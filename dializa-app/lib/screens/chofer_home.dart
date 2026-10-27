import 'dart:async';

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import 'login_screen.dart';
import '../services/auth_service.dart';
import '../services/identidad_viaje.dart';
import '../services/seguimiento_gps.dart';
import 'registro_conductor_screen.dart';
import '../config/feature_flags.dart';
import '../services/geoapify_service.dart';
import '../services/ubicacion_actual.dart';
import '../services/ubicacion_repository.dart';
import '../widgets/mapa_ruta.dart';
import '../widgets/controles_viaje.dart';

/// Panel del chofer.
///
/// Muestra la lista de viajes que el administrador le asignó a este
/// chofer (colección `viajes`, filtrando por `choferId == uid actual`).
///
/// Para cada viaje, busca el nombre del paciente (colección `usuarios`)
/// y su respuesta de asistencia (colección `respuestas_paciente`) para
/// mostrar si necesita ayuda de movilidad.
///
/// Nota: todavía no muestra dirección ni mapa — eso se agrega en la
/// siguiente etapa, cuando se integre Google Maps.
class ChoferHome extends StatefulWidget {
  const ChoferHome({super.key});

  @override
  State<ChoferHome> createState() => _ChoferHomeState();
}

class _ChoferHomeState extends State<ChoferHome> {
  SeguimientoGps? _seguimiento;
  @override
  void dispose() {
    final tracker = _seguimiento;
    if (tracker != null) unawaited(tracker.cerrar());
    super.dispose();
  }

  final _firestore = FirebaseFirestore.instance;
  final _functions = FirebaseFunctions.instanceFor(
    region: 'southamerica-east1',
  );

