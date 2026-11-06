import 'dart:async';

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'login_screen.dart';
import '../services/auth_service.dart';
import 'registro_conductor_screen.dart';
import '../config/feature_flags.dart';
import '../services/geoapify_service.dart';
import '../services/ubicacion_actual.dart';
import '../services/ubicacion_repository.dart';
import '../services/seguimiento_ubicacion.dart';
import '../widgets/controles_estado_viaje.dart';
import '../widgets/mapa_ruta.dart';

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
  final _firestore = FirebaseFirestore.instance;
  final _functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');

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

  // ---------------------------------------------------------------------
  // Seguimiento GPS en vivo: se enciende solo cuando el chofer tiene un
  // viaje activo y se apaga al finalizarlo o cancelarlo.
  // ---------------------------------------------------------------------
  final _seguimiento = SeguimientoUbicacion();
  Stream<QuerySnapshot<Map<String, dynamic>>>? _streamViajes;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _subViajes;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _subSolicitudes;
  List<QueryDocumentSnapshot<Map<String, dynamic>>> _viajesDelChofer = [];
  List<QueryDocumentSnapshot<Map<String, dynamic>>> _solicitudesDelChofer = [];

  static const _prioridadEstado = {
    'en_viaje': 4,
    'conductor_llego': 3,
    'conductor_en_camino': 2,
    'asignado': 1,
  };

  @override
  void initState() {
    super.initState();
    final uid = FirebaseAuth.instance.currentUser!.uid;
    _subViajes = _firestore
        .collection('viajes')
        .where('choferId', isEqualTo: uid)
        .snapshots()
        .listen((s) {
      _viajesDelChofer = s.docs;
      _actualizarSeguimiento();
    }, onError: (_) {});
    _subSolicitudes = _firestore
        .collection('solicitudes')
        .where('conductorId', isEqualTo: uid)
        .snapshots()
        .listen((s) {
      _solicitudesDelChofer = s.docs;
      _actualizarSeguimiento();
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _subViajes?.cancel();
    _subSolicitudes?.cancel();
    _seguimiento.dispose();
    super.dispose();
  }

  /// Busca el viaje activo mas avanzado y enciende/apaga el GPS en vivo.
  /// Mismos estados que autorizan al paciente a ver la ubicacion
  /// (functions/autorizacionUbicacion.js).
  void _actualizarSeguimiento() {
    String? coleccion;
    String? id;
    var mejor = 0;

    for (final doc in _viajesDelChofer) {
      final estado = doc.data()['estado'] as String? ?? 'asignado';
      if (estado == 'asignado') continue; // aun no sale
      final p = _prioridadEstado[estado] ?? 0;
      if (p > mejor) {
        mejor = p;
        coleccion = 'viajes';
        id = doc.id;
      }
    }
    for (final doc in _solicitudesDelChofer) {
      final estado = doc.data()['estado'] as String? ?? '';
      final p = _prioridadEstado[estado] ?? 0;
      if (p > mejor) {
        mejor = p;
        coleccion = 'solicitudes';
        id = doc.id;
      }
    }

    if (coleccion != null && id != null) {
      _seguimiento.iniciar(coleccion: coleccion, id: id);
    } else if (_seguimiento.activo.value) {
      _seguimiento.detener();
    }
  }

  Future<void> _cambiarDisponibilidad(bool disponible) async {
    try {
      await _functions.httpsCallable('actualizarDisponibilidad').call<Map<String, dynamic>>({
        'disponible': disponible,
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No se pudo actualizar tu disponibilidad: $e')),
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
      // Antes, si esta escritura fallaba el boton quedaba cargando para
      // siempre. Ahora se renueva el token (claim `rol`) y se informa el
      // error.
      String mensaje = 'Ubicación compartida.';
      try {
        await FirebaseAuth.instance.currentUser?.getIdToken(true);
        await _ubicacionRepository.actualizarUbicacion(lat: resultado.lat, lng: resultado.lng);
      } catch (e) {
        mensaje = 'No se pudo compartir tu ubicación: $e';
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(mensaje)),
        );
      }
    } else if (mounted) {
      final mensaje = switch (resultado) {
        UbicacionTimeout() => 'No se pudo obtener tu ubicación a tiempo.',
        UbicacionSinPermiso() => 'Necesitas conceder permiso de ubicación.',
        UbicacionServicioDesactivado() => 'Activa el GPS de tu dispositivo.',
        UbicacionError(mensaje: final m) => 'Error: $m',
        _ => 'No se pudo obtener tu ubicación.',
      };
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
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
        final aprobado = snapshotUsuario.data?.data()?['aprobado'] as bool? ?? false;

        if (!snapshotUsuario.hasData) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }

        if (!aprobado) {
          return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
            future: _firestore.collection('choferes_privado').doc(uidChofer).get(),
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
              _buildAvisoSeguimiento(),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    _SolicitudesPendientes(uidChofer: uidChofer),
                    _MisSolicitudes(
                      uidChofer: uidChofer,
                      antesDeFinalizar: _seguimiento.enviarMuestrasPendientes,
                    ),
                    const _TituloSeccion('Viajes asignados por el centro'),
                    _buildListaViajes(uidChofer),
                  ],
                ),
              ),
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
      stream: _firestore.collection('choferes_privado').doc(uidChofer).snapshots(),
      builder: (context, snapshot) {
        final disponible = snapshot.data?.data()?['disponible'] as bool? ?? false;
        return Container(
          color: disponible ? Colors.green.shade50 : Colors.grey.shade200,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Column(
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(disponible ? 'Disponible para viajes' : 'No disponible'),
                value: disponible,
                onChanged: _cambiarDisponibilidad,
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _compartiendoUbicacion ? null : _compartirUbicacionAhora,
                  icon: _compartiendoUbicacion
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
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

  /// Muestra si el GPS en vivo esta encendido o si hay algun problema.
  Widget _buildAvisoSeguimiento() {
    return ValueListenableBuilder<bool>(
      valueListenable: _seguimiento.activo,
      builder: (context, activo, _) {
        return ValueListenableBuilder<String?>(
          valueListenable: _seguimiento.problema,
          builder: (context, problema, _) {
            if (problema != null) {
              return Container(
                width: double.infinity,
                color: Colors.orange.shade100,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    const Icon(Icons.gps_off, color: Colors.orange),
                    const SizedBox(width: 8),
                    Expanded(child: Text(problema, style: const TextStyle(fontSize: 14))),
                  ],
                ),
              );
            }
            if (!activo) return const SizedBox.shrink();
            return Container(
              width: double.infinity,
              color: Colors.blue.shade50,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: const Row(
                children: [
                  Icon(Icons.gps_fixed, color: Colors.blue),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Compartiendo tu ubicación en vivo con el paciente. Mantén la app abierta.',
                      style: TextStyle(fontSize: 14),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildListaViajes(String uidChofer) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _streamViajes ??= _firestore
          .collection('viajes')
          .where('choferId', isEqualTo: uidChofer)
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          );
        }

        if (snapshot.hasError) {
          return Text('Error al cargar: ${snapshot.error}');
        }

        final viajes = snapshot.data?.docs ?? [];

        if (viajes.isEmpty) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'No tienes viajes asignados por ahora.',
              style: TextStyle(fontSize: 16, color: Colors.grey),
            ),
          );
        }

        // Ordena por fecha y hora (texto en formato AAAA-MM-DD y HH:mm,
        // que se ordenan correctamente como texto).
        final viajesOrdenados = [...viajes]..sort((a, b) {
            final fechaA = '${a.data()['fecha']} ${a.data()['hora']}';
            final fechaB = '${b.data()['fecha']} ${b.data()['hora']}';
            return fechaA.compareTo(fechaB);
          });

        return Column(
          children: [
            for (final doc in viajesOrdenados)
              _TarjetaViaje(
                // La key evita que, al reordenarse la lista, una tarjeta
                // quede mostrando los botones de OTRO viaje.
                key: ValueKey('viaje_${doc.id}'),
                pacienteId: doc.id,
                fecha: doc.data()['fecha'] as String? ?? '',
                hora: doc.data()['hora'] as String? ?? '',
                antesDeFinalizar: _seguimiento.enviarMuestrasPendientes,
              ),
          ],
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
const PuntoMapa _ubicacionCentroDialisis = PuntoMapa(-33.4489, -70.6693); // Plaza de Armas, Santiago (placeholder)

/// Tarjeta que muestra un viaje asignado: nombre del paciente, hora, y
/// si necesita ayuda de movilidad o que lo busquen. Si el paciente cargo
/// una direccion de retiro, permite calcular la ruta (Geoapify Routing
/// API) y verla en un mapa, ademas de probar el ajuste a la via (Geoapify
/// Map Matching API) sobre esa misma ruta.
class _TarjetaViaje extends StatefulWidget {
  final String pacienteId;
  final String fecha;
  final String hora;
  final Future<void> Function()? antesDeFinalizar;

  const _TarjetaViaje({
    super.key,
    required this.pacienteId,
    required this.fecha,
    required this.hora,
    this.antesDeFinalizar,
  });

  @override
  State<_TarjetaViaje> createState() => _TarjetaViajeState();
}

class _TarjetaViajeState extends State<_TarjetaViaje> {
  final _geoapifyService = GeoapifyService();
  // Se cargan UNA vez (antes se volvian a pedir en cada reconstruccion y
  // la tarjeta entera, botones incluidos, parpadeaba a "cargando").
  late final Future<List<DocumentSnapshot<Map<String, dynamic>>>> _datosPaciente = Future.wait([
    FirebaseFirestore.instance.collection('usuarios').doc(widget.pacienteId).get(),
    FirebaseFirestore.instance.collection('respuestas_paciente').doc(widget.pacienteId).get(),
  ]);

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
      final puntosAjustados = await _geoapifyService.ajustarRutaGps(puntos: puntosDePrueba);
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
    return FutureBuilder<
        List<DocumentSnapshot<Map<String, dynamic>>>>(
      future: _datosPaciente,
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
        final direccion = respuestaDoc.data()?['direccion'] as Map<String, dynamic>?;
        final direccionTexto = respuestaDoc.data()?['direccionTexto'] as String?;

        PuntoMapa? destino;
        if (direccion != null) {
          destino = PuntoMapa((direccion['lat'] as num).toDouble(), (direccion['lng'] as num).toDouble());
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
            ] else if (direccionTexto != null && direccionTexto.isNotEmpty) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(Icons.home_outlined, size: 18, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(child: Text(direccionTexto, style: const TextStyle(color: Colors.grey))),
                ],
              ),
            ],
            // Punto 6.9: Geoapify queda integrado pero desactivado hasta
            // nuevo aviso -- mientras FeatureFlags.geoapifyHabilitado sea
            // false, no se muestran los botones de ruta/map matching.
            if (destino != null && FeatureFlags.geoapifyHabilitado) ...[
              if (_ruta == null)
                OutlinedButton.icon(
                  onPressed: _calculandoRuta ? null : () => _calcularRuta(destino!),
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
                MapaRuta(origen: _ubicacionCentroDialisis, destino: destino, ruta: _ruta),
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
                        color: _resultadoMapMatching!.startsWith('Error') ? Colors.red : Colors.green,
                      ),
                    ),
                  ),
              ],
              if (_errorRuta != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(_errorRuta!, style: const TextStyle(color: Colors.red)),
                ),
            ],
            const SizedBox(height: 10),
            _buildProgresoViaje(),
          ],
        );
      },
    );
  }

  /// Punto 13.2: botones para avanzar la maquina de estados del viaje.
  /// Ahora viven en ControlesEstadoViaje (lib/widgets), que corrige el
  /// error por el que a veces el chofer no podia finalizar el viaje.
  Widget _buildProgresoViaje() {
    return ControlesEstadoViaje(
      coleccion: 'viajes',
      id: widget.pacienteId,
      antesDeFinalizar: widget.antesDeFinalizar,
    );
  }
}

