// Tests UNITARIOS (dobles en memoria) de viajes.js: solicitudes,
// cancelacion validada, archivo en historial_viajes, asignarViaje.
const test = require("node:test");
const assert = require("node:assert/strict");
const { montar, sembrarUsuarios, UID } = require("./helpers/montaje");
const { peticion, error } = require("./helpers/memoria");

const PUNTO_A = { lat: -33.45, lng: -70.66, direccion: "Calle Uno 123" };
const PUNTO_B = { lat: -33.5, lng: -70.7, direccion: "Hospital X" };

async function entorno(opts) {
  const e = montar();
  await sembrarUsuarios(e.db, e.auth, opts);
  return e;
}
// Completar la observacion del cliente en las fixtures de escenarios previos.
const llamar = async (e, fn, uid, rol, data) => {
  if ([e.viajes.actualizarEstadoViaje, e.viajes.cancelarAsignacionConductor, e.gps.registrarMuestrasGps].includes(fn)) {
    const coleccion = data.coleccion || "solicitudes";
    const snap = await e.db.doc(`${coleccion}/${data.id}`).get();
    if (snap.exists) data = { viajeId: require("../historial").viajeIdDe(coleccion, data.id, snap.data()).viajeId, estadoEsperado: snap.data().estado || "asignado", ...data };
  }
  return fn.run(peticion(uid, rol, data));
};
const leer = async (db, ruta) => (await db.doc(ruta).get()).data();

async function crearViaje(e, estado, { coleccion = "viajes", choferId = UID.chofer, extra = {} } = {}) {
  if (coleccion === "viajes") {
    await e.db.collection("viajes").doc(UID.paciente).set({
      viajeId: "viaje_fijo_0001", choferId, choferNombre: "Chofer Uno", fecha: "2026-10-10", hora: "09:30",
      estado, historial: [{ estado, fecha: "2026-10-09T00:00:00.000Z" }], ...extra,
    });
    return UID.paciente;
  }
  const ref = e.db.collection("solicitudes").doc("solicitud_0001");
  await ref.set({ pacienteId: UID.paciente, conductorId: choferId, estado, origen: PUNTO_A, destino: PUNTO_B,
    historial: [{ estado, fecha: "2026-10-09T00:00:00.000Z" }], rechazadoPor: [], creadoEn: "2026-10-09T00:00:00.000Z", ...extra });
  return "solicitud_0001";
}

// --- B: crearSolicitudViaje -------------------------------------------------------

test("B: crearSolicitudViaje persiste origen, destino y necesidades validados (y conserva notas/direccionTexto)", async () => {
  const e = await entorno();
  const r = await llamar(e, e.viajes.crearSolicitudViaje, UID.paciente, "paciente", {
    origen: PUNTO_A, destino: PUNTO_B, notas: "Timbre roto", direccionTexto: "Casa",
    necesidades: { sillaRuedas: true, acompanante: false, observaciones: "Escalera", contactoEmergencia: "+56 9 1111 2222" },
  });
  const s = await leer(e.db, `solicitudes/${r.id}`);
  assert.equal(s.estado, "solicitado");
  assert.equal(s.pacienteId, UID.paciente);
  assert.deepEqual(s.origen, PUNTO_A);
  assert.deepEqual(s.destino, PUNTO_B);
  assert.equal(s.necesidades.sillaRuedas, true);
  assert.equal(s.necesidades.observaciones, "Escalera");
  assert.equal(s.notas, "Timbre roto");
  assert.equal(s.direccionTexto, "Casa");
  assert.equal(s.historial[0].estado, "solicitado");
});

