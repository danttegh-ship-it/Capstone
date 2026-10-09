import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'firebase_options.dart';
import 'screens/login_screen.dart';
import 'services/auth_service.dart';
import 'services/mensajeria_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  // Puntos 14.1/14.3: inicializa las notificaciones push. El registro
  // del token en si ocurre despues del login (ver AuthService), no aqui.
  FirebaseMessaging.onBackgroundMessage(manejarMensajeEnSegundoPlano);
  await MensajeriaService.inicializar();

  // Correccion E: registra/renueva/elimina el token FCM segun la sesion
  // (login, sesion restaurada, rotacion de token y cierre de sesion).
  AuthService.iniciarGestionFcmPorSesion();

  runApp(const DializaApp());
}

class DializaApp extends StatelessWidget {
  const DializaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dializa App',
      theme: ThemeData(
        primarySwatch: Colors.blue,
        useMaterial3: true,
        textTheme: const TextTheme(
          bodyLarge: TextStyle(fontSize: 18),
          bodyMedium: TextStyle(fontSize: 18),
        ),
      ),
      home: const LoginScreen(),
    );
  }
}