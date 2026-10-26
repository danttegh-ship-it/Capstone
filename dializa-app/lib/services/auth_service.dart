import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'fcm_session_controller.dart';
import 'seguimiento_gps.dart';

/// Funciones de autenticacion que dializa-app no tenia todavia, portadas
/// desde daily-app/android/.../AuthRepository.kt:
///   - verificacion de correo electronico (punto 9.6)
///   - recuperacion de contrasena (punto 9.7)
///   - registro del token FCM ligado a la SESION (puntos 9.5, 14.2): se
///     registra al iniciar sesion y al restaurarla, se renueva cuando
///     Firebase rota el token y se elimina al cerrar sesion (correccion E)
///
/// Se agrupan aca en vez de dejarlas sueltas en login_screen.dart, para
/// que cualquier pantalla pueda reutilizarlas.
class AuthService {
  AuthService();

  /// Envia el correo de verificacion al usuario que acaba de iniciar
  /// sesion. No bloquea el login si falla (igual que en daily-app).
  Future<void> enviarVerificacionCorreo() async {
    final usuario = FirebaseAuth.instance.currentUser;
    if (usuario == null || usuario.emailVerified) return;
    try {
      await usuario.sendEmailVerification();
    } catch (_) {
      // Silencioso a proposito: no verificar el correo no debe impedir
      // usar la app, solo se ofrece la opcion.
    }
  }

  /// Envia el correo de recuperacion de contrasena. Lanza la excepcion
  /// de FirebaseAuth tal cual para que la pantalla muestre el mensaje
  /// adecuado (usuario no encontrado, correo invalido, etc.).
  Future<void> enviarRecuperacionPassword(String email) async {
    await FirebaseAuth.instance.sendPasswordResetEmail(email: email.trim());
  }

  static StreamSubscription<User?>? _suscripcionSesion;
  static StreamSubscription<String>? _suscripcionToken;
  static FcmSessionController? _fcm;

  static FcmSessionController get _controller => _fcm ??= FcmSessionController(
    currentUid: () => FirebaseAuth.instance.currentUser?.uid,
    getToken: () => FirebaseMessaging.instance.getToken(),
    register: (uid, session, token) async {
      if (FirebaseAuth.instance.currentUser?.uid != uid) return;
      await FirebaseFunctions.instanceFor(region: 'southamerica-east1')
          .httpsCallable('registrarTokenFcm')
          .call<void>({'token': token, 'sesionId': session});
    },
    revoke: (session) async {
      await FirebaseFunctions.instanceFor(region: 'southamerica-east1')
          .httpsCallable('eliminarTokenFcm')
          .call<void>({'sesionId': session});
    },
    deleteToken: () => FirebaseMessaging.instance.deleteToken(),
  );

  Future<void> registrarTokenFcmActual() => _controller.refresh();

  static void iniciarGestionFcmPorSesion() {
    if (_suscripcionSesion != null) return;
    _suscripcionToken ??= FirebaseMessaging.instance.onTokenRefresh.listen(
      (token) => unawaited(_controller.refresh(token)),
      onError: (Object _) {},
    );
    _suscripcionSesion = FirebaseAuth.instance.authStateChanges().listen((
      user,
    ) {
      _controller.sessionChanged(user?.uid);
    });
  }

  Future<void> cerrarSesion() async {
    await SeguimientoGps.detenerTodos();
    await _controller.close();
    await FirebaseAuth.instance.signOut();
  }
}
