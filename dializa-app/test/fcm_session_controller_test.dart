import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:dializa_app/services/fcm_session_controller.dart';

void main() {
 test('H05 getToken tardio no registra una cuenta anterior', () async {
   String? uid = 'A';
   final pending = Completer<String?>();
   final calls = <String>[];
   final controller = FcmSessionController(currentUid: () => uid,
     getToken: () => pending.future,
     register: (user, session, token) async { calls.add(user); },
     revoke: (_) async {}, deleteToken: () async {});
   controller.sessionChanged(uid);
   await Future<void>.delayed(Duration.zero);
   uid = 'B'; controller.sessionChanged(uid);
   pending.complete('token');
   await controller.refresh('token');
   expect(calls, isNot(contains('A')));
   expect(calls, contains('B'));
 });
 test('H05 cierre espera registro y revoca antes de borrar token', () async {
   final pending = Completer<void>(); final calls = <String>[];
   final controller = FcmSessionController(currentUid: () => 'A',
     getToken: () async => 'token',
     register: (u, s, t) async { calls.add('registro'); await pending.future; },
     revoke: (_) async { calls.add('revocar'); },
     deleteToken: () async { calls.add('borrar'); });
   controller.sessionChanged('A');
   await Future<void>.delayed(Duration.zero);
   final close = controller.close();
   expect(calls, ['registro']); pending.complete(); await close;
   expect(calls, ['registro', 'revocar', 'borrar']);
 });
}
