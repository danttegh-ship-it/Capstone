import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;

import '../services/geoapify_service.dart';
import '../services/ubicacion_repository.dart';

/// Mapa (OpenStreetMap, sin API key) con la ubicacion EN VIVO del chofer,
/// leida de Realtime Database `ubicaciones/{choferId}`.
///
/// Solo el paciente autorizado por el servidor puede leer ese nodo
/// (database.rules.json). La autorizacion se escribe justo DESPUES de que
/// el viaje cambia de estado, asi que la primera lectura puede llegar
/// antes y ser rechazada: en ese caso se reintenta cada pocos segundos.
class MapaChoferEnVivo extends StatefulWidget {
  const MapaChoferEnVivo({
    super.key,
    required this.choferId,
    this.puntoPaciente,
    this.altura = 280,
  });

  final String choferId;

  /// Donde se retira al paciente (opcional), para mostrarlo en el mapa.
  final PuntoMapa? puntoPaciente;
  final double altura;

  @override
  State<MapaChoferEnVivo> createState() => _MapaChoferEnVivoState();
}

class _MapaChoferEnVivoState extends State<MapaChoferEnVivo> {
  final _repositorio = UbicacionRepository();
  final _mapController = MapController();

  StreamSubscription<Map<String, dynamic>?>? _suscripcion;
  Timer? _reintento;
  Timer? _reloj;

  ll.LatLng? _posicionChofer;
  int? _timestampMs;
  bool _mapaListo = false;
  bool _seguirAlChofer = true;
  bool _sinPermisoTodavia = false;

  @override
  void initState() {
    super.initState();
    _escuchar();
    // Refresca el texto "actualizado hace X s".
    _reloj = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void didUpdateWidget(covariant MapaChoferEnVivo oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.choferId != widget.choferId) {
      _posicionChofer = null;
      _timestampMs = null;
      _escuchar();
    }
  }

  @override
  void dispose() {
    _suscripcion?.cancel();
    _reintento?.cancel();
    _reloj?.cancel();
    super.dispose();
  }

  void _escuchar() {
    _suscripcion?.cancel();
    _reintento?.cancel();
    _suscripcion = _repositorio.escucharUbicacion(widget.choferId).listen(
      (datos) {
        final lat = datos?['lat'];
        final lng = datos?['lng'];
        if (lat is num && lng is num) {
          final nueva = ll.LatLng(lat.toDouble(), lng.toDouble());
          setState(() {
            _posicionChofer = nueva;
            _timestampMs = (datos?['timestamp'] as num?)?.toInt();
            _sinPermisoTodavia = false;
          });
          if (_mapaListo && _seguirAlChofer) {
            try {
              _mapController.move(nueva, _mapController.camera.zoom);
            } catch (_) {}
          }
        } else {
          setState(() => _sinPermisoTodavia = false);
        }
      },
      onError: (Object e) {
        // Normalmente "permission denied" mientras el servidor concede el
        // acceso. Se reintenta.
        if (!mounted) return;
        setState(() => _sinPermisoTodavia = true);
        _reintento = Timer(const Duration(seconds: 4), () {
          if (mounted) _escuchar();
        });
      },
    );
  }

  String _textoActualizacion() {
    final ts = _timestampMs;
    if (ts == null) return '';
    final segundos = (DateTime.now().millisecondsSinceEpoch - ts) ~/ 1000;
    if (segundos < 10) return 'Actualizado recién';
    if (segundos < 60) return 'Actualizado hace $segundos s';
    final minutos = segundos ~/ 60;
    return 'Actualizado hace $minutos min';
  }

  @override
  Widget build(BuildContext context) {
    final chofer = _posicionChofer;
    final paciente = widget.puntoPaciente == null
        ? null
        : ll.LatLng(widget.puntoPaciente!.lat, widget.puntoPaciente!.lng);

    if (chofer == null) {
      return Container(
        height: 120,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.grey.shade100,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(height: 10),
            Text(
              _sinPermisoTodavia
                  ? 'Conectando con la ubicación del chofer…'
                  : 'Esperando la ubicación del chofer…',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: widget.altura,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: chofer,
                    initialZoom: 15,
                    onMapReady: () => _mapaListo = true,
                    onPositionChanged: (camera, hasGesture) {
                      // Si el paciente mueve el mapa con el dedo, se deja
                      // de seguir al chofer hasta que toque el boton.
                      if (hasGesture && _seguirAlChofer) {
                        setState(() => _seguirAlChofer = false);
                      }
                    },
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.example.dializa_app',
                    ),
                    MarkerLayer(
                      markers: [
                        if (paciente != null)
                          Marker(
                            point: paciente,
                            width: 40,
                            height: 40,
                            child: const Icon(Icons.home, color: Colors.red, size: 34),
                          ),
                        Marker(
                          point: chofer,
                          width: 44,
                          height: 44,
                          child: const Icon(Icons.directions_car, color: Colors.blue, size: 38),
                        ),
                      ],
                    ),
                  ],
                ),
                if (!_seguirAlChofer)
                  Positioned(
                    right: 8,
                    bottom: 8,
                    child: FloatingActionButton.small(
                      heroTag: null,
                      tooltip: 'Centrar en el chofer',
                      onPressed: () {
                        setState(() => _seguirAlChofer = true);
                        try {
                          _mapController.move(chofer, _mapController.camera.zoom);
                        } catch (_) {}
                      },
                      child: const Icon(Icons.my_location),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          _textoActualizacion(),
          style: const TextStyle(color: Colors.grey, fontSize: 13),
          textAlign: TextAlign.right,
        ),
      ],
    );
  }
}
