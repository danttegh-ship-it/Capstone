import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'operaciones_app.dart';

/// Puerto de daily-app/android/.../RealtimeLocationRepository.kt: lee y
/// escribe `ubicaciones/{uid}` en Realtime Database.
///
/// IMPORTANTE (mismo bug que se documentó y corrigió en daily-app):
/// nunca usar `set()` sobre el nodo completo del chofer, porque pisaría
/// el campo `pacienteAutorizado` (que solo puede escribir el servidor, ver
/// database.rules.json) y la escritura sería rechazada. Por eso aquí se
/// usa `update()` sobre lat/lng/timestamp únicamente, igual que en
/// daily-app.
///
/// SeguimientoGps invoca update durante los estados autorizados, en primer
/// plano. Solo modifica lat/lng/timestamp; los permisos pertenecen al servidor.
class UbicacionRepository {
  UbicacionRepository() : _db = FirebaseDatabase.instance;

  final FirebaseDatabase _db;

  Future<void> actualizarUbicacion({
    required double lat,
    required double lng,
    int? timestampMs,
    Map<String, dynamic>? viaje,
  }) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    if (OperacionesApp.usaSpark) {
      Map<String, dynamic>? datos;
      final coleccion = viaje?['coleccion'];
      if (coleccion == 'viajes' || coleccion == 'solicitudes') {
        datos =
            (await FirebaseFirestore.instance
                    .collection(coleccion)
                    .doc(viaje!['id'])
                    .get())
                .data();
      }
      await FirebaseFirestore.instance.collection('ubicaciones').doc(uid).set({
        'lat': lat,
        'lng': lng,
        'timestamp': timestampMs ?? DateTime.now().millisecondsSinceEpoch,
        'actualizadoEn': FieldValue.serverTimestamp(),
        'coleccion': datos == null ? 'sesion' : coleccion,
        'id': datos == null ? uid : viaje!['id'],
        'pacienteAutorizado': datos == null
            ? null
            : coleccion == 'viajes'
            ? viaje!['id']
            : datos['pacienteId'],
        'viajeAutorizado': datos == null ? null : viaje!['viajeId'],
      });
      return;
    }

    await _db.ref('ubicaciones/$uid').update({
      'lat': lat,
      'lng': lng,
      'timestamp': timestampMs ?? DateTime.now().millisecondsSinceEpoch,
    });
  }

  /// Stream de la ubicación de un chofer (lo usa el paciente o el admin
  /// para seguirlo en la pantalla UbicacionPacienteScreen).
  Stream<Map<String, dynamic>?> escucharUbicacion(String conductorUid) {
    if (OperacionesApp.usaSpark) {
      return FirebaseFirestore.instance
          .collection('ubicaciones')
          .doc(conductorUid)
          .snapshots()
          .map((doc) {
            final d = doc.data();
            if (d == null) return null;
            return {
              ...d,
              'autorizacionValidaHasta':
                  (d['actualizadoEn'] as Timestamp?)?.millisecondsSinceEpoch !=
                      null
                  ? (d['actualizadoEn'] as Timestamp).millisecondsSinceEpoch +
                        120000
                  : 0,
            };
          });
    }
    return _db.ref('ubicaciones/$conductorUid').onValue.map((evento) {
      final valor = evento.snapshot.value;
      if (valor is Map) {
        return valor.map((key, value) => MapEntry(key.toString(), value));
      }
      return null;
    });
  }
}
