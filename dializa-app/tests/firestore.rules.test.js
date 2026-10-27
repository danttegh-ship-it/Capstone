const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");
let env;
const user = (uid) => env.authenticatedContext(uid).firestore();
before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-dializa-h10",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
});
after(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, rol, activo, aprobado] of [
      ["admin", "admin", true, false],
      ["admin_off", "admin", false, false],
      ["paciente", "paciente", true, false],
      ["otro", "paciente", true, false],
      ["chofer", "chofer", true, true],
      ["pendiente", "chofer", true, false],
    ])
      await db.doc(`usuarios/${uid}`).set({ rol, activo, aprobado });
    await db
      .doc("viajes/paciente")
      .set({ choferId: "chofer", estado: "en_viaje" });
    await db.doc("solicitudes/privada").set({
      pacienteId: "paciente",
      conductorId: "chofer",
      estado: "asignado",
      origen: { direccion: "Privada" },
    });
    await db
      .doc("solicitudes/pendiente")
      .set({ pacienteId: "paciente", conductorId: null, estado: "solicitado" });
    await db.doc("respuestas_paciente/paciente").set({ asiste: true });
    await db.doc("usuarios_privado/paciente").set({ fcmToken: "NO-PUBLICO" });
    await db.doc("historial_viajes/cerrado").set({ pacienteId: "paciente" });
    await db.doc("gps_viajes/cerrado/muestras/1").set({ lat: 1, lng: 1 });
  });
});
describe("H10 privacidad y consultas", () => {
  it("paciente lee su perfil y su viaje, no los de otro", async () => {
    await assertSucceeds(user("paciente").doc("usuarios/paciente").get());
    await assertSucceeds(user("paciente").doc("viajes/paciente").get());
    await assertFails(user("otro").doc("usuarios/paciente").get());
    await assertFails(user("otro").doc("viajes/paciente").get());
    await assertFails(user("otro").doc("solicitudes/privada").get());
    await assertFails(user("otro").doc("respuestas_paciente/paciente").get());
  });
  it("chofer aprobado accede al paciente asignado y a pendientes, no a todos los perfiles", async () => {
    await assertSucceeds(user("chofer").doc("usuarios/paciente").get());
    await assertSucceeds(
      user("chofer").doc("respuestas_paciente/paciente").get(),
    );
    await assertSucceeds(
      user("chofer")
        .collection("viajes")
        .where("choferId", "==", "chofer")
        .get(),
    );
    await assertSucceeds(
      user("chofer")
        .collection("solicitudes")
        .where("estado", "==", "solicitado")
        .get(),
    );
    await assertFails(user("chofer").collection("usuarios").get());
    await assertFails(user("pendiente").doc("solicitudes/pendiente").get());
  });
  it("el admin activo puede consultar paneles e historial; desactivado no", async () => {
    await assertSucceeds(
      user("admin").collection("usuarios").where("rol", "==", "paciente").get(),
    );
    await assertSucceeds(user("admin").doc("historial_viajes/cerrado").get());
    await assertSucceeds(
      user("admin").doc("gps_viajes/cerrado/muestras/1").get(),
    );
    await assertFails(user("admin_off").collection("usuarios").get());
    await assertFails(user("admin_off").doc("historial_viajes/cerrado").get());
    await assertFails(
      user("admin_off").doc("gps_viajes/cerrado/muestras/1").get(),
    );
  });
  it("tokens y sesiones son privados incluso para admin", async () => {
    for (const uid of ["admin", "paciente", "chofer"])
      for (const ruta of [
        "usuarios_privado/paciente",
        "fcmTokens/token",
        "fcmSesiones/sesion",
      ])
        await assertFails(user(uid).doc(ruta).get());
  });
  it("ningun cliente escribe estado o permisos; paciente conserva asistencia propia", async () => {
    for (const uid of ["admin", "paciente", "chofer"])
      for (const ruta of [
        "viajes/paciente",
        "solicitudes/privada",
        "usuarios/paciente",
        "historial_viajes/cerrado",
        "gps_viajes/cerrado/muestras/1",
        "usuarios_privado/paciente",
      ])
        await assertFails(user(uid).doc(ruta).set({ rol: "admin" }));
    await assertSucceeds(
      user("paciente")
        .doc("respuestas_paciente/paciente")
        .set({ asiste: false }),
    );
    await assertFails(
      user("otro").doc("respuestas_paciente/paciente").set({ asiste: false }),
    );
  });
  it("usuario sin perfil y anonimato no leen viajes", async () => {
    await assertFails(user("sin_perfil").doc("viajes/paciente").get());
    await assertFails(
      env.unauthenticatedContext().firestore().doc("viajes/paciente").get(),
    );
  });
});
