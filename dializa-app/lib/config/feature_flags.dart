/// Interruptores centrales del lado Flutter. Reflejan los mismos flags
/// que `functions/config.js` en el backend, para que la UI no muestre
/// botones que llamarian a una Cloud Function desactivada.
///
/// Cambiar un valor aqui y volver a compilar es suficiente para
/// activar/desactivar la feature correspondiente en el cliente; el
/// backend tiene su propio flag espejo en `functions/config.js` y hay
/// que mantenerlos sincronizados a mano (no hay forma de leer la config
/// del backend sin gastar una llamada).
class FeatureFlags {
  FeatureFlags._();

  /// Punto 6.9 del requerimiento: Geoapify (geocoding, routing, places,
  /// map matching) integrado pero desactivado hasta nuevo aviso. Mientras
  /// esto sea `false`, las pantallas muestran un campo de texto simple en
  /// vez del buscador con autocompletado, y ocultan los botones de
  /// calcular ruta / probar map matching.
  static const bool geoapifyHabilitado = false;

  /// Puntos 11.9/11.10: restriccion geografica a Chile. No aplica aun en
  /// el cliente (la validacion vive en el backend); se deja el flag aqui
  /// por si en algun momento se quiere mostrar un aviso en la UI antes de
  /// enviar coordenadas fuera de rango.
  static const bool restriccionGeograficaChileActiva = false;

  /// Punto 11.14: permisos de ubicacion/notificaciones solicitados de
  /// forma explicita y escalonada. La funcion ya esta escrita
  /// (`lib/services/permisos_service.dart`) pero no se invoca
  /// automaticamente todavia -- no aplica aun porque no hay ubicacion en
  /// vivo activa en ninguna pantalla.
  static const bool permisosEscalonadosActivos = false;
}
