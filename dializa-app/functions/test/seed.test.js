// Tests UNITARIOS del seed de cuentas (scripts/seed-lib.js) con dobles de
// Auth y Firestore. No ejecuta el script real (eso requiere credenciales o
// el Emulator Suite).
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FakeAuth } = require("./helpers/memoria");
const { rolPorPrefijo, planificar, ejecutarPlan, CUENTAS_POR_DEFECTO } = require("../scripts/seed-lib");

const PASSWORD = "ClaveSecreta123";

test("rolPorPrefijo: admin.* -> admin, conductor.* -> chofer, resto -> paciente", () => {
  assert.equal(rolPorPrefijo("admin.ejemplo@gmail.com"), "admin");
  assert.equal(rolPorPrefijo("ADMIN.Otro@Outlook.com"), "admin");
  assert.equal(rolPorPrefijo("conductor.ejemplo@gmail.com"), "chofer");
  assert.equal(rolPorPrefijo("conductor.pedro@outlook.com"), "chofer");
  assert.equal(rolPorPrefijo("juan.perez@gmail.com"), "paciente");
  assert.equal(rolPorPrefijo("administrador@gmail.com"), "paciente", "sin el punto no es el prefijo");
  assert.equal(rolPorPrefijo("x.admin.y@gmail.com"), "paciente", "el prefijo debe estar al inicio");
});

test("cuentas por defecto: admin.ejemplo@gmail.com y conductor.ejemplo@gmail.com", () => {
  assert.deepEqual(CUENTAS_POR_DEFECTO, ["admin.ejemplo@gmail.com", "conductor.ejemplo@gmail.com"]);
});

test("planificar: crea las nuevas, omite las existentes, descarta invalidas y duplicadas", () => {
  const plan = planificar(["admin.ejemplo@gmail.com", "Conductor.Ejemplo@gmail.com", "malo", "admin.ejemplo@gmail.com", "ya.existe@x.cl"], new Set(["ya.existe@x.cl"]));
  assert.deepEqual(plan.map((p) => [p.email, p.accion, p.rol]), [
    ["admin.ejemplo@gmail.com", "crear", "admin"],
    ["conductor.ejemplo@gmail.com", "crear", "chofer"],
    ["malo", "invalido", undefined],
    ["ya.existe@x.cl", "omitir_existente", null],
  ]);
});

test("ejecutarPlan: crea cuentas con perfil + custom claim coherentes; el chofer nace NO aprobado por defecto", async () => {
  const auth = new FakeAuth();
  const db = new FakeFirestore();
  const plan = planificar(CUENTAS_POR_DEFECTO, new Set());
  const res = await ejecutarPlan({ auth, db, plan, password: PASSWORD, ahora: () => "2026-10-07T00:00:00.000Z" });
  assert.deepEqual(res.map((r) => r.resultado), ["creada", "creada"]);

  const admin = [...auth.usuarios.values()].find((u) => u.email === "admin.ejemplo@gmail.com");
  const chofer = [...auth.usuarios.values()].find((u) => u.email === "conductor.ejemplo@gmail.com");
  assert.deepEqual(admin.claims, { rol: "admin" });
  assert.deepEqual(chofer.claims, { rol: "chofer" });
  const perfilAdmin = (await db.doc(`usuarios/${admin.uid}`).get()).data();
  const perfilChofer = (await db.doc(`usuarios/${chofer.uid}`).get()).data();
  assert.equal(perfilAdmin.rol, "admin");
  assert.equal(perfilAdmin.activo, true);
  assert.equal(perfilChofer.rol, "chofer");
  assert.equal(perfilChofer.aprobado, false, "un admin debe aprobarlo en la pantalla Conductores");
  assert.equal((await db.doc(`choferes_privado/${chofer.uid}`).get()).data().disponible, false);
});

