import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../config/centro_dialisis.dart';
import '../services/geoapify_service.dart';
import '../services/ubicacion_actual.dart';
import 'mapa_chofer_en_vivo.dart';

/// Seccion de la pantalla del paciente para:
///   1. Pedir un traslado desde la app (Cloud Function `crearSolicitudViaje`).
///   2. Ver el estado del traslado y, cuando un chofer va en camino, verlo
///      en un mapa en tiempo real.
///
/// Considera los dos tipos de viaje:
///   - `solicitudes`: los que pide el propio paciente con el boton.
///   - `viajes/{uid}`: el que asigna el administrador.
class SeccionTrasladoPaciente extends StatefulWidget {
  const SeccionTrasladoPaciente({
    super.key,
    this.direccionInicial,
    this.necesitaMovilidad = false,
  });

  /// Direccion de retiro que el paciente ya escribio en el formulario.
  final String? direccionInicial;
  final bool necesitaMovilidad;

  @override
  State<SeccionTrasladoPaciente> createState() => _SeccionTrasladoPacienteState();
}

class _SeccionTrasladoPacienteState extends State<SeccionTrasladoPaciente> {
  final _functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');
  final _uid = FirebaseAuth.instance.currentUser!.uid;

  late final _streamSolicitudes = FirebaseFirestore.instance
      .collection('solicitudes')
      .where('pacienteId', isEqualTo: _uid)
      .snapshots();
  late final _streamViajeAsignado =
      FirebaseFirestore.instance.collection('viajes').doc(_uid).snapshots();

  bool _pidiendo = false;

  static const _estadosActivos = [
    'solicitado',
    'asignado',
    'conductor_en_camino',
    'conductor_llego',
    'en_viaje',
  ];

  /// Estados en los que el servidor autoriza al paciente a ver la
  /// ubicacion del chofer (functions/autorizacionUbicacion.js).
  static const _estadosConMapaSolicitud = ['asignado', 'conductor_en_camino', 'conductor_llego', 'en_viaje'];
  static const _estadosConMapaViaje = ['conductor_en_camino', 'conductor_llego', 'en_viaje'];

  static const _textoEstado = {
    'solicitado': 'Buscando un chofer disponible…',
    'asignado': 'Un chofer aceptó tu traslado',
    'conductor_en_camino': 'El chofer va en camino',
    'conductor_llego': 'El chofer llegó a buscarte',
    'en_viaje': 'En viaje al centro de diálisis',
  };

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _streamSolicitudes,
      builder: (context, snapSolicitudes) {
        return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          stream: _streamViajeAsignado,
          builder: (context, snapViaje) {
            if (!snapSolicitudes.hasData && !snapSolicitudes.hasError) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: LinearProgressIndicator(),
              );
            }

            // Solicitud activa mas reciente (si hay).
            final activas = (snapSolicitudes.data?.docs ?? [])
                .where((d) => _estadosActivos.contains(d.data()['estado']))
                .toList()
              ..sort((a, b) => (b.data()['creadoEn'] as String? ?? '')
                  .compareTo(a.data()['creadoEn'] as String? ?? ''));
            final solicitud = activas.isNotEmpty ? activas.first : null;

            final viaje = snapViaje.data?.data();
            final estadoViaje = viaje?['estado'] as String? ?? 'asignado';
            final viajeEnCurso = viaje != null && _estadosConMapaViaje.contains(estadoViaje);

