import 'package:cloud_functions/cloud_functions.dart';

/// Cliente Dart para las 3 Cloud Functions que hacen de proxy hacia
/// Geoapify (ver `functions/index.js`).
///
/// Nunca llama a `api.geoapify.com` directamente ni conoce ninguna API
/// key: todo pasa por Cloud Functions (mismo patron de seguridad usado
/// en daily-app), que corren en la region `southamerica-east1`.
class GeoapifyService {
  GeoapifyService()
      : _functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');

  final FirebaseFunctions _functions;

  /// Busca coordenadas a partir de un texto de direccion (ej. "Av.
  /// Providencia 1234, Santiago"). Usa la Geocoding API de Geoapify.
  Future<List<DireccionEncontrada>> geocodificarDireccion(String texto) async {
    final callable = _functions.httpsCallable('geocodificarDireccion');
    final resultado = await callable.call<Map<String, dynamic>>({'texto': texto});

    final resultados = (resultado.data['resultados'] as List<dynamic>? ?? [])
        .cast<Map<dynamic, dynamic>>();

    return resultados
        .map(
          (r) => DireccionEncontrada(
            etiqueta: r['etiqueta'] as String? ?? texto,
            lat: (r['lat'] as num).toDouble(),
            lng: (r['lng'] as num).toDouble(),
          ),
        )
        .toList();
  }

  /// Calcula la ruta entre dos o mas puntos. Usa la Routing API de
  /// Geoapify. `modo` puede ser 'drive', 'walk' o 'bicycle'.
  Future<RutaCalculada> calcularRuta({
    required List<PuntoMapa> waypoints,
    String modo = 'drive',
  }) async {
    final callable = _functions.httpsCallable('calcularRuta');
    final resultado = await callable.call<Map<String, dynamic>>({
      'waypoints': waypoints.map((p) => {'lat': p.lat, 'lng': p.lng}).toList(),
      'modo': modo,
    });

    final puntosRuta = (resultado.data['puntosRuta'] as List<dynamic>? ?? [])
        .cast<Map<dynamic, dynamic>>()
        .map((p) => PuntoMapa((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble()))
        .toList();

    return RutaCalculada(
      distanciaMetros: (resultado.data['distanciaMetros'] as num).toDouble(),
      duracionSegundos: (resultado.data['duracionSegundos'] as num).toDouble(),
      puntosRuta: puntosRuta,
    );
  }

  /// Ajusta una secuencia de puntos GPS crudos (con timestamp) a las
  /// vias reales. Usa la Map Matching API de Geoapify. Pensado para
  /// cuando se agregue seguimiento de ubicacion en vivo del chofer; por
  /// ahora se puede probar con puntos de ejemplo desde la UI.
  Future<List<PuntoMapa>> ajustarRutaGps({
    required List<PuntoGps> puntos,
    String modo = 'drive',
  }) async {
    final callable = _functions.httpsCallable('ajustarRutaGps');
    final resultado = await callable.call<Map<String, dynamic>>({
      'puntos': puntos
          .map((p) => {'lat': p.lat, 'lng': p.lng, 'timestamp': p.timestamp.toIso8601String()})
          .toList(),
      'modo': modo,
    });

    return (resultado.data['puntosAjustados'] as List<dynamic>? ?? [])
        .cast<Map<dynamic, dynamic>>()
        .map((p) => PuntoMapa((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble()))
        .toList();
  }
}

class PuntoMapa {
  const PuntoMapa(this.lat, this.lng);
  final double lat;
  final double lng;
}

class PuntoGps {
  const PuntoGps({required this.lat, required this.lng, required this.timestamp});
  final double lat;
  final double lng;
  final DateTime timestamp;
}

class DireccionEncontrada {
  const DireccionEncontrada({required this.etiqueta, required this.lat, required this.lng});
  final String etiqueta;
  final double lat;
  final double lng;
}

class RutaCalculada {
  const RutaCalculada({
    required this.distanciaMetros,
    required this.duracionSegundos,
    required this.puntosRuta,
  });

  final double distanciaMetros;
  final double duracionSegundos;
  final List<PuntoMapa> puntosRuta;

  String get distanciaLegible => '${(distanciaMetros / 1000).toStringAsFixed(1)} km';

  String get duracionLegible {
    final minutos = (duracionSegundos / 60).round();
    if (minutos < 60) return '$minutos min';
    final horas = minutos ~/ 60;
    final minutosRestantes = minutos % 60;
    return '${horas}h ${minutosRestantes}min';
  }
}