// =============================================================================
// Traslados que pide el paciente (coleccion `solicitudes`)
// =============================================================================

class _TituloSeccion extends StatelessWidget {
  const _TituloSeccion(this.texto);
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Text(texto, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
    );
  }
}

/// Solicitudes en estado 'solicitado' que cualquier chofer disponible
/// puede aceptar con un boton (Cloud Function `aceptarSolicitud`).
class _SolicitudesPendientes extends StatefulWidget {
  const _SolicitudesPendientes({required this.uidChofer});
  final String uidChofer;

  @override
  State<_SolicitudesPendientes> createState() => _SolicitudesPendientesState();
}

class _SolicitudesPendientesState extends State<_SolicitudesPendientes> {
  final _functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');
  late final _streamPrivado =
      FirebaseFirestore.instance.collection('choferes_privado').doc(widget.uidChofer).snapshots();
  late final _streamPendientes = FirebaseFirestore.instance
      .collection('solicitudes')
      .where('estado', isEqualTo: 'solicitado')
      .snapshots();

  String? _aceptando; // id de la solicitud que se esta aceptando

  Future<void> _aceptar(String solicitudId) async {
    setState(() => _aceptando = solicitudId);
    try {
      await _functions.httpsCallable('aceptarSolicitud').call<Map<String, dynamic>>({
        'solicitudId': solicitudId,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Aceptaste el traslado. Aparece en "Mis traslados".')),
        );
      }
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No se pudo aceptar: ${e.message ?? e.code}')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo aceptar. Revisa tu conexión.')),
        );
      }
    } finally {
      if (mounted) setState(() => _aceptando = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: _streamPrivado,
      builder: (context, snapPrivado) {
        final disponible = snapPrivado.data?.data()?['disponible'] as bool? ?? false;

        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: _streamPendientes,
          builder: (context, snapshot) {
            final pendientes = (snapshot.data?.docs ?? []).where((d) {
              final rechazadoPor = d.data()['rechazadoPor'];
              return !(rechazadoPor is List && rechazadoPor.contains(widget.uidChofer));
            }).toList()
              ..sort((a, b) => (a.data()['creadoEn'] as String? ?? '')
                  .compareTo(b.data()['creadoEn'] as String? ?? ''));

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _TituloSeccion('Solicitudes de traslado (${pendientes.length})'),
                if (!disponible)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Text(
                      'Activa "Disponible para viajes" para poder aceptar solicitudes.',
                      style: TextStyle(color: Colors.grey, fontSize: 15),
                    ),
                  )
                else if (pendientes.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Text(
                      'No hay pacientes esperando traslado.',
                      style: TextStyle(color: Colors.grey, fontSize: 15),
                    ),
                  ),
                if (disponible)
                  for (final doc in pendientes)
                    Card(
                      key: ValueKey('pendiente_${doc.id}'),
                      color: Colors.amber.shade50,
                      margin: const EdgeInsets.only(bottom: 10),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _InfoSolicitud(datos: doc.data()),
                            const SizedBox(height: 10),
                            ElevatedButton.icon(
                              onPressed: _aceptando != null ? null : () => _aceptar(doc.id),
                              icon: _aceptando == doc.id
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    )
                                  : const Icon(Icons.check),
                              label: const Text('Aceptar traslado'),
                            ),
                          ],
                        ),
                      ),
                    ),
              ],
            );
          },
        );
      },
    );
  }
}

