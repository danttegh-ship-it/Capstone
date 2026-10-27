import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'cola_gps.dart';
import 'identidad_viaje.dart';

/// GPS observado mientras la app esta activa. Se pausa explicitamente al
/// minimizar; no promete seguimiento con la app cerrada o en segundo plano.
class SeguimientoGps extends ChangeNotifier with WidgetsBindingObserver {
  SeguimientoGps(this.uid) {
    _instancias.add(this);
    WidgetsBinding.instance.addObserver(this);
    cola = ColaGps(
      read: () async =>
          (await SharedPreferences.getInstance()).getString('gps_$uid'),
      write: (json) async {
        if (!await (await SharedPreferences.getInstance()).setString(
          'gps_$uid',
          json,
        )) {
          throw StateError('No se pudo guardar GPS en el dispositivo.');
        }
      },
      send: (data) async {
        if (FirebaseAuth.instance.currentUser?.uid != uid) {
          throw StateError('La sesion del chofer cambio.');
        }
        final result =
            await FirebaseFunctions.instanceFor(region: 'southamerica-east1')
                .httpsCallable('registrarMuestrasGps')
                .call<Map<String, dynamic>>(data);
        return result.data;
      },
    );
  }
  static final Set<SeguimientoGps> _instancias = {};
  final String uid;
  late final ColaGps cola;
  final _db = FirebaseFirestore.instance;
  final List<StreamSubscription<QuerySnapshot<Map<String, dynamic>>>>
  _consultas = [];
  StreamSubscription<Position>? _posiciones;
  Timer? _timer;
  List<QueryDocumentSnapshot<Map<String, dynamic>>> _manual = [],
      _solicitudes = [];
  Map<String, dynamic>? _actual;
  bool _activo = true, _cerrado = false, _iniciando = false, _enviando = false;
  String estado = 'Preparando seguimiento GPS';
  void _mensaje(String value) {
    if (_cerrado) return;
    estado = value;
    notifyListeners();
  }

  Future<void>? _closeFuture;

  Future<void> iniciar() async {
    try {
      await cola.load();
      if (_cerrado) return;
      for (final collection in ['viajes', 'solicitudes']) {
        final field = collection == 'viajes' ? 'choferId' : 'conductorId';
        _consultas.add(
          _db
              .collection(collection)
              .where(field, isEqualTo: uid)
              .snapshots()
              .listen(
                (snapshot) {
                  if (collection == 'viajes') {
                    _manual = snapshot.docs;
                  } else {
                    _solicitudes = snapshot.docs;
                  }
                  unawaited(_reconciliar());
                },
                onError: (Object _) =>
                    _mensaje('No se pudo consultar viajes para GPS.'),
              ),
        );
      }
      _timer = Timer.periodic(const Duration(seconds: 15), (_) {
        unawaited(_enviar());
      });
    } catch (_) {
      _mensaje('No se pudo recuperar la cola GPS local.');
    }
  }

