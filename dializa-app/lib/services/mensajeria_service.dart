import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Puerto de daily-app/android/.../DailyAppMessagingService.kt (puntos
/// 14.1, 14.3, 14.4): muestra una notificación local cuando llega un
/// mensaje FCM con la app abierta (en segundo plano/cerrada, el sistema
/// operativo ya la muestra solo).
///
/// Deep link simplificado (punto 14.4): dializa-app todavía no tiene una
/// pantalla de detalle de viaje por id como daily-app (PendingIntent con
/// `solicitudId`), así que por ahora el tap en la notificación solo trae
/// la app al frente, en la pantalla de rol en la que ya estaba (login_screen
/// decide esa pantalla según el usuario autenticado). El `data` payload
/// que manda notificaciones.js (tipo + pacienteId/solicitudId) queda listo
/// para cuando exista una pantalla de detalle a la que navegar.
class MensajeriaService {
  static final FlutterLocalNotificationsPlugin _notificacionesLocales =
      FlutterLocalNotificationsPlugin();

  static Future<void> inicializar() async {
    await _notificacionesLocales.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
    );

    // Mensaje recibido con la app en primer plano.
    FirebaseMessaging.onMessage.listen((mensaje) {
      final notificacion = mensaje.notification;
      if (notificacion == null) return;

      _notificacionesLocales.show(
        mensaje.hashCode,
        notificacion.title,
        notificacion.body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'dializa_app_general',
            'Notificaciones de Dializa App',
            importance: Importance.high,
            priority: Priority.high,
          ),
        ),
      );
    });

    // Tap en la notificación con la app en segundo plano.
    FirebaseMessaging.onMessageOpenedApp.listen((mensaje) {
      // Punto 14.4: aquí es donde iría la navegación a la pantalla de
      // detalle del viaje una vez que exista, usando
      // mensaje.data['tipo'] / mensaje.data['solicitudId'] / mensaje.data['pacienteId'].
    });
  }
}

/// Handler de mensajes recibidos con la app totalmente cerrada. Debe ser
/// una función de nivel superior (no un método de clase) y estar
/// anotada con @pragma('vm:entry-point') para que Android pueda
/// invocarla fuera del ciclo de vida normal de la app.
@pragma('vm:entry-point')
Future<void> manejarMensajeEnSegundoPlano(RemoteMessage mensaje) async {
  // FCM ya muestra la notificación del sistema automáticamente cuando la
  // app está cerrada y el mensaje incluye un bloque "notification"; no
  // hace falta hacer nada más aquí por ahora.
}
