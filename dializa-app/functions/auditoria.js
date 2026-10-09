// Registro de auditoria (punto 10.7). Coleccion de solo-escritura desde
// el servidor (ver firestore.rules), nunca editable ni legible desde el
// cliente salvo por un admin.

async function registrarAuditoria(db, { accion, actorUid, objetivoUid = null, detalle = null }) {
  await db.collection("auditoria").add({
    accion,
    actorUid,
    objetivoUid,
    detalle,
    fecha: new Date().toISOString(),
  });
}

module.exports = { registrarAuditoria };
