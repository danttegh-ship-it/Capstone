import 'dart:async';

/// Serializa publicaciones de una instancia y evita enviar las que quedaron
/// pendientes cuando cambia el estado, se cierra sesion o se pausa la app.
class PublicadorUbicacion {
  PublicadorUbicacion(this.send);
  final Future<void> Function(double, double, int) send;
  Future<void> _tail = Future.value();
  int _generacion = 0;
  String? _instancia;
  void cambiar(String? instancia) {
    if (_instancia == instancia) return;
    _instancia = instancia;
    _generacion++;
  }

  Future<void> publicar(double lat, double lng, int timestamp) {
    final generacion = _generacion;
    final tarea = _tail.then((_) async {
      if (_instancia == null || generacion != _generacion) return;
      await send(lat, lng, timestamp);
    });
    _tail = tarea.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return tarea;
  }
}

const estadosUbicacionManual = [
  'conductor_en_camino',
  'conductor_llego',
  'en_viaje',
];
const estadosUbicacionSolicitud = ['asignado', ...estadosUbicacionManual];
bool autorizaUbicacion(String coleccion, String estado) =>
    (coleccion == 'viajes' ? estadosUbicacionManual : estadosUbicacionSolicitud)
        .contains(estado);