  Future<void> _cerrarSesion() async {
    await AuthService().cerrarSesion();

    if (!mounted) return;

    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  final _ubicacionRepository = UbicacionRepository();
  bool _compartiendoUbicacion = false;

  Future<void> _cambiarDisponibilidad(bool disponible) async {
    try {
      await _functions
          .httpsCallable('actualizarDisponibilidad')
          .call<Map<String, dynamic>>({'disponible': disponible});
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('No se pudo actualizar tu disponibilidad: $e'),
          ),
        );
      }
    }
  }

  /// Punto 8.7/12.8: empuja la ubicación actual del chofer a Realtime
  /// Database una vez (no es seguimiento continuo en segundo plano, ver
  /// comentario en ubicacion_repository.dart).
  Future<void> _compartirUbicacionAhora() async {
    setState(() => _compartiendoUbicacion = true);

    final resultado = await obtenerUbicacionActual();

    if (resultado is UbicacionExito) {
      await _ubicacionRepository.actualizarUbicacion(
        lat: resultado.lat,
        lng: resultado.lng,
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Ubicación compartida.')));
      }
    } else if (mounted) {
      final mensaje = switch (resultado) {
        UbicacionTimeout() => 'No se pudo obtener tu ubicación a tiempo.',
        UbicacionSinPermiso() => 'Necesitas conceder permiso de ubicación.',
        UbicacionServicioDesactivado() => 'Activa el GPS de tu dispositivo.',
        UbicacionError(mensaje: final m) => 'Error: $m',
        _ => 'No se pudo obtener tu ubicación.',
      };
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(mensaje)));
    }

    if (mounted) setState(() => _compartiendoUbicacion = false);
  }

  @override
  Widget build(BuildContext context) {
    final uidChofer = FirebaseAuth.instance.currentUser!.uid;

    // Puntos 9.4/13.12: un chofer no puede ver sus viajes hasta que un
    // admin lo apruebe. Mientras tanto se muestra el formulario de
    // registro (o un aviso de "pendiente de aprobación" si ya lo envió).
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: _firestore.collection('usuarios').doc(uidChofer).snapshots(),
      builder: (context, snapshotUsuario) {
        final aprobado =
            snapshotUsuario.data?.data()?['aprobado'] as bool? ?? false;

        if (!snapshotUsuario.hasData) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        if (snapshotUsuario.data?.data()?['activo'] != true) {
          _seguimiento = null;
          unawaited(SeguimientoGps.detenerTodos());
          return Scaffold(
            appBar: AppBar(title: const Text('Cuenta desactivada')),
            body: Center(
              child: TextButton(
                onPressed: _cerrarSesion,
                child: const Text('Cerrar sesion'),
              ),
            ),
          );
        }
        if (!aprobado) {
          if (_seguimiento != null) {
            _seguimiento = null;
            unawaited(SeguimientoGps.detenerTodos());
          }
          return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
            future: _firestore
                .collection('choferes_privado')
                .doc(uidChofer)
                .get(),
            builder: (context, snapshotPrivado) {
              final yaEnviado = snapshotPrivado.data?.exists ?? false;
              return Scaffold(
                appBar: AppBar(
                  title: const Text('Panel de Chofer'),
                  actions: [
                    IconButton(
                      icon: const Icon(Icons.logout),
                      tooltip: 'Cerrar sesión',
                      onPressed: _cerrarSesion,
                    ),
                  ],
                ),
                body: snapshotPrivado.connectionState == ConnectionState.waiting
                    ? const Center(child: CircularProgressIndicator())
                    : RegistroConductorScreen(yaEnviado: yaEnviado),
              );
            },
          );
        }

        if (_seguimiento == null) {
          _seguimiento = SeguimientoGps(uidChofer);
          unawaited(_seguimiento!.iniciar());
        }
        return Scaffold(
          appBar: AppBar(
            title: const Text('Panel de Chofer'),
            actions: [
              IconButton(
                icon: const Icon(Icons.logout),
                tooltip: 'Cerrar sesión',
                onPressed: _cerrarSesion,
              ),
            ],
          ),
          body: Column(
            children: [
              _buildTogleDisponibilidad(uidChofer),
              if (_seguimiento != null)
                AnimatedBuilder(
                  animation: _seguimiento!,
                  builder: (context, _) => Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(_seguimiento!.estado),
                  ),
                ),
              Expanded(child: _buildListaViajes(uidChofer)),
            ],
          ),
        );
      },
    );
  }

  /// Punto 13.5: el chofer activa/desactiva si está disponible para
  /// recibir viajes.
  Widget _buildTogleDisponibilidad(String uidChofer) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: _firestore
          .collection('choferes_privado')
          .doc(uidChofer)
          .snapshots(),
      builder: (context, snapshot) {
        final disponible =
            snapshot.data?.data()?['disponible'] as bool? ?? false;
        return Container(
          color: disponible ? Colors.green.shade50 : Colors.grey.shade200,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Column(
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  disponible ? 'Disponible para viajes' : 'No disponible',
                ),
                value: disponible,
                onChanged: _cambiarDisponibilidad,
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _compartiendoUbicacion
                      ? null
                      : _compartirUbicacionAhora,
                  icon: _compartiendoUbicacion
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.my_location),
                  label: const Text('Compartir mi ubicación ahora'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildListaViajes(String uidChofer) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _firestore
          .collection('viajes')
          .where('choferId', isEqualTo: uidChofer)
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(child: Text('Error al cargar: ${snapshot.error}'));
        }

        final viajes = (snapshot.data?.docs ?? [])
            .where(
              (doc) => !const [
                'finalizado',
                'cancelado',
              ].contains(doc.data()['estado']),
            )
            .toList();

        if (viajes.isEmpty) {
          return const Center(
            child: Text(
              'No tienes viajes asignados por ahora.',
              style: TextStyle(fontSize: 16),
              textAlign: TextAlign.center,
            ),
          );
        }

        // Ordena por fecha y hora (texto en formato AAAA-MM-DD y HH:mm,
        // que se ordenan correctamente como texto).
        final viajesOrdenados = [...viajes]
          ..sort((a, b) {
            final fechaA = '${a.data()['fecha']} ${a.data()['hora']}';
            final fechaB = '${b.data()['fecha']} ${b.data()['hora']}';
            return fechaA.compareTo(fechaB);
          });

        return ListView.builder(
          padding: const EdgeInsets.all(12),
          itemCount: viajesOrdenados.length,
          itemBuilder: (context, index) {
            final doc = viajesOrdenados[index];
            final pacienteId = doc.id;
            final fecha = doc.data()['fecha'] as String? ?? '';
            final hora = doc.data()['hora'] as String? ?? '';

            return _TarjetaViaje(
              pacienteId: pacienteId,
              fecha: fecha,
              hora: hora,
            );
          },
        );
      },
    );
  }
}

// =============================================================================
// Widgets auxiliares
// =============================================================================

/// Ubicacion de referencia del centro de dialisis, usada como origen de
/// la ruta mientras no se porte el seguimiento de ubicacion en vivo del
/// chofer (RealtimeLocationRepository.kt / RTDB de daily-app). Reemplazar
/// por la ubicacion real del centro, o por el GPS del chofer una vez que
/// esa parte se porte.
const PuntoMapa _ubicacionCentroDialisis = PuntoMapa(
  -33.4489,
  -70.6693,
); // Plaza de Armas, Santiago (placeholder)

