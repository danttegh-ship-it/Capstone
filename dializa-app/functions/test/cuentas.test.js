// Tests UNITARIOS (dobles) de cuentas.js: correcciones D y E (lado
// servidor), bajas con viajes abiertos.
const test = require("node:test");
const assert = require("node:assert/strict");
const { montar, sembrarUsuarios, UID } = require("./helpers/montaje");
const { peticion, error } = require("./helpers/memoria");

// Completar la observacion del cliente en las fixtures de escenarios previos.
const llamar = async (e, fn, uid, rol, data) => {
  if ([e.viajes.actualizarEstadoViaje, e.viajes.cancelarAsignacionConductor, e.gps.registrarMuestrasGps].includes(fn)) {
    const coleccion = data.coleccion || "solicitudes";
    const snap = await e.db.doc(`${coleccion}/${data.id}`).get();
    if (snap.exists) data = { viajeId: require("../historial").viajeIdDe(coleccion, data.id, snap.data()).viajeId, estadoEsperado: snap.data().estado || "asignado", ...data };
  }
  return fn.run(peticion(uid, rol, data));
};
async function entorno() {
  const e = montar();
  await sembrarUsuarios(e.db, e.auth);
  return e;
}
const usuario = async (e, uid) => (await e.db.doc(`usuarios/${uid}`).get()).data();

// --- D: activarDesactivarCuenta -------------------------------------------------------

test("D: desactivar -> Firestore activo:false, Auth disabled:true y refresh tokens revocados", async () => {
  const e = await entorno();
  const r = await llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.chofer, activo: false });
  assert.deepEqual([r.ok, r.authActualizado], [true, true]);
  assert.equal((await usuario(e, UID.chofer)).activo, false);
  assert.equal(e.auth.usuarios.get(UID.chofer).disabled, true);
  assert.equal(e.auth.usuarios.get(UID.chofer).tokensRevocados, 1);
});

test("D: reactivar -> Auth habilitado y Firestore activo:true", async () => {
  const e = await entorno();
  await llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.chofer, activo: false });
  await llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.chofer, activo: true });
  assert.equal((await usuario(e, UID.chofer)).activo, true);
  assert.equal(e.auth.usuarios.get(UID.chofer).disabled, false);
});

test("D: una cuenta desactivada queda bloqueada de inmediato en las Cloud Functions (aunque su token siga vigente)", async () => {
  const e = await entorno();
  await llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.chofer, activo: false });
  const err = await error(llamar(e, e.cuentas.actualizarDisponibilidad, UID.chofer, "chofer", { disponible: true }));
  assert.equal(err.code, "permission-denied");
});

test("D: idempotente -- repetir la misma desactivacion no falla ni duplica efectos relevantes", async () => {
  const e = await entorno();
  await llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.paciente, activo: false });
  const r = await llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.paciente, activo: false });
  assert.equal(r.ok, true);
  assert.equal(e.auth.usuarios.get(UID.paciente).disabled, true);
});

test("D: si el usuario existe solo en Firestore (sin Auth) se desactiva igual y se informa authActualizado:false", async () => {
  const e = await entorno();
  await e.db.doc("usuarios/paciente_sin_auth").set({ rol: "paciente", nombre: "Sin Auth", activo: true });
  const r = await llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: "paciente_sin_auth", activo: false });
  assert.equal(r.authActualizado, false);
  assert.equal((await usuario(e, "paciente_sin_auth")).activo, false);
});

test("D: si Auth falla al desactivar, Firestore ya quedo en false (lado seguro) y el error se propaga para reintentar", async () => {
  const e = await entorno();
  e.auth.updateUser = async () => { throw new Error("auth caido"); };
  const err = await error(llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.chofer, activo: false }));
  assert.match(err.message, /auth caido/);
  assert.equal((await usuario(e, UID.chofer)).activo, false);
});

test("D: protecciones previas se mantienen (no auto-desactivarse, ni al ultimo admin)", async () => {
  const e = await entorno();
  assert.equal((await error(llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.admin, activo: false }))).code, "failed-precondition");
  await llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin, "admin", { uid: UID.admin2, activo: false });
  // admin2 ya no esta activo: desactivar a "admin" desde admin2 no se puede (admin2 desactivado) y al unico activo tampoco
  const err = await error(llamar(e, e.cuentas.activarDesactivarCuenta, UID.admin2, "admin", { uid: UID.admin, activo: false }));
  assert.equal(err.code, "permission-denied");
  assert.equal(e.auth.usuarios.get(UID.admin).disabled, false);
});

test("D: solo un admin puede desactivar", async () => {
  const e = await entorno();
  assert.equal((await error(llamar(e, e.cuentas.activarDesactivarCuenta, UID.chofer, "chofer", { uid: UID.paciente, activo: false }))).code, "permission-denied");
  assert.equal(e.auth.usuarios.get(UID.paciente).disabled, false);
});

// --- E (servidor): higiene del token FCM ----------------------------------------------------

