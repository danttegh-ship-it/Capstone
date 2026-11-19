import 'package:geocoding/geocoding.dart';
import 'geoapify_service.dart';

/// Geocodificador del sistema Android/iOS; no utiliza una clave de Firebase.
class DireccionService {
  Future<String?> resolver(PuntoMapa punto) async {
    final lugares = await placemarkFromCoordinates(
      punto.lat,
      punto.lng,
    ).timeout(const Duration(seconds: 10));
    if (lugares.isEmpty) return null;
    final p = lugares.first;
    final partes = <String>{
      if (p.street?.trim().isNotEmpty == true) p.street!.trim(),
      if (p.locality?.trim().isNotEmpty == true) p.locality!.trim(),
      if (p.administrativeArea?.trim().isNotEmpty == true)
        p.administrativeArea!.trim(),
    };
    return partes.isEmpty ? null : partes.join(', ');
  }
}