            if (solicitud != null) {
              return _buildTarjetaSolicitud(solicitud.data());
            }
            if (viajeEnCurso) {
              return _buildTarjetaViajeAsignado(viaje);
            }
            return _buildPedirTraslado();
          },
        );
      },
    );
  }

  // ---------------------------------------------------------------------
  // Traslado pedido por el paciente
  // ---------------------------------------------------------------------

  Widget _buildTarjetaSolicitud(Map<String, dynamic> datos) {
    final estado = datos['estado'] as String? ?? 'solicitado';
    final choferId = datos['conductorId'] as String?;
    final origen = datos['origen'] as Map<String, dynamic>?;
    final puntoPaciente = origen == null
        ? null
        : PuntoMapa((origen['lat'] as num).toDouble(), (origen['lng'] as num).toDouble());

    return _TarjetaTraslado(
      titulo: _textoEstado[estado] ?? estado,
      buscando: estado == 'solicitado',
      choferId: choferId,
      mostrarMapa: choferId != null && _estadosConMapaSolicitud.contains(estado),
      puntoPaciente: puntoPaciente,
    );
  }

  // ---------------------------------------------------------------------
  // Viaje asignado por el administrador
  // ---------------------------------------------------------------------

  Widget _buildTarjetaViajeAsignado(Map<String, dynamic> datos) {
    final estado = datos['estado'] as String? ?? 'asignado';
    return _TarjetaTraslado(
      titulo: _textoEstado[estado] ?? estado,
      buscando: false,
      choferId: datos['choferId'] as String?,
      nombreChofer: datos['choferNombre'] as String?,
      mostrarMapa: true,
    );
  }

  // ---------------------------------------------------------------------
  // Pedir traslado
  // ---------------------------------------------------------------------

  Widget _buildPedirTraslado() {
    return Card(
      color: Colors.blue.shade50,
      margin: const EdgeInsets.only(bottom: 20),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              '¿Necesitas que te busquen ahora?',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            const Text(
              'Pide un traslado y un chofer disponible lo aceptará.',
              style: TextStyle(fontSize: 16),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 56,
              child: ElevatedButton.icon(
                onPressed: _pidiendo ? null : _abrirDialogoPedir,
                icon: _pidiendo
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.local_taxi),
                label: const Text('Pedir traslado', style: TextStyle(fontSize: 18)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _abrirDialogoPedir() async {
    final direccionController = TextEditingController(text: widget.direccionInicial ?? '');
    final notasController = TextEditingController();
    var sillaRuedas = widget.necesitaMovilidad;

    final confirmar = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setStateDialogo) => AlertDialog(
          title: const Text('Pedir traslado'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: direccionController,
                  decoration: const InputDecoration(
                    labelText: '¿Dónde te buscamos?',
                    hintText: 'Ej: Av. Providencia 1234, Santiago',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: notasController,
                  decoration: const InputDecoration(
                    labelText: 'Nota para el chofer (opcional)',
                    hintText: 'Ej: depto 302, tocar el timbre',
                  ),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Necesito ayuda de movilidad'),
                  value: sillaRuedas,
                  onChanged: (v) => setStateDialogo(() => sillaRuedas = v),
                ),
                const Text(
                  'Usaremos la ubicación de tu teléfono para que el chofer te encuentre.',
                  style: TextStyle(fontSize: 13, color: Colors.grey),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Volver')),
            ElevatedButton(onPressed: () => Navigator.pop(context, true), child: const Text('Pedir')),
          ],
        ),
      ),
    );

    final direccion = direccionController.text.trim();
    final notas = notasController.text.trim();
    // Los controladores no se liberan aqui a proposito: el dialogo todavia
    // los usa durante su animacion de cierre.

    if (confirmar != true) return;
    if (direccion.isEmpty) {
      _mostrar('Escribe la dirección donde te deben buscar.');
      return;
    }
    await _pedirTraslado(direccion: direccion, notas: notas, sillaRuedas: sillaRuedas);
  }

  Future<void> _pedirTraslado({
    required String direccion,
    required String notas,
    required bool sillaRuedas,
  }) async {
    setState(() => _pidiendo = true);

    try {
      // El servidor exige coordenadas de origen: se usa el GPS del telefono.
      final ubicacion = await obtenerUbicacionActual();
      if (ubicacion is! UbicacionExito) {
        final mensaje = switch (ubicacion) {
          UbicacionServicioDesactivado() => 'Activa el GPS del teléfono para pedir el traslado.',
          UbicacionSinPermiso() => 'Necesitas dar permiso de ubicación para pedir el traslado.',
          UbicacionTimeout() => 'No se pudo obtener tu ubicación. Intenta de nuevo.',
          UbicacionError(mensaje: final m) => 'Error de ubicación: $m',
          _ => 'No se pudo obtener tu ubicación.',
        };
        _mostrar(mensaje);
        return;
      }

      await _functions.httpsCallable('crearSolicitudViaje').call<Map<String, dynamic>>({
        'origen': {'lat': ubicacion.lat, 'lng': ubicacion.lng, 'direccion': direccion},
        'destino': {
          'lat': CentroDialisis.ubicacion.lat,
          'lng': CentroDialisis.ubicacion.lng,
          'direccion': CentroDialisis.direccion,
        },
        'necesidades': {'sillaRuedas': sillaRuedas},
        'notas': notas.isEmpty ? null : notas,
        'direccionTexto': direccion,
      });
      _mostrar('Traslado pedido. Te avisaremos cuando un chofer lo acepte.', exito: true);
    } on FirebaseFunctionsException catch (e) {
      _mostrar('No se pudo pedir el traslado: ${e.message ?? e.code}');
    } catch (e) {
      _mostrar('No se pudo pedir el traslado. Revisa tu conexión.');
    } finally {
      if (mounted) setState(() => _pidiendo = false);
    }
  }

  void _mostrar(String mensaje, {bool exito = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(mensaje, style: const TextStyle(fontSize: 16)),
        backgroundColor: exito ? Colors.green : null,
      ),
    );
  }
}

/// Tarjeta con el estado del traslado, el nombre del chofer y el mapa.
class _TarjetaTraslado extends StatefulWidget {
  const _TarjetaTraslado({
    required this.titulo,
    required this.buscando,
    required this.choferId,
    required this.mostrarMapa,
    this.nombreChofer,
    this.puntoPaciente,
  });

  final String titulo;
  final bool buscando;
  final String? choferId;
  final String? nombreChofer;
  final bool mostrarMapa;
  final PuntoMapa? puntoPaciente;

  @override
  State<_TarjetaTraslado> createState() => _TarjetaTrasladoState();
}

class _TarjetaTrasladoState extends State<_TarjetaTraslado> {
  Future<DocumentSnapshot<Map<String, dynamic>>>? _chofer;
  String? _choferCargado;

  @override
  Widget build(BuildContext context) {
    final choferId = widget.choferId;
    if (widget.nombreChofer == null && choferId != null && choferId != _choferCargado) {
      _choferCargado = choferId;
      _chofer = FirebaseFirestore.instance.collection('usuarios').doc(choferId).get();
    }

    return Card(
      color: Colors.green.shade50,
      margin: const EdgeInsets.only(bottom: 20),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                if (widget.buscando)
                  const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                else
                  const Icon(Icons.directions_car, color: Colors.green),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    widget.titulo,
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            if (choferId != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: widget.nombreChofer != null
                    ? Text('Chofer: ${widget.nombreChofer}', style: const TextStyle(fontSize: 16))
                    : FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                        future: _chofer,
                        builder: (context, snap) {
                          final nombre = snap.data?.data()?['nombre'] as String?;
                          return Text(
                            nombre != null ? 'Chofer: $nombre' : 'Chofer asignado',
                            style: const TextStyle(fontSize: 16),
                          );
                        },
                      ),
              ),
            if (widget.mostrarMapa && choferId != null) ...[
              const SizedBox(height: 12),
              MapaChoferEnVivo(
                key: ValueKey('mapa_$choferId'),
                choferId: choferId,
                puntoPaciente: widget.puntoPaciente,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
