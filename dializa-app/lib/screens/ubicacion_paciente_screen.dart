import 'dart:async';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../services/ubicacion_repository.dart';
import '../services/identidad_viaje.dart';
import '../services/publicador_ubicacion.dart';

class UbicacionPacienteScreen extends StatelessWidget {
  const UbicacionPacienteScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final db = FirebaseFirestore.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Ubicacion del chofer')),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: db.collection('viajes').doc(uid).snapshots(),
        builder: (context, manual) {
          if (manual.hasError) {
            return const Center(
              child: Text('No se pudo consultar el viaje. Revisa tu sesion.'),
            );
          }
          return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: db
                .collection('solicitudes')
                .where('pacienteId', isEqualTo: uid)
                .snapshots(),
            builder: (context, solicitudes) {
              if (solicitudes.hasError) {
                return const Center(
                  child: Text('No se pudo consultar tus solicitudes.'),
                );
              }
              final viajes = <Map<String, dynamic>>[];
              final datos = manual.data?.data();
              if (datos != null &&
                  autorizaUbicacion(
                    'viajes',
                    datos['estado'] as String? ?? 'asignado',
                  )) {
                viajes.add({
                  'uid': datos['choferId'],
                  'id': identidadViaje(uid, datos),
                });
              }
              for (final doc
                  in solicitudes.data?.docs ??
                      <QueryDocumentSnapshot<Map<String, dynamic>>>[]) {
                if (autorizaUbicacion(
                  'solicitudes',
                  doc.data()['estado'] as String,
                )) {
                  viajes.add({'uid': doc.data()['conductorId'], 'id': doc.id});
                }
              }
              if (!manual.hasData || !solicitudes.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              if (viajes.isEmpty) {
                return const Center(
                  child: Text('No hay un traslado con ubicacion autorizada.'),
                );
              }
              return ListView(
                children: viajes
                    .where((v) => v['uid'] is String)
                    .map(
                      (v) => UbicacionChofer(
                        key: ValueKey('${v['uid']}:${v['id']}'),
                        uidPaciente: uid,
                        viajeId: v['id'] as String,
                        stream: UbicacionRepository().escucharUbicacion(
                          v['uid'] as String,
                        ),
                      ),
                    )
                    .toList(),
              );
            },
          );
        },
      ),
    );
  }
}

class UbicacionChofer extends StatefulWidget {
  const UbicacionChofer({
    super.key,
    required this.stream,
    required this.uidPaciente,
    required this.viajeId,
    this.mostrarMapa = true,
  });
  final Stream<Map<String, dynamic>?> stream;
  final String uidPaciente, viajeId;
  final bool mostrarMapa;
  @override
  State<UbicacionChofer> createState() => _UbicacionChoferState();
}

class _UbicacionChoferState extends State<UbicacionChofer> {
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => StreamBuilder<Map<String, dynamic>?>(
    stream: widget.stream,
    builder: (context, snap) {
      if (snap.hasError) {
        return const Padding(
          padding: EdgeInsets.all(16),
          child: Text(
            'Ubicacion no disponible. El permiso puede haber terminado.',
          ),
        );
      }
      final d = snap.data;
      final ahora = DateTime.now().millisecondsSinceEpoch;
      if (d == null ||
          d['pacienteAutorizado'] != widget.uidPaciente ||
          d['viajeAutorizado'] != widget.viajeId ||
          (d['autorizacionValidaHasta'] as num? ?? 0) <= ahora) {
        return const Padding(
          padding: EdgeInsets.all(16),
          child: Text('Esperando ubicacion autorizada del chofer.'),
        );
      }
      final lat = d['lat'], lng = d['lng'], timestamp = d['timestamp'];
      if (lat is! num ||
          lng is! num ||
          timestamp is! num ||
          ahora - timestamp > 120000 ||
          timestamp > ahora + 60000) {
        return const Padding(
          padding: EdgeInsets.all(16),
          child: Text(
            'La ubicacion no esta actualizada. Espera una nueva posicion.',
          ),
        );
      }
      final punto = LatLng(lat.toDouble(), lng.toDouble());
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text(
              'Ultima posicion observada: ${DateTime.fromMillisecondsSinceEpoch(timestamp.toInt()).toLocal()}',
            ),
            if (widget.mostrarMapa) _MapaPosicionChofer(punto: punto),
          ],
        ),
      );
    },
  );
}

/// El mapa solo existe mientras la lectura supera los controles de acceso
/// y vigencia de UbicacionChofer.
class _MapaPosicionChofer extends StatefulWidget {
  const _MapaPosicionChofer({required this.punto});

  final LatLng punto;

  @override
  State<_MapaPosicionChofer> createState() => _MapaPosicionChoferState();
}

class _MapaPosicionChoferState extends State<_MapaPosicionChofer> {
  final _controlador = MapController();
  bool _listo = false;
  bool _seguir = true;

  @override
  void didUpdateWidget(covariant _MapaPosicionChofer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.punto != widget.punto && _seguir) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _seguir) _centrar();
      });
    }
  }

  void _centrar() {
    if (_listo) _controlador.move(widget.punto, _controlador.camera.zoom);
  }

  @override
  void dispose() {
    _controlador.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 320,
    child: Stack(
      fit: StackFit.expand,
      children: [
        FlutterMap(
          mapController: _controlador,
          options: MapOptions(
            initialCenter: widget.punto,
            initialZoom: 15,
            onMapReady: () {
              _listo = true;
              _centrar();
            },
            onPositionChanged: (_, gesto) {
              if (gesto && _seguir) setState(() => _seguir = false);
            },
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.example.dializa_app',
            ),
            MarkerLayer(
              markers: [
                Marker(
                  point: widget.punto,
                  child: const Icon(
                    Icons.local_taxi,
                    color: Colors.purple,
                    size: 34,
                  ),
                ),
              ],
            ),
            const RichAttributionWidget(
              attributions: [
                TextSourceAttribution('OpenStreetMap contributors'),
              ],
            ),
          ],
        ),
        if (!_seguir)
          Positioned(
            right: 8,
            top: 8,
            child: FloatingActionButton.small(
              heroTag: null,
              tooltip: 'Centrar en el chofer',
              onPressed: () {
                setState(() => _seguir = true);
                _centrar();
              },
              child: const Icon(Icons.my_location),
            ),
          ),
      ],
    ),
  );
}
