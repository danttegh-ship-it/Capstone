// Flujo de viaje: combina los dos modelos que pidio el requerimiento.
//
//   - `viajes/{pacienteId}`: asignacion manual que hace el admin (ya
//     existia en dializa-app, UI sin cambios -- punto 13.8/13.10/13.13:
//     "usaremos la version de dializa app"). Se le agrega `estado` +
//     `historial` para que el chofer pueda ir avanzando el viaje sin
//     tocar la forma en que el admin lo crea.
//   - `solicitudes/{id}`: viaje bajo demanda que pide el propio paciente,
//     con aceptacion/rechazo por parte de un chofer disponible (puerto
//     completo de daily-app, puntos 13.1/13.2/13.4/13.9/13.11/13.12).
//
// La maquina de estados (docs/ESTADOS_VIAJE.md) es la misma para ambos:
//   solicitado -> asignado -> conductor_en_camino -> conductor_llego -> en_viaje -> finalizado
//   (cualquier estado antes de en_viaje) -> cancelado
// `viajes/{pacienteId}` nace directo en "asignado" (el admin ya eligio
// chofer y hora), nunca pasa por "solicitado".
//
// FASE 1: al cerrarse (finalizado/cancelado) o reasignarse, cada viaje se
// archiva en `historial_viajes` dentro de la MISMA transaccion (ver
// historial.js) y, tras confirmar, se reconcilia la autorizacion de
// ubicacion en RTDB (autorizacionUbicacion.js). El admin ya no escribe
// `viajes` directo: usa el callable `asignarViaje`.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  validarUid,
  validarEstado,
  validarFecha,
  validarHora,
  validarPuntoViaje,
  validarNecesidades,
  validarTextoOpcional,
} = require("./validaciones");
const { registrarAuditoria } = require("./auditoria");
const { exigirLimiteTasa } = require("./rateLimit");
const {
  ESTADOS_FINALES,
  campoConductor,
  leerContextoArchivo,
  escribirArchivo,
  agregarHistorial,
  exigirInstancia,
} = require("./historial");

// Transiciones permitidas, controladas por quien las dispara.
const TRANSICIONES_CONDUCTOR = {
  asignado: ["conductor_en_camino", "cancelado"],
  conductor_en_camino: ["conductor_llego", "cancelado"],
  conductor_llego: ["en_viaje", "cancelado"],
  en_viaje: ["finalizado"],
};

// Un viaje ya iniciado no se puede reasignar desde el panel admin.
const ESTADOS_NO_REASIGNABLES = ["conductor_llego", "en_viaje"];

function coleccionValida(coleccion) {
  if (coleccion !== "viajes" && coleccion !== "solicitudes") {
    throw new HttpsError("invalid-argument", "coleccion debe ser 'viajes' o 'solicitudes'.");
  }
  return coleccion;
}