test("E: registrarTokenFcm guarda el token y lo LIMPIA de otra cuenta que lo tuviera (cambio de usuario en el mismo telefono)", async () => {
  const e = await entorno();
  await llamar(e, e.cuentas.registrarTokenFcm, UID.paciente, "paciente", { token: "TOKEN-DEL-TELEFONO" });
  assert.equal((await usuario(e, UID.paciente)).fcmToken, "TOKEN-DEL-TELEFONO");
  await llamar(e, e.cuentas.registrarTokenFcm, UID.chofer, "chofer", { token: "TOKEN-DEL-TELEFONO" });
  assert.equal((await usuario(e, UID.chofer)).fcmToken, "TOKEN-DEL-TELEFONO");
  assert.equal((await usuario(e, UID.paciente)).fcmToken, null, "el usuario anterior ya no recibe en ese telefono");
});

test("E: registrarTokenFcm valida el token y exige sesion", async () => {
  const e = await entorno();
  assert.equal((await error(llamar(e, e.cuentas.registrarTokenFcm, UID.paciente, "paciente", { token: "" }))).code, "invalid-argument");
  assert.equal((await error(llamar(e, e.cuentas.registrarTokenFcm, UID.paciente, "paciente", { token: 123 }))).code, "invalid-argument");
  assert.equal((await error(llamar(e, e.cuentas.registrarTokenFcm, null, null, { token: "x" }))).code, "unauthenticated");
});

test("E: eliminarTokenFcm borra el token propio, y no toca el de otro dispositivo si el token no coincide", async () => {
  const e = await entorno();
  await llamar(e, e.cuentas.registrarTokenFcm, UID.paciente, "paciente", { token: "T-A" });
  await llamar(e, e.cuentas.eliminarTokenFcm, UID.paciente, "paciente", { token: "T-OTRO-DISPOSITIVO" });
  assert.equal((await usuario(e, UID.paciente)).fcmToken, "T-A");
  await llamar(e, e.cuentas.eliminarTokenFcm, UID.paciente, "paciente", { token: "T-A" });
  assert.equal((await usuario(e, UID.paciente)).fcmToken, null);
});

// --- Bajas con viajes abiertos -------------------------------------------------------------------

test("eliminarCuenta de un chofer con viajes sin cerrar es RECHAZADA; con viajes cerrados procede", async () => {
  const e = await entorno();
  await llamar(e, e.viajes.asignarViaje, UID.admin, "admin", { pacienteId: UID.paciente, choferId: UID.chofer, fecha: "2026-10-12", hora: "10:15" });
  const err = await error(llamar(e, e.cuentas.eliminarCuenta, UID.admin, "admin", { uid: UID.chofer }));
  assert.equal(err.code, "failed-precondition");
  assert.ok((await e.db.doc(`usuarios/${UID.chofer}`).get()).exists);
  await llamar(e, e.viajes.cancelarAsignacionConductor, UID.chofer, "chofer", { coleccion: "viajes", id: UID.paciente });
  await llamar(e, e.cuentas.eliminarCuenta, UID.admin, "admin", { uid: UID.chofer });
  assert.ok(!(await e.db.doc(`usuarios/${UID.chofer}`).get()).exists);
  // la evidencia del viaje cancelado se conserva con el nombre desnormalizado
  const archivos = await e.db.collection("historial_viajes").get();
  assert.equal(archivos.docs[0].data().conductorNombre, "Chofer Uno");
});

test("eliminarPaciente archiva su viaje vigente (cuenta_eliminada), cancela solicitudes abiertas y revoca la ubicacion", async () => {
  const e = await entorno();
  const { viajeId } = await llamar(e, e.viajes.asignarViaje, UID.admin, "admin", { pacienteId: UID.paciente, choferId: UID.chofer, fecha: "2026-10-12", hora: "10:15" });
  await llamar(e, e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", { coleccion: "viajes", id: UID.paciente, nuevoEstado: "conductor_en_camino" });
  assert.equal(e.rtdb._leer(`ubicaciones/${UID.chofer}/pacienteAutorizado`), UID.paciente);
  await e.db.doc("solicitudes/sol_borrar_001").set({ pacienteId: UID.paciente, conductorId: null, estado: "solicitado", historial: [], rechazadoPor: [] });

  const r = await llamar(e, e.cuentas.eliminarPaciente, UID.admin, "admin", { uid: UID.paciente });
  assert.equal(r.ok, true);
  assert.ok(!(await e.db.doc(`viajes/${UID.paciente}`).get()).exists);
  assert.ok(!(await e.db.doc(`usuarios/${UID.paciente}`).get()).exists);
  const a = (await e.db.doc(`historial_viajes/${viajeId}`).get()).data();
  assert.equal(a.cierre, "cuenta_eliminada");
  assert.equal(a.pacienteNombre, "Paciente Uno", "nombre desnormalizado conservado");
  assert.equal((await e.db.doc("solicitudes/sol_borrar_001").get()).data().estado, "cancelado");
  assert.equal((await e.db.doc("historial_viajes/sol_borrar_001").get()).data().cierre, "cuenta_eliminada");
  assert.equal(e.rtdb._leer(`ubicaciones/${UID.chofer}/pacienteAutorizado`), null);
});
