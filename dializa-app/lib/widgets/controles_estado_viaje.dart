import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

/// Botones con los que el chofer avanza la maquina de estados de un viaje
/// (docs/ESTADOS_VIAJE.md). Sirve tanto para `viajes/{pacienteId}` (los
/// que asigna el admin) como para `solicitudes/{id}` (los que pide el
/// paciente).
///
/// CORRECCION "el chofer no puede terminar el viaje": la version anterior
/// de estos botones (dentro de chofer_home.dart) tenia tres problemas:
///   1. Creaba un stream nuevo en cada reconstruccion. Mientras ese stream
///      no entregaba datos, el estado se asumia 'asignado' y el boton
///      mostraba "Voy en camino" aunque el viaje estuviera 'en_viaje'. Si
///      el chofer tocaba en ese instante, el servidor rechazaba el cambio.
///   2. No se bloqueaba mientras la llamada estaba en curso: un doble toque
///      en "Finalizar viaje" mandaba dos llamadas y la segunda fallaba con
///      "No se puede pasar de 'finalizado' a 'finalizado'".
///   3. Mostraba "Cancelar" durante 'en_viaje', que el servidor no permite.
/// Ademas, el envio de GPS pendiente (antesDeFinalizar) nunca puede
/// bloquear el cierre: tiene un tiempo maximo y sus errores se ignoran.
class ControlesEstadoViaje extends StatefulWidget {
  const ControlesEstadoViaje({
    super.key,
    required this.coleccion,
    required this.id,
    this.antesDeFinalizar,
  });

  /// 'viajes' o 'solicitudes'.
  final String coleccion;
  final String id;

  /// Se ejecuta justo antes de finalizar (por ejemplo, para enviar las
  /// ultimas muestras GPS). Nunca impide finalizar.
  final Future<void> Function()? antesDeFinalizar;

  @override
  State<ControlesEstadoViaje> createState() => _ControlesEstadoViajeState();
}

class _ControlesEstadoViajeState extends State<ControlesEstadoViaje> {
  final _functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');

  late DocumentReference<Map<String, dynamic>> _ref;
  late Stream<DocumentSnapshot<Map<String, dynamic>>> _stream;
  bool _enviando = false;

  static const _siguienteEstado = {
    'asignado': 'conductor_en_camino',
    'conductor_en_camino': 'conductor_llego',
    'conductor_llego': 'en_viaje',
    'en_viaje': 'finalizado',
  };
  static const _etiquetaBoton = {
    'asignado': 'Voy en camino',
    'conductor_en_camino': 'Llegué',
    'conductor_llego': 'Iniciar viaje',
    'en_viaje': 'Finalizar viaje',
  };
  static const _estadosCancelables = ['asignado', 'conductor_en_camino', 'conductor_llego'];

  @override
  void initState() {
    super.initState();
    _crearStream();
  }

  @override
  void didUpdateWidget(covariant ControlesEstadoViaje oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coleccion != widget.coleccion || oldWidget.id != widget.id) {
      _crearStream();
    }
  }

  void _crearStream() {
    _ref = FirebaseFirestore.instance.collection(widget.coleccion).doc(widget.id);
    _stream = _ref.snapshots();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: _stream,
      builder: (context, snapshot) {
        // Sin datos todavia: NO se asume ningun estado (ver punto 1 arriba).
        if (!snapshot.hasData) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: LinearProgressIndicator(),
          );
        }

        final estado = snapshot.data!.data()?['estado'] as String? ?? 'asignado';

        if (estado == 'finalizado' || estado == 'cancelado') {
          return Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              estado == 'finalizado' ? 'Viaje finalizado.' : 'Viaje cancelado.',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          );
        }

        final proximo = _siguienteEstado[estado];
        final puedeCancelar = _estadosCancelables.contains(estado);

        return Row(
          children: [
            if (proximo != null)
              Expanded(
                child: ElevatedButton(
                  onPressed: _enviando ? null : () => _avanzarEstado(proximo),
                  child: _enviando
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(_etiquetaBoton[estado] ?? 'Avanzar'),
                ),
              ),
            if (puedeCancelar) ...[
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: _enviando ? null : _confirmarCancelacion,
                style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                child: const Text('Cancelar'),
              ),
            ],
          ],
        );
      },
    );
  }

  Future<void> _avanzarEstado(String nuevoEstado) async {
    setState(() => _enviando = true);

    try {
      if (nuevoEstado == 'finalizado' && widget.antesDeFinalizar != null) {
        try {
          await widget.antesDeFinalizar!().timeout(const Duration(seconds: 5));
        } catch (_) {
          // El GPS pendiente nunca impide terminar el viaje.
        }
      }

      await _functions.httpsCallable('actualizarEstadoViaje').call<Map<String, dynamic>>({
        'coleccion': widget.coleccion,
        'id': widget.id,
        'nuevoEstado': nuevoEstado,
      });
    } on FirebaseFunctionsException catch (e) {
      // Si el viaje YA quedo en el estado pedido (reintento, doble toque o
      // respuesta perdida por mala senal), no es un error real.
      if (!await _yaEstaEn(nuevoEstado)) {
        _mostrarError('No se pudo actualizar el viaje: ${e.message ?? e.code}');
      }
    } catch (e) {
      if (!await _yaEstaEn(nuevoEstado)) {
        _mostrarError('No se pudo actualizar el viaje. Revisa tu conexión e intenta de nuevo.');
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<bool> _yaEstaEn(String estado) async {
    try {
      final doc = await _ref.get(const GetOptions(source: Source.server));
      return doc.data()?['estado'] == estado;
    } catch (_) {
      return false;
    }
  }

  Future<void> _confirmarCancelacion() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancelar viaje'),
        content: const Text('¿Seguro que quieres cancelar este viaje?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('No')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sí, cancelar')),
        ],
      ),
    );
    if (confirmar != true || !mounted) return;

    setState(() => _enviando = true);
    try {
      await _functions.httpsCallable('cancelarAsignacionConductor').call<Map<String, dynamic>>({
        'coleccion': widget.coleccion,
        'id': widget.id,
      });
    } on FirebaseFunctionsException catch (e) {
      if (!await _yaEstaEn('cancelado')) {
        _mostrarError('No se pudo cancelar: ${e.message ?? e.code}');
      }
    } catch (e) {
      if (!await _yaEstaEn('cancelado')) {
        _mostrarError('No se pudo cancelar. Revisa tu conexión e intenta de nuevo.');
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  void _mostrarError(String mensaje) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
  }
}