function init(db, cuentas, { autorizacion }) {
  const { exigirPerfilValido, exigirAdmin } = cuentas;

  // ---------------------------------------------------------------------
  // crearSolicitudViaje: el paciente pide un traslado bajo demanda. El id
  // y el historial se generan en el servidor; el cliente nunca los fija.
  // Correccion B: se persisten y validan origen, destino y necesidades
  // (se conservan `notas` y `direccionTexto`), y se limita la frecuencia.
  // ---------------------------------------------------------------------
  const crearSolicitudViaje = onCall(async (request) => {
    const { uid } = await exigirPerfilValido(request, ["paciente"]);
    const datos = request.data || {};

    const origen = validarPuntoViaje(datos.origen, "origen");
    const destino = validarPuntoViaje(datos.destino, "destino");
    const necesidades = validarNecesidades(datos.necesidades);
    const notas = validarTextoOpcional(datos.notas, 500, "notas");
    const direccionTexto = validarTextoOpcional(datos.direccionTexto, 200, "direccionTexto");

    // Como en daily-app: como maximo una solicitud cada 5 segundos.
    await exigirLimiteTasa(db, uid, "crearSolicitudViaje", 5000, 1);

    const ref = db.collection("solicitudes").doc();
    await ref.set({
      pacienteId: uid,
      conductorId: null,
      estado: "solicitado",
      origen,
      destino,
      necesidades,
      notas,
      direccionTexto,
      rechazadoPor: [],
      historial: agregarHistorial([], "solicitado", uid),
      creadoEn: new Date().toISOString(),
    });

    return { id: ref.id };
  });

  // ---------------------------------------------------------------------
  // aceptarSolicitud: un chofer disponible y aprobado toma una solicitud
  // en estado 'solicitado'. Transaccion para evitar que dos choferes la
  // tomen a la vez. Al aceptar se concede al paciente la lectura de la
  // ubicacion de ese chofer (reconciliacion RTDB).
  // ---------------------------------------------------------------------
  const aceptarSolicitud = onCall(async (request) => {
    const { uid } = await exigirPerfilValido(request, ["chofer"]);
    const solicitudId = validarUid(request.data && request.data.solicitudId);

    const choferPrivadoRef = db.collection("choferes_privado").doc(uid);
    const solicitudRef = db.collection("solicitudes").doc(solicitudId);

    await db.runTransaction(async (tx) => {
      const [choferDoc, solicitudDoc] = await Promise.all([tx.get(choferPrivadoRef), tx.get(solicitudRef)]);

      if (!choferDoc.exists || choferDoc.data().disponible !== true) {
        throw new HttpsError("failed-precondition", "Debes estar disponible para aceptar viajes.");
      }
      if (!solicitudDoc.exists || solicitudDoc.data().estado !== "solicitado") {
        throw new HttpsError("failed-precondition", "La solicitud ya no esta disponible.");
      }

      tx.update(solicitudRef, {
        conductorId: uid,
        estado: "asignado",
        historial: agregarHistorial(solicitudDoc.data().historial, "asignado", uid),
      });
      tx.update(choferPrivadoRef, { disponible: false });
    });

    const autorizacionSincronizada = await autorizacion.reconciliarSeguro([uid]);
    return { ok: true, autorizacionSincronizada };
  });

  // ---------------------------------------------------------------------
  // rechazarSolicitud: SOLO para el chofer que YA acepto (estado
  // 'asignado') y se arrepiente: la solicitud vuelve a 'solicitado' para
  // otro chofer. NO existe rechazo de solicitudes pendientes: en la lista
  // de pendientes solo hay "Aceptar".
  // ---------------------------------------------------------------------
  const rechazarSolicitud = onCall(async (request) => {
    const { uid } = await exigirPerfilValido(request, ["chofer"]);
    const solicitudId = validarUid(request.data && request.data.solicitudId);
    const motivo = validarTextoOpcional(request.data && request.data.motivo, 200, "motivo");

    const solicitudRef = db.collection("solicitudes").doc(solicitudId);
    const choferPrivadoRef = db.collection("choferes_privado").doc(uid);

    await db.runTransaction(async (tx) => {
      const solicitudDoc = await tx.get(solicitudRef);
      if (!solicitudDoc.exists) throw new HttpsError("not-found", "Solicitud no encontrada.");

      const datos = solicitudDoc.data();
      if (datos.conductorId !== uid || datos.estado !== "asignado") {
        throw new HttpsError("failed-precondition", "Esta solicitud no esta asignada a ti.");
      }

      const rechazadoPor = Array.isArray(datos.rechazadoPor) ? [...datos.rechazadoPor] : [];
      if (rechazadoPor.includes(uid)) {
        throw new HttpsError("failed-precondition", "Ya rechazaste esta solicitud antes.");
      }
      rechazadoPor.push(uid);

      tx.update(solicitudRef, {
        conductorId: null,
        estado: "solicitado",
        rechazadoPor,
        historial: agregarHistorial(datos.historial, `rechazado:${motivo || "sin motivo"}`, uid),
      });
      tx.update(choferPrivadoRef, { disponible: true });
    });

    const autorizacionSincronizada = await autorizacion.reconciliarSeguro([uid]);
    return { ok: true, autorizacionSincronizada };
  });

  // ---------------------------------------------------------------------
  // Cambio de estado con archivo: compartido por actualizarEstadoViaje y
  // cancelarAsignacionConductor. TODO ocurre en una transaccion: valida
  // dueno y transicion, escribe el nuevo estado y, si queda final,
  // archiva en historial_viajes y libera al chofer.
  // ---------------------------------------------------------------------
  async function cambiarEstadoComoChofer({ uid, coleccion, id, nuevoEstado, viajeId, estadoEsperado }) {
    const ref = db.collection(coleccion).doc(id);

    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) throw new HttpsError("not-found", "No encontrado.");

      const datos = doc.data();
      if (datos[campoConductor(coleccion)] !== uid) {
        throw new HttpsError("permission-denied", "Este viaje no esta asignado a ti.");
      }

      exigirInstancia(coleccion, id, datos, viajeId);
      const estadoActual = datos.estado || "asignado";
      if (typeof estadoEsperado !== "string") throw new HttpsError("invalid-argument", "estadoEsperado es obligatorio.");
      if (estadoActual !== estadoEsperado) throw new HttpsError("failed-precondition", "El estado cambio. Actualiza la pantalla.");
      const permitidas = TRANSICIONES_CONDUCTOR[estadoActual] || [];
      if (!permitidas.includes(nuevoEstado)) {
        throw new HttpsError("failed-precondition", `No se puede pasar de '${estadoActual}' a '${nuevoEstado}'.`);
      }

      const cierra = ESTADOS_FINALES.includes(nuevoEstado);
      // Todas las lecturas ANTES de escribir (regla de las transacciones).
      const ctx = cierra ? await leerContextoArchivo(tx, db, coleccion, id, datos) : null;

      const datosFinales = {
        ...datos,
        estado: nuevoEstado,
        historial: agregarHistorial(datos.historial, nuevoEstado, uid),
      };
      tx.update(ref, { estado: datosFinales.estado, historial: datosFinales.historial });

      if (cierra) {
        escribirArchivo(tx, ctx, { coleccion, id, datosFinales, cierre: nuevoEstado });
        tx.set(db.collection("choferes_privado").doc(uid), { disponible: false }, { merge: true });
      }
    });
  }

  // ---------------------------------------------------------------------
  // cancelarAsignacionConductor (correccion C): el chofer cancela un viaje
  // que ya habia aceptado. El servidor valida el estado dentro de una
  // transaccion atomica: solo se puede cancelar desde asignado,
  // conductor_en_camino o conductor_llego (nunca en_viaje ni un viaje
  // finalizado/cancelado). Queda `disponible:false` (igual que daily-app).
  // ---------------------------------------------------------------------
  const cancelarAsignacionConductor = onCall(async (request) => {
    const { uid } = await exigirPerfilValido(request, ["chofer"]);
    const coleccion = coleccionValida((request.data && request.data.coleccion) || "solicitudes");
    const id = validarUid(request.data && request.data.id);

    await cambiarEstadoComoChofer({ uid, coleccion, id, nuevoEstado: "cancelado", viajeId: request.data.viajeId, estadoEsperado: request.data.estadoEsperado });

    await registrarAuditoria(db, { accion: "cancelarAsignacion", actorUid: uid, detalle: { coleccion, id } });

    const autorizacionSincronizada = await autorizacion.reconciliarSeguro([uid]);
    return { ok: true, autorizacionSincronizada };
  });

  // ---------------------------------------------------------------------
  // actualizarEstadoViaje: avanza la maquina de estados (solo el chofer
  // asignado) y al finalizar o cancelar archiva y libera al chofer.
  // ---------------------------------------------------------------------
  const actualizarEstadoViaje = onCall(async (request) => {
    const { uid } = await exigirPerfilValido(request, ["chofer"]);
    const coleccion = coleccionValida((request.data && request.data.coleccion) || "solicitudes");
    const id = validarUid(request.data && request.data.id);
    const nuevoEstado = validarEstado(request.data && request.data.nuevoEstado);

    await cambiarEstadoComoChofer({ uid, coleccion, id, nuevoEstado, viajeId: request.data.viajeId, estadoEsperado: request.data.estadoEsperado });

    const autorizacionSincronizada = await autorizacion.reconciliarSeguro([uid]);
    return { ok: true, autorizacionSincronizada };
  });

  // ---------------------------------------------------------------------
  // asignarViaje (admin): reemplaza el `.set()` directo que hacia
  // AdminHome. En UNA transaccion archiva el viaje anterior del paciente
  // (si lo habia) y crea el nuevo con un viajeId generado aqui. Asi nunca
  // se pierde un viaje pasado, y dos asignaciones concurrentes se
  // serializan (la segunda archiva a la primera como 'reasignado').
  // ---------------------------------------------------------------------
  const asignarViaje = onCall(async (request) => {
    const { uid: actorUid } = await exigirAdmin(request);
    const pacienteId = validarUid(request.data && request.data.pacienteId);
    const choferId = validarUid(request.data && request.data.choferId);
    const fecha = validarFecha(request.data && request.data.fecha);
    const hora = validarHora(request.data && request.data.hora);

    const viajeRef = db.collection("viajes").doc(pacienteId);
    const viajeId = db.collection("viajes").doc().id;

    const { choferAnterior } = await db.runTransaction(async (tx) => {
      const [viajeSnap, pacienteSnap, choferSnap] = await Promise.all([
        tx.get(viajeRef),
        tx.get(db.collection("usuarios").doc(pacienteId)),
        tx.get(db.collection("usuarios").doc(choferId)),
      ]);

      if (!pacienteSnap.exists || pacienteSnap.data().rol !== "paciente" || pacienteSnap.data().activo === false) {
        throw new HttpsError("failed-precondition", "El paciente no existe o esta desactivado.");
      }
      if (
        !choferSnap.exists ||
        choferSnap.data().rol !== "chofer" ||
        choferSnap.data().activo === false ||
        choferSnap.data().aprobado !== true
      ) {
        throw new HttpsError("failed-precondition", "El chofer no existe, no esta aprobado o esta desactivado.");
      }

      const previo = viajeSnap.exists ? viajeSnap.data() : null;
      let ctx = null;
      let cierre = null;
      if (previo) {
        const estadoPrevio = previo.estado || "asignado";
        if (ESTADOS_NO_REASIGNABLES.includes(estadoPrevio)) {
          throw new HttpsError("failed-precondition", `El viaje actual esta en curso ('${estadoPrevio}') y no se puede reasignar.`);
        }
        cierre = ESTADOS_FINALES.includes(estadoPrevio) ? estadoPrevio : "reasignado";
        ctx = await leerContextoArchivo(tx, db, "viajes", pacienteId, previo);
      }

      if (previo) escribirArchivo(tx, ctx, { coleccion: "viajes", id: pacienteId, datosFinales: previo, cierre });

      tx.set(viajeRef, {
        viajeId,
        choferId,
        choferNombre: choferSnap.data().nombre || null,
        fecha,
        hora,
        estado: "asignado",
        historial: agregarHistorial([], "asignado", actorUid),
        asignadoEn: new Date().toISOString(),
        asignadoPor: actorUid,
      });

      return { choferAnterior: previo ? previo.choferId || null : null };
    });

    await registrarAuditoria(db, {
      accion: "asignarViaje",
      actorUid,
      objetivoUid: pacienteId,
      detalle: { viajeId, choferId, fecha, hora },
    });

    const autorizacionSincronizada = await autorizacion.reconciliarSeguro([choferAnterior, choferId]);
    return { ok: true, viajeId, autorizacionSincronizada };
  });

  // ---------------------------------------------------------------------
  // sincronizarAutorizacionUbicacion: reparacion manual de la
  // autorizacion RTDB de un chofer (si una reconciliacion fallo). El admin
  // puede repararla para cualquier chofer; el chofer solo la suya.
  // ---------------------------------------------------------------------
  const sincronizarAutorizacionUbicacion = onCall(async (request) => {
    const { uid, rol } = await exigirPerfilValido(request, ["admin", "chofer"]);
    const objetivo = rol === "admin" ? validarUid(request.data && request.data.choferId) : uid;
    if (rol === "chofer" && request.data && request.data.choferId && request.data.choferId !== uid) {
      throw new HttpsError("permission-denied", "Solo puedes sincronizar tu propia ubicacion.");
    }
    const resultado = await autorizacion.reconciliar(objetivo);
    return { ok: true, ...resultado };
  });

  return {
    crearSolicitudViaje,
    aceptarSolicitud,
    rechazarSolicitud,
    cancelarAsignacionConductor,
    actualizarEstadoViaje,
    asignarViaje,
    sincronizarAutorizacionUbicacion,
  };
}

module.exports = { init, TRANSICIONES_CONDUCTOR };
