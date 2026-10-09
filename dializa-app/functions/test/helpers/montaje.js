// Monta TODO el backend (cuentas + autorizacion + viajes + gps) sobre
// dobles en memoria, igual que lo conecta functions/index.js.
require("./entorno");
const { FakeFirestore, FakeRtdb, FakeAuth } = require("./memoria");

function montar() {
  const db = new FakeFirestore();
  const rtdb = new FakeRtdb();
  const auth = new FakeAuth();
  const autorizacion = require("../../autorizacionUbicacion").init(db, () => rtdb);
  const cuentas = require("../../cuentas").init(db, { autorizacion }, auth);
  const viajes = require("../../viajes").init(db, cuentas, { autorizacion });
  const gps = require("../../gps").init(db, cuentas);
  return { db, rtdb, auth, autorizacion, cuentas, viajes, gps };
}

const UID = {
  admin: "admin_uid_0001",
  admin2: "admin_uid_0002",
  chofer: "chofer_uid_001",
  chofer2: "chofer_uid_002",
  chofer3: "chofer_uid_003",
  paciente: "paciente_uid_01",
  paciente2: "paciente_uid_02",
};

/** Siembra usuarios coherentes (rol + activo + aprobado) en el doble. */
async function sembrarUsuarios(db, auth, { aprobarChoferes = true } = {}) {
  const base = [
    [UID.admin, { rol: "admin", nombre: "Admin Uno", activo: true }, "admin1@x.cl"],
    [UID.admin2, { rol: "admin", nombre: "Admin Dos", activo: true }, "admin2@x.cl"],
    [UID.chofer, { rol: "chofer", nombre: "Chofer Uno", activo: true, aprobado: aprobarChoferes }, "c1@x.cl"],
    [UID.chofer2, { rol: "chofer", nombre: "Chofer Dos", activo: true, aprobado: aprobarChoferes }, "c2@x.cl"],
    [UID.chofer3, { rol: "chofer", nombre: "Chofer Tres", activo: true, aprobado: aprobarChoferes }, "c3@x.cl"],
    [UID.paciente, { rol: "paciente", nombre: "Paciente Uno", activo: true }, "p1@x.cl"],
    [UID.paciente2, { rol: "paciente", nombre: "Paciente Dos", activo: true }, "p2@x.cl"],
  ];
  for (const [uid, perfil, email] of base) {
    await db.collection("usuarios").doc(uid).set(perfil);
    auth.agregar({ uid, email, claims: { rol: perfil.rol } });
  }
  for (const uid of [UID.chofer, UID.chofer2, UID.chofer3]) {
    await db.collection("choferes_privado").doc(uid).set({ disponible: true, patente: "AB1234" });
  }
}

module.exports = { montar, sembrarUsuarios, UID };
