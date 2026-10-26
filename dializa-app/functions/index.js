// Cloud Functions v2 de dializa-app -- punto de entrada.
//
// Este archivo solo inicializa Firebase Admin, fija la region, y conecta
// los modulos. La logica de negocio vive en:
//   - cuentas.js             roles, custom claims, altas/bajas, FCM token
//   - viajes.js               maquina de estados de viaje/solicitud + asignarViaje
//   - historial.js            archivo idempotente en historial_viajes
//   - gps.js                  recorrido GPS observado (gps_viajes)
//   - autorizacionUbicacion.js  quien puede leer la ubicacion (RTDB)
//   - geoapify-funciones.js   las 6 funciones de Geoapify (flag en config.js)
//   - notificaciones.js       triggers de Firestore que disparan FCM
//   - validaciones.js         validacion de payloads
//   - rateLimit.js / geoapify.js   utilidades compartidas
//
// Puerto de daily-app/firebase/functions/index.js, adaptado a las
// colecciones y al modelo de roles de dializa-app (ver docs/ARQUITECTURA.md
// para el mapeo completo).

const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getDatabase } = require("firebase-admin/database");

initializeApp();
const db = getFirestore();

// Region consistente con daily-app (America del Sur, mas cerca de los
// usuarios en Santiago que la region por defecto us-central1).
setGlobalOptions({ region: "southamerica-east1" });

// RTDB se obtiene de forma perezosa (solo al reconciliar la autorizacion de
// ubicacion), para no exigirla al cargar el modulo.
const autorizacion = require("./autorizacionUbicacion").init(db, () => getDatabase());
const cuentas = require("./cuentas").init(db, { autorizacion });
const viajes = require("./viajes").init(db, cuentas, { autorizacion });
const gps = require("./gps").init(db, cuentas);
const geoapifyFunciones = require("./geoapify-funciones").init(db, cuentas);
const notificaciones = require("./notificaciones").init(db);

// ---------------------------------------------------------------------
// Cuentas, roles y choferes
// ---------------------------------------------------------------------
exports.crearCuentaAdministrador = cuentas.crearCuentaAdministrador;
exports.solicitarRegistroConductor = cuentas.solicitarRegistroConductor;
exports.aprobarConductor = cuentas.aprobarConductor;
exports.activarDesactivarCuenta = cuentas.activarDesactivarCuenta;
exports.eliminarCuenta = cuentas.eliminarCuenta;
exports.registrarTokenFcm = cuentas.registrarTokenFcm;
exports.eliminarTokenFcm = cuentas.eliminarTokenFcm;
exports.actualizarDisponibilidad = cuentas.actualizarDisponibilidad;
exports.agregarPaciente = cuentas.agregarPaciente;
exports.modificarPaciente = cuentas.modificarPaciente;
exports.eliminarPaciente = cuentas.eliminarPaciente;

// ---------------------------------------------------------------------
// Flujo de viaje
// ---------------------------------------------------------------------
exports.crearSolicitudViaje = viajes.crearSolicitudViaje;
exports.aceptarSolicitud = viajes.aceptarSolicitud;
exports.rechazarSolicitud = viajes.rechazarSolicitud;
exports.cancelarAsignacionConductor = viajes.cancelarAsignacionConductor;
exports.actualizarEstadoViaje = viajes.actualizarEstadoViaje;
exports.asignarViaje = viajes.asignarViaje;
exports.sincronizarAutorizacionUbicacion = viajes.sincronizarAutorizacionUbicacion;

// ---------------------------------------------------------------------
// GPS acumulado del viaje
// ---------------------------------------------------------------------
exports.registrarMuestrasGps = gps.registrarMuestrasGps;

// ---------------------------------------------------------------------
// Geoapify (desactivado por defecto, ver functions/config.js)
// ---------------------------------------------------------------------
exports.geocodificarDireccion = geoapifyFunciones.geocodificarDireccion;
exports.buscarDirecciones = geoapifyFunciones.buscarDirecciones;
exports.obtenerDireccionInversa = geoapifyFunciones.obtenerDireccionInversa;
exports.calcularRuta = geoapifyFunciones.calcularRuta;
exports.buscarLugaresCercanos = geoapifyFunciones.buscarLugaresCercanos;
exports.ajustarRutaGps = geoapifyFunciones.ajustarRutaGps;

// ---------------------------------------------------------------------
// Notificaciones (triggers de Firestore, sin invocacion directa desde el cliente)
// ---------------------------------------------------------------------
exports.notificarAsignacionViaje = notificaciones.notificarAsignacionViaje;
exports.notificarAsignacionSolicitud = notificaciones.notificarAsignacionSolicitud;

// H02: retry real del proveedor ante caida temporal de RTDB. Evento viejo:
// se recalcula el estado actual, nunca se aplica el payload antiguo.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
function repararUbicacion(campo) {
  return async (event) => {
    if (!event.data) return;
    const antes = event.data.before.exists ? event.data.before.data() : {};
    const despues = event.data.after.exists ? event.data.after.data() : {};
    const uids = [...new Set([antes[campo], despues[campo]].filter(Boolean))];
    for (const uid of uids) await autorizacion.reconciliar(uid);
  };
}
exports.reconciliarUbicacionViaje = onDocumentWritten({ document: "viajes/{id}", retry: true }, repararUbicacion("choferId"));
exports.reconciliarUbicacionSolicitud = onDocumentWritten({ document: "solicitudes/{id}", retry: true }, repararUbicacion("conductorId"));

exports.sincronizarAccesoCuenta = onDocumentWritten({document:"usuarios/{uid}",retry:true}, event => autorizacion.sincronizarCuenta(event.params.uid));
// TTL de cinco minutos: si los eventos/RTDB fallan, los permisos no quedan
// vigentes indefinidamente. Renovacion periodica solo desde servidor.
const {onSchedule}=require("firebase-functions/v2/scheduler");
exports.renovarAccesosUbicacion = onSchedule("every 2 minutes", async ()=>{
 const perfiles=await db.collection("usuarios").where("activo","==",true).get();
 for(const doc of perfiles.docs) {
  await autorizacion.sincronizarCuenta(doc.id);
  if(doc.data().rol==="chofer" && doc.data().aprobado===true) await autorizacion.reconciliar(doc.id);
 }
});
