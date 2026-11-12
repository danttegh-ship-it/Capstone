import 'package:dializa_app/screens/historial_admin_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('ficha archivada muestra el motivo y la secuencia de estados', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => mostrarDetalleHistorial(context, {
                'pacienteNombre': 'Paciente de prueba',
                'cierre': 'reasignado',
                'estadoFinal': 'asignado',
                'origen': {'direccion': 'Retiro de prueba'},
                'historial': [
                  {'estado': 'asignado', 'fecha': '2026-10-30T10:00:00Z'},
                  {'estado': 'conductor_en_camino'},
                ],
              }),
              child: const Text('Abrir ficha'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Abrir ficha'));
    await tester.pumpAndSettle();
    expect(find.text('Resultado: Reasignado a otro chofer'), findsOneWidget);
    expect(find.text('Retiro: Retiro de prueba'), findsOneWidget);
    expect(find.text('Asignado'), findsOneWidget);
    expect(find.text('Chofer en camino'), findsOneWidget);
  });
}
