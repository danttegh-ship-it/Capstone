import 'dart:async';

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'admin_home.dart';
import 'chofer_home.dart';
import 'paciente_home.dart';
import '../services/auth_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _authService = AuthService();
  bool _cargando = false;
  String? _error;

  Future<void> _iniciarSesion() async {
    setState(() {
      _cargando = true;
      _error = null;
    });

    try {
      final credenciales = await FirebaseAuth.instance
          .signInWithEmailAndPassword(
        email: _emailController.text.trim(),
        password: _passwordController.text.trim(),
      );

      final doc = await FirebaseFirestore.instance
          .collection('usuarios')
          .doc(credenciales.user!.uid)
          .get();

      if (!doc.exists) {
        setState(() {
          _error = 'Usuario sin rol asignado. Contacta al administrador.';
          _cargando = false;
        });
        return;
      }

      final rol = doc.data()!['rol'] as String;

      // Puntos 9.6: ofrecer verificar el correo tras un login exitoso, sin
      // bloquear el login si falla. El registro del token FCM ya NO se hace
      // aqui: lo gestiona AuthService.iniciarGestionFcmPorSesion() (arrancado
      // en main) al detectar la sesion, tambien cuando se restaura.
      unawaited(_authService.enviarVerificacionCorreo());

      if (!mounted) return;

      Widget pantallaDestino;
      switch (rol) {
        case 'admin':
          pantallaDestino = const AdminHome();
          break;
        case 'chofer':
          pantallaDestino = const ChoferHome();
          break;
        case 'paciente':
          pantallaDestino = const PacienteHome();
          break;
        default:
          setState(() {
            _error = 'Rol desconocido: $rol';
            _cargando = false;
          });
          return;
      }

      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => pantallaDestino),
      );
    } on FirebaseAuthException catch (e) {
      setState(() {
        _error = e.code == 'user-not-found' || e.code == 'wrong-password'
            ? 'Correo o contraseña incorrectos'
            : 'Error al iniciar sesión: ${e.message}';
        _cargando = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.local_hospital, size: 80, color: Colors.blue),
              const SizedBox(height: 16),
              const Text(
                'Dializa App',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 40),
              TextField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'Correo electrónico',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.email),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passwordController,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Contraseña',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.lock),
                ),
              ),
              const SizedBox(height: 24),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Colors.red),
                    textAlign: TextAlign.center,
                  ),
                ),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: _cargando ? null : _iniciarSesion,
                  child: _cargando
                      ? const CircularProgressIndicator(color: Colors.white)
                      : const Text('Ingresar', style: TextStyle(fontSize: 18)),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _cargando ? null : _mostrarDialogoRecuperarPassword,
                child: const Text('¿Olvidaste tu contraseña?', style: TextStyle(fontSize: 16)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Dialogo de recuperacion de contrasena (punto 9.7), equivalente a
  /// DialogoRecuperarPassword en daily-app/android/.../LoginScreen.kt.
  void _mostrarDialogoRecuperarPassword() {
    final emailRecuperacionController = TextEditingController(text: _emailController.text);
    String? mensajeRecuperacion;
    bool enviando = false;

    showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Recuperar contraseña'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva.',
              ),
              const SizedBox(height: 12),
              TextField(
                controller: emailRecuperacionController,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'Correo electrónico',
                  border: OutlineInputBorder(),
                ),
              ),
              if (mensajeRecuperacion != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    mensajeRecuperacion!,
                    style: TextStyle(
                      color: mensajeRecuperacion!.startsWith('Listo') ? Colors.green : Colors.red,
                    ),
                  ),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cerrar'),
            ),
            ElevatedButton(
              onPressed: enviando
                  ? null
                  : () async {
                      setDialogState(() => enviando = true);
                      try {
                        await _authService.enviarRecuperacionPassword(emailRecuperacionController.text);
                        setDialogState(() {
                          enviando = false;
                          mensajeRecuperacion = 'Listo, revisa tu correo.';
                        });
                      } on FirebaseAuthException catch (e) {
                        setDialogState(() {
                          enviando = false;
                          mensajeRecuperacion = e.code == 'user-not-found'
                              ? 'No existe una cuenta con ese correo.'
                              : 'No se pudo enviar: ${e.message}';
                        });
                      }
                    },
              child: enviando
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Enviar'),
            ),
          ],
        ),
      ),
    );
  }
}