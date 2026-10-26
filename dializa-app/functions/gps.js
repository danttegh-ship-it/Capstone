// Recorrido GPS observado de cada viaje.
//
// DONDE SE GUARDA: subcoleccion de Firestore
//     gps_viajes/{viajeId}                 resumen {conteo, primerTs, ultimoTs, pacienteId, conductorId}
//     gps_viajes/{viajeId}/muestras/{t}    una muestra {lat, lng, t, fase, fuente:'gps'}
// Nunca un arreglo dentro de un documento (limite de 1 MiB y reescritura
// completa en cada punto). El id de cada muestra es su timestamp en ms:
// reenviar el mismo lote es idempotente (no duplica ni infla `conteo`).
//
// QUIEN ESCRIBE: solo esta Cloud Function (los clientes no tienen permiso
// de escritura sobre `gps_viajes`, ver firestore.rules). Solo el chofer
// asignado y aprobado, y solo mientras el viaje esta en un estado activo.
//
// CUANDO: durante conductor_en_camino, conductor_llego y en_viaje (`fase`
// guarda cual era). No se aceptan muestras en asignado (aun no sale) ni
// tras finalizado/cancelado, ni de viajes ajenos.
//
// VOLUMEN: <= 50 muestras por llamada, <= 5000 por viaje (a 1 muestra cada
// 5 s son ~7 h de viaje), 30 llamadas por minuto por chofer, y solo
// timestamps en [ahora-15 min, ahora+60 s] (evita retroceder o inventar
// recorridos).
//
// CARRERA CON EL CIERRE: la escritura ocurre en una transaccion que LEE el
// documento del viaje. Si el viaje se finaliza/cancela en paralelo, las
// transacciones se serializan: la segunda ve el estado final y se rechaza.
//
// TRES CONCEPTOS DISTINTOS (no mezclar):
//   - GPS observado:       `gps_viajes/{viajeId}/muestras`  (fuente:'gps')
//   - ruta planificada:    la calcula Geoapify bajo demanda (no se persiste aqui)
//   - ruta ajustada (map matching): reservada en
//     `gps_viajes/{viajeId}/derivadas/{ajustada|planificada}`, escrita solo
//     por el servidor cuando Geoapify este activo (Fase 4). Nunca se
//     sobrescribe una muestra observada con un dato derivado.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  validarUid,
  validarMuestrasGps,
  GPS_MAX_MUESTRAS_POR_VIAJE,
} = require("./validaciones");
const { exigirLimiteTasa } = require("./rateLimit");
const { campoConductor, viajeIdDe, exigirInstancia } = require("./historial");

const ESTADOS_CON_GPS = ["conductor_en_camino", "conductor_llego", "en_viaje"];

function init(db, cuentas) {
  const { exigirPerfilValido } = cuentas;

  const registrarMuestrasGps = onCall(async (request) => {
    const { uid } = await exigirPerfilValido(request, ["chofer"]);

    const coleccion = request.data && request.data.coleccion;
    if (coleccion !== "viajes" && coleccion !== "solicitudes") {
      throw new HttpsError("invalid-argument", "coleccion debe ser 'viajes' o 'solicitudes'.");
    }
    const id = validarUid(request.data && request.data.id);
    const muestras = validarMuestrasGps(request.data && request.data.muestras);

    await exigirLimiteTasa(db, uid, "registrarMuestrasGps", 60000, 30);

    const viajeRef = db.collection(coleccion).doc(id);

    const resultado = await db.runTransaction(async (tx) => {
      const viajeSnap = await tx.get(viajeRef);
      if (!viajeSnap.exists) throw new HttpsError("not-found", "Viaje no encontrado.");
      const datos = viajeSnap.data();

      if (datos[campoConductor(coleccion)] !== uid) {
        throw new HttpsError("permission-denied", "Este viaje no esta asignado a ti.");
      }
      exigirInstancia(coleccion, id, datos, request.data.viajeId);
      const estado = datos.estado || "asignado";
      if (!ESTADOS_CON_GPS.includes(estado)) {
        throw new HttpsError("failed-precondition", `No se registra GPS en estado '${estado}'.`);
      }

      const { viajeId } = viajeIdDe(coleccion, id, datos);
      const resumenRef = db.collection("gps_viajes").doc(viajeId);
      const refsMuestras = muestras.map((m) => resumenRef.collection("muestras").doc(String(m.t)));

      const [resumenSnap, ...existentes] = await Promise.all([tx.get(resumenRef), ...refsMuestras.map((r) => tx.get(r))]);
      const resumen = resumenSnap.exists ? resumenSnap.data() : null;
      const conteoActual = resumen ? resumen.conteo || 0 : 0;

      const nuevas = muestras.filter((_, i) => !existentes[i].exists);
      if (conteoActual + nuevas.length > GPS_MAX_MUESTRAS_POR_VIAJE) {
        throw new HttpsError("resource-exhausted", "Se alcanzo el maximo de muestras GPS para este viaje.");
      }

      nuevas.forEach((m) => {
        tx.set(resumenRef.collection("muestras").doc(String(m.t)), {
          lat: m.lat,
          lng: m.lng,
          t: m.t,
          fase: estado,
          fuente: "gps",
        });
      });

      if (nuevas.length > 0) {
        const primerLote = nuevas[0].t;
        const ultimoLote = nuevas[nuevas.length - 1].t;
        const pacienteId = coleccion === "viajes" ? id : datos.pacienteId;
        tx.set(
          resumenRef,
          {
            viajeId,
            origenColeccion: coleccion,
            origenId: id,
            pacienteId,
            conductorId: uid,
            conteo: conteoActual + nuevas.length,
            primerTs: resumen && resumen.primerTs ? Math.min(resumen.primerTs, primerLote) : primerLote,
            ultimoTs: resumen && resumen.ultimoTs ? Math.max(resumen.ultimoTs, ultimoLote) : ultimoLote,
          },
          { merge: true }
        );
      }

      return { guardadas: nuevas.length, duplicadas: muestras.length - nuevas.length, viajeId };
    });

    return { ok: true, ...resultado };
  });

  return { registrarMuestrasGps };
}

module.exports = { init, ESTADOS_CON_GPS };
