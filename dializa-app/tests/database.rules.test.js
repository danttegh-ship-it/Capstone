// Tests de reglas de Realtime Database para dializa-app, puerto de
// daily-app/firebase/tests/database.rules.test.js. Prueba especialmente
// el caso que causo un bug real en daily-app: un update() parcial de
// lat/lng/timestamp NO debe poder pisar pacienteAutorizado.
//
// ESCRITO PERO NO EJECUTADO en el entorno donde se genero (mismo motivo
// que firestore.rules.test.js: requiere el Firebase Emulator Suite).
//
// Para correrlo de verdad (desde la raiz del proyecto):
//   npm install
//   npm run test:reglas:database

const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const fs = require("fs");

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "dializa-app-test",
    database: { rules: fs.readFileSync("database.rules.json", "utf8") },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearDatabase();
});

describe("ubicaciones/{uid}", () => {
  it("el propio chofer (con custom claim rol=chofer) puede escribir lat/lng/timestamp", async () => {
    const chofer1 = testEnv.authenticatedContext("chofer1", { rol: "chofer" });
    await assertSucceeds(
      chofer1.database().ref("ubicaciones/chofer1").update({ lat: -33.4, lng: -70.6, timestamp: Date.now() })
    );
  });

  it("un paciente NO puede escribir ubicacion de un chofer", async () => {
    const paciente1 = testEnv.authenticatedContext("paciente1", { rol: "paciente" });
    await assertFails(
      paciente1.database().ref("ubicaciones/chofer1").update({ lat: -33.4, lng: -70.6, timestamp: Date.now() })
    );
  });

  it("nadie puede escribir pacienteAutorizado desde el cliente", async () => {
    const chofer1 = testEnv.authenticatedContext("chofer1", { rol: "chofer" });
    await assertFails(chofer1.database().ref("ubicaciones/chofer1/pacienteAutorizado").set("paciente1"));
  });

  it("un update() parcial de lat/lng NO borra pacienteAutorizado ya existente", async () => {
    // Este es el bug real que se corrigio en daily-app: usar set() sobre
    // el nodo completo pisaba pacienteAutorizado; update() solo toca los
    // campos indicados.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("ubicaciones/chofer1").set({
        lat: -33.0,
        lng: -70.0,
        timestamp: 1,
        pacienteAutorizado: "paciente1",
      });
    });

    const chofer1 = testEnv.authenticatedContext("chofer1", { rol: "chofer" });
    await assertSucceeds(
      chofer1.database().ref("ubicaciones/chofer1").update({ lat: -33.5, lng: -70.5, timestamp: 2 })
    );

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await ctx.database().ref("ubicaciones/chofer1/pacienteAutorizado").get();
      if (snap.val() !== "paciente1") {
        throw new Error("pacienteAutorizado se perdio tras el update() parcial");
      }
    });
  });

  it("el paciente autorizado puede leer la ubicacion del chofer que lo lleva", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("ubicaciones/chofer1").set({
        lat: -33.0,
        lng: -70.0,
        timestamp: 1,
        pacienteAutorizado: "paciente1",
      });
    });
    const paciente1 = testEnv.authenticatedContext("paciente1", { rol: "paciente" });
    await assertSucceeds(paciente1.database().ref("ubicaciones/chofer1").get());
  });

  it("un paciente NO autorizado no puede leer la ubicacion de un chofer ajeno", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("ubicaciones/chofer1").set({
        lat: -33.0,
        lng: -70.0,
        timestamp: 1,
        pacienteAutorizado: "paciente1",
      });
    });
    const paciente2 = testEnv.authenticatedContext("paciente2", { rol: "paciente" });
    await assertFails(paciente2.database().ref("ubicaciones/chofer1").get());
  });

  it("un admin siempre puede leer cualquier ubicacion", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("ubicaciones/chofer1").set({ lat: -33.0, lng: -70.0, timestamp: 1 });
    });
    const admin1 = testEnv.authenticatedContext("admin1", { rol: "admin" });
    await assertSucceeds(admin1.database().ref("ubicaciones/chofer1").get());
  });

  it("un chofer sin custom claim (rol no sincronizado) no puede escribir", async () => {
    const choferSinClaim = testEnv.authenticatedContext("chofer2"); // sin { rol: 'chofer' }
    await assertFails(
      choferSinClaim.database().ref("ubicaciones/chofer2").update({ lat: -33.4, lng: -70.6, timestamp: Date.now() })
    );
  });

  // --- Fase 1 ------------------------------------------------------------------------

  it("el chofer NO puede escribir viajeAutorizado ni autorizacionVersion (solo el servidor)", async () => {
    const chofer1 = testEnv.authenticatedContext("chofer1", { rol: "chofer" });
    await assertFails(chofer1.database().ref("ubicaciones/chofer1/viajeAutorizado").set("v1"));
    await assertFails(chofer1.database().ref("ubicaciones/chofer1/autorizacionVersion").set(1));
    await assertFails(chofer1.database().ref("ubicaciones/chofer1").update({ lat: 1, lng: 1, timestamp: 1, pacienteAutorizado: "paciente1" }));
  });

  it("un set() del nodo completo por el chofer es rechazado (solo update() de lat/lng/timestamp)", async () => {
    const chofer1 = testEnv.authenticatedContext("chofer1", { rol: "chofer" });
    await assertFails(chofer1.database().ref("ubicaciones/chofer1").set({ lat: -33, lng: -70, timestamp: 1 }));
  });

  it("lat/lng/timestamp deben ser numeros validos", async () => {
    const chofer1 = testEnv.authenticatedContext("chofer1", { rol: "chofer" });
    await assertFails(chofer1.database().ref("ubicaciones/chofer1").update({ lat: 95, lng: 0, timestamp: 1 }));
    await assertFails(chofer1.database().ref("ubicaciones/chofer1").update({ lat: 0, lng: 190, timestamp: 1 }));
    await assertFails(chofer1.database().ref("ubicaciones/chofer1").update({ lat: "x", lng: 0, timestamp: 1 }));
  });

  it("un paciente cuya autorizacion fue revocada (nodo sin pacienteAutorizado) ya no puede leer", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("ubicaciones/chofer1").set({ lat: -33, lng: -70, timestamp: 1, autorizacionVersion: 5 });
    });
    const paciente1 = testEnv.authenticatedContext("paciente1", { rol: "paciente" });
    await assertFails(paciente1.database().ref("ubicaciones/chofer1").get());
  });

  it("un chofer no puede escribir la ubicacion de otro chofer", async () => {
    const chofer2 = testEnv.authenticatedContext("chofer2", { rol: "chofer" });
    await assertFails(chofer2.database().ref("ubicaciones/chofer1").update({ lat: -33, lng: -70, timestamp: 1 }));
  });
});
