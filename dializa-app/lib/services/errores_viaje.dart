import 'package:cloud_functions/cloud_functions.dart';
import 'cola_gps.dart';

String mensajeErrorViaje(Object error) {
  final code = error is FirebaseFunctionsException
      ? error.code
      : error is FalloGps
      ? error.code
      : null;
  return switch (code) {
    'unavailable' ||
    'deadline-exceeded' => 'No hay conexion. Intenta de nuevo.',
    'unauthenticated' => 'Inicia sesion de nuevo para continuar.',
    'permission-denied' => 'No tienes permiso para cambiar este viaje.',
    'not-found' => 'Este viaje ya no esta disponible.',
    'failed-precondition' =>
      'El viaje cambio. Revisa su estado e intenta de nuevo.',
    'invalid-argument' => 'No se pudo validar el viaje. Actualiza la pantalla.',
    'resource-exhausted' => 'Espera un momento antes de intentar de nuevo.',
    _ =>
      'No se pudo completar la accion. Revisa la conexion e intenta de nuevo.',
  };
}