/// Solicitudes que este chofer ya acepto y aun no termina.
class _MisSolicitudes extends StatefulWidget {
  const _MisSolicitudes({required this.uidChofer, this.antesDeFinalizar});
  final String uidChofer;
  final Future<void> Function()? antesDeFinalizar;

  @override
  State<_MisSolicitudes> createState() => _MisSolicitudesState();
}

class _MisSolicitudesState extends State<_MisSolicitudes> {
  late final _stream = FirebaseFirestore.instance
      .collection('solicitudes')
      .where('conductorId', isEqualTo: widget.uidChofer)
      .snapshots();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _stream,
      builder: (context, snapshot) {
        final activas = (snapshot.data?.docs ?? []).where((d) {
          final estado = d.data()['estado'] as String? ?? '';
          return estado != 'finalizado' && estado != 'cancelado';
        }).toList();

        if (activas.isEmpty) return const SizedBox.shrink();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _TituloSeccion('Mis traslados en curso'),
            for (final doc in activas)
              Card(
                key: ValueKey('mia_${doc.id}'),
                margin: const EdgeInsets.only(bottom: 10),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _InfoSolicitud(datos: doc.data()),
                      const SizedBox(height: 10),
                      ControlesEstadoViaje(
                        key: ValueKey('controles_sol_${doc.id}'),
                        coleccion: 'solicitudes',
                        id: doc.id,
                        antesDeFinalizar: widget.antesDeFinalizar,
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Datos de una solicitud: nombre del paciente, direccion y necesidades.
class _InfoSolicitud extends StatefulWidget {
  const _InfoSolicitud({required this.datos});
  final Map<String, dynamic> datos;

  @override
  State<_InfoSolicitud> createState() => _InfoSolicitudState();
}

class _InfoSolicitudState extends State<_InfoSolicitud> {
  Future<DocumentSnapshot<Map<String, dynamic>>>? _paciente;
  String? _pacienteIdCargado;

  @override
  Widget build(BuildContext context) {
    final datos = widget.datos;
    final pacienteId = datos['pacienteId'] as String?;
    if (pacienteId != null && pacienteId != _pacienteIdCargado) {
      _pacienteIdCargado = pacienteId;
      _paciente = FirebaseFirestore.instance.collection('usuarios').doc(pacienteId).get();
    }

    final origen = datos['origen'] as Map<String, dynamic>?;
    final direccion = (datos['direccionTexto'] as String?) ?? (origen?['direccion'] as String?);
    final necesidades = datos['necesidades'] as Map<String, dynamic>? ?? {};
    final notas = datos['notas'] as String?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          future: _paciente,
          builder: (context, snap) {
            final nombre = snap.data?.data()?['nombre'] as String? ?? 'Paciente';
            return Text(nombre, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600));
          },
        ),
        if (direccion != null && direccion.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(
              children: [
                const Icon(Icons.home_outlined, size: 18, color: Colors.grey),
                const SizedBox(width: 4),
                Expanded(child: Text(direccion, style: const TextStyle(color: Colors.grey))),
              ],
            ),
          ),
        if (necesidades['sillaRuedas'] == true)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              '⚠ Necesita ayuda de movilidad / silla de ruedas',
              style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold),
            ),
          ),
        if (notas != null && notas.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('Nota: $notas'),
          ),
      ],
    );
  }
}