test("ejecutarPlan: con aprobarConductores=true el chofer NUEVO nace aprobado (solo cuentas de prueba)", async () => {
  const auth = new FakeAuth();
  const db = new FakeFirestore();
  await ejecutarPlan({ auth, db, plan: planificar(["conductor.ejemplo@gmail.com"], new Set()), password: PASSWORD, aprobarConductores: true });
  const chofer = [...auth.usuarios.values()][0];
  assert.equal((await db.doc(`usuarios/${chofer.uid}`).get()).data().aprobado, true);
});

test("ejecutarPlan: NUNCA cambia ni promueve cuentas existentes (rol, claims, perfil, contrasena)", async () => {
  const auth = new FakeAuth();
  const db = new FakeFirestore();
  // Cuentas que ya existian con roles "inesperados" respecto de su prefijo
  auth.agregar({ uid: "uid_existente_admin_x", email: "admin.ejemplo@gmail.com", claims: { rol: "paciente" } });
  await db.doc("usuarios/uid_existente_admin_x").set({ rol: "paciente", nombre: "Persona Real", activo: true });
  auth.agregar({ uid: "uid_existente_cond_y", email: "conductor.ejemplo@gmail.com", claims: { rol: "admin" }, disabled: true });
  await db.doc("usuarios/uid_existente_cond_y").set({ rol: "admin", nombre: "Otro", activo: false });
  const antesAuth = JSON.stringify([...auth.usuarios.values()]);
  const antesDb = JSON.stringify([...db.docs]);

  const existentes = new Set(["admin.ejemplo@gmail.com", "conductor.ejemplo@gmail.com"]);
  const res = await ejecutarPlan({ auth, db, plan: planificar(CUENTAS_POR_DEFECTO, existentes), password: PASSWORD });

  assert.deepEqual(res.map((r) => r.resultado), ["omitir_existente", "omitir_existente"]);
  assert.equal(JSON.stringify([...auth.usuarios.values()]), antesAuth);
  assert.equal(JSON.stringify([...db.docs]), antesDb);
  assert.equal(auth.llamadas.length, 0, "ni una sola llamada de escritura a Auth");
});

test("ejecutarPlan: si falla Firestore tras crear el usuario en Auth, se deshace (no quedan cuentas sin perfil)", async () => {
  const auth = new FakeAuth();
  const db = new FakeFirestore();
  db.fallarEscrituraEn = "usuarios/";
  const res = await ejecutarPlan({ auth, db, plan: planificar(["admin.ejemplo@gmail.com"], new Set()), password: PASSWORD });
  assert.equal(res[0].resultado, "error");
  assert.equal(auth.usuarios.size, 0);
});

test("ejecutarPlan: rechaza contrasenas debiles y NUNCA expone la contrasena en resultados ni llamadas registradas", async () => {
  const auth = new FakeAuth();
  const db = new FakeFirestore();
  await assert.rejects(() => ejecutarPlan({ auth, db, plan: [], password: "corta" }), /SEED_PASSWORD invalida/);
  await assert.rejects(() => ejecutarPlan({ auth, db, plan: [], password: undefined }), /SEED_PASSWORD invalida/);
  const res = await ejecutarPlan({ auth, db, plan: planificar(["admin.ejemplo@gmail.com"], new Set()), password: PASSWORD });
  assert.ok(!JSON.stringify(res).includes(PASSWORD));
  assert.ok(!JSON.stringify(auth.llamadas).includes(PASSWORD));
  assert.ok(![...db.docs.values()].some((d) => JSON.stringify(d).includes(PASSWORD)));
});

test("no existe ningun endpoint publico que otorgue roles por prefijo (el prefijo solo se usa en scripts/seed-lib.js)", () => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..");
  const fuentes = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  for (const f of fuentes) {
    const texto = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/startsWith\(["']admin\./.test(texto) && !/rolPorPrefijo/.test(texto), `${f} no debe deducir roles del correo`);
  }
});
