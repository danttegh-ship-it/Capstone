import '../services/geoapify_service.dart';

/// Datos del centro de dialisis, destino de los traslados que pide el
/// paciente desde la app (`crearSolicitudViaje` exige coordenadas de
/// destino).
///
/// TODO: reemplazar por la direccion y coordenadas reales del centro.
/// Mientras tanto se usa la misma ubicacion de referencia que ya usaba
/// chofer_home.dart (Plaza de Armas, Santiago).
class CentroDialisis {
  CentroDialisis._();

  static const String nombre = 'Centro de diálisis';
  static const String direccion = 'Plaza de Armas, Santiago';
  static const PuntoMapa ubicacion = PuntoMapa(-33.4489, -70.6693);
}