  Future<void> _reconciliar() async {
    if (_cerrado || !_activo || _iniciando) return;
    final candidatos = <Map<String, dynamic>>[];
    for (final entry in {
      'viajes': _manual,
      'solicitudes': _solicitudes,
    }.entries) {
      for (final doc in entry.value) {
        if (doc.data()['estado'] != 'en_viaje') continue;
        candidatos.add({
          'coleccion': entry.key,
          'id': doc.id,
          'viajeId': entry.key == 'viajes'
              ? identidadViaje(doc.id, doc.data())
              : doc.id,
        });
      }
    }
    if (candidatos.length != 1) {
      await _pararSensor();
      _actual = null;
      _mensaje(
        candidatos.isEmpty
            ? 'GPS listo: se activa al iniciar el viaje.'
            : 'Hay varios viajes iniciados. Resuelve la asignacion antes de registrar GPS.',
      );
      return;
    }
    final trip = candidatos.single;
    if (_actual?['viajeId'] == trip['viajeId'] && _posiciones != null) return;
    _iniciando = true;
    try {
      await _pararSensor();
      _actual = trip;
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw StateError('Activa el GPS del dispositivo.');
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw StateError(
          'Concede permiso de ubicacion para registrar el recorrido.',
        );
      }
      if (_cerrado ||
          !_activo ||
          FirebaseAuth.instance.currentUser?.uid != uid) {
        return;
      }
      _posiciones =
          Geolocator.getPositionStream(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 5,
            ),
          ).listen(
            (position) {
              if (_cerrado ||
                  !_activo ||
                  FirebaseAuth.instance.currentUser?.uid != uid) {
                return;
              }
              final point = {
                'lat': position.latitude,
                'lng': position.longitude,
                'timestampMs': position.timestamp.millisecondsSinceEpoch,
              };
              // trip es la instancia capturada por esta suscripcion, nunca la nueva.
              unawaited(
                cola
                    .add(trip, point)
                    .then(
                      (_) => _mensaje(
                        'GPS activo; ${cola.pendientes} muestras por enviar.',
                      ),
                      onError: (Object _) =>
                          _mensaje('No se pudo guardar la muestra GPS.'),
                    ),
              );
            },
            onError: (Object _) => _mensaje(
              'Se interrumpio la lectura GPS. Revisa permisos y ubicacion.',
            ),
          );
      _mensaje('GPS activo durante el viaje.');
      unawaited(_enviar());
    } catch (error) {
      _mensaje(error.toString());
    } finally {
      _iniciando = false;
    }
  }

  Future<void> _pararSensor() async {
    await _posiciones?.cancel();
    _posiciones = null;
  }

  Future<void> _enviar() async {
    if (_cerrado ||
        _enviando ||
        FirebaseAuth.instance.currentUser?.uid != uid) {
      return;
    }
    _enviando = true;
    try {
      await cola.flush();
    } catch (_) {
      _mensaje(
        'GPS pendiente de envio (${cola.pendientes}). Revisa la conexion antes de finalizar.',
      );
    } finally {
      _enviando = false;
    }
  }

  Future<void> _prepararCierre(String viajeId) async {
    await _pararSensor();
    await cola.flush(
      viajeId,
    ); // Si falla, no se cierra el viaje ni se borra el lote.
  }

  static Future<void> prepararCierre(String viajeId) async {
    for (final tracker in _instancias.toList()) {
      await tracker._prepararCierre(viajeId);
    }
  }

  static Future<void> reanudarTodos() async {
    for (final tracker in _instancias.toList()) {
      tracker._manual =
          (await tracker._db
                  .collection('viajes')
                  .where('choferId', isEqualTo: tracker.uid)
                  .get(const GetOptions(source: Source.server)))
              .docs;
      tracker._solicitudes =
          (await tracker._db
                  .collection('solicitudes')
                  .where('conductorId', isEqualTo: tracker.uid)
                  .get(const GetOptions(source: Source.server)))
              .docs;
      await tracker._reconciliar();
    }
  }

  static Future<void> detenerSiCambio(String? uidActual) async {
    for (final tracker in _instancias.toList()) {
      if (tracker.uid != uidActual) await tracker.cerrar();
    }
  }

  static Future<void> detenerTodos() async {
    for (final tracker in _instancias.toList()) {
      await tracker.cerrar();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _activo = state == AppLifecycleState.resumed;
    if (_activo) {
      unawaited(_reconciliar());
    } else {
      unawaited(_pararSensor());
      _mensaje('GPS pausado: vuelve a la app para continuar el recorrido.');
    }
  }

  Future<void> cerrar() => _closeFuture ??= _cerrar();

  Future<void> _cerrar() async {
    _cerrado = true;
    _timer?.cancel();
    for (final sub in _consultas) {
      await sub.cancel();
    }
    await _pararSensor();
    try {
      await cola.flush();
    } catch (_) {} // Se conserva la cola del UID.
    _cerrado = true;
    WidgetsBinding.instance.removeObserver(this);
    _instancias.remove(this);
    super.dispose();
  }
}
