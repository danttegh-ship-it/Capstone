const test = require("node:test"),
  assert = require("node:assert/strict");
const { montar, sembrarUsuarios, UID } = require("./helpers/montaje");
const { peticion } = require("./helpers/memoria");
const call = (f, u, d) => f.run(peticion(u, "paciente", d));
async function env() {
  const e = montar();
  await sembrarUsuarios(e.db, e.auth);
  return e;
}
test("H05: dos cuentas concurrentes conservan un solo propietario privado del token", async () => {
  const e = await env();
  await Promise.all([
    call(e.cuentas.registrarTokenFcm, UID.paciente, {
      sesionId: "sesion_concurrente_01",
      token: "token-compartido",
    }),
    call(e.cuentas.registrarTokenFcm, UID.paciente2, {
      sesionId: "sesion_concurrente_02",
      token: "token-compartido",
    }),
  ]);
  const propietarios = await e.db.collection("fcmTokens").get();
  assert.equal(propietarios.size, 1);
  const privados = (
    await e.db.collection("usuarios_privado").get()
  ).docs.filter((d) => d.data().fcmToken === "token-compartido");
  assert.equal(privados.length, 1);
  assert.equal(privados[0].id, propietarios.docs[0].data().uid);
  assert.ok(
    (await e.db.collection("usuarios").get()).docs.every(
      (d) => !d.data().fcmToken,
    ),
  );
});
test("H05: logout adelantado impide registro tardio de la sesion cerrada", async () => {
  const e = await env();
  const data = { sesionId: "sesion_cerrada_001", token: "token-pendiente" };
  await call(e.cuentas.eliminarTokenFcm, UID.paciente, data);
  await assert.rejects(call(e.cuentas.registrarTokenFcm, UID.paciente, data), {
    code: "failed-precondition",
  });
  assert.equal((await e.db.collection("fcmTokens").get()).size, 0);
});
test("H05: logout de otra sesion no elimina token de la sesion nueva", async () => {
  const e = await env();
  await call(e.cuentas.registrarTokenFcm, UID.paciente, {
    sesionId: "sesion_nueva_0001",
    token: "token-nuevo",
  });
  await call(e.cuentas.eliminarTokenFcm, UID.paciente, {
    sesionId: "sesion_vieja_0001",
  });
  assert.equal(
    (await e.db.doc(`usuarios_privado/${UID.paciente}`).get()).data().fcmToken,
    "token-nuevo",
  );
});

test("H05: sesion sustituida no recupera un token transferido a otra cuenta", async () => {
  const e = await env();
  const a = { sesionId: "sesion_transferida_A01", token: "token-transferido" };
  await call(e.cuentas.registrarTokenFcm, UID.paciente, a);
  await call(e.cuentas.registrarTokenFcm, UID.paciente2, {
    sesionId: "sesion_transferida_B01",
    token: a.token,
  });
  await assert.rejects(call(e.cuentas.registrarTokenFcm, UID.paciente, a), {
    code: "failed-precondition",
  });
  assert.equal(
    (await e.db.doc(`usuarios_privado/${UID.paciente2}`).get()).data().fcmToken,
    a.token,
  );
});

for (const eliminar of [false, true]) {
  test(`T3: ${eliminar ? "baja" : "desactivacion"} limpia notificaciones y es idempotente`, async () => {
    const e = await env();
    const sesion = "sesion_baja_usuario_01";
    await call(e.cuentas.registrarTokenFcm, UID.paciente, {
      sesionId: sesion,
      token: "token-baja",
    });
    await e.db
      .doc("fcmSesiones/otra_sesion_historica")
      .set({ uid: UID.paciente, revocada: false });
    await call(e.cuentas.registrarTokenFcm, UID.paciente2, {
      sesionId: "sesion_otro_usuario_01",
      token: "token-otro",
    });
    const request = peticion(UID.admin, "admin", {
      uid: UID.paciente,
      activo: false,
    });
    await (
      eliminar ? e.cuentas.eliminarCuenta : e.cuentas.activarDesactivarCuenta
    ).run(request);
    const helper = require("../fcm").init(e.db);
    await helper.limpiarNotificaciones(UID.paciente, eliminar);
    const propios = await e.db
      .collection("fcmTokens")
      .where("uid", "==", UID.paciente)
      .get();
    assert.equal(propios.size, 0);
    const sesiones = await e.db
      .collection("fcmSesiones")
      .where("uid", "==", UID.paciente)
      .get();
    assert.ok(sesiones.docs.every((d) => d.data().revocada === true));
    const privado = await e.db.doc(`usuarios_privado/${UID.paciente}`).get();
    if (eliminar) assert.equal(privado.exists, false);
    else assert.equal(privado.data().fcmToken, null);
    assert.equal(
      (await e.db.doc(`usuarios_privado/${UID.paciente2}`).get()).data()
        .fcmToken,
      "token-otro",
    );
    if (!eliminar) {
      await e.cuentas.activarDesactivarCuenta.run(
        peticion(UID.admin, "admin", { uid: UID.paciente, activo: true }),
      );
      await assert.rejects(
        call(e.cuentas.registrarTokenFcm, UID.paciente, {
          sesionId: sesion,
          token: "token-baja",
        }),
        { code: "failed-precondition" },
      );
    }
  });
}
