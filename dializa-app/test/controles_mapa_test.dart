import 'dart:async';

import 'package:dializa_app/screens/ubicacion_paciente_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

void main() {
  testWidgets('mapa sigue, permite explorar y se retira al revocar el acceso', (
    tester,
  ) async {
    final stream = StreamController<Map<String, dynamic>?>();
    final ahora = DateTime.now().millisecondsSinceEpoch;
    void emitir(double lat, {String paciente = 'paciente'}) {
      stream.add({
        'pacienteAutorizado': paciente,
        'viajeAutorizado': 'viaje',
        'autorizacionValidaHasta': ahora + 300000,
        'timestamp': ahora,
        'lat': lat,
        'lng': -70.6,
      });
    }

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: UbicacionChofer(
            stream: stream.stream,
            uidPaciente: 'paciente',
            viajeId: 'viaje',
          ),
        ),
      ),
    );

    emitir(-33.4);
    await tester.pumpAndSettle();
    final mapa = find.byType(FlutterMap);
    final controlador = tester.widget<FlutterMap>(mapa).mapController!;
    emitir(-33.5);
    await tester.pumpAndSettle();
    expect(controlador.camera.center, const LatLng(-33.5, -70.6));

    await tester.drag(mapa, const Offset(100, 0));
    await tester.pumpAndSettle();
    final centroManual = controlador.camera.center;
    emitir(-33.6);
    await tester.pumpAndSettle();
    expect(controlador.camera.center, centroManual);

    await tester.tap(find.byTooltip('Centrar en el chofer'));
    await tester.pumpAndSettle();
    expect(controlador.camera.center, const LatLng(-33.6, -70.6));

    emitir(-33.7, paciente: 'otro');
    await tester.pumpAndSettle();
    expect(mapa, findsNothing);
    expect(find.byTooltip('Centrar en el chofer'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    unawaited(stream.close());
  });
}
