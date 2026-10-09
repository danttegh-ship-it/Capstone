// Tests de reglas de Firestore para dializa-app, puerto de
// daily-app/firebase/tests/firestore.rules.test.js adaptado a las
// colecciones usuarios/choferes_privado/viajes/solicitudes/respuestas_paciente.
//
// ESCRITO PERO NO EJECUTADO en el entorno donde se genero (sin Emulator
// Suite ni acceso al registro de npm). Son tests de INTEGRACION contra el
// emulador real; no estan cubiertos por `functions/` `npm test` (que usa
// dobles en memoria y no evalua reglas de seguridad).
//
// Para correrlo de verdad (desde la raiz del proyecto):
//   npm install
//   npm run test:reglas:firestore
// (equivale a: firebase emulators:exec --only firestore "mocha tests/firestore.rules.test.js")

const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const fs = require("fs");

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "dializa-app-test",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("usuarios/{uid}", () => {
  it("cualquier autenticado puede leer", async () => {
    const admin = testEnv.unauthenticatedContext();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("paciente1").set({ rol: "paciente", nombre: "Ana" });
    });
    const paciente2 = testEnv.authenticatedContext("paciente2");
    await assertSucceeds(paciente2.firestore().collection("usuarios").doc("paciente1").get());
  });

  it("nadie puede escribir directo desde el cliente (solo Cloud Functions)", async () => {
    const admin = testEnv.authenticatedContext("admin1");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("admin1").set({ rol: "admin", activo: true });
    });
    await assertFails(
      admin.firestore().collection("usuarios").doc("paciente1").set({ rol: "paciente", nombre: "Ana" })
    );
  });
});

describe("choferes_privado/{uid}", () => {
  it("el propio chofer puede leer sus datos", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("chofer1").set({ rol: "chofer", activo: true });
      await ctx.firestore().collection("choferes_privado").doc("chofer1").set({ patente: "AB1234" });
    });
    const chofer1 = testEnv.authenticatedContext("chofer1");
    await assertSucceeds(chofer1.firestore().collection("choferes_privado").doc("chofer1").get());
  });

  it("otro chofer NO puede leer los datos privados de otro", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("chofer1").set({ rol: "chofer", activo: true });
      await ctx.firestore().collection("usuarios").doc("chofer2").set({ rol: "chofer", activo: true });
      await ctx.firestore().collection("choferes_privado").doc("chofer1").set({ patente: "AB1234" });
    });
    const chofer2 = testEnv.authenticatedContext("chofer2");
    await assertFails(chofer2.firestore().collection("choferes_privado").doc("chofer1").get());
  });
});

describe("viajes/{pacienteId}", () => {
  it("Fase 1: NI un admin puede escribir directo (se asigna con la Cloud Function asignarViaje, que archiva el anterior)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("admin1").set({ rol: "admin", activo: true });
    });
    const admin1 = testEnv.authenticatedContext("admin1");
    await assertFails(
      admin1.firestore().collection("viajes").doc("paciente1").set({ choferId: "chofer1", estado: "asignado" })
    );
  });

  it("cualquier autenticado puede leer (el chofer ve los suyos, el paciente el propio)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("viajes").doc("paciente1").set({ choferId: "chofer1", estado: "asignado" });
    });
    await assertSucceeds(testEnv.authenticatedContext("chofer1").firestore().collection("viajes").doc("paciente1").get());
    await assertFails(testEnv.unauthenticatedContext().firestore().collection("viajes").doc("paciente1").get());
  });

  it("un paciente NO puede escribir su propio viaje directo", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("paciente1").set({ rol: "paciente", activo: true });
    });
    const paciente1 = testEnv.authenticatedContext("paciente1");
    await assertFails(
      paciente1.firestore().collection("viajes").doc("paciente1").set({ choferId: "chofer1", estado: "asignado" })
    );
  });
});

describe("solicitudes/{id}", () => {
  it("nadie puede escribir directo (solo Cloud Functions)", async () => {
    const paciente1 = testEnv.authenticatedContext("paciente1");
    await assertFails(paciente1.firestore().collection("solicitudes").doc("s1").set({ estado: "solicitado" }));
  });
});

describe("respuestas_paciente/{uid}", () => {
  it("el propio paciente puede escribir su respuesta", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("paciente1").set({ rol: "paciente", activo: true });
    });
    const paciente1 = testEnv.authenticatedContext("paciente1");
    await assertSucceeds(
      paciente1.firestore().collection("respuestas_paciente").doc("paciente1").set({ asistira: true })
    );
  });

  it("otro paciente NO puede escribir la respuesta ajena", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("paciente1").set({ rol: "paciente", activo: true });
      await ctx.firestore().collection("usuarios").doc("paciente2").set({ rol: "paciente", activo: true });
    });
    const paciente2 = testEnv.authenticatedContext("paciente2");
    await assertFails(
      paciente2.firestore().collection("respuestas_paciente").doc("paciente1").set({ asistira: true })
    );
  });
});

