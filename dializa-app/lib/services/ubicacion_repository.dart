import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_auth/firebase_auth.dart';

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
/// Alcance de este cambio: se deja lista la función para empujar la
/// ubicación actual del chofer una vez (por ejemplo, al tocar un botón
/// "compartir mi ubicación"). El seguimiento continuo en segundo plano
/// (equivalente a UbicacionForegroundService.kt) todavía NO está
/// implementado -- requiere un servicio en primer plano nativo que no
/// se armó en esta pasada; ver docs/ARQUITECTURA.md.
class UbicacionRepository {
  UbicacionRepository() : _db = FirebaseDatabase.instance;

  final FirebaseDatabase _db;

  Future<void> actualizarUbicacion({required double lat, required double lng}) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    await _db.ref('ubicaciones/$uid').update({
      'lat': lat,
      'lng': lng,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  /// Stream de la ubicación de un chofer (lo usa el paciente o el admin
  /// para seguirlo en el mapa, cuando esa pantalla exista).
  Stream<Map<String, dynamic>?> escucharUbicacion(String conductorUid) {
    return _db.ref('ubicaciones/$conductorUid').onValue.map((evento) {
      final valor = evento.snapshot.value;
      if (valor is Map) {
        return valor.map((key, value) => MapEntry(key.toString(), value));
      }
      return null;
    });
  }
}
