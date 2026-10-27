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
}
