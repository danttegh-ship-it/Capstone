import 'package:permission_handler/permission_handler.dart';

/// Puerto de daily-app/android/.../PermisosUbicacion.kt: pide permisos de
/// forma explícita y escalonada (primero ubicación aproximada, luego
/// precisa solo si hace falta; notificaciones aparte), en vez de pedir
/// todo junto al abrir la pantalla.
///
/// Punto 11.14 del requerimiento: "no aplica aún, créala y déjala
/// desactivada". Por eso este archivo está completo y listo para usar,
/// pero ninguna pantalla lo llama todavía (ver
/// FeatureFlags.permisosEscalonadosActivos en config/feature_flags.dart).
/// Para activarlo: llamar a `solicitarPermisosUbicacionEscalonado()` antes
/// de empezar a compartir ubicación en vivo, y `solicitarPermisoNotificaciones()`
/// antes de registrar el token FCM.
class PermisosService {
  /// Paso 1: pide ubicación aproximada. Paso 2: si la función que llama
  /// necesita precisión (por ejemplo, mostrar al chofer en el mapa en
  /// tiempo real), pide ubicación precisa como un segundo paso separado.
  Future<bool> solicitarPermisosUbicacionEscalonado({required bool requierePrecisión}) async {
    final estadoAproximada = await Permission.locationWhenInUse.request();
    if (!estadoAproximada.isGranted) return false;

    if (!requierePrecisión) return true;

    // En Android, pedir ubicación "precisa" es otro permiso aparte
    // (ACCESS_FINE_LOCATION) desde Android 12; permission_handler lo
    // expone como el mismo Permission.location pero el sistema puede
    // mostrar un segundo diálogo para el nivel de precisión.
    final estadoPrecisa = await Permission.location.request();
    return estadoPrecisa.isGranted;
  }

  /// Notificaciones push (Android 13+ las trata como permiso en tiempo
  /// de ejecución, igual que POST_NOTIFICATIONS en daily-app).
  Future<bool> solicitarPermisoNotificaciones() async {
    final estado = await Permission.notification.request();
    return estado.isGranted;
  }
}
