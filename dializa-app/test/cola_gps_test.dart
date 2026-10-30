import 'package:flutter/material.dart';
import 'package:dializa_app/screens/solicitudes_chofer_screen.dart';
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:dializa_app/services/cola_gps.dart';

void main() {
  const trip = {
    'coleccion': 'viajes',
    'id': 'paciente',
    'viajeId': 'instancia_A',
  };
  test(
    'H08 fallo de envio conserva lote y reintento es idempotente por timestamp',
    () async {
      String? storage;
      final sent = <Map<String, dynamic>>[];
      final queue = ColaGps(
        read: () async => storage,
        write: (s) async {
          storage = s;
        },
        send: (d) async {
          sent.add(d);
          throw StateError('sin red');
        },
      );
      await queue.add(trip, {'lat': -33.0, 'lng': -70.0, 'timestampMs': 1234});
      await expectLater(queue.flush(), throwsStateError);
      expect(queue.pendientes, 1);
      final recovered = ColaGps(
        read: () async => storage,
        write: (s) async {
          storage = s;
        },
        send: (d) async {
          sent.add(d);
          return {'guardadas': 1, 'duplicadas': 0};
        },
      );
      await recovered.load();
      await recovered.flush();
      expect(recovered.pendientes, 0);
      expect(sent.last['viajeId'], 'instancia_A');
      expect((sent.last['muestras'] as List).single['timestampMs'], 1234);
    },
  );
  test(
    'H01/H08 nueva asignacion no absorbe puntos de la instancia anterior',
    () async {
      final sent = <Map<String, dynamic>>[];
      final queue = ColaGps(
        read: () async => null,
        write: (_) async {},
        send: (d) async {
          sent.add(d);
          return {'guardadas': 1};
        },
      );
      await queue.add(trip, {'lat': 1, 'lng': 2, 'timestampMs': 1});
      await queue.add(
        {...trip, 'viajeId': 'instancia_B'},
        {'lat': 3, 'lng': 4, 'timestampMs': 2},
      );
      await queue.flush('instancia_A');
      expect(queue.pendientes, 1);
      expect(sent.single['viajeId'], 'instancia_A');
      await queue.flush('instancia_B');
      expect(sent.last['viajeId'], 'instancia_B');
    },
  );
  for (final code in [
    'invalid-argument',
    'failed-precondition',
    'not-found',
    'permission-denied',
  ]) {
    test(
      'T1 rechazo permanente $code no bloquea otra instancia ni cierre',
      () async {
        String? storage;
        final sent = <String>[];
        final queue = ColaGps(
          read: () async => storage,
          write: (s) async {
            storage = s;
          },
          send: (d) async {
            sent.add(d['viajeId'] as String);
            if (d['viajeId'] == 'instancia_A') throw FalloGps(code);
            return {'guardadas': 1};
          },
        );
        await queue.add(trip, {'timestampMs': 1234});
        await queue.add({...trip, 'viajeId': 'activa'}, {'timestampMs': 5678});
        await queue.flush();
        await queue.prepararCierre('instancia_A');
        expect(sent, ['instancia_A', 'activa']);
        expect(queue.pendientes, 0);
        expect(queue.enCuarentena, 1);
        expect(
          (queue.cuarentena.single['muestras'] as List).single['timestampMs'],
          1234,
        );
        final recovered = ColaGps(
          read: () async => storage,
          write: (_) async {},
          send: (_) async => {},
        );
        await recovered.load();
        expect(recovered.enCuarentena, 1);
        expect(recovered.pendientes, 0);
      },
    );
  }
  test(
    'T1 reloj atrasado: rechazo parcial conserva instante en cuarentena y permite cierre',
    () async {
      final queue = ColaGps(
        read: () async => null,
        write: (_) async {},
        send: (_) async => {
          'guardadas': 1,
          'duplicadas': 0,
          'rechazadas': [
            {
              'indice': 0,
              'codigo': 'invalid-argument',
              'motivo': 'Anterior al inicio',
            },
          ],
        },
      );
      await queue.add(trip, {'timestampMs': 1});
      await queue.add(trip, {'timestampMs': 2});
      await queue.prepararCierre('instancia_A');
      expect(queue.enCuarentena, 1);
      expect(queue.pendientes, 0);
    },
  );
  test(
    'T1 fallo transitorio no bloquea envio de otra instancia y no pierde puntos',
    () async {
      final sent = <String>[];
      final queue = ColaGps(
        read: () async => null,
        write: (_) async {},
        send: (d) async {
          sent.add(d['viajeId'] as String);
          if (d['viajeId'] == 'instancia_A') throw FalloGps('unavailable');
          return {'guardadas': 1};
        },
      );
      await queue.add(trip, {'timestampMs': 1});
      await queue.add({...trip, 'viajeId': 'activa'}, {'timestampMs': 2});
      await expectLater(queue.flush(), throwsA(isA<FalloGps>()));
      expect(sent, ['instancia_A', 'activa']);
      expect(queue.pendientes, 1);
      expect(queue.enCuarentena, 0);
      await queue.prepararCierre('activa');
    },
  );
  test(
    'T1 envio periodico y cierre usan una sola llamada para el lote',
    () async {
      var calls = 0;
      final gate = Completer<void>();
      final queue = ColaGps(
        read: () async => null,
        write: (_) async {},
        send: (d) async {
          calls++;
          await gate.future;
          return {'guardadas': 1};
        },
      );
      await queue.add(trip, {'timestampMs': 1});
      final periodico = queue.flush();
      final cierre = queue.prepararCierre('instancia_A');
      await Future<void>.delayed(Duration.zero);
      expect(calls, 1);
      gate.complete();
      await Future.wait([periodico, cierre]);
      expect(calls, 1);
    },
  );
  testWidgets('T1 boton Finalizar continua con GPS en cuarentena', (
    tester,
  ) async {
    final queue = ColaGps(
      read: () async => null,
      write: (_) async {},
      send: (_) async => throw FalloGps('failed-precondition'),
    );
    await queue.add(trip, {'lat': -33, 'lng': -70, 'timestampMs': 1234});
    var cierres = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TarjetaSolicitud(
            estado: 'en_viaje',
            ejecutar: (accion, nuevoEstado) async {
              expect(accion, 'actualizarEstadoViaje');
              expect(nuevoEstado, 'finalizado');
              await queue.prepararCierre('instancia_A');
              cierres++;
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('Finalizar viaje'));
    await tester.pumpAndSettle();
    expect(cierres, 1);
    expect(queue.enCuarentena, 1);
    expect(queue.pendientes, 0);
  });
}
