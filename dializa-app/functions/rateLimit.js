// Rate limiting por uid+accion, basado en una transaccion de Firestore.
//
// Portado desde daily-app/firebase/functions/rateLimit.js (mismo diseno):
// evita que un usuario autenticado agote la cuota gratuita de Geoapify
// disparando llamadas en bucle desde el cliente.

const { HttpsError } = require("firebase-functions/v2/https");

/**
 * Exige que el uid no haya superado el limite de llamadas para `accion`
 * dentro de la ventana de tiempo indicada. Lanza HttpsError('resource-exhausted')
 * si se supera.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 * @param {string} accion - nombre logico de la accion (ej. 'geocodificarDireccion')
 * @param {number} ventanaMs - tamano de la ventana en milisegundos
 * @param {number} maximoLlamadas - llamadas permitidas dentro de la ventana
 */
async function exigirLimiteTasa(db, uid, accion, ventanaMs = 60000, maximoLlamadas = 20) {
  const ref = db.collection("rateLimits").doc(`${uid}_${accion}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const ahora = Date.now();

    if (!snap.exists) {
      tx.set(ref, { conteo: 1, inicioVentana: ahora });
      return;
    }

    const datos = snap.data();
    const inicioVentana = datos.inicioVentana || ahora;
    const dentroDeVentana = ahora - inicioVentana < ventanaMs;

    if (!dentroDeVentana) {
      tx.set(ref, { conteo: 1, inicioVentana: ahora });
      return;
    }

    const nuevoConteo = (datos.conteo || 0) + 1;
    if (nuevoConteo > maximoLlamadas) {
      throw new HttpsError(
        "resource-exhausted",
        "Demasiadas solicitudes en poco tiempo. Intenta de nuevo en un minuto."
      );
    }

    tx.update(ref, { conteo: nuevoConteo });
  });
}

module.exports = { exigirLimiteTasa };
