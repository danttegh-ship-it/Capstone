import 'dart:async';

import 'package:geolocator/geolocator.dart';

/// Puerto de daily-app/android/.../UbicacionActual.kt: obtiene la
/// ubicación actual con timeout, usando un sealed-class equivalente en
/// Dart (clases selladas) para distinguir cada forma de fallo, en vez de
/// un simple null.
sealed class ResultadoUbicacionActual {}

class UbicacionExito extends ResultadoUbicacionActual {
  UbicacionExito(this.lat, this.lng);
  final double lat;
  final double lng;
}

class UbicacionTimeout extends ResultadoUbicacionActual {}

class UbicacionSinPermiso extends ResultadoUbicacionActual {}

class UbicacionServicioDesactivado extends ResultadoUbicacionActual {}

class UbicacionError extends ResultadoUbicacionActual {
  UbicacionError(this.mensaje);
  final String mensaje;
}

/// Obtiene la ubicación actual del dispositivo con un timeout de 10
/// segundos (mismo valor que daily-app). Pide permiso si todavía no se
/// ha concedido.
Future<ResultadoUbicacionActual> obtenerUbicacionActual() async {
  final servicioActivo = await Geolocator.isLocationServiceEnabled();
  if (!servicioActivo) return UbicacionServicioDesactivado();

  var permiso = await Geolocator.checkPermission();
  if (permiso == LocationPermission.denied) {
    permiso = await Geolocator.requestPermission();
  }
  if (permiso == LocationPermission.denied || permiso == LocationPermission.deniedForever) {
    return UbicacionSinPermiso();
  }

  try {
    final posicion = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
    ).timeout(const Duration(seconds: 10));
    return UbicacionExito(posicion.latitude, posicion.longitude);
  } on TimeoutException {
    return UbicacionTimeout();
  } catch (e) {
    return UbicacionError(e.toString());
  }
}
