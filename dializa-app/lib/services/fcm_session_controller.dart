import 'dart:async';
import 'dart:math';

/// Cola de registros ligada a una generacion de sesion. El cierre espera
/// operaciones ya iniciadas antes de revocar; getToken tardio no cambia de UID.
class FcmSessionController {
  FcmSessionController({required this.currentUid, required this.getToken,
    required this.register, required this.revoke, required this.deleteToken});
  final String? Function() currentUid;
  final Future<String?> Function() getToken;
  final Future<void> Function(String uid, String session, String token) register;
  final Future<void> Function(String session) revoke;
  final Future<void> Function() deleteToken;
  Future<void> _queue = Future<void>.value();
  int _generation = 0;
  String? _uid;
  String? _session;
  bool _closing = false;

  void sessionChanged(String? uid) {
    _generation++;
    _closing = false;
    _uid = uid;
    _session = uid == null ? null : List.generate(24, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    if (uid != null) refresh();
  }

  Future<void> refresh([String? token]) {
    final generation = _generation;
    final uid = _uid;
    final session = _session;
    bool valid() => !_closing && generation == _generation && uid != null && currentUid() == uid;
    _queue = _queue.then((_) async {
      if (!valid() || session == null) return;
      final actual = token ?? await getToken();
      if (!valid() || actual == null) return;
      await register(uid!, session, actual);
    }).catchError((Object _) {});
    return _queue;
  }

  Future<void> close() async {
    if (_closing) { await _queue; return; }
    _closing = true;
    _generation++;
    final session = _session;
    await _queue;
    try {
      if (session != null) await revoke(session);
    } catch (_) {
      // Sin red no se garantiza revocacion remota instantanea.
    }
    // Independiente del resultado del servidor: no dejar de invalidar el
    // token local por una excepcion al revocar.
    try { await deleteToken(); } catch (_) {}
    _session = null;
    _uid = null;
  }
}