describe("historial_viajes/{viajeId}", () => {
  async function sembrar() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("admin1").set({ rol: "admin", activo: true });
      await ctx.firestore().collection("usuarios").doc("paciente1").set({ rol: "paciente", activo: true });
      await ctx.firestore().collection("usuarios").doc("chofer1").set({ rol: "chofer", activo: true });
      await ctx.firestore().collection("historial_viajes").doc("v1").set({ pacienteId: "paciente1", conductorId: "chofer1", estadoFinal: "finalizado" });
    });
  }

  it("un admin puede leer el historial", async () => {
    await sembrar();
    await assertSucceeds(testEnv.authenticatedContext("admin1").firestore().collection("historial_viajes").doc("v1").get());
  });

  it("un admin puede consultar por paciente y por conductor (las consultas que usa el panel)", async () => {
    await sembrar();
    const db = testEnv.authenticatedContext("admin1").firestore();
    await assertSucceeds(db.collection("historial_viajes").where("pacienteId", "==", "paciente1").get());
    await assertSucceeds(db.collection("historial_viajes").where("conductorId", "==", "chofer1").get());
  });

  it("paciente y chofer NO pueden leer el historial", async () => {
    await sembrar();
    await assertFails(testEnv.authenticatedContext("paciente1").firestore().collection("historial_viajes").doc("v1").get());
    await assertFails(testEnv.authenticatedContext("chofer1").firestore().collection("historial_viajes").doc("v1").get());
  });

  it("NADIE (ni admin) puede crear, editar ni borrar historial desde el cliente", async () => {
    await sembrar();
    const admin = testEnv.authenticatedContext("admin1").firestore();
    await assertFails(admin.collection("historial_viajes").doc("v2").set({ pacienteId: "paciente1" }));
    await assertFails(admin.collection("historial_viajes").doc("v1").update({ estadoFinal: "cancelado" }));
    await assertFails(admin.collection("historial_viajes").doc("v1").delete());
  });
});

describe("gps_viajes/{viajeId}/muestras", () => {
  async function sembrar() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("admin1").set({ rol: "admin", activo: true });
      await ctx.firestore().collection("usuarios").doc("chofer1").set({ rol: "chofer", activo: true });
      await ctx.firestore().collection("usuarios").doc("paciente1").set({ rol: "paciente", activo: true });
      await ctx.firestore().collection("gps_viajes").doc("v1").set({ conteo: 1, conductorId: "chofer1", pacienteId: "paciente1" });
      await ctx.firestore().collection("gps_viajes").doc("v1").collection("muestras").doc("1000").set({ lat: -33, lng: -70, t: 1000 });
    });
  }

  it("un admin puede leer el resumen y las muestras", async () => {
    await sembrar();
    const db = testEnv.authenticatedContext("admin1").firestore();
    await assertSucceeds(db.collection("gps_viajes").doc("v1").get());
    await assertSucceeds(db.collection("gps_viajes").doc("v1").collection("muestras").get());
  });

  it("el chofer NO puede escribir muestras directo (solo via registrarMuestrasGps), ni leer las de otros, ni el paciente", async () => {
    await sembrar();
    const chofer = testEnv.authenticatedContext("chofer1").firestore();
    await assertFails(chofer.collection("gps_viajes").doc("v1").collection("muestras").doc("2000").set({ lat: 0, lng: 0, t: 2000 }));
    await assertFails(chofer.collection("gps_viajes").doc("v1").set({ conteo: 0 }));
    await assertFails(chofer.collection("gps_viajes").doc("v1").collection("muestras").get());
    await assertFails(testEnv.authenticatedContext("paciente1").firestore().collection("gps_viajes").doc("v1").get());
  });

  it("un admin tampoco puede escribir muestras desde el cliente", async () => {
    await sembrar();
    const admin = testEnv.authenticatedContext("admin1").firestore();
    await assertFails(admin.collection("gps_viajes").doc("v1").collection("muestras").doc("3000").set({ lat: 0, lng: 0, t: 3000 }));
  });
});

describe("choferes_privado: datos sensibles del conductor siguen protegidos", () => {
  it("un paciente NO puede leer patente/licencia de un chofer", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("usuarios").doc("paciente1").set({ rol: "paciente", activo: true });
      await ctx.firestore().collection("choferes_privado").doc("chofer1").set({ patente: "AB1234", licencia: "L-123" });
    });
    await assertFails(testEnv.authenticatedContext("paciente1").firestore().collection("choferes_privado").doc("chofer1").get());
  });
});
