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
}
