import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as ll;

import '../services/geoapify_service.dart';

/// Mapa simple basado en OpenStreetMap (sin API key) que dibuja un
/// origen, un destino y, si se calculo, la polilinea de la ruta entre
/// ambos. Pensado para mostrar de forma minima el resultado de
/// `calcularRuta` sin depender de Google Maps SDK (que necesitaria una
/// clave propia todavia no generada para este proyecto).
class MapaRuta extends StatelessWidget {
  const MapaRuta({
    super.key,
    required this.origen,
    required this.destino,
    this.ruta,
    this.altura = 260,
  });

  final PuntoMapa origen;
  final PuntoMapa destino;
  final RutaCalculada? ruta;
  final double altura;

  @override
  Widget build(BuildContext context) {
    final origenLatLng = ll.LatLng(origen.lat, origen.lng);
    final destinoLatLng = ll.LatLng(destino.lat, destino.lng);

    final centro = ll.LatLng(
      (origen.lat + destino.lat) / 2,
      (origen.lng + destino.lng) / 2,
    );

    return SizedBox(
      height: altura,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: FlutterMap(
          options: MapOptions(
            initialCenter: centro,
            initialZoom: 12,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.example.dializa_app',
            ),
            if (ruta != null && ruta!.puntosRuta.isNotEmpty)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: ruta!.puntosRuta
                        .map((p) => ll.LatLng(p.lat, p.lng))
                        .toList(),
                    strokeWidth: 4,
                    color: Colors.blue,
                  ),
                ],
              ),
            MarkerLayer(
              markers: [
                Marker(
                  point: origenLatLng,
                  width: 40,
                  height: 40,
                  child: const Icon(Icons.trip_origin, color: Colors.green, size: 30),
                ),
                Marker(
                  point: destinoLatLng,
                  width: 40,
                  height: 40,
                  child: const Icon(Icons.location_on, color: Colors.red, size: 36),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
