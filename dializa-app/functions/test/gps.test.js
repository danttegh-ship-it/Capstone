// Tests UNITARIOS (dobles) de registrarMuestrasGps (gps.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { montar, sembrarUsuarios, UID } = require("./helpers/montaje");
const { peticion, error } = require("./helpers/memoria");

// Completar la observacion del cliente en las fixtures de escenarios previos.
const llamar = async (e, fn, uid, rol, data) => {
  if (
    [
      e.viajes.actualizarEstadoViaje,
      e.viajes.cancelarAsignacionConductor,
      e.gps.registrarMuestrasGps,
    ].includes(fn)
  ) {
    const coleccion = data.coleccion || "solicitudes";
    const snap = await e.db.doc(`${coleccion}/${data.id}`).get();
    if (snap.exists)
      data = {
        viajeId: require("../historial").viajeIdDe(
          coleccion,
          data.id,
          snap.data(),
        ).viajeId,
        estadoEsperado: snap.data().estado || "asignado",
        ...data,
      };
  }
  return fn.run(peticion(uid, rol, data));
};

async function entorno(estadoViaje = "conductor_en_camino") {
  const e = montar();
  await sembrarUsuarios(e.db, e.auth);
  const { viajeId } = await llamar(
    e,
    e.viajes.asignarViaje,
    UID.admin,
    "admin",
    {
      pacienteId: UID.paciente,
      choferId: UID.chofer,
      fecha: "2026-10-12",
      hora: "10:15",
    },
  );
  const orden = [
    "conductor_en_camino",
    "conductor_llego",
    "en_viaje",
    "finalizado",
  ];
  if (estadoViaje !== "asignado") {
    for (const s of orden.slice(0, orden.indexOf(estadoViaje) + 1)) {
      await llamar(e, e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", {
        coleccion: "viajes",
        id: UID.paciente,
        nuevoEstado: s,
      });
    }
  }
  return { e, viajeId };
}
const muestra = (i, extra = {}) => ({
  lat: -33.45 + i * 0.0001,
  lng: -70.66,
  timestampMs: Date.now() - 10000 + i,
  ...extra,
});
const gps = (
  e,
  muestras,
  uid = UID.chofer,
  id = UID.paciente,
  coleccion = "viajes",
) =>
  llamar(e, e.gps.registrarMuestrasGps, uid, "chofer", {
    coleccion,
    id,
    muestras,
  });
const muestras = async (e, viajeId) =>
  (
    await e.db
      .collection("gps_viajes")
      .doc(viajeId)
      .collection("muestras")
      .get()
  ).docs.map((d) => d.data());

test("GPS: guarda muestras en la subcoleccion (no en el documento), con fase y fuente, y actualiza el resumen", async () => {
  const { e, viajeId } = await entorno("en_viaje");
  const r = await gps(e, [muestra(1), muestra(2), muestra(3)]);
  assert.deepEqual([r.guardadas, r.duplicadas], [3, 0]);
  const ms = await muestras(e, viajeId);
  assert.equal(ms.length, 3);
  assert.ok(
    ms.every(
      (m) =>
        m.fuente === "gps" &&
        m.fase === "en_viaje" &&
        typeof m.lat === "number",
    ),
  );
  const resumen = (await e.db.doc(`gps_viajes/${viajeId}`).get()).data();
  assert.equal(resumen.conteo, 3);
  assert.equal(resumen.pacienteId, UID.paciente);
  assert.equal(resumen.conductorId, UID.chofer);
  assert.ok(resumen.ultimoTs >= resumen.primerTs);
  assert.equal(
    resumen.muestras,
    undefined,
    "nunca un arreglo dentro del documento",
  );
});

test("GPS: reenviar el mismo lote es idempotente (sin duplicados ni conteo inflado)", async () => {
  const { e, viajeId } = await entorno();
  const lote = [muestra(1), muestra(2)];
  await gps(e, lote);
  const r2 = await gps(e, lote);
  assert.deepEqual([r2.guardadas, r2.duplicadas], [0, 2]);
  assert.equal((await muestras(e, viajeId)).length, 2);
  assert.equal(
    (await e.db.doc(`gps_viajes/${viajeId}`).get()).data().conteo,
    2,
  );
});

test("GPS: dos lotes concurrentes con muestras distintas suman bien el conteo", async () => {
  const { e, viajeId } = await entorno();
  await Promise.all([
    gps(e, [muestra(1), muestra(2)]),
    gps(e, [muestra(3), muestra(4), muestra(5)]),
  ]);
  assert.equal(
    (await e.db.doc(`gps_viajes/${viajeId}`).get()).data().conteo,
    5,
  );
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
  for (const [uid, rol] of [
    [UID.paciente, "paciente"],
    [UID.admin, "admin"],
  ]) {
    const err = await error(
      llamar(e, e.gps.registrarMuestrasGps, uid, rol, {
        coleccion: "viajes",
        id: UID.paciente,
        muestras: [muestra(1)],
      }),
    );
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
  await llamar(e, e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", {
    coleccion: "viajes",
    id: UID.paciente,
    nuevoEstado: "finalizado",
  });
  assert.equal((await error(gps(e, [muestra(2)]))).code, "failed-precondition");
  assert.equal((await muestras(e, viajeId)).length, 1);
  // y el archivo recibio el resumen GPS
  assert.equal(
    (await e.db.doc(`historial_viajes/${viajeId}`).get()).data().gps.conteo,
    1,
  );
});

