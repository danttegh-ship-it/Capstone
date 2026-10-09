// Tests UNITARIOS (dobles) de la autorizacion de ubicacion en RTDB
// (correccion A): concesion, revocacion, reasignacion, eventos tardios y
// que el `update()` del chofer no borre la autorizacion.
const test = require("node:test");
const assert = require("node:assert/strict");
const { montar, sembrarUsuarios, UID } = require("./helpers/montaje");
const { peticion, error } = require("./helpers/memoria");
const { elegirAutorizado } = require("../autorizacionUbicacion");

const llamar = (fn, uid, rol, data) => fn.run(peticion(uid, rol, data));
const nodo = (e, uid) => e.rtdb._leer(`ubicaciones/${uid}`) || {};
const P = { lat: -33.45, lng: -70.66, direccion: "x" };

async function entorno() {
  const e = montar();
  await sembrarUsuarios(e.db, e.auth);
  return e;
}
const asignar = (e, extra = {}) =>
  llamar(e.viajes.asignarViaje, UID.admin, "admin", { pacienteId: UID.paciente, choferId: UID.chofer, fecha: "2026-10-12", hora: "10:15", ...extra });
const estado = (e, uid, nuevoEstado, id = UID.paciente, coleccion = "viajes") =>
  llamar(e.viajes.actualizarEstadoViaje, uid, "chofer", { coleccion, id, nuevoEstado });

test("elegirAutorizado (puro): estados que autorizan en cada coleccion y prioridad", () => {
  const v = (id, estado, extra = {}) => ({ id, datos: { estado, ...extra } });
  assert.equal(elegirAutorizado([v("p1", "asignado")], []), null, "viajes en 'asignado' NO autorizan");
  assert.equal(elegirAutorizado([v("p1", "finalizado")], []), null);
  assert.deepEqual(elegirAutorizado([v("p1", "conductor_en_camino", { viajeId: "V1" })], []), { pacienteId: "p1", viajeId: "V1" });
  assert.deepEqual(elegirAutorizado([], [v("s1", "asignado", { pacienteId: "pp" })]), { pacienteId: "pp", viajeId: "s1" }, "solicitudes en 'asignado' SI autorizan");
  assert.equal(elegirAutorizado([], [v("s1", "solicitado", { pacienteId: "pp" })]), null);
  const elegido = elegirAutorizado([v("p1", "conductor_en_camino", { viajeId: "V1" })], [v("s1", "en_viaje", { pacienteId: "pp" })]);
  assert.equal(elegido.pacienteId, "pp", "gana el estado mas avanzado");
});

test("A: aceptar una solicitud concede la lectura al paciente; cancelar la revoca y conserva la version", async () => {
  const e = await entorno();
  await e.db.collection("solicitudes").doc("sol_000000001").set({ pacienteId: UID.paciente, conductorId: null, estado: "solicitado", historial: [], rechazadoPor: [] });
  const r = await llamar(e.viajes.aceptarSolicitud, UID.chofer, "chofer", { solicitudId: "sol_000000001" });
  assert.equal(r.autorizacionSincronizada, true);
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
  assert.equal(nodo(e, UID.chofer).viajeAutorizado, "sol_000000001");

  const c = await llamar(e.viajes.cancelarAsignacionConductor, UID.chofer, "chofer", { coleccion: "solicitudes", id: "sol_000000001" });
  assert.equal(c.autorizacionSincronizada, true);
  const n = nodo(e, UID.chofer);
  assert.equal(n.pacienteAutorizado, undefined, "revocado");
  assert.equal(n.viajeAutorizado, undefined);
  assert.equal(typeof n.autorizacionVersion, "number", "la lapida conserva la version");
});

test("A: rechazar una solicitud ya aceptada revoca al paciente", async () => {
  const e = await entorno();
  await e.db.collection("solicitudes").doc("sol_000000002").set({ pacienteId: UID.paciente, conductorId: null, estado: "solicitado", historial: [], rechazadoPor: [] });
  await llamar(e.viajes.aceptarSolicitud, UID.chofer, "chofer", { solicitudId: "sol_000000002" });
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
  await llamar(e.viajes.rechazarSolicitud, UID.chofer, "chofer", { solicitudId: "sol_000000002" });
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, undefined);
});

test("A: viaje asignado por admin NO autoriza; conductor_en_camino SI; finalizar revoca", async () => {
  const e = await entorno();
  const { viajeId, autorizacionSincronizada } = await asignar(e);
  assert.equal(autorizacionSincronizada, true);
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, undefined, "asignado con dias de anticipacion: aun sin acceso");
  await estado(e, UID.chofer, "conductor_en_camino");
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
  assert.equal(nodo(e, UID.chofer).viajeAutorizado, viajeId);
  await estado(e, UID.chofer, "conductor_llego");
  await estado(e, UID.chofer, "en_viaje");
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
  await estado(e, UID.chofer, "finalizado");
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, undefined);
});

