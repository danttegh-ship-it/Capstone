import 'dart:async';
import 'dart:convert';

/// Codigo estable del callable; nunca se guarda el mensaje remoto sin filtrar.
class FalloGps implements Exception {
  FalloGps(this.code);
  final String code;
}

/// Cola por instancia. La cuarentena conserva las muestras rechazadas y sus
/// fechas originales, pero no participa de los envios ni del cierre.
class ColaGps {
  ColaGps({required this.read, required this.write, required this.send});
  final Future<String?> Function() read;
  final Future<void> Function(String) write;
  final Future<Map<String, dynamic>> Function(Map<String, dynamic>) send;
  final Map<String, Map<String, dynamic>> _items = {};
  final List<Map<String, dynamic>> _cuarentena = [];
  Future<void> _tail = Future<void>.value();
  Future<void>? _load;
  Future<T> _serial<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Future<void> load() => _load ??= _serial(() async {
    final saved = await read();
    if (saved == null) return;
    final decoded = jsonDecode(saved);
    final items = decoded is List ? decoded : decoded['pendientes'] as List;
    for (final raw in items) {
      final item = Map<String, dynamic>.from(raw as Map);
      _items[_key(item)] = item;
    }
    if (decoded is Map) {
      _cuarentena.addAll(
        (decoded['cuarentena'] as List).map(
          (e) => Map<String, dynamic>.from(e as Map),
        ),
      );
    }
  });
  String _key(Map<String, dynamic> item) =>
      jsonEncode([item['coleccion'], item['id'], item['viajeId']]);
  Future<void> _save() => write(
    jsonEncode({
      'version': 2,
      'pendientes': _items.values.toList(),
      'cuarentena': _cuarentena,
    }),
  );
  int get pendientes => _items.values.fold<int>(
    0,
    (n, item) => n + (item['muestras'] as List).length,
  );
  int get enCuarentena => _cuarentena.fold<int>(
    0,
    (n, item) => n + (item['muestras'] as List).length,
  );
  // Copia para una futura exportacion administrativa, sin exponer estado mutable.
  List<dynamic> get cuarentena => jsonDecode(jsonEncode(_cuarentena)) as List;
  static const permanentes = {
    'invalid-argument',
    'failed-precondition',
    'not-found',
    'permission-denied',
  };
  void _aislar(Map<String, dynamic> item, List<dynamic> points, String code) {
    _cuarentena.add({
      'coleccion': item['coleccion'],
      'id': item['id'],
      'viajeId': item['viajeId'],
      'codigo': code,
      'muestras': jsonDecode(jsonEncode(points)),
    });
  }

  Future<void> add(
    Map<String, dynamic> trip,
    Map<String, dynamic> point,
  ) async {
    await load();
    await _serial(() async {
      final item = _items.putIfAbsent(
        _key(trip),
        () => {...trip, 'muestras': <dynamic>[]},
      );
      final points = item['muestras'] as List;
      if (points.any((p) => p['timestampMs'] == point['timestampMs'])) return;
      if (points.length >= 5000) {
        throw StateError('Cola GPS llena. Conecta el dispositivo.');
      }
      points.add(Map<String, dynamic>.from(point));
      await _save();
    });
  }

  Future<void> flush([String? viajeId]) async {
    await load();
    await _serial(() async {
      Object? temporal;
      for (final key in _items.keys.toList()) {
        final item = _items[key]!;
        if (viajeId != null && item['viajeId'] != viajeId) continue;
        final points = item['muestras'] as List;
        while (points.isNotEmpty) {
          final batch = points.take(50).toList();
          Map<String, dynamic> result;
          try {
            result = await send({...item, 'muestras': batch});
          } catch (error) {
            if (error is FalloGps && permanentes.contains(error.code)) {
              _aislar(item, batch, error.code);
              points.removeRange(0, batch.length);
              await _save();
              continue;
            }
            temporal ??= error;
            break; // Otra instancia sigue aunque esta no tenga conexion/permisos.
          }
          final rejected = result['rechazadas'] as List? ?? [];
          final indices = <int>{};
          var respuestaInvalida = false;
          for (final raw in rejected) {
            final index = raw['indice'];
            if (index is! int ||
                index < 0 ||
                index >= batch.length ||
                !indices.add(index) ||
                !permanentes.contains(raw['codigo'])) {
              respuestaInvalida = true;
              break;
            }
          }
          if (respuestaInvalida) {
            temporal ??= StateError('Confirmacion GPS invalida.');
            break;
          }
          if ((result['guardadas'] as num? ?? 0) +
                  (result['duplicadas'] as num? ?? 0) +
                  indices.length !=
              batch.length) {
            temporal ??= StateError('El servidor no confirmo el lote GPS.');
            break;
          }
          for (final raw in rejected) {
            _aislar(item, [
              batch[raw['indice'] as int],
            ], raw['codigo'] as String);
          }
          points.removeRange(0, batch.length);
          await _save();
        }
        if (points.isEmpty) {
          _items.remove(key);
          await _save();
        }
      }
      if (temporal != null) throw temporal;
    });
  }

  /// Comparte la misma exclusion mutua con el envio periodico.
  Future<void> prepararCierre(String viajeId) => flush(viajeId);
}
