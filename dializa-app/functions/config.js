// Interruptores centrales del backend. Un solo lugar para prender/apagar
// features que el cliente pidio dejar listas pero inactivas hasta nuevo
// aviso (ver requerimientos_de_la_app.txt, puntos 6.9, 11.9, 11.10).
//
// Cambiar un valor aqui y desplegar es suficiente para activar la funcion
// correspondiente; no hace falta tocar el resto del codigo.

module.exports = {
  // Punto 6.9: Geoapify (geocoding, routing, places, map matching) queda
  // integrado pero DESACTIVADO hasta que se confirme que el cliente final
  // lo va a usar. Las 6 Cloud Functions de Geoapify revisan este flag
  // primero y devuelven un error claro si esta en false, sin tocar
  // Secret Manager ni gastar cuota.
  GEOAPIFY_HABILITADO: false,

  // Puntos 11.9/11.10: restriccion geografica a Chile continental en
  // validarCoordenada(). Desactivada por defecto (no aplica aun).
  RESTRICCION_GEOGRAFICA_CHILE_ACTIVA: false,
};
