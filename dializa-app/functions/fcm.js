// Propiedad atomica por token; datos privados y tombstone por sesion.
const { createHash } = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { perfilOperativo } = require("./operacionesCuenta");
const clave = (token) => createHash("sha256").update(token).digest("hex");
function sesionValida(request) {
  if (!request.auth?.uid)
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  const sesionId = request.data?.sesionId;
  if (typeof sesionId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(sesionId))
    throw new HttpsError("invalid-argument", "sesionId invalida.");
  return { uid: request.auth.uid, sesionId };
}
function init(db) {
  const registrarTokenFcm = onCall(async (request) => {
    const { uid, sesionId } = sesionValida(request);
    const token = request.data?.token;
    if (typeof token !== "string" || !token || token.length > 4096)
      throw new HttpsError("invalid-argument", "token invalido.");
    const tokenRef = db.collection("fcmTokens").doc(clave(token)),
      privadoRef = db.collection("usuarios_privado").doc(uid),
      sesionRef = db.collection("fcmSesiones").doc(sesionId),
      perfilRef = db.collection("usuarios").doc(uid);
    await db.runTransaction(async (tx) => {
      const [perfil, privado, propietario, sesion, legados] = await Promise.all(
        [
          tx.get(perfilRef),
          tx.get(privadoRef),
          tx.get(tokenRef),
          tx.get(sesionRef),
          tx.get(db.collection("usuarios").where("fcmToken", "==", token)),
        ],
      );
      if (!perfil.exists || !perfilOperativo(perfil.data()))
        throw new HttpsError("permission-denied", "Cuenta inactiva.");
      if (
        sesion.exists &&
        (sesion.data().uid !== uid || sesion.data().revocada)
      )
        throw new HttpsError("failed-precondition", "Sesion FCM cerrada.");
      const anterior = privado.exists ? privado.data() : {};
      const tokenAnteriorRef =
        anterior.tokenKey && anterior.tokenKey !== tokenRef.id
          ? db.collection("fcmTokens").doc(anterior.tokenKey)
          : null;
      const tokenAnterior = tokenAnteriorRef
        ? await tx.get(tokenAnteriorRef)
        : null;
      const otroUid = propietario.exists ? propietario.data().uid : null;
      const otroRef =
        otroUid && otroUid !== uid
          ? db.collection("usuarios_privado").doc(otroUid)
          : null;
      const otro = otroRef ? await tx.get(otroRef) : null;
      const obsoletas = [
        ...new Set(
          [
            anterior.sesionId,
            propietario.exists ? propietario.data().sesionId : null,
          ].filter((id) => id && id !== sesionId),
        ),
      ];
      const sesionesPrevias = await Promise.all(
        obsoletas.map((id) => tx.get(db.collection("fcmSesiones").doc(id))),
      );
      for (const previa of sesionesPrevias)
        if (previa.exists)
          tx.set(previa.ref, { uid: previa.data().uid, revocada: true });
      if (tokenAnterior?.exists && tokenAnterior.data().uid === uid)
        tx.delete(tokenAnteriorRef);
      if (otro?.exists && otro.data().tokenKey === tokenRef.id)
        tx.set(otroRef, {
          ...otro.data(),
          fcmToken: null,
          tokenKey: null,
          sesionId: null,
        });
      for (const doc of legados.docs) {
        const datos = { ...doc.data() };
        delete datos.fcmToken;
        tx.set(doc.ref, datos);
      }
      // Eliminar cualquier token anterior del perfil propio, aunque sea otro.
      if (
        !legados.docs.some((d) => d.id === uid) &&
        Object.hasOwn(perfil.data(), "fcmToken")
      ) {
        const datos = { ...perfil.data() };
        delete datos.fcmToken;
        tx.set(perfilRef, datos);
      }
      tx.set(sesionRef, { uid, revocada: false });
      tx.set(tokenRef, { uid, sesionId, token });
      tx.set(privadoRef, {
        ...anterior,
        fcmToken: token,
        tokenKey: tokenRef.id,
        sesionId,
      });
    });
    return { ok: true };
  });
  const eliminarTokenFcm = onCall(async (request) => {
    const { uid, sesionId } = sesionValida(request);
    await db.runTransaction(async (tx) => {
      const sesionRef = db.collection("fcmSesiones").doc(sesionId),
        privadoRef = db.collection("usuarios_privado").doc(uid);
      const [sesion, privado] = await Promise.all([
        tx.get(sesionRef),
        tx.get(privadoRef),
      ]);
      if (sesion.exists && sesion.data().uid !== uid)
        throw new HttpsError("permission-denied", "Sesion ajena.");
      const datos = privado.exists ? privado.data() : {};
      const tokenRef = datos.tokenKey
        ? db.collection("fcmTokens").doc(datos.tokenKey)
        : null;
      const propietario = tokenRef ? await tx.get(tokenRef) : null;
      // Incluso un logout que llega antes del registro deja tombstone.
      tx.set(sesionRef, { uid, revocada: true });
      if (
        datos.sesionId === sesionId &&
        (!request.data?.token || datos.fcmToken === request.data.token)
      ) {
        if (
          propietario?.exists &&
          propietario.data().uid === uid &&
          propietario.data().sesionId === sesionId
        )
          tx.delete(tokenRef);
        tx.set(privadoRef, {
          ...datos,
          fcmToken: null,
          tokenKey: null,
          sesionId: null,
        });
      }
    });
    return { ok: true };
  });
  return { registrarTokenFcm, eliminarTokenFcm };
}
module.exports = { init, clave };
