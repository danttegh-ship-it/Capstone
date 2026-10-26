import 'dart:async';
import 'dart:convert';

/// Persistencia y envio serializados por UID e instancia. Solo se elimina
/// un lote despues de confirmacion; un fallo conserva exactamente sus fechas.
class ColaGps {
  ColaGps({required this.read, required this.write, required this.send});
  final Future<String?> Function() read;
  final Future<void> Function(String) write;
  final Future<Map<String, dynamic>> Function(Map<String, dynamic>) send;
  final Map<String, Map<String, dynamic>> _items = {};
  Future<void> _tail = Future<void>.value();
  Future<void>? _load;
  Future<T> _serial<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return result;
  }

  Future<void> load() => _load ??= _serial(() async {
    final saved = await read();
    if (saved == null) return;
    for (final raw in jsonDecode(saved) as List) {
      final item = Map<String, dynamic>.from(raw as Map);
      _items[_key(item)] = item;
    }
  });
  String _key(Map<String, dynamic> item) =>
      jsonEncode([item['coleccion'], item['id'], item['viajeId']]);
  Future<void> _save() => write(jsonEncode(_items.values.toList()));
  int get pendientes => _items.values.fold<int>(
    0,
    (n, item) => n + (item['muestras'] as List).length,
  );
  Future<void> add(
    Map<String, dynamic> trip,
    Map<String, dynamic> point,
  ) async {
    await load();
    await _serial(() async {
      final key = _key(trip);
      final item = _items.putIfAbsent(
        key,
        () => {...trip, 'muestras': <dynamic>[]},
      );
      final points = item['muestras'] as List;
      if (points.any((p) => p['timestampMs'] == point['timestampMs'])) return;
      if (points.length >= 5000)
        throw StateError(
          'Cola GPS llena. Conecta el dispositivo antes de continuar.',
        );
      points.add(Map<String, dynamic>.from(point));
      await _save();
    });
  }

  Future<void> flush([String? viajeId]) async {
    await load();
    await _serial(() async {
      for (final key in _items.keys.toList()) {
        final item = _items[key]!;
        if (viajeId != null && item['viajeId'] != viajeId) continue;
        final points = item['muestras'] as List;
        while (points.isNotEmpty) {
          final batch = points.take(50).toList();
          final result = await send({...item, 'muestras': batch});
          if ((result['guardadas'] as num? ?? 0) +
                  (result['duplicadas'] as num? ?? 0) !=
              batch.length) {
            throw StateError('El servidor no confirmo el lote GPS completo.');
          }
          points.removeRange(0, batch.length);
          await _save();
        }
        _items.remove(key);
        await _save();
      }
    });
  }
}