test("A: un paciente anterior NO conserva acceso cuando el chofer pasa a otro paciente", async () => {
  const e = await entorno();
  await asignar(e); // paciente 1 con chofer 1
  await estado(e, UID.chofer, "conductor_en_camino");
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
  await estado(e, UID.chofer, "conductor_llego");
  await estado(e, UID.chofer, "en_viaje");
  await estado(e, UID.chofer, "finalizado");
  // el mismo chofer toma el viaje del paciente 2
  await llamar(e.viajes.asignarViaje, UID.admin, "admin", { pacienteId: UID.paciente2, choferId: UID.chofer, fecha: "2026-10-13", hora: "12:00" });
  await estado(e, UID.chofer, "conductor_en_camino", UID.paciente2);
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente2);
  assert.notEqual(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
});

test("A: reasignar el viaje a otro chofer revoca al chofer anterior y no concede de antemano al nuevo", async () => {
  const e = await entorno();
  await asignar(e);
  await estado(e, UID.chofer, "conductor_en_camino");
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
  const r = await asignar(e, { choferId: UID.chofer2 }); // viaje no iniciado del punto de vista de reasignar (en_camino permitido)
  assert.equal(r.autorizacionSincronizada, true);
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, undefined, "chofer anterior revocado");
  assert.equal(nodo(e, UID.chofer2).pacienteAutorizado, undefined, "nuevo chofer: aun en 'asignado'");
  await estado(e, UID.chofer2, "conductor_en_camino");
  assert.equal(nodo(e, UID.chofer2).pacienteAutorizado, UID.paciente);
});

test("A: un evento TARDIO (reconciliacion mas vieja) no revoca ni concede sobre una asignacion mas nueva", async () => {
  const e = await entorno();
  await asignar(e);
  await estado(e, UID.chofer, "conductor_en_camino");
  const ahora = Date.now();
  const original = Date.now;
  try {
    Date.now = () => ahora - 60000; // reconciliacion que "empezo" hace un minuto
    const tardia = await e.autorizacion.reconciliar(UID.chofer);
    assert.equal(tardia.aplicado, false, "debe abortar: hay una version mas nueva");
  } finally {
    Date.now = original;
  }
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente, "el acceso vigente se conserva");

  // y al reves: tras revocar, una concesion vieja no revive el acceso
  await estado(e, UID.chofer, "cancelado");
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, undefined);
  const versionRevocacion = nodo(e, UID.chofer).autorizacionVersion;
  await e.db.collection("solicitudes").doc("sol_viejo_0001").set({ pacienteId: UID.paciente2, conductorId: UID.chofer, estado: "asignado", historial: [] });
  try {
    Date.now = () => versionRevocacion - 5000;
    const r = await e.autorizacion.reconciliar(UID.chofer);
    assert.equal(r.aplicado, false);
  } finally {
    Date.now = original;
  }
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, undefined, "la lapida impide revivir el acceso");
});

test("A: el update() de lat/lng/timestamp del chofer NO borra pacienteAutorizado (set() si lo borraria)", async () => {
  const e = await entorno();
  await asignar(e);
  await estado(e, UID.chofer, "conductor_en_camino");
  await e.rtdb.ref(`ubicaciones/${UID.chofer}`).update({ lat: -33.4, lng: -70.6, timestamp: 123 });
  const n = nodo(e, UID.chofer);
  assert.equal(n.pacienteAutorizado, UID.paciente);
  assert.equal(n.lat, -33.4);
  // demostracion del riesgo que se evita: un set() de nodo completo destruye la autorizacion
  await e.rtdb.ref(`ubicaciones/${UID.chofer}`).set({ lat: 1, lng: 2, timestamp: 3 });
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, undefined);
  // y la reconciliacion lo repara
  await e.autorizacion.reconciliar(UID.chofer);
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
  assert.equal(nodo(e, UID.chofer).lat, 1, "la reconciliacion conserva lat/lng");
});

test("A: si RTDB falla, la operacion de negocio SE CONFIRMA y se informa autorizacionSincronizada:false; el admin puede reparar", async () => {
  const e = await entorno();
  await asignar(e);
  e.rtdb.fallar = true;
  const r = await estado(e, UID.chofer, "conductor_en_camino");
  assert.equal(r.ok, true);
  assert.equal(r.autorizacionSincronizada, false);
  assert.equal((await e.db.doc(`viajes/${UID.paciente}`).get()).data().estado, "conductor_en_camino");
  e.rtdb.fallar = false;
  const rep = await llamar(e.viajes.sincronizarAutorizacionUbicacion, UID.admin, "admin", { choferId: UID.chofer });
  assert.equal(rep.pacienteAutorizado, UID.paciente);
  assert.equal(nodo(e, UID.chofer).pacienteAutorizado, UID.paciente);
});

test("A: sincronizarAutorizacionUbicacion -- un chofer solo repara la suya; un paciente no puede", async () => {
  const e = await entorno();
  assert.equal((await error(llamar(e.viajes.sincronizarAutorizacionUbicacion, UID.chofer, "chofer", { choferId: UID.chofer2 }))).code, "permission-denied");
  assert.equal((await error(llamar(e.viajes.sincronizarAutorizacionUbicacion, UID.paciente, "paciente", {}))).code, "permission-denied");
  const ok = await llamar(e.viajes.sincronizarAutorizacionUbicacion, UID.chofer, "chofer", {});
  assert.equal(ok.ok, true);
});
