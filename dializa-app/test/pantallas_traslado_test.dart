import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dializa_app/screens/solicitar_traslado_screen.dart';
import 'package:dializa_app/screens/solicitudes_chofer_screen.dart';
import 'package:dializa_app/screens/ubicacion_paciente_screen.dart';
import 'package:dializa_app/screens/historial_admin_screen.dart';
import 'package:dializa_app/services/publicador_ubicacion.dart';
import 'package:dializa_app/services/geoapify_service.dart';

void main() {
  testWidgets(
    'T7 solicitud valida manda origen destino y necesidades una sola vez',
    (tester) async {
      final gate = Completer<String>();
      final enviados = <Map<String, dynamic>>[];
      await tester.pumpWidget(
        MaterialApp(
          home: SolicitarTrasladoScreen(
            elegir: (_) async => const PuntoMapa(-33.4, -70.6),
            crear: (datos) {
              enviados.add(datos);
              return gate.future;
            },
          ),
        ),
      );
      await tester.enterText(
        find.byKey(const Key('origen')),
        'Origen ficticio',
      );
      await tester.enterText(
        find.byKey(const Key('destino')),
        'Destino ficticio',
      );
      for (final texto in ['Elegir origen en mapa', 'Elegir destino en mapa']) {
        await tester.ensureVisible(find.text(texto));
        await tester.tap(find.text(texto));
        await tester.pumpAndSettle();
      }
      final boton = find.widgetWithText(ElevatedButton, 'Solicitar traslado');
      await tester.ensureVisible(boton);
      await tester.tap(boton);
      await tester.tap(boton);
      expect(enviados.length, 1);
      expect(enviados.single['origen'], {
        'lat': -33.4,
        'lng': -70.6,
        'direccion': 'Origen ficticio',
      });
      expect(enviados.single['destino']['direccion'], 'Destino ficticio');
      expect(enviados.single['necesidades']['sillaRuedas'], false);
      gate.complete('solicitud_ficticia');
      await tester.pumpAndSettle();
      expect(find.textContaining('Solicitud enviada.'), findsOneWidget);
    },
  );
  testWidgets('T7 solicitud sin direcciones no llama al backend', (
    tester,
  ) async {
    var calls = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: SolicitarTrasladoScreen(
          crear: (_) async {
            calls++;
            return 'id';
          },
        ),
      ),
    );
    final boton = find.widgetWithText(ElevatedButton, 'Solicitar traslado');
    await tester.ensureVisible(boton);
    await tester.tap(boton);
    await tester.pump();
    expect(calls, 0);
  });
  testWidgets('T7 pendiente solo ofrece Aceptar y evita doble llamada', (
    tester,
  ) async {
    final gate = Completer<void>();
    var calls = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TarjetaSolicitud(
            estado: 'solicitado',
            ejecutar: (accion, _) async {
              expect(accion, 'aceptarSolicitud');
              calls++;
              await gate.future;
            },
          ),
        ),
      ),
    );
    expect(find.text('Rechazar'), findsNothing);
    expect(find.text('Cancelar'), findsNothing);
    await tester.tap(find.text('Aceptar'));
    await tester.tap(find.text('Aceptar'));
    expect(calls, 1);
    gate.complete();
    await tester.pumpAndSettle();
  });
  for (final estado in ['asignado', 'en_viaje']) {
    testWidgets(
      'T7 Rechazar solo despues de aceptar y antes de iniciar: $estado',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: TarjetaSolicitud(
                estado: estado,
                ejecutar: (_, nuevo) async {},
              ),
            ),
          ),
        );
        expect(
          find.text('Rechazar'),
          estado == 'asignado' ? findsOneWidget : findsNothing,
        );
        if (estado == 'en_viaje') expect(find.text('Cancelar'), findsNothing);
      },
    );
  }
  for (final caso in ['autorizada', 'otra-instancia', 'vencida', 'antigua']) {
    testWidgets('T7 ubicacion paciente $caso', (tester) async {
      final now = DateTime.now().millisecondsSinceEpoch;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: UbicacionChofer(
              uidPaciente: 'paciente',
              viajeId: 'viaje',
              mostrarMapa: false,
              stream: Stream.value({
                'pacienteAutorizado': 'paciente',
                'viajeAutorizado': caso == 'otra-instancia'
                    ? 'anterior'
                    : 'viaje',
                'autorizacionValidaHasta': caso == 'vencida'
                    ? now - 1000
                    : now + 300000,
                'timestamp': caso == 'antigua' ? now - 180000 : now,
                'lat': -33.4,
                'lng': -70.6,
              }),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Ultima posicion observada:'),
        caso == 'autorizada' ? findsOneWidget : findsNothing,
      );
      await tester.pumpWidget(const SizedBox());
    });
  }
  test(
    'T7 publicaciones serializadas y pausa invalida las pendientes',
    () async {
      final gate = Completer<void>();
      var calls = 0;
      final publisher = PublicadorUbicacion((_, _, _) async {
        calls++;
        await gate.future;
      });
      publisher.cambiar('viaje');
      final primera = publisher.publicar(-33, -70, 1);
      final pendiente = publisher.publicar(-33, -70, 2);
      await Future<void>.delayed(Duration.zero);
      publisher.cambiar(null);
      gate.complete();
      await Future.wait([primera, pendiente]);
      expect(calls, 1);
      expect(autorizaUbicacion('viajes', 'asignado'), false);
      expect(autorizaUbicacion('solicitudes', 'asignado'), true);
      expect(autorizaUbicacion('viajes', 'en_viaje'), true);
      expect(autorizaUbicacion('solicitudes', 'finalizado'), false);
    },
  );
  testWidgets('T7 resumen distingue muestras observadas de ausencia de GPS', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ResumenGps(
            datos: {'conteo': 3, 'primerTs': 1000, 'ultimoTs': 2000},
          ),
        ),
      ),
    );
    expect(find.textContaining('GPS observado: 3 muestras.'), findsOneWidget);
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ResumenGps(datos: null))),
    );
    expect(find.text('Sin muestras GPS guardadas.'), findsOneWidget);
  });
}
