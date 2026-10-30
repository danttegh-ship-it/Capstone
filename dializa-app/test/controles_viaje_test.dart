import 'dart:async';
import 'package:dializa_app/services/errores_viaje.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dializa_app/widgets/controles_viaje.dart';

void main() {
  for (final estado in ['asignado', 'conductor_en_camino', 'conductor_llego']) {
    testWidgets('H09 cancelar se ofrece en $estado', (tester) async {
      var cancelled = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ControlesViaje(
              estado: estado,
              enviando: false,
              onAvanzar: (_) {},
              onCancelar: () {
                cancelled = true;
              },
            ),
          ),
        ),
      );
      await tester.tap(find.text('Cancelar'));
      expect(cancelled, isTrue);
    });
  }
  testWidgets('H09 en_viaje solo permite finalizar', (tester) async {
    String? next;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ControlesViaje(
            estado: 'en_viaje',
            enviando: false,
            onAvanzar: (s) {
              next = s;
            },
            onCancelar: () {},
          ),
        ),
      ),
    );
    expect(find.text('Cancelar'), findsNothing);
    await tester.tap(find.text('Finalizar viaje'));
    expect(next, 'finalizado');
  });
  testWidgets('H09 acciones deshabilitadas mientras se envia', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ControlesViaje(
            estado: 'asignado',
            enviando: true,
            onAvanzar: (_) {},
            onCancelar: () {},
          ),
        ),
      ),
    );
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );
    expect(
      tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
      isNull,
    );
  });
  for (final estado in ['finalizado', 'cancelado']) {
    testWidgets('H09 $estado no ofrece acciones', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ControlesViaje(
              estado: estado,
              enviando: false,
              onAvanzar: (_) {},
              onCancelar: () {},
            ),
          ),
        ),
      );
      expect(find.byType(ElevatedButton), findsNothing);
      expect(find.byType(OutlinedButton), findsNothing);
    });
  }
  testWidgets('T4 doble toque sin rebuild produce una sola llamada', (
    tester,
  ) async {
    final gate = Completer<void>();
    var llamadas = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ControlesViaje(
            estado: 'en_viaje',
            enviando: false,
            onAvanzar: (_) async {
              llamadas++;
              await gate.future;
            },
            onCancelar: () {},
          ),
        ),
      ),
    );
    await tester.tap(find.text('Finalizar viaje'));
    await tester.tap(find.text('Finalizar viaje'));
    expect(llamadas, 1);
    await tester.pump();
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );
    gate.complete();
    await tester.pumpAndSettle();
  });
  test('T4 errores publicos no exponen el mensaje del proveedor', () {
    for (final code in [
      'permission-denied',
      'unavailable',
      'failed-precondition',
      'internal',
    ]) {
      final mensaje = mensajeErrorViaje(
        FirebaseFunctionsException(code: code, message: 'detalle-privado'),
      );
      expect(mensaje, isNot(contains('detalle-privado')));
    }
  });
}