test("GPS: carrera con el cierre -- finalizar y registrar a la vez: las muestras aceptadas quedan contadas en el archivo o se rechazan, nunca despues", async () => {
  const { e, viajeId } = await entorno("en_viaje");
  const res = await Promise.allSettled([
    gps(e, [muestra(1), muestra(2)]),
    llamar(e, e.viajes.actualizarEstadoViaje, UID.chofer, "chofer", {
      coleccion: "viajes",
      id: UID.paciente,
      nuevoEstado: "finalizado",
    }),
  ]);
  assert.equal(res[1].status, "fulfilled");
  const aceptadas = (await muestras(e, viajeId)).length;
  const archivadas = (
    await e.db.doc(`historial_viajes/${viajeId}`).get()
  ).data().gps.conteo;
  if (res[0].status === "fulfilled") assert.equal(aceptadas, 2);
  else assert.equal(aceptadas, 0);
  // consistencia: nada se agrega despues del cierre
  const final = (await muestras(e, viajeId)).length;
  assert.equal(final, aceptadas);
  assert.equal(
    archivadas,
    aceptadas,
    "el resumen archivado coincide exactamente con las muestras aceptadas",
  );
});

test("GPS: coordenadas invalidas, timestamps invalidos se aislan; envelope vacio o gigante falla", async () => {
  const { e, viajeId } = await entorno();
  const ahora = Date.now();
  const malos = [
    [muestra(1), { lat: 91, lng: 0, timestampMs: ahora }],
    [{ lat: "a", lng: 0, timestampMs: ahora }],
    [{ lat: -33, lng: -70, timestampMs: ahora - 9 * 60 * 60 * 1000 }],
    [{ lat: -33, lng: -70, timestampMs: ahora + 5 * 60 * 1000 }],
    [{ lat: -33, lng: -70, timestampMs: "ahora" }],
    [{ lat: -33, lng: -70, timestampMs: 1.5 }],
    [],
    Array.from({ length: 51 }, (_, i) => muestra(i)),
    "no-es-arreglo",
  ];
  for (const lote of malos) {
    if (Array.isArray(lote) && lote.length >= 1 && lote.length <= 50) {
      const r = await gps(e, lote);
      assert.equal(r.rechazadas.length, lote.length == 2 ? 1 : lote.length);
      assert.equal(r.guardadas, lote.length == 2 ? 1 : 0);
    } else {
      assert.equal((await error(gps(e, lote))).code, "invalid-argument");
    }
  }
  assert.equal(
    (await muestras(e, viajeId)).length,
    1,
    "la muestra valida del lote mixto se conserva",
  );
});

test("GPS: tope de 5000 muestras por viaje", async () => {
  const { e, viajeId } = await entorno();
  await e.db
    .doc(`gps_viajes/${viajeId}`)
    .set({ viajeId, conteo: 4990, primerTs: 1, ultimoTs: 2 });
  const r = await gps(
    e,
    Array.from({ length: 20 }, (_, i) => muestra(i)),
  );
  assert.equal(r.guardadas, 10);
  assert.equal(r.rechazadas.length, 10);
  assert.equal((await muestras(e, viajeId)).length, 10);
  const repetido = await gps(
    e,
    Array.from({ length: 10 }, (_, i) =>
      muestra(i, { timestampMs: Date.now() - 1000 + i }),
    ),
  );
  assert.equal(repetido.guardadas, 0);
  assert.equal(repetido.rechazadas.length, 10);
  assert.equal(
    (await e.db.doc(`gps_viajes/${viajeId}`).get()).data().conteo,
    5000,
  );
});

test("GPS: limite de frecuencia por chofer (30 llamadas/minuto)", async () => {
  const { e } = await entorno();
  for (let i = 0; i < 30; i++) await gps(e, [muestra(i)]);
  assert.equal((await error(gps(e, [muestra(99)]))).code, "resource-exhausted");
});

test("GPS: tambien funciona en solicitudes bajo demanda", async () => {
  const e = montar();
  await sembrarUsuarios(e.db, e.auth);
  await e.db.collection("solicitudes").doc("sol_gps_00001").set({
    pacienteId: UID.paciente,
    conductorId: UID.chofer,
    estado: "en_viaje",
    historial: [],
  });
  const r = await gps(
    e,
    [muestra(1)],
    UID.chofer,
    "sol_gps_00001",
    "solicitudes",
  );
  assert.equal(r.viajeId, "sol_gps_00001");
  assert.equal((await muestras(e, "sol_gps_00001")).length, 1);
});

test("H08: lote offline de la misma instancia se conserva hasta ocho horas", async () => {
  const { e, viajeId } = await entorno("en_viaje");
  await e.db
    .doc(`viajes/${UID.paciente}`)
    .update({ gpsIniciadoEn: new Date(Date.now() - 7200000).toISOString() });
  const r = await gps(e, [muestra(1, { timestampMs: Date.now() - 3600000 })]);
  assert.equal(r.guardadas, 1);
  assert.equal((await muestras(e, viajeId)).length, 1);
  const rechazado = await gps(e, [
    muestra(1, { timestampMs: Date.now() - 10800000 }),
  ]);
  assert.equal(rechazado.rechazadas.length, 1);
});

test("T1: lote mixto y reloj atrasado mas de 60 segundos conservan timestamps", async () => {
  const { e, viajeId } = await entorno("en_viaje");
  const t = Date.now() - 120000;
  const r = await gps(e, [
    muestra(1, { timestampMs: t }),
    muestra(2, { lat: 999 }),
    muestra(3, { timestampMs: Date.now() - 600000 }),
  ]);
  assert.equal(r.guardadas, 1);
  assert.deepEqual(r.rechazadas.map((x) => x.indice).sort(), [1, 2]);
  assert.equal((await muestras(e, viajeId))[0].t, t);
});
