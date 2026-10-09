// Tests UNITARIOS (dobles) de registrarMuestrasGps (gps.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { montar, sembrarUsuarios, UID } = require("./helpers/montaje");
const { peticion, error } = require("./helpers/memoria");

const llamar = (fn, uid, rol, data) => fn.run(peticion(uid, rol, data));

async function entorno(estadoViaje = "conductor_en_camino") {
  const e = montar();
  await sembrarUsuarios(e.db, e.auth);
  const { viajeId } = await llamar(e.viajes.asignarViaje, UID.admin, "admin", { pacienteId: UID.paciente, choferId: UID.chofer, fecha: "2026-10-12", hora: "10:15" });
  const orden = ["conductor_en_camino", "conductor_llego", "en_viaje", "finalizado"];
  if (estadoViaje !== "asignado") {
    for (const s of orden.slice(0, orden.indexOf(estadoViaje) + 1)) {
      await llamar(e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", { coleccion: "viajes", id: UID.paciente, nuevoEstado: s });
    }
  }
  return { e, viajeId };
}
const muestra = (i, extra = {}) => ({ lat: -33.45 + i * 0.0001, lng: -70.66, timestampMs: Date.now() - 10000 + i, ...extra });
const gps = (e, muestras, uid = UID.chofer, id = UID.paciente, coleccion = "viajes") =>
  llamar(e.gps.registrarMuestrasGps, uid, "chofer", { coleccion, id, muestras });
const muestras = async (e, viajeId) => (await e.db.collection("gps_viajes").doc(viajeId).collection("muestras").get()).docs.map((d) => d.data());

test("GPS: guarda muestras en la subcoleccion (no en el documento), con fase y fuente, y actualiza el resumen", async () => {
  const { e, viajeId } = await entorno("en_viaje");
  const r = await gps(e, [muestra(1), muestra(2), muestra(3)]);
  assert.deepEqual([r.guardadas, r.duplicadas], [3, 0]);
  const ms = await muestras(e, viajeId);
  assert.equal(ms.length, 3);
  assert.ok(ms.every((m) => m.fuente === "gps" && m.fase === "en_viaje" && typeof m.lat === "number"));
  const resumen = (await e.db.doc(`gps_viajes/${viajeId}`).get()).data();
  assert.equal(resumen.conteo, 3);
  assert.equal(resumen.pacienteId, UID.paciente);
  assert.equal(resumen.conductorId, UID.chofer);
  assert.ok(resumen.ultimoTs >= resumen.primerTs);
  assert.equal(resumen.muestras, undefined, "nunca un arreglo dentro del documento");
});

test("GPS: reenviar el mismo lote es idempotente (sin duplicados ni conteo inflado)", async () => {
  const { e, viajeId } = await entorno();
  const lote = [muestra(1), muestra(2)];
  await gps(e, lote);
  const r2 = await gps(e, lote);
  assert.deepEqual([r2.guardadas, r2.duplicadas], [0, 2]);
  assert.equal((await muestras(e, viajeId)).length, 2);
  assert.equal((await e.db.doc(`gps_viajes/${viajeId}`).get()).data().conteo, 2);
});

test("GPS: dos lotes concurrentes con muestras distintas suman bien el conteo", async () => {
  const { e, viajeId } = await entorno();
  await Promise.all([gps(e, [muestra(1), muestra(2)]), gps(e, [muestra(3), muestra(4), muestra(5)])]);
  assert.equal((await e.db.doc(`gps_viajes/${viajeId}`).get()).data().conteo, 5);
  assert.equal((await muestras(e, viajeId)).length, 5);
});

test("GPS: un chofer AJENO no puede registrar muestras en un viaje que no es suyo", async () => {
  const { e, viajeId } = await entorno();
  const err = await error(gps(e, [muestra(1)], UID.chofer2));
  assert.equal(err.code, "permission-denied");
  assert.equal((await muestras(e, viajeId)).length, 0);
});

test("GPS: roles distintos de chofer (paciente, admin) son rechazados", async () => {
  const { e } = await entorno();
  for (const [uid, rol] of [[UID.paciente, "paciente"], [UID.admin, "admin"]]) {
    const err = await error(llamar(e.gps.registrarMuestrasGps, uid, rol, { coleccion: "viajes", id: UID.paciente, muestras: [muestra(1)] }));
    assert.equal(err.code, "permission-denied");
  }
});

test("GPS: en estado 'asignado' (aun no sale) no se registran muestras", async () => {
  const { e } = await entorno("asignado");
  assert.equal((await error(gps(e, [muestra(1)]))).code, "failed-precondition");
});

test("GPS: despues de finalizar NO se aceptan muestras (viaje cerrado)", async () => {
  const { e, viajeId } = await entorno("en_viaje");
  await gps(e, [muestra(1)]);
  await llamar(e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", { coleccion: "viajes", id: UID.paciente, nuevoEstado: "finalizado" });
  assert.equal((await error(gps(e, [muestra(2)]))).code, "failed-precondition");
  assert.equal((await muestras(e, viajeId)).length, 1);
  // y el archivo recibio el resumen GPS
  assert.equal((await e.db.doc(`historial_viajes/${viajeId}`).get()).data().gps.conteo, 1);
});

test("GPS: carrera con el cierre -- finalizar y registrar a la vez: las muestras aceptadas quedan contadas en el archivo o se rechazan, nunca despues", async () => {
  const { e, viajeId } = await entorno("en_viaje");
  const res = await Promise.allSettled([
    gps(e, [muestra(1), muestra(2)]),
    llamar(e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", { coleccion: "viajes", id: UID.paciente, nuevoEstado: "finalizado" }),
  ]);
  assert.equal(res[1].status, "fulfilled");
  const aceptadas = (await muestras(e, viajeId)).length;
  const archivadas = (await e.db.doc(`historial_viajes/${viajeId}`).get()).data().gps.conteo;
  if (res[0].status === "fulfilled") assert.equal(aceptadas, 2);
  else assert.equal(aceptadas, 0);
  // consistencia: nada se agrega despues del cierre
  const final = (await muestras(e, viajeId)).length;
  assert.equal(final, aceptadas);
  assert.equal(archivadas, aceptadas, "el resumen archivado coincide exactamente con las muestras aceptadas");
});

test("GPS: coordenadas invalidas, timestamps fuera de ventana, lotes vacios o gigantes se rechazan completos", async () => {
  const { e, viajeId } = await entorno();
  const ahora = Date.now();
  const malos = [
    [muestra(1), { lat: 91, lng: 0, timestampMs: ahora }],
    [{ lat: "a", lng: 0, timestampMs: ahora }],
    [{ lat: -33, lng: -70, timestampMs: ahora - 16 * 60 * 1000 }],
    [{ lat: -33, lng: -70, timestampMs: ahora + 5 * 60 * 1000 }],
    [{ lat: -33, lng: -70, timestampMs: "ahora" }],
    [{ lat: -33, lng: -70, timestampMs: 1.5 }],
    [],
    Array.from({ length: 51 }, (_, i) => muestra(i)),
    "no-es-arreglo",
  ];
  for (const lote of malos) {
    const err = await error(gps(e, lote));
    assert.equal(err && err.code, "invalid-argument", JSON.stringify(lote).slice(0, 60));
  }
  assert.equal((await muestras(e, viajeId)).length, 0, "un lote invalido no guarda NINGUNA muestra");
});

test("GPS: tope de 5000 muestras por viaje", async () => {
  const { e, viajeId } = await entorno();
  await e.db.doc(`gps_viajes/${viajeId}`).set({ viajeId, conteo: 4990, primerTs: 1, ultimoTs: 2 });
  const err = await error(gps(e, Array.from({ length: 20 }, (_, i) => muestra(i))));
  assert.equal(err.code, "resource-exhausted");
  assert.equal((await muestras(e, viajeId)).length, 0);
  await gps(e, Array.from({ length: 10 }, (_, i) => muestra(i))); // llega justo a 5000
  assert.equal((await e.db.doc(`gps_viajes/${viajeId}`).get()).data().conteo, 5000);
});

test("GPS: limite de frecuencia por chofer (30 llamadas/minuto)", async () => {
  const { e } = await entorno();
  for (let i = 0; i < 30; i++) await gps(e, [muestra(i)]);
  assert.equal((await error(gps(e, [muestra(99)]))).code, "resource-exhausted");
});

test("GPS: tambien funciona en solicitudes bajo demanda", async () => {
  const e = montar();
  await sembrarUsuarios(e.db, e.auth);
  await e.db.collection("solicitudes").doc("sol_gps_00001").set({ pacienteId: UID.paciente, conductorId: UID.chofer, estado: "en_viaje", historial: [] });
  const r = await gps(e, [muestra(1)], UID.chofer, "sol_gps_00001", "solicitudes");
  assert.equal(r.viajeId, "sol_gps_00001");
  assert.equal((await muestras(e, "sol_gps_00001")).length, 1);
});