test("B: rechaza origen/destino ausentes, coordenadas invalidas y textos demasiado largos", async () => {
  const e = await entorno();
  const intentos = [
    { destino: PUNTO_B },
    { origen: PUNTO_A },
    { origen: { lat: 200, lng: 0 }, destino: PUNTO_B },
    { origen: { lat: "x", lng: 0 }, destino: PUNTO_B },
    { origen: { ...PUNTO_A, direccion: "a".repeat(201) }, destino: PUNTO_B },
    { origen: PUNTO_A, destino: PUNTO_B, necesidades: { observaciones: "a".repeat(501) } },
    { origen: PUNTO_A, destino: PUNTO_B, necesidades: { contactoEmergencia: "a".repeat(151) } },
  ];
  for (const data of intentos) {
    const err = await error(llamar(e, e.viajes.crearSolicitudViaje, UID.paciente, "paciente", data));
    assert.equal(err && err.code, "invalid-argument", JSON.stringify(data).slice(0, 80));
  }
  assert.equal((await e.db.collection("solicitudes").get()).size, 0, "no debe crearse nada");
});

test("B: rate limit -- la segunda creacion inmediata es rechazada; otro paciente no se ve afectado", async () => {
  const e = await entorno();
  const data = { origen: PUNTO_A, destino: PUNTO_B };
  await llamar(e, e.viajes.crearSolicitudViaje, UID.paciente, "paciente", data);
  const err = await error(llamar(e, e.viajes.crearSolicitudViaje, UID.paciente, "paciente", data));
  assert.equal(err.code, "resource-exhausted");
  await llamar(e, e.viajes.crearSolicitudViaje, UID.paciente2, "paciente", data);
});

test("B: solo un paciente activo puede crear solicitudes", async () => {
  const e = await entorno();
  const data = { origen: PUNTO_A, destino: PUNTO_B };
  assert.equal((await error(llamar(e, e.viajes.crearSolicitudViaje, UID.chofer, "chofer", data))).code, "permission-denied");
  await e.db.collection("usuarios").doc(UID.paciente).update({ activo: false });
  assert.equal((await error(llamar(e, e.viajes.crearSolicitudViaje, UID.paciente, "paciente", data))).code, "permission-denied");
});

// --- C: cancelarAsignacionConductor ------------------------------------------------------

for (const estado of ["asignado", "conductor_en_camino", "conductor_llego"]) {
  for (const coleccion of ["viajes", "solicitudes"]) {
    test(`C: cancelar desde '${estado}' en ${coleccion} es valido, archiva y deja al chofer no disponible`, async () => {
      const e = await entorno();
      const id = await crearViaje(e, estado, { coleccion });
      const r = await llamar(e, e.viajes.cancelarAsignacionConductor, UID.chofer, "chofer", { coleccion, id });
      assert.equal(r.ok, true);
      assert.equal((await leer(e.db, `${coleccion}/${id}`)).estado, "cancelado");
      const archivos = await e.db.collection("historial_viajes").get();
      assert.equal(archivos.size, 1);
      assert.equal(archivos.docs[0].data().estadoFinal, "cancelado");
      assert.equal(archivos.docs[0].data().cierre, "cancelado");
      assert.equal((await leer(e.db, `choferes_privado/${UID.chofer}`)).disponible, false);
    });
  }
}

for (const estado of ["en_viaje", "finalizado", "cancelado"]) {
  test(`C: cancelar desde '${estado}' es RECHAZADO por el servidor y no cambia nada`, async () => {
    const e = await entorno();
    const id = await crearViaje(e, estado);
    const antes = await leer(e.db, `viajes/${id}`);
    const err = await error(llamar(e, e.viajes.cancelarAsignacionConductor, UID.chofer, "chofer", { coleccion: "viajes", id }));
    assert.equal(err.code, "failed-precondition");
    assert.deepEqual(await leer(e.db, `viajes/${id}`), antes);
    assert.equal((await e.db.collection("historial_viajes").get()).size, 0);
    assert.equal((await leer(e.db, `choferes_privado/${UID.chofer}`)).disponible, true);
  });
}

test("C: un chofer ajeno no puede cancelar", async () => {
  const e = await entorno();
  const id = await crearViaje(e, "asignado");
  const err = await error(llamar(e, e.viajes.cancelarAsignacionConductor, UID.chofer2, "chofer", { coleccion: "viajes", id }));
  assert.equal(err.code, "permission-denied");
  assert.equal((await leer(e.db, `viajes/${id}`)).estado, "asignado");
});

