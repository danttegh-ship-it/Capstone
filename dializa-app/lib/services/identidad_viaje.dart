/// Misma identidad que functions/historial.js para asignaciones anteriores.
String identidadViaje(String pacienteId, Map<String, dynamic> datos) {
  final id = datos['viajeId'];
  if (id is String && id.isNotEmpty) return id;
  String sanear(Object? valor) {
    final limpio = (valor?.toString() ?? '').replaceAll(
      RegExp(r'[^A-Za-z0-9_-]'),
      '_',
    );
    return limpio.length > 60 ? limpio.substring(0, 60) : limpio;
  }

  final legado = [
    'legacy',
    sanear(pacienteId),
    sanear(datos['choferId']),
    sanear(datos['fecha']),
    sanear(datos['hora']),
  ].join('_');
  return legado.length > 240 ? legado.substring(0, 240) : legado;
}