/// Tarjeta que muestra un viaje asignado: nombre del paciente, hora, y
/// si necesita ayuda de movilidad o que lo busquen. Si el paciente cargo
/// una direccion de retiro, permite calcular la ruta (Geoapify Routing
/// API) y verla en un mapa, ademas de probar el ajuste a la via (Geoapify
/// Map Matching API) sobre esa misma ruta.
class _TarjetaViaje extends StatefulWidget {
  final String pacienteId;
  final String fecha;
  final String hora;

  const _TarjetaViaje({
    required this.pacienteId,
    required this.fecha,
    required this.hora,
  });

  @override
  State<_TarjetaViaje> createState() => _TarjetaViajeState();
}

class _TarjetaViajeState extends State<_TarjetaViaje> {
  bool _enviando = false;
  final _geoapifyService = GeoapifyService();
  final _functions = FirebaseFunctions.instanceFor(
    region: 'southamerica-east1',
  );
  final _firestore = FirebaseFirestore.instance;

  bool _calculandoRuta = false;
  bool _probandoMapMatching = false;
  RutaCalculada? _ruta;
  String? _errorRuta;
  String? _resultadoMapMatching;

  Future<void> _calcularRuta(PuntoMapa destino) async {
    setState(() {
      _calculandoRuta = true;
      _errorRuta = null;
    });

    try {
      final ruta = await _geoapifyService.calcularRuta(
        waypoints: [_ubicacionCentroDialisis, destino],
      );
      setState(() {
        _ruta = ruta;
        _calculandoRuta = false;
      });
    } catch (e) {
      setState(() {
        _calculandoRuta = false;
        _errorRuta = 'No se pudo calcular la ruta: $e';
      });
    }
  }

  /// Prueba la Map Matching API con un par de puntos GPS de ejemplo
  /// tomados de la ruta ya calculada, simulando lecturas GPS reales con
  /// timestamps consecutivos. Sirve para verificar que la tercera clave
  /// (map matching) funciona de punta a punta, mientras no exista todavia
  /// seguimiento de ubicacion en vivo del chofer.
  Future<void> _probarMapMatching() async {
    final ruta = _ruta;
    if (ruta == null || ruta.puntosRuta.length < 2) return;

    setState(() {
      _probandoMapMatching = true;
      _resultadoMapMatching = null;
    });

    final ahora = DateTime.now();
    final indiceMedio = ruta.puntosRuta.length ~/ 2;
    final puntosDePrueba = [
      PuntoGps(
        lat: ruta.puntosRuta.first.lat,
        lng: ruta.puntosRuta.first.lng,
        timestamp: ahora,
      ),
      PuntoGps(
        lat: ruta.puntosRuta[indiceMedio].lat,
        lng: ruta.puntosRuta[indiceMedio].lng,
        timestamp: ahora.add(const Duration(minutes: 3)),
      ),
      PuntoGps(
        lat: ruta.puntosRuta.last.lat,
        lng: ruta.puntosRuta.last.lng,
        timestamp: ahora.add(const Duration(minutes: 6)),
      ),
    ];

    try {
      final puntosAjustados = await _geoapifyService.ajustarRutaGps(
        puntos: puntosDePrueba,
      );
      setState(() {
        _probandoMapMatching = false;
        _resultadoMapMatching =
            'Map Matching OK: ${puntosAjustados.length} puntos ajustados a la vía.';
      });
    } catch (e) {
      setState(() {
        _probandoMapMatching = false;
        _resultadoMapMatching = 'Error al probar Map Matching: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.schedule, size: 20),
                const SizedBox(width: 6),
                Text(
                  '${widget.fecha} — ${widget.hora}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const Divider(),
            _buildDatosPaciente(),
          ],
        ),
      ),
    );
  }

  Widget _buildDatosPaciente() {
    return FutureBuilder<List<DocumentSnapshot<Map<String, dynamic>>>>(
      future: Future.wait([
        FirebaseFirestore.instance
            .collection('usuarios')
            .doc(widget.pacienteId)
            .get(),
        FirebaseFirestore.instance
            .collection('respuestas_paciente')
            .doc(widget.pacienteId)
            .get(),
      ]),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: LinearProgressIndicator(),
          );
        }

        final usuarioDoc = snapshot.data![0];
        final respuestaDoc = snapshot.data![1];

        final nombre =
            (usuarioDoc.data()?['nombre'] as String?) ?? '(sin nombre)';

        final necesitaMovilidad =
            (respuestaDoc.data()?['necesitaMovilidad'] as bool?) ?? false;
        final comoLlega = respuestaDoc.data()?['comoLlega'] as String?;
        final direccion =
            respuestaDoc.data()?['direccion'] as Map<String, dynamic>?;

