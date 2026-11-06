import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'ubicacion_repository.dart';

/// Seguimiento de la ubicacion del chofer EN VIVO mientras tiene un viaje
/// activo (conductor_en_camino, conductor_llego o en_viaje; en solicitudes
/// tambien 'asignado').
///
/// Hace dos cosas con cada lectura del GPS:
///   1. Actualiza `ubicaciones/{uid}` en Realtime Database (cada ~4 s como
///      maximo). Eso es lo que ve el paciente en el mapa.
///   2. Acumula muestras y las envia cada 30 s a la Cloud Function
///      `registrarMuestrasGps`, que guarda el recorrido en
///      `gps_viajes/{viajeId}` (lo usa el historial del admin).
///
/// CORRECCION DEL GPS: las reglas de RTDB (database.rules.json) exigen que
/// el token tenga el custom claim `rol == 'chofer'`. Ese claim lo fija el
/// servidor al aprobar la cuenta, pero el token que ya tenia el telefono
/// NO se entera hasta que se renueva (hasta 1 hora despues). Mientras
/// tanto toda escritura de ubicacion era rechazada. Por eso se fuerza la
/// renovacion del token al iniciar y tras un "permission denied".
///
/// Limitacion conocida: funciona con la app abierta (primer plano). El
/// seguimiento con la app cerrada requiere un servicio nativo en primer
/// plano que todavia no existe (ver ubicacion_repository.dart).
class SeguimientoUbicacion {
  SeguimientoUbicacion();

  final _repositorio = UbicacionRepository();
  final _functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');

  StreamSubscription<Position>? _suscripcion;
  Timer? _temporizadorMuestras;

  String? _coleccion;
  String? _viajeDocId;

  final List<Map<String, dynamic>> _muestrasPendientes = [];
  int _ultimaEscrituraRtdbMs = 0;
  int _ultimoTimestampMs = 0;
  bool _reintentoTokenHecho = false;
  bool _iniciando = false;

  /// Mensaje para mostrar en pantalla (null = todo bien).
  final ValueNotifier<String?> problema = ValueNotifier<String?>(null);

  /// true mientras el seguimiento esta encendido.
  final ValueNotifier<bool> activo = ValueNotifier<bool>(false);

  /// Enciende el seguimiento para el viaje indicado. Si ya estaba
  /// encendido, solo cambia el viaje al que se asocian las muestras.
  Future<void> iniciar({required String coleccion, required String id}) async {
    if (_coleccion != coleccion || _viajeDocId != id) {
      // Cambio de viaje: las muestras del viaje anterior ya no sirven.
      await enviarMuestrasPendientes();
      _muestrasPendientes.clear();
      _coleccion = coleccion;
      _viajeDocId = id;
    }
    if (_suscripcion != null || _iniciando) return;
    _iniciando = true;
    try {
      await _encender();
    } finally {
      _iniciando = false;
    }
  }

