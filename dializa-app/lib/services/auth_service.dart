import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

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
  AuthService()
      : _functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');

  final FirebaseFunctions _functions;

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

  /// Registra (o actualiza) el token FCM del usuario autenticado contra
  /// la Cloud Function `registrarTokenFcm`. Se llama despues de un login
  /// exitoso y, de nuevo, cada vez que Firebase renueva el token.
  /// Nunca debe bloquear el login si falla.
  Future<void> registrarTokenFcmActual() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      final callable = _functions.httpsCallable('registrarTokenFcm');
      await callable.call<Map<String, dynamic>>({'token': token});
    } catch (_) {
      // Silencioso: sin notificaciones push la app sigue funcionando.
    }
  }

  // ---------------------------------------------------------------------
  // Gestion del token FCM por sesion (correccion E)
  // ---------------------------------------------------------------------

  static StreamSubscription<User?>? _suscripcionSesion;
  static StreamSubscription<String>? _suscripcionToken;

  /// Arranca (UNA sola vez; llamadas repetidas no hacen nada) la gestion
  /// del token FCM atada al estado de autenticacion:
  ///   - hay usuario (login nuevo O sesion restaurada al abrir la app):
  ///     registra el token y se suscribe a `onTokenRefresh`;
  ///   - no hay usuario: cancela la suscripcion al token.
  /// Al cambiar de usuario, la suscripcion anterior se cancela antes de
  /// crear la nueva, asi un token renovado nunca se asocia al usuario
  /// previo ni se duplican listeners. Llamar desde `main()` despues de
  /// `Firebase.initializeApp`.
  static void iniciarGestionFcmPorSesion() {
    if (_suscripcionSesion != null) return;
    _suscripcionSesion =
        FirebaseAuth.instance.authStateChanges().listen((usuario) {
      _cancelarSuscripcionToken();
      if (usuario == null) return;

      final uidSuscrito = usuario.uid;
      _suscripcionToken =
          FirebaseMessaging.instance.onTokenRefresh.listen((token) {
        // Defensa extra: solo registra si la sesion sigue siendo la misma.
        if (FirebaseAuth.instance.currentUser?.uid != uidSuscrito) return;
        unawaited(AuthService()._registrarToken(token));
      }, onError: (_) {});

      unawaited(AuthService().registrarTokenFcmActual());
    });
  }

  static void _cancelarSuscripcionToken() {
    _suscripcionToken?.cancel();
    _suscripcionToken = null;
  }

  Future<void> _registrarToken(String token) async {
    try {
      final callable = _functions.httpsCallable('registrarTokenFcm');
      await callable.call<Map<String, dynamic>>({'token': token});
    } catch (_) {
      // Silencioso: sin notificaciones push la app sigue funcionando.
    }
  }

  /// Cierra la sesion de forma que el siguiente usuario de este telefono
  /// no herede las notificaciones del anterior:
  ///   1. deja de escuchar renovaciones del token;
  ///   2. pide al servidor borrar el token de ESTE usuario (aun autenticado);
  ///   3. invalida el token en el dispositivo (se genera uno nuevo despues);
  ///   4. cierra la sesion.
  /// Los pasos 2 y 3 no bloquean el cierre de sesion si fallan (por
  /// ejemplo sin conexion): el servidor tambien limpia el token cuando
  /// otro usuario registra el mismo.
  Future<void> cerrarSesion() async {
    _cancelarSuscripcionToken();
    try {
      final token = await FirebaseMessaging.instance
          .getToken()
          .timeout(const Duration(seconds: 5));
      await _functions
          .httpsCallable('eliminarTokenFcm')
          .call<Map<String, dynamic>>({'token': token})
          .timeout(const Duration(seconds: 5));
      await FirebaseMessaging.instance
          .deleteToken()
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      // Ver comentario del metodo.
    }
    await FirebaseAuth.instance.signOut();
  }
}
