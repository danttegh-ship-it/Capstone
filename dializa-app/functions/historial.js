// Historial de viajes (coleccion `historial_viajes`).
//
// MODELO
//   - `viajes/{pacienteId}`  = asignacion VIGENTE del paciente (un doc por
//     paciente, se sobrescribe al reasignar).
//   - `solicitudes/{id}`     = viaje bajo demanda (un doc por viaje).
//   - `historial_viajes/{viajeId}` = copia inmutable de cada viaje cerrado.
//   - `gps_viajes/{viajeId}/muestras/*` = recorrido GPS observado (gps.js).
//
// ID ESTABLE POR INSTANCIA DE VIAJE (`viajeId`)
//   - solicitudes: el id del documento (ya es unico por viaje).
//   - viajes: `viajeId` generado por el servidor en `asignarViaje`. Los
//     documentos anteriores a esta version no lo tienen: se les calcula un
//     id determinista `legacy_<paciente>_<chofer>_<fecha>_<hora>` (esLegacy).
//
// CUANDO SE ARCHIVA (siempre DENTRO de la misma transaccion que cambia el
// estado, asi no hay "cerro pero no archivo" ni al reves):
//   - estado -> finalizado | cancelado            (cierre = ese estado)
//   - el admin reasigna un viaje aun no iniciado  (cierre = 'reasignado')
//   - se elimina la cuenta del paciente           (cierre = 'cuenta_eliminada')
//
// IDEMPOTENCIA: el documento se crea solo si no existe. Un reintento, un
// trigger duplicado o dos llamadas concurrentes (las transacciones de
// Firestore se serializan) producen UN solo documento y no pisan el primero.
//
// NOMBRES DESNORMALIZADOS: se copian pacienteNombre/conductorNombre al
// archivar para que borrar una cuenta despues no borre la evidencia.

const { HttpsError } = require("firebase-functions/v2/https");

const ESTADOS_FINALES = ["finalizado", "cancelado"];

function campoConductor(coleccion) {
  return coleccion === "viajes" ? "choferId" : "conductorId";
}

function sanear(texto) {
  return String(texto === undefined || texto === null ? "" : texto)
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 60);
}

/**
 * Id estable de la instancia de viaje. Ver cabecera.
 * @returns {{viajeId: string, esLegacy: boolean}}
 */
function viajeIdDe(coleccion, id, datos) {
  if (coleccion === "solicitudes") return { viajeId: id, esLegacy: false };
  if (datos && typeof datos.viajeId === "string" && datos.viajeId.length > 0) {
    return { viajeId: datos.viajeId, esLegacy: false };
  }
  const base = [
    "legacy",
    sanear(id),
    sanear(datos && datos.choferId),
    sanear(datos && datos.fecha),
    sanear(datos && datos.hora),
  ];
  return { viajeId: base.join("_").slice(0, 240), esLegacy: true };
}

/**
 * Lee (dentro de la transaccion, ANTES de cualquier escritura) todo lo
 * necesario para archivar: el doc de historial, el resumen GPS y los
 * nombres de los participantes.
 */
async function leerContextoArchivo(tx, db, coleccion, id, datos) {
  const { viajeId, esLegacy } = viajeIdDe(coleccion, id, datos);
  const pacienteId = coleccion === "viajes" ? id : datos.pacienteId;
  const conductorId = datos[campoConductor(coleccion)] || null;

  const archivoRef = db.collection("historial_viajes").doc(viajeId);
  const gpsRef = db.collection("gps_viajes").doc(viajeId);
  const lecturas = [
    tx.get(archivoRef),
    tx.get(gpsRef),
    tx.get(db.collection("usuarios").doc(pacienteId)),
  ];
  if (conductorId)
    lecturas.push(tx.get(db.collection("usuarios").doc(conductorId)));
  const [archivoSnap, gpsSnap, pacienteSnap, conductorSnap] =
    await Promise.all(lecturas);

  return {
    viajeId,
    esLegacy,
    pacienteId,
    conductorId,
    archivoRef,
    archivoSnap,
    gpsSnap,
    pacienteSnap,
    conductorSnap,
  };
}

/**
 * Escribe el documento de historial (solo si no existia). `datosFinales`
 * es el contenido que tendra el documento vivo tras la operacion (con el
 * estado y el historial de estados ya actualizados).
 * @returns {boolean} true si archivo ahora, false si ya estaba archivado.
 */
function escribirArchivo(tx, ctx, { coleccion, id, datosFinales, cierre }) {
  if (ctx.archivoSnap.exists) return false;

  const gps = ctx.gpsSnap.exists
    ? {
        conteo: ctx.gpsSnap.data().conteo || 0,
        primerTs: ctx.gpsSnap.data().primerTs || null,
        ultimoTs: ctx.gpsSnap.data().ultimoTs || null,
      }
    : { conteo: 0, primerTs: null, ultimoTs: null };

  const nombrePaciente =
    ctx.pacienteSnap && ctx.pacienteSnap.exists
      ? ctx.pacienteSnap.data().nombre || null
      : null;
  const nombreConductor =
    datosFinales.choferNombre ||
    (ctx.conductorSnap && ctx.conductorSnap.exists
      ? ctx.conductorSnap.data().nombre || null
      : null);

  tx.set(ctx.archivoRef, {
    viajeId: ctx.viajeId,
    esLegacy: ctx.esLegacy,
    origenColeccion: coleccion,
    origenId: id,
    pacienteId: ctx.pacienteId,
    pacienteNombre: nombrePaciente,
    conductorId: ctx.conductorId,
    conductorNombre: nombreConductor,
    estadoFinal: datosFinales.estado || "asignado",
    cierre,
    historial: Array.isArray(datosFinales.historial)
      ? datosFinales.historial
      : [],
    fecha: datosFinales.fecha || null,
    hora: datosFinales.hora || null,
    origen: datosFinales.origen || null,
    destino: datosFinales.destino || null,
    necesidades: datosFinales.necesidades || null,
    notas: datosFinales.notas || null,
    creadoEn: datosFinales.creadoEn || datosFinales.asignadoEn || null,
    archivadoEn: new Date().toISOString(),
    gps,
  });
  return true;
}

function agregarHistorial(historialActual, estado, actorUid = null) {
  const historial = Array.isArray(historialActual) ? [...historialActual] : [];
  const entrada = { estado, fecha: new Date().toISOString() };
  if (actorUid) entrada.actorUid = actorUid;
  historial.push(entrada);
  return historial;
}

module.exports = {
  ESTADOS_FINALES,
  campoConductor,
  viajeIdDe,
  leerContextoArchivo,
  escribirArchivo,
  agregarHistorial,
};

// La ruta viajes/{pacienteId} se reutiliza: nunca inferir la instancia de
// una orden pendiente a partir del documento que haya ahora en esa ruta.
function exigirInstancia(coleccion, id, datos, esperado) {
  if (
    typeof esperado !== "string" ||
    !esperado ||
    esperado.length > 256 ||
    esperado.includes("/")
  ) {
    throw new HttpsError(
      "invalid-argument",
      "viajeId de la instancia observada es obligatorio.",
    );
  }
  if (viajeIdDe(coleccion, id, datos).viajeId !== esperado) {
    throw new HttpsError(
      "failed-precondition",
      "El viaje fue reemplazado. Actualiza la pantalla.",
    );
  }
}
module.exports.exigirInstancia = exigirInstancia;