  Future<void> _encender() async {
    final permisoOk = await _asegurarPermiso();
    if (!permisoOk) return;

    await _renovarToken();
    if (_viajeDocId == null) return; // se detuvo mientras se encendia

    _suscripcion = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10, // metros
      ),
    ).listen(
      _alRecibirPosicion,
      onError: (Object e) {
        problema.value = 'Error del GPS: $e';
      },
    );
    _temporizadorMuestras = Timer.periodic(
      const Duration(seconds: 30),
      (_) => enviarMuestrasPendientes(),
    );
    activo.value = true;

    // Primera posicion inmediata (getPositionStream puede tardar si el
    // telefono esta quieto).
    try {
      final posicion = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(const Duration(seconds: 10));
      _alRecibirPosicion(posicion);
    } catch (_) {
      // Se reintenta solo con el stream.
    }
  }

  /// Apaga el seguimiento (por ejemplo, al finalizar o cancelar el viaje).
  Future<void> detener() async {
    await _suscripcion?.cancel();
    _suscripcion = null;
    _temporizadorMuestras?.cancel();
    _temporizadorMuestras = null;
    await enviarMuestrasPendientes();
    _muestrasPendientes.clear();
    _coleccion = null;
    _viajeDocId = null;
    activo.value = false;
    problema.value = null;
  }

  void dispose() {
    _suscripcion?.cancel();
    _temporizadorMuestras?.cancel();
    problema.dispose();
    activo.dispose();
  }

  Future<bool> _asegurarPermiso() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      problema.value = 'Activa el GPS del teléfono para compartir tu ubicación.';
      return false;
    }
    var permiso = await Geolocator.checkPermission();
    if (permiso == LocationPermission.denied) {
      permiso = await Geolocator.requestPermission();
    }
    if (permiso == LocationPermission.denied || permiso == LocationPermission.deniedForever) {
      problema.value = 'Necesitas dar permiso de ubicación para que el paciente vea dónde vienes.';
      return false;
    }
    problema.value = null;
    return true;
  }

  Future<void> _renovarToken() async {
    try {
      await FirebaseAuth.instance.currentUser?.getIdToken(true);
    } catch (_) {
      // Sin conexion: se reintentara tras el primer rechazo.
    }
  }

  Future<void> _alRecibirPosicion(Position posicion) async {
    var ahora = DateTime.now().millisecondsSinceEpoch;
    // El servidor usa el timestamp como id de la muestra: deben ser unicos.
    if (ahora <= _ultimoTimestampMs) ahora = _ultimoTimestampMs + 1;
    _ultimoTimestampMs = ahora;

    _muestrasPendientes.add({
      'lat': posicion.latitude,
      'lng': posicion.longitude,
      'timestampMs': ahora,
    });
    // El servidor acepta como maximo 50 por llamada.
    if (_muestrasPendientes.length > 50) {
      _muestrasPendientes.removeRange(0, _muestrasPendientes.length - 50);
    }

    if (ahora - _ultimaEscrituraRtdbMs < 4000) return;
    _ultimaEscrituraRtdbMs = ahora;

    try {
      await _repositorio.actualizarUbicacion(lat: posicion.latitude, lng: posicion.longitude);
      problema.value = null;
      _reintentoTokenHecho = false;
    } on FirebaseException catch (e) {
      if (e.code == 'permission-denied' && !_reintentoTokenHecho) {
        // Token sin el claim `rol` todavia: se renueva y se reintenta una vez.
        _reintentoTokenHecho = true;
        await _renovarToken();
        try {
          await _repositorio.actualizarUbicacion(lat: posicion.latitude, lng: posicion.longitude);
          problema.value = null;
          return;
        } catch (_) {}
      }
      problema.value = 'No se pudo compartir tu ubicación (${e.code}).';
    } catch (e) {
      problema.value = 'No se pudo compartir tu ubicación. Revisa tu conexión.';
    }
  }

  /// Envia al servidor las muestras GPS acumuladas. Nunca lanza errores.
  Future<void> enviarMuestrasPendientes() async {
    final coleccion = _coleccion;
    final id = _viajeDocId;
    if (coleccion == null || id == null || _muestrasPendientes.isEmpty) return;

    // El servidor rechaza muestras de mas de 15 minutos: se descartan las
    // muy antiguas (por ejemplo, tras un rato sin senal).
    final limite = DateTime.now().millisecondsSinceEpoch - 10 * 60 * 1000;
    _muestrasPendientes.removeWhere((m) => (m['timestampMs'] as int) < limite);
    if (_muestrasPendientes.isEmpty) return;

    final lote = List<Map<String, dynamic>>.from(_muestrasPendientes);
    try {
      await _functions.httpsCallable('registrarMuestrasGps').call<Map<String, dynamic>>({
        'coleccion': coleccion,
        'id': id,
        'muestras': lote,
      });
      _muestrasPendientes.removeWhere((m) => lote.contains(m));
    } on FirebaseFunctionsException catch (e) {
      // Viaje ya cerrado o datos invalidos: reintentar no sirve de nada.
      if (e.code == 'failed-precondition' || e.code == 'invalid-argument' || e.code == 'permission-denied') {
        _muestrasPendientes.removeWhere((m) => lote.contains(m));
      }
      // Otros errores (sin conexion, limite de frecuencia): se reintentan
      // en el proximo ciclo.
    } catch (_) {
      // Se reintenta en el proximo ciclo.
    }
  }
}
