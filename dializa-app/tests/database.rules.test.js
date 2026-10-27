const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");
let env;
const db = (uid, rol) => env.authenticatedContext(uid, { rol }).database();
before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-dializa-h10",
    database: { rules: fs.readFileSync("database.rules.json", "utf8") },
  });
});
after(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const cuentas = {};
    for (const [uid, rol, activo, aprobado] of [
      ["admin", "admin", true, false],
      ["admin_off", "admin", false, false],
      ["paciente", "paciente", true, false],
      ["otro", "paciente", true, false],
      ["chofer", "chofer", true, true],
      ["pendiente", "chofer", true, false],
    ])
      cuentas[uid] = {
        rol,
        activo,
        aprobado,
        validoHasta: Date.now() + 300000,
      };
    await ctx
      .database()
      .ref()
      .set({
        cuentasAutorizadas: cuentas,
        ubicaciones: {
          chofer: {
            lat: -33,
            lng: -70,
            timestamp: 1,
            pacienteAutorizado: "paciente",
            autorizacionVersion: 3,
            reconciliacionGeneracion: 3,
            autorizacionValidaHasta: Date.now() + 300000,
          },
        },
      });
  });
});
describe("H02/H10 RTDB", () => {
  it("update conserva autorizacion y exige chofer aprobado/activo", async () => {
    await assertSucceeds(
      db("chofer", "chofer")
        .ref("ubicaciones/chofer")
        .update({ lat: -34, lng: -71, timestamp: 2 }),
    );
    await assertFails(
      db("pendiente", "chofer")
        .ref("ubicaciones/pendiente")
        .update({ lat: 1, lng: 1, timestamp: 1 }),
    );
    await assertFails(
      db("otro", "paciente").ref("ubicaciones/chofer").update({ lat: 1 }),
    );
    await env.withSecurityRulesDisabled(async (ctx) => {
      if (
        (
          await ctx
            .database()
            .ref("ubicaciones/chofer/pacienteAutorizado")
            .get()
        ).val() !== "paciente"
      )
        throw Error("Permiso perdido");
    });
  });
  it("solo paciente autorizado, chofer propio y admin activo leen", async () => {
    await assertSucceeds(
      db("paciente", "paciente").ref("ubicaciones/chofer").get(),
    );
    await assertSucceeds(
      db("chofer", "chofer").ref("ubicaciones/chofer").get(),
    );
    await assertSucceeds(db("admin", "admin").ref("ubicaciones/chofer").get());
    await assertFails(db("otro", "paciente").ref("ubicaciones/chofer").get());
    await assertFails(db("admin_off", "admin").ref("ubicaciones/chofer").get());
  });
  it("clientes no modifican fencing ni espejo, ni reemplazan el nodo", async () => {
    const ref = db("chofer", "chofer").ref("ubicaciones/chofer");
    for (const campo of [
      "pacienteAutorizado",
      "viajeAutorizado",
      "autorizacionVersion",
      "reconciliacionGeneracion",
      "autorizacionValidaHasta",
    ])
      await assertFails(ref.child(campo).set(999));
    await assertFails(ref.set({ lat: 1, lng: 1, timestamp: 1 }));
    await assertFails(
      db("admin", "admin").ref("cuentasAutorizadas/chofer/activo").set(true),
    );
  });
  it("cuenta desactivada o espejo vencido pierde lectura y escritura", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("cuentasAutorizadas/chofer/activo").set(false);
    });
    await assertFails(
      db("chofer", "chofer").ref("ubicaciones/chofer").update({ lat: 1 }),
    );
    await assertFails(
      db("paciente", "paciente").ref("ubicaciones/chofer").get(),
    );
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("cuentasAutorizadas/admin/validoHasta").set(1);
    });
    await assertFails(db("admin", "admin").ref("ubicaciones/chofer").get());
  });
  it("coordenadas fuera de rango o tipos incorrectos fallan", async () => {
    for (const datos of [
      { lat: 99 },
      { lng: 181 },
      { lat: "x" },
      { timestamp: "x" },
    ])
      await assertFails(
        db("chofer", "chofer").ref("ubicaciones/chofer").update(datos),
      );
  });
});