        PuntoMapa? destino;
        if (direccion != null) {
          destino = PuntoMapa(
            (direccion['lat'] as num).toDouble(),
            (direccion['lng'] as num).toDouble(),
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              nombre,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            if (comoLlega == 'necesita_busqueda')
              const Text(
                'Necesita que lo busquen',
                style: TextStyle(color: Colors.blue),
              ),
            if (necesitaMovilidad)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text(
                  '⚠ Necesita ayuda de movilidad para subir al vehículo',
                  style: TextStyle(
                    color: Colors.orange,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            if (destino != null) ...[
              const SizedBox(height: 10),
              Text(
                direccion!['etiqueta'] as String? ?? '',
                style: const TextStyle(color: Colors.grey),
              ),
              const SizedBox(height: 8),
            ],
            // Punto 6.9: Geoapify queda integrado pero desactivado hasta
            // nuevo aviso -- mientras FeatureFlags.geoapifyHabilitado sea
            // false, no se muestran los botones de ruta/map matching.
            if (destino != null && FeatureFlags.geoapifyHabilitado) ...[
              if (_ruta == null)
                OutlinedButton.icon(
                  onPressed: _calculandoRuta
                      ? null
                      : () => _calcularRuta(destino!),
                  icon: _calculandoRuta
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.directions),
                  label: const Text('Calcular ruta hasta el paciente'),
                )
              else ...[
                MapaRuta(
                  origen: _ubicacionCentroDialisis,
                  destino: destino,
                  ruta: _ruta,
                ),
                const SizedBox(height: 8),
                Text(
                  'Distancia: ${_ruta!.distanciaLegible} · Tiempo estimado: ${_ruta!.duracionLegible}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _probandoMapMatching ? null : _probarMapMatching,
                  icon: _probandoMapMatching
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.route),
                  label: const Text('Probar ajuste GPS (map matching)'),
                ),
                if (_resultadoMapMatching != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      _resultadoMapMatching!,
                      style: TextStyle(
                        color: _resultadoMapMatching!.startsWith('Error')
                            ? Colors.red
                            : Colors.green,
                      ),
                    ),
                  ),
              ],
              if (_errorRuta != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    _errorRuta!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
            ],
            const SizedBox(height: 10),
            _buildProgresoViaje(),
          ],
        );
      },
    );
  }

  /// Punto 13.2: botones para avanzar la máquina de estados del viaje
  /// (ver docs/ESTADOS_VIAJE.md) y para cancelar la asignación. Llama a
  /// la Cloud Function actualizarEstadoViaje / cancelarAsignacionConductor
  /// sobre la colección 'viajes' (la asignación manual del admin), que es
  /// la que ya existía en dializa-app.
  Widget _buildProgresoViaje() {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: _firestore
          .collection('viajes')
          .doc(widget.pacienteId)
          .snapshots(),
      builder: (context, snapshot) {
        final datos = snapshot.data?.data();
        if (datos == null) return const SizedBox.shrink();
        final estado = datos['estado'] as String? ?? 'asignado';
        final viajeId = identidadViaje(widget.pacienteId, datos);

        return ControlesViaje(
          estado: estado,
          enviando: _enviando,
          onAvanzar: (nuevo) => _avanzarEstado(nuevo, viajeId, estado),
          onCancelar: () => _cancelarAsignacion(viajeId, estado),
        );
      },
    );
  }

  Future<void> _avanzarEstado(
    String nuevoEstado,
    String viajeId,
    String estadoEsperado,
  ) async {
    setState(() => _enviando = true);
    try {
      if (nuevoEstado == 'finalizado') {
        await SeguimientoGps.prepararCierre(viajeId);
      }
      await _functions
          .httpsCallable('actualizarEstadoViaje')
          .call<Map<String, dynamic>>({
            'coleccion': 'viajes',
            'id': widget.pacienteId,
            'nuevoEstado': nuevoEstado,
            'viajeId': viajeId,
            'estadoEsperado': estadoEsperado,
          });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('No se pudo actualizar: $e')));
        unawaited(SeguimientoGps.reanudarTodos().catchError((Object _) {}));
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _cancelarAsignacion(
    String viajeId,
    String estadoEsperado,
  ) async {
    setState(() => _enviando = true);
    try {
      await _functions
          .httpsCallable('cancelarAsignacionConductor')
          .call<Map<String, dynamic>>({
            'viajeId': viajeId,
            'estadoEsperado': estadoEsperado,
            'coleccion': 'viajes',
            'id': widget.pacienteId,
          });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('No se pudo cancelar: $e')));
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }
}
