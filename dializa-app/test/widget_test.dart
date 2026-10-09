// Test de widget para la pantalla de login (punto 16.4 del requerimiento:
// "adaptar widget_test.dart a las pantallas actuales" -- el placeholder
// que dejaba `flutter create` no probaba nada real).
//
// ESCRITO PERO NO EJECUTADO en este entorno: no hay Flutter SDK instalado
// en este sandbox (no existe el comando `flutter`), asi que no se pudo
// correr `flutter test` para confirmarlo. Para correrlo de verdad:
//   flutter test
//
// Nota de diseño: LoginScreen usa FirebaseAuth.instance directamente, asi
// que para que este test corra de verdad en un proyecto con Flutter SDK
// hace falta inicializar un Firebase de prueba (ver
// https://firebase.google.com/docs/rules/unit-tests o el paquete
// `firebase_auth_mocks`) antes de montar el widget. Se deja comentado
// para no agregar una dependencia de testing que no se pudo verificar
// que resuelva en este entorno sin red.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dializa_app/screens/login_screen.dart';

void main() {
  testWidgets('LoginScreen muestra el titulo, los campos y el boton de ingresar', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));

    expect(find.text('Dializa App'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Correo electrónico'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Contraseña'), findsOneWidget);
    expect(find.widgetWithText(ElevatedButton, 'Ingresar'), findsOneWidget);
    expect(find.text('¿Olvidaste tu contraseña?'), findsOneWidget);
  });
}
