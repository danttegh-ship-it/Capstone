import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

/// El adaptador Spark esta limitado al proyecto ficticio de pruebas.
/// Produccion conserva los callables y las reglas originales.
class OperacionesApp {
  static bool get usaSpark =>
      Firebase.app().options.projectId == 'dializa-pruebas';
  static Future<Map<String, dynamic>> ejecutar(
    String accion,
    Map<String, dynamic> datos,
  ) async {
    if (!usaSpark) {
      return (await FirebaseFunctions.instanceFor(
        region: 'southamerica-east1',
      ).httpsCallable(accion).call<Map<String, dynamic>>(datos)).data;
    }
    return OperacionesSpark().ejecutar(accion, datos);
  }
}

class OperacionesSpark {
  final db = FirebaseFirestore.instance;
  String get uid => FirebaseAuth.instance.currentUser!.uid;
  Never fallo(String codigo) =>
      throw FirebaseException(plugin: 'cloud_firestore', code: codigo);
  Future<Map<String, dynamic>> ejecutar(
    String accion,
    Map<String, dynamic> d,
  ) async {
    final ahora = DateTime.now().toUtc().toIso8601String();
    if (accion == 'registrarMuestrasGps') {
      final ref = db.collection(d['coleccion']).doc(d['id']);
      final resumen = db.collection('gps_viajes').doc(d['viajeId']);
      final rechazadas = <Map<String, dynamic>>[];
      var guardadas = 0, duplicadas = 0;
      await db.runTransaction((tx) async {
        rechazadas.clear();
        guardadas = 0;
        duplicadas = 0;
        final viaje = (await tx.get(ref)).data();
        if (viaje == null) fallo('not-found');
        if (viaje['estado'] != 'en_viaje' ||
            viaje[d['coleccion'] == 'viajes' ? 'choferId' : 'conductorId'] !=
                uid ||
            (d['coleccion'] == 'viajes' ? viaje['viajeId'] : d['id']) !=
                d['viajeId']) {
          fallo('failed-precondition');
        }
        final prev = await tx.get(resumen);
        final muestras = (d['muestras'] as List).cast<Map>();
        final existentes = <DocumentSnapshot<Map<String, dynamic>>>[];
        final tiempos = <int>[];
        for (final p in muestras) {
          existentes.add(
            await tx.get(
              resumen.collection('muestras').doc('${p['timestampMs']}'),
            ),
          );
        }
        for (var i = 0; i < muestras.length; i++) {
          final p = muestras[i];
          final t = p['timestampMs'];
          if (t is! int ||
              t < DateTime.now().millisecondsSinceEpoch - 28800000 ||
              t > DateTime.now().millisecondsSinceEpoch + 60000) {
            rechazadas.add({
              'indice': i,
              'codigo': 'invalid-argument',
              'motivo':
                  'Muestra fuera de la ventana de tiempo del modo de pruebas.',
            });
            continue;
          }
          if (existentes[i].exists) {
            duplicadas++;
            continue;
          }
          tx.set(resumen.collection('muestras').doc('$t'), {
            'lat': p['lat'],
            'lng': p['lng'],
            't': t,
            'fase': 'en_viaje',
            'fuente': 'gps',
          });
          guardadas++;
          tiempos.add(t);
        }
        if (guardadas > 0) {
          tx.set(resumen, {
            'conductorId': uid,
            'origenColeccion': d['coleccion'],
            'origenId': d['id'],
            'conteo': (prev.data()?['conteo'] as num? ?? 0) + guardadas,
            'primerTs': [
              prev.data()?['primerTs'] as int? ?? tiempos.first,
              ...tiempos,
            ].reduce((a, b) => a < b ? a : b),
            'ultimoTs': [
              prev.data()?['ultimoTs'] as int? ?? tiempos.first,
              ...tiempos,
            ].reduce((a, b) => a > b ? a : b),
          }, SetOptions(merge: true));
        }
      });
      return {
        'guardadas': guardadas,
        'duplicadas': duplicadas,
        'rechazadas': rechazadas,
      };
    }
    if (accion == 'crearSolicitudViaje') {
      final ref = db.collection('solicitudes').doc();
      await ref.set({
        ...d,
        'pacienteId': uid,
        'conductorId': null,
        'estado': 'solicitado',
        'creadoEn': ahora,
        'historial': <dynamic>[],
      });
      return {'ok': true, 'solicitudId': ref.id};
    }
    if (accion == 'actualizarDisponibilidad') {
      await db.collection('choferes_privado').doc(uid).set({
        'disponible': d['disponible'],
      }, SetOptions(merge: true));
      return {'ok': true};
    }
    if ([
      'modificarPaciente',
      'eliminarPaciente',
      'agregarPaciente',
      'aprobarConductor',
      'activarDesactivarCuenta',
    ].contains(accion)) {
      final ref = db.collection('usuarios').doc(d['uid'] as String);
      await db.runTransaction((tx) async {
        final previo = await tx.get(ref);
        if (accion == 'agregarPaciente') {
          if (previo.exists) fallo('already-exists');
          tx.set(ref, {
            'nombre': d['nombre'],
            'rol': 'paciente',
            'activo': true,
          });
        } else {
          if (!previo.exists) fallo('not-found');
          if (accion == 'modificarPaciente') {
            tx.update(ref, {'nombre': d['nombre']});
          } else if (accion == 'eliminarPaciente') {
            // Baja logica: conserva referencias historicas y bloquea acceso.
            tx.update(ref, {'activo': false, 'eliminado': true});
          } else if (accion == 'aprobarConductor') {
            tx.update(ref, {'aprobado': true});
          } else {
            tx.update(ref, {'activo': d['activo']});
          }
        }
      });
      return {'ok': true};
    }
    if (accion == 'asignarViaje') {
      final ref = db.collection('viajes').doc(d['pacienteId'] as String);
      final instancia = db.collection('viajes').doc().id;
      await db.runTransaction((tx) async {
        final anterior = await tx.get(ref);
        final chofer = await tx.get(
          db.collection('usuarios').doc(d['choferId']),
        );
        final paciente = await tx.get(
          db.collection('usuarios').doc(d['pacienteId']),
        );
        if (chofer.data()?['activo'] != true ||
            chofer.data()?['aprobado'] != true ||
            paciente.data()?['activo'] != true) {
          fallo('failed-precondition');
        }
        final previo = anterior.data();
        if (previo != null &&
            ![
              'finalizado',
              'cancelado',
              'asignado',
            ].contains(previo['estado'])) {
          fallo('failed-precondition');
        }
        if (previo != null) {
          final archivo = db
              .collection('historial_viajes')
              .doc(previo['viajeId']);
          final archivado = await tx.get(archivo);
          if (!archivado.exists) {
            tx.set(archivo, {
              ...previo,
              'pacienteId': d['pacienteId'],
              'pacienteNombre': paciente.data()?['nombre'],
              'conductorNombre': previo['choferNombre'],
              'estadoFinal': previo['estado'] == 'asignado'
                  ? 'reasignado'
                  : previo['estado'],
              'archivadoEn': ahora,
            });
          }
        }
        tx.set(ref, {
          'viajeId': instancia,
          'choferId': d['choferId'],
          'choferNombre': chofer.data()?['nombre'] ?? '',
          'fecha': d['fecha'],
          'hora': d['hora'],
          'estado': 'asignado',
          'asignadoEn': ahora,
          'asignadoPor': uid,
          'historial': [
            {'estado': 'asignado', 'fecha': ahora, 'actorUid': uid},
          ],
        });
      });
      return {'ok': true, 'viajeId': instancia};
    }
    if ([
      'aceptarSolicitud',
      'actualizarEstadoViaje',
      'cancelarAsignacionConductor',
      'rechazarSolicitud',
    ].contains(accion)) {
      final coleccion = d['coleccion'] as String? ?? 'solicitudes';
      final id = (d['id'] ?? d['solicitudId']) as String;
      final ref = db.collection(coleccion).doc(id);
      await db.runTransaction((tx) async {
        final snap = await tx.get(ref);
        final previo = snap.data();
        if (previo == null) fallo('not-found');
        if (d['estadoEsperado'] != null &&
            previo['estado'] != d['estadoEsperado']) {
          fallo('failed-precondition');
        }
        if (d['viajeId'] != null &&
            (coleccion == 'viajes' ? previo['viajeId'] : id) != d['viajeId']) {
          fallo('failed-precondition');
        }
        final siguiente = accion == 'aceptarSolicitud'
            ? 'asignado'
            : accion == 'rechazarSolicitud' ||
                  accion == 'cancelarAsignacionConductor'
            ? 'cancelado'
            : d['nuevoEstado'];
        final cambios = <String, dynamic>{
          'estado': siguiente,
          'historial': [
            ...?previo['historial'] as List?,
            {'estado': siguiente, 'fecha': ahora, 'actorUid': uid},
          ],
        };
        if (accion == 'aceptarSolicitud') cambios['conductorId'] = uid;
        tx.update(ref, cambios);
        if (['finalizado', 'cancelado'].contains(siguiente)) {
          final instancia = coleccion == 'viajes' ? previo['viajeId'] : id;
          tx.set(db.collection('historial_viajes').doc(instancia), {
            ...previo,
            ...cambios,
            'origenColeccion': coleccion,
            'origenId': id,
            'pacienteId': coleccion == 'viajes' ? id : previo['pacienteId'],
            'conductorNombre': previo['choferNombre'] ?? 'Chofer de prueba',
            'estadoFinal': siguiente,
            'archivadoEn': ahora,
          });
        }
      });
      return {'ok': true};
    }
    fallo('unimplemented');
  }
}