test("C: dos cancelaciones concurrentes -- una gana, la otra falla, un solo archivo", async () => {
  const e = await entorno();
  const id = await crearViaje(e, "conductor_en_camino");
  const req = () => llamar(e, e.viajes.cancelarAsignacionConductor, UID.chofer, "chofer", { coleccion: "viajes", id });
  const res = await Promise.allSettled([req(), req()]);
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(res.find((r) => r.status === "rejected").reason.code, "failed-precondition");
  assert.equal((await e.db.collection("historial_viajes").get()).size, 1);
});

// --- Maquina de estados y rechazo ----------------------------------------------------

test("actualizarEstadoViaje: transiciones validas e invalidas", async () => {
  const e = await entorno();
  const id = await crearViaje(e, "asignado");
  const paso = (nuevoEstado) => llamar(e, e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", { coleccion: "viajes", id, nuevoEstado });
  assert.equal((await error(paso("en_viaje"))).code, "failed-precondition"); // salta estados
  await paso("conductor_en_camino");
  await paso("conductor_llego");
  await paso("en_viaje");
  assert.equal((await error(paso("cancelado"))).code, "failed-precondition");
  await paso("finalizado");
  assert.equal((await error(paso("finalizado"))).code, "failed-precondition");
  const h = (await leer(e.db, `viajes/${id}`)).historial.map((x) => x.estado);
  assert.deepEqual(h, ["asignado", "conductor_en_camino", "conductor_llego", "en_viaje", "finalizado"]);
});

test("rechazarSolicitud: solo para quien YA acepto (asignado); una pendiente NO se puede rechazar", async () => {
  const e = await entorno();
  const id = await crearViaje(e, "solicitado", { coleccion: "solicitudes", choferId: null });
  // pendiente: nadie la tiene -> el chofer no puede "rechazarla"
  const err = await error(llamar(e, e.viajes.rechazarSolicitud, UID.chofer, "chofer", { solicitudId: id }));
  assert.equal(err.code, "failed-precondition");
  assert.equal((await leer(e.db, `solicitudes/${id}`)).estado, "solicitado");
  assert.deepEqual((await leer(e.db, `solicitudes/${id}`)).rechazadoPor, []);

  // aceptada -> si puede arrepentirse y vuelve a 'solicitado'
  await llamar(e, e.viajes.aceptarSolicitud, UID.chofer, "chofer", { solicitudId: id });
  assert.equal((await leer(e.db, `solicitudes/${id}`)).estado, "asignado");
  await llamar(e, e.viajes.rechazarSolicitud, UID.chofer, "chofer", { solicitudId: id, motivo: "Auto en taller" });
  const s = await leer(e.db, `solicitudes/${id}`);
  assert.equal(s.estado, "solicitado");
  assert.equal(s.conductorId, null);
  assert.deepEqual(s.rechazadoPor, [UID.chofer]);
});

test("aceptarSolicitud: dos choferes a la vez -- solo uno la obtiene", async () => {
  const e = await entorno();
  const id = await crearViaje(e, "solicitado", { coleccion: "solicitudes", choferId: null });
  const res = await Promise.allSettled([
    llamar(e, e.viajes.aceptarSolicitud, UID.chofer, "chofer", { solicitudId: id }),
    llamar(e, e.viajes.aceptarSolicitud, UID.chofer2, "chofer", { solicitudId: id }),
  ]);
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  const s = await leer(e.db, `solicitudes/${id}`);
  assert.ok([UID.chofer, UID.chofer2].includes(s.conductorId));
});

// --- Historial: archivo sin perdida e idempotente -------------------------------------------

test("historial: finalizar archiva con nombres, estados y resumen GPS; el viaje vivo se conserva", async () => {
  const e = await entorno();
  const id = await crearViaje(e, "en_viaje");
  await e.db.collection("gps_viajes").doc("viaje_fijo_0001").set({ conteo: 7, primerTs: 1000, ultimoTs: 9000 });
  await llamar(e, e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", { coleccion: "viajes", id, nuevoEstado: "finalizado" });
  const a = await leer(e.db, "historial_viajes/viaje_fijo_0001");
  assert.equal(a.pacienteId, UID.paciente);
  assert.equal(a.pacienteNombre, "Paciente Uno");
  assert.equal(a.conductorId, UID.chofer);
  assert.equal(a.conductorNombre, "Chofer Uno");
  assert.equal(a.estadoFinal, "finalizado");
  assert.equal(a.cierre, "finalizado");
  assert.equal(a.historial.at(-1).estado, "finalizado");
  assert.deepEqual(a.gps, { conteo: 7, primerTs: 1000, ultimoTs: 9000 });
  assert.equal(a.esLegacy, false);
  assert.equal((await leer(e.db, `viajes/${id}`)).estado, "finalizado");
});

test("historial: archivar es IDEMPOTENTE -- un segundo intento no duplica ni pisa el original", async () => {
  const e = await entorno();
  const id = await crearViaje(e, "conductor_llego");
  await llamar(e, e.viajes.cancelarAsignacionConductor, UID.chofer, "chofer", { coleccion: "viajes", id });
  const primero = await leer(e.db, "historial_viajes/viaje_fijo_0001");

  // Reintento "a mano" del archivado (lo que haria un trigger o reintento duplicado)
  const { leerContextoArchivo, escribirArchivo } = require("../historial");
  const datos = await leer(e.db, `viajes/${id}`);
  const escribio = await e.db.runTransaction(async (tx) => {
    const ctx = await leerContextoArchivo(tx, e.db, "viajes", id, datos);
    return escribirArchivo(tx, ctx, { coleccion: "viajes", id, datosFinales: { ...datos, estado: "finalizado" }, cierre: "finalizado" });
  });
  assert.equal(escribio, false);
  assert.equal((await e.db.collection("historial_viajes").get()).size, 1);
  assert.deepEqual(await leer(e.db, "historial_viajes/viaje_fijo_0001"), primero);
});

test("historial: viaje legado (sin viajeId ni estado) se archiva con id determinista y esLegacy", async () => {
  const e = await entorno();
  await e.db.collection("viajes").doc(UID.paciente).set({ choferId: UID.chofer, choferNombre: "Chofer Uno", fecha: "2026-09-01", hora: "08:00" });
  await llamar(e, e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", { coleccion: "viajes", id: UID.paciente, nuevoEstado: "conductor_en_camino" });
  await llamar(e, e.viajes.cancelarAsignacionConductor, UID.chofer, "chofer", { coleccion: "viajes", id: UID.paciente });
  const archivos = await e.db.collection("historial_viajes").get();
  assert.equal(archivos.size, 1);
  const a = archivos.docs[0].data();
  assert.equal(a.esLegacy, true);
  assert.match(a.viajeId, /^legacy_paciente_uid_01_chofer_uid_001_2026-09-01_08_00$/);
});

// --- asignarViaje --------------------------------------------------------------------------

const asignar = (e, extra = {}, uid = UID.admin, rol = "admin") =>
  llamar(e, e.viajes.asignarViaje, uid, rol, { pacienteId: UID.paciente, choferId: UID.chofer, fecha: "2026-10-12", hora: "10:15", ...extra });

test("asignarViaje: crea el viaje con viajeId generado, nombres resueltos en servidor y sin archivo previo", async () => {
  const e = await entorno();
  const r = await asignar(e);
  const v = await leer(e.db, `viajes/${UID.paciente}`);
  assert.equal(v.viajeId, r.viajeId);
  assert.equal(v.choferNombre, "Chofer Uno");
  assert.equal(v.estado, "asignado");
  assert.equal(v.asignadoPor, UID.admin);
  assert.equal((await e.db.collection("historial_viajes").get()).size, 0);
});

test("asignarViaje: reasignar ARCHIVA el viaje anterior (no se pierde) y crea uno nuevo con otro viajeId", async () => {
  const e = await entorno();
  const r1 = await asignar(e);
  const r2 = await asignar(e, { choferId: UID.chofer2, hora: "11:00" });
  assert.notEqual(r1.viajeId, r2.viajeId);
  const a = await leer(e.db, `historial_viajes/${r1.viajeId}`);
  assert.equal(a.cierre, "reasignado");
  assert.equal(a.conductorId, UID.chofer);
  assert.equal(a.hora, "10:15");
  const v = await leer(e.db, `viajes/${UID.paciente}`);
  assert.equal(v.viajeId, r2.viajeId);
  assert.equal(v.choferId, UID.chofer2);
});

test("asignarViaje: tras finalizar, el nuevo .set no pierde nada (el finalizado ya estaba archivado)", async () => {
  const e = await entorno();
  const r1 = await asignar(e);
  for (const nuevoEstado of ["conductor_en_camino", "conductor_llego", "en_viaje", "finalizado"]) {
    await llamar(e, e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", { coleccion: "viajes", id: UID.paciente, nuevoEstado });
  }
  const antes = await leer(e.db, `historial_viajes/${r1.viajeId}`);
  assert.equal(antes.cierre, "finalizado");
  await asignar(e, { fecha: "2026-10-20" });
  assert.deepEqual(await leer(e.db, `historial_viajes/${r1.viajeId}`), antes, "el archivo del viaje finalizado no se toca");
  assert.equal((await e.db.collection("historial_viajes").get()).size, 1);
});

test("asignarViaje: un viaje en curso (conductor_llego / en_viaje) NO se puede reasignar", async () => {
  for (const estado of ["conductor_llego", "en_viaje"]) {
    const e = await entorno();
    await crearViaje(e, estado);
    const err = await error(asignar(e, { choferId: UID.chofer2 }));
    assert.equal(err.code, "failed-precondition");
    assert.equal((await leer(e.db, `viajes/${UID.paciente}`)).choferId, UID.chofer);
  }
});

test("asignarViaje: dos asignaciones concurrentes -- ninguna se pierde, queda una vigente y la otra archivada", async () => {
  const e = await entorno();
  const [a, b] = await Promise.all([asignar(e, { hora: "09:00" }), asignar(e, { choferId: UID.chofer2, hora: "10:00" })]);
  const vigente = await leer(e.db, `viajes/${UID.paciente}`);
  assert.ok([a.viajeId, b.viajeId].includes(vigente.viajeId));
  const otro = vigente.viajeId === a.viajeId ? b.viajeId : a.viajeId;
  const archivado = await leer(e.db, `historial_viajes/${otro}`);
  assert.ok(archivado, "el viaje desplazado debe estar en historial_viajes");
  assert.equal(archivado.cierre, "reasignado");
  assert.equal((await e.db.collection("historial_viajes").get()).size, 1);
});

test("asignarViaje: validaciones y permisos", async () => {
  const e = await entorno({ aprobarChoferes: false });
  assert.equal((await error(asignar(e))).code, "failed-precondition"); // chofer sin aprobar
  await e.db.collection("usuarios").doc(UID.chofer).update({ aprobado: true });
  assert.equal((await error(asignar(e, {}, UID.paciente, "paciente"))).code, "permission-denied");
  assert.equal((await error(asignar(e, { fecha: "2026-02-31" }))).code, "invalid-argument");
  assert.equal((await error(asignar(e, { fecha: "12/10/2026" }))).code, "invalid-argument");
  assert.equal((await error(asignar(e, { hora: "25:00" }))).code, "invalid-argument");
  assert.equal((await error(asignar(e, { hora: "9:5" }))).code, "invalid-argument");
  assert.equal((await error(asignar(e, { pacienteId: UID.chofer }))).code, "failed-precondition"); // no es paciente
  await e.db.collection("usuarios").doc(UID.chofer).update({ activo: false });
  assert.equal((await error(asignar(e))).code, "failed-precondition"); // chofer desactivado
  assert.equal((await e.db.collection("viajes").get()).size, 0);
});
