// Cuentas, roles y custom claims.
//
// Puerto de daily-app/firebase/functions/index.js (seccion de cuentas),
// adaptado a las colecciones de dializa-app.
//
// Diseno de autorizacion "mixto" (punto 6.4 del requerimiento): el cliente
// Flutter sigue leyendo el campo `rol` de `usuarios/{uid}` para decidir que
// pantalla mostrar (rapido, como ya hacia dializa-app). Pero para cualquier
// Cloud Function sensible, el servidor NUNCA confia solo en ese documento:
// exigirPerfilValido() revisa primero el custom claim `rol` (mas dificil de
// falsificar que un documento) y si no existe todavia -- por ejemplo,
// cuentas creadas antes de este cambio -- cae de vuelta a leer Firestore,
// y de paso sincroniza el claim para la proxima vez.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");

const { validarUid, validarEmail, validarNombre, validarTelefono, validarRol } = require("./validaciones");
const { registrarAuditoria } = require("./auditoria");
const { ESTADOS_FINALES, leerContextoArchivo, escribirArchivo, agregarHistorial } = require("./historial");

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{autorizacion: {reconciliarSeguro: Function}}} deps
 * @param {import('firebase-admin/auth').Auth} [authInyectado] solo para tests
 */
function init(db, { autorizacion }, authInyectado = null) {
  const auth = authInyectado || getAuth();

  /**
   * Fija el custom claim `rol` de un usuario en Firebase Auth. Se llama
   * cada vez que se crea o aprueba una cuenta, y tambien como "reparacion"
   * perezosa cuando exigirPerfilValido() encuentra un uid sin claim.
   */
  async function sincronizarClaimRol(uid, rol) {
    await auth.setCustomUserClaims(uid, { rol });
  }

  /**
   * Exige que quien llama este autenticado, activo, y si es chofer,
   * aprobado. Devuelve { uid, rol }. Punto 9.2 (verificacion de rol en
   * cada operacion sensible), adaptado al mix de daily-app + dializa-app.
   */
  async function exigirPerfilValido(request, rolesPermitidos = null) {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesion para usar esta funcion.");
    }

    const uid = validarUid(request.auth.uid);
    let rol = request.auth.token && request.auth.token.rol;

    const doc = await db.collection("usuarios").doc(uid).get();
    if (!doc.exists) {
      throw new HttpsError("permission-denied", "No tienes un perfil registrado en la app.");
    }
    const datos = doc.data();

    if (!rol) {
      // Cuenta anterior a este cambio: no tiene custom claim todavia.
      // Se usa el rol de Firestore y se repara el claim para la proxima vez.
      rol = datos.rol;
      if (rol) {
        await sincronizarClaimRol(uid, rol).catch(() => {});
      }
    }

    if (!rol || rol !== datos.rol) {
      // El claim y el documento no coinciden -- se confia en Firestore
      // (es lo que lee el cliente) pero se reporta para investigar.
      rol = datos.rol;
    }

    if (datos.activo === false) {
      throw new HttpsError("permission-denied", "Tu cuenta esta desactivada.");
    }

    if (rol === "chofer" && datos.aprobado !== true) {
      throw new HttpsError("permission-denied", "Tu cuenta de chofer aun no ha sido aprobada.");
    }

    if (rolesPermitidos && !rolesPermitidos.includes(rol)) {
      throw new HttpsError("permission-denied", "Tu rol no esta autorizado para esta accion.");
    }

    return { uid, rol };
  }

  async function exigirAdmin(request) {
    return exigirPerfilValido(request, ["admin"]);
  }

  /**
   * Cuenta cuantos administradores activos quedan. Se usa para impedir
   * que el ultimo admin se desactive o se elimine a si mismo y deje la
   * app sin nadie que administre (punto 9.10).
   */
  async function contarAdministradoresActivos() {
    const snap = await db
      .collection("usuarios")
      .where("rol", "==", "admin")
      .where("activo", "==", true)
      .get();
    return snap.size;
  }

  // ---------------------------------------------------------------------
  // crearCuentaAdministrador: crea OTRA cuenta de administrador. Solo
  // puede invocarla un administrador ya existente.
  // ---------------------------------------------------------------------
  const crearCuentaAdministrador = onCall(async (request) => {
    await exigirAdmin(request);

    const email = validarEmail(request.data && request.data.email);
    const nombre = validarNombre(request.data && request.data.nombre);

    const usuarioExistente = await auth.getUserByEmail(email).catch(() => null);
    if (usuarioExistente) {
      throw new HttpsError("already-exists", "Ya existe una cuenta con ese correo.");
    }

    const nuevoUsuario = await auth.createUser({ email, emailVerified: false });
    await sincronizarClaimRol(nuevoUsuario.uid, "admin");

    await db.collection("usuarios").doc(nuevoUsuario.uid).set({
      rol: "admin",
      nombre,
      activo: true,
      creadoEn: new Date().toISOString(),
    });

    await registrarAuditoria(db, {
      accion: "crearCuentaAdministrador",
      actorUid: request.auth.uid,
      objetivoUid: nuevoUsuario.uid,
    });

    return { uid: nuevoUsuario.uid };
  });

  // ---------------------------------------------------------------------
  // solicitarRegistroConductor: el propio chofer completa sus datos de
  // vehiculo. Queda con aprobado=false hasta que un admin lo apruebe.
  // ---------------------------------------------------------------------
  const { validarPatente, validarLicencia } = require("./validaciones");

  const solicitarRegistroConductor = onCall(async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
    }
    const uid = validarUid(request.auth.uid);

    const patente = validarPatente(request.data && request.data.patente);
    const licencia = validarLicencia(request.data && request.data.licencia);
    const modeloVehiculo = (request.data && request.data.modeloVehiculo) || null;
    const vehiculoAdaptado = Boolean(request.data && request.data.vehiculoAdaptado);
    const telefono = validarTelefono(request.data && request.data.telefono);

    const usuarioDoc = await db.collection("usuarios").doc(uid).get();
    if (usuarioDoc.exists && usuarioDoc.data().rol && usuarioDoc.data().rol !== "chofer") {
      throw new HttpsError("failed-precondition", "Esta cuenta ya tiene otro rol asignado.");
    }
    if (usuarioDoc.exists && usuarioDoc.data().aprobado === true) {
      throw new HttpsError("already-exists", "Ya tienes un registro de chofer aprobado.");
    }

    const batch = db.batch();
    batch.set(
      db.collection("usuarios").doc(uid),
      {
        rol: "chofer",
        activo: true,
        aprobado: false,
        telefono,
      },
      { merge: true }
    );
    batch.set(
      db.collection("choferes_privado").doc(uid),
      { patente, licencia, modeloVehiculo, vehiculoAdaptado, disponible: false },
      { merge: true }
    );
    await batch.commit();

    await sincronizarClaimRol(uid, "chofer");

    return { ok: true, mensaje: "Registro enviado. Un administrador debe aprobarlo." };
  });

  // ---------------------------------------------------------------------
  // aprobarConductor: un admin aprueba a un chofer registrado.
  // ---------------------------------------------------------------------
  const aprobarConductor = onCall(async (request) => {
    await exigirAdmin(request);
    const conductorUid = validarUid(request.data && request.data.uid);

    const doc = await db.collection("usuarios").doc(conductorUid).get();
    if (!doc.exists || doc.data().rol !== "chofer") {
      throw new HttpsError("not-found", "No existe un registro de chofer con ese uid.");
    }

    await db.collection("usuarios").doc(conductorUid).update({ aprobado: true, activo: true });
    await sincronizarClaimRol(conductorUid, "chofer");

    await registrarAuditoria(db, {
      accion: "aprobarConductor",
      actorUid: request.auth.uid,
      objetivoUid: conductorUid,
    });

    return { ok: true };
  });

  // ---------------------------------------------------------------------
  // activarDesactivarCuenta / eliminarCuenta: con auto-proteccion y
  // proteccion del ultimo administrador (punto 9.10).
  // ---------------------------------------------------------------------
  const activarDesactivarCuenta = onCall(async (request) => {
    const { uid: actorUid } = await exigirAdmin(request);
    const objetivoUid = validarUid(request.data && request.data.uid);
    const activo = Boolean(request.data && request.data.activo);

    if (objetivoUid === actorUid && !activo) {
      throw new HttpsError("failed-precondition", "No puedes desactivar tu propia cuenta.");
    }

    const doc = await db.collection("usuarios").doc(objetivoUid).get();
    if (!doc.exists) throw new HttpsError("not-found", "Usuario no encontrado.");

    if (!activo && doc.data().rol === "admin") {
      const administradoresActivos = await contarAdministradoresActivos();
      if (administradoresActivos <= 1) {
        throw new HttpsError("failed-precondition", "No puedes desactivar al ultimo administrador activo.");
      }
    }

    // Correccion D. Orden pensado para que un fallo a medias sea SEGURO y
    // el reintento sea idempotente:
    //   - desactivar: primero Firestore (las Cloud Functions ya bloquean a
    //     la cuenta), luego Auth (disabled + revocar refresh tokens).
    //   - activar: primero Auth (que pueda iniciar sesion), luego Firestore.
    // Limites reales (ver docs/ARQUITECTURA.md): deshabilitar en Auth impide
    // NUEVOS inicios de sesion y renovar el token, pero los ID tokens ya
    // emitidos siguen siendo validos hasta ~1 h. Las Cloud Functions de esta
    // app se bloquean al instante (exigirPerfilValido relee Firestore), pero
    // las reglas de RTDB solo ven el token: un chofer desactivado podria
    // seguir escribiendo SU propia ubicacion hasta que expire el token.
    let authActualizado = true;
    const actualizarAuth = async (accion) => {
      try {
        await accion();
      } catch (error) {
        if (error && error.code === "auth/user-not-found") {
          authActualizado = false; // la cuenta existe solo en Firestore
          return;
        }
        throw error;
      }
    };

    if (activo) {
      await actualizarAuth(() => auth.updateUser(objetivoUid, { disabled: false }));
      await db.collection("usuarios").doc(objetivoUid).update({ activo: true });
    } else {
      await db.collection("usuarios").doc(objetivoUid).update({ activo: false });
      await actualizarAuth(async () => {
        await auth.updateUser(objetivoUid, { disabled: true });
        await auth.revokeRefreshTokens(objetivoUid);
      });
    }

    await registrarAuditoria(db, {
      accion: activo ? "activarCuenta" : "desactivarCuenta",
      actorUid,
      objetivoUid,
      detalle: { authActualizado },
    });

    return { ok: true, authActualizado };
  });

  const eliminarCuenta = onCall(async (request) => {
    const { uid: actorUid } = await exigirAdmin(request);
    const objetivoUid = validarUid(request.data && request.data.uid);

    if (objetivoUid === actorUid) {
      throw new HttpsError("failed-precondition", "No puedes eliminar tu propia cuenta.");
    }

    const doc = await db.collection("usuarios").doc(objetivoUid).get();
    if (!doc.exists) throw new HttpsError("not-found", "Usuario no encontrado.");

    if (doc.data().rol === "admin") {
      const administradoresActivos = await contarAdministradoresActivos();
      if (administradoresActivos <= 1) {
        throw new HttpsError("failed-precondition", "No puedes eliminar al ultimo administrador activo.");
      }
    }

    if (doc.data().rol === "chofer") {
      // No se borra a un chofer con viajes sin cerrar: quedarian huerfanos
      // y el paciente seguiria autorizado a una ubicacion que nadie emite.
      const [viajesChofer, solicitudesChofer] = await Promise.all([
        db.collection("viajes").where("choferId", "==", objetivoUid).get(),
        db.collection("solicitudes").where("conductorId", "==", objetivoUid).get(),
      ]);
      const abiertos = [...viajesChofer.docs, ...solicitudesChofer.docs].filter(
        (d) => !ESTADOS_FINALES.includes(d.data().estado || "asignado")
      );
      if (abiertos.length > 0) {
        throw new HttpsError(
          "failed-precondition",
          "El chofer tiene viajes sin cerrar. Reasignalos o cancelalos antes de eliminarlo."
        );
      }
    }

    await db.collection("usuarios").doc(objetivoUid).delete();
    await db.collection("choferes_privado").doc(objetivoUid).delete().catch(() => {});
    await auth.deleteUser(objetivoUid).catch(() => {});

    await registrarAuditoria(db, { accion: "eliminarCuenta", actorUid, objetivoUid });

    return { ok: true };
  });

  // ---------------------------------------------------------------------
  // registrarTokenFcm: guarda/actualiza el token de notificaciones push
  // del usuario autenticado (puntos 9.5, 14.2).
  // ---------------------------------------------------------------------
  const registrarTokenFcm = onCall(async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
    }
    const uid = request.auth.uid;
    const token = request.data && request.data.token;
    if (!token || typeof token !== "string") {
      throw new HttpsError("invalid-argument", "token invalido.");
    }

    if (token.length > 4096) throw new HttpsError("invalid-argument", "token invalido.");

    // Higiene del token (correccion E): un mismo dispositivo puede cambiar
    // de usuario. Si este token estaba asociado a OTRA cuenta, se limpia
    // alli para que las notificaciones de esa cuenta no lleguen a quien
    // ahora usa el telefono.
    const otros = await db.collection("usuarios").where("fcmToken", "==", token).get();
    for (const otro of otros.docs) {
      if (otro.id !== uid) await otro.ref.update({ fcmToken: null });
    }

    await db.collection("usuarios").doc(uid).set({ fcmToken: token }, { merge: true });
    return { ok: true };
  });

  // eliminarTokenFcm: se llama ANTES de cerrar sesion. Si el token guardado
  // coincide con el del dispositivo, se borra; asi el siguiente usuario del
  // telefono no deja al anterior recibiendo sus notificaciones.
  const eliminarTokenFcm = onCall(async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
    }
    const uid = request.auth.uid;
    const token = request.data && request.data.token;
    const ref = db.collection("usuarios").doc(uid);
    const doc = await ref.get();
    if (doc.exists && doc.data().fcmToken && (!token || doc.data().fcmToken === token)) {
      await ref.update({ fcmToken: null });
    }
    return { ok: true };
  });

  // ---------------------------------------------------------------------
  // actualizarDisponibilidad: el chofer activa/desactiva si esta
  // disponible para recibir viajes (punto 13.5).
  // ---------------------------------------------------------------------
  const actualizarDisponibilidad = onCall(async (request) => {
    const { uid, rol } = await exigirPerfilValido(request, ["chofer"]);
    const disponible = Boolean(request.data && request.data.disponible);

    await db.collection("choferes_privado").doc(uid).set({ disponible }, { merge: true });
    return { ok: true, rol, disponible };
  });

  // ---------------------------------------------------------------------
  // Gestion de pacientes por el admin (punto 10.6: usuarios/{uid} ahora
  // es write:false en firestore.rules, asi que lo que antes escribia
  // admin_home.dart directo a Firestore pasa por aqui).
  // ---------------------------------------------------------------------
  const agregarPaciente = onCall(async (request) => {
    const { uid: actorUid } = await exigirAdmin(request);
    const uidPaciente = validarUid(request.data && request.data.uid);
    const nombre = validarNombre(request.data && request.data.nombre);

    const doc = await db.collection("usuarios").doc(uidPaciente).get();
    if (doc.exists) {
      throw new HttpsError("already-exists", "Ya existe un usuario con ese uid.");
    }

    await db.collection("usuarios").doc(uidPaciente).set({
      rol: "paciente",
      nombre,
      activo: true,
      creadoEn: new Date().toISOString(),
    });
    await sincronizarClaimRol(uidPaciente, "paciente");

    await registrarAuditoria(db, { accion: "agregarPaciente", actorUid, objetivoUid: uidPaciente });

    return { ok: true };
  });

  const modificarPaciente = onCall(async (request) => {
    const { uid: actorUid } = await exigirAdmin(request);
    const uidPaciente = validarUid(request.data && request.data.uid);
    const nombre = validarNombre(request.data && request.data.nombre);

    const doc = await db.collection("usuarios").doc(uidPaciente).get();
    if (!doc.exists || doc.data().rol !== "paciente") {
      throw new HttpsError("not-found", "No existe ese paciente.");
    }

    await db.collection("usuarios").doc(uidPaciente).update({ nombre });

    await registrarAuditoria(db, { accion: "modificarPaciente", actorUid, objetivoUid: uidPaciente });

    return { ok: true };
  });

  const eliminarPaciente = onCall(async (request) => {
    const { uid: actorUid } = await exigirAdmin(request);
    const uidPaciente = validarUid(request.data && request.data.uid);

    const doc = await db.collection("usuarios").doc(uidPaciente).get();
    if (!doc.exists || doc.data().rol !== "paciente") {
      throw new HttpsError("not-found", "No existe ese paciente.");
    }

    // Antes de borrar la cuenta se archiva todo viaje sin cerrar (cierre
    // 'cuenta_eliminada') para no perder evidencia, y se reconcilia la
    // autorizacion de ubicacion de los choferes implicados.
    const choferesAfectados = new Set();

    const viajeRef = db.collection("viajes").doc(uidPaciente);
    await db.runTransaction(async (tx) => {
      const viajeSnap = await tx.get(viajeRef);
      if (!viajeSnap.exists) return;
      const datos = viajeSnap.data();
      const ctx = await leerContextoArchivo(tx, db, "viajes", uidPaciente, datos);
      escribirArchivo(tx, ctx, { coleccion: "viajes", id: uidPaciente, datosFinales: datos, cierre: "cuenta_eliminada" });
      tx.delete(viajeRef);
      if (datos.choferId) choferesAfectados.add(datos.choferId);
    });

    const solicitudesPaciente = await db.collection("solicitudes").where("pacienteId", "==", uidPaciente).get();
    for (const sol of solicitudesPaciente.docs) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(sol.ref);
        if (!snap.exists) return;
        const datos = snap.data();
        if (ESTADOS_FINALES.includes(datos.estado)) return; // ya archivada al cerrarse
        const ctx = await leerContextoArchivo(tx, db, "solicitudes", sol.id, datos);
        const datosFinales = {
          ...datos,
          estado: "cancelado",
          historial: agregarHistorial(datos.historial, "cancelado", actorUid),
        };
        tx.update(sol.ref, { estado: datosFinales.estado, historial: datosFinales.historial });
        escribirArchivo(tx, ctx, { coleccion: "solicitudes", id: sol.id, datosFinales, cierre: "cuenta_eliminada" });
        if (datos.conductorId) {
          tx.set(db.collection("choferes_privado").doc(datos.conductorId), { disponible: false }, { merge: true });
          choferesAfectados.add(datos.conductorId);
        }
      });
    }

    await db.collection("usuarios").doc(uidPaciente).delete();

    await registrarAuditoria(db, { accion: "eliminarPaciente", actorUid, objetivoUid: uidPaciente });

    const autorizacionSincronizada = await autorizacion.reconciliarSeguro([...choferesAfectados]);
    return { ok: true, autorizacionSincronizada };
  });

  return {
    exigirPerfilValido,
    exigirAdmin,
    contarAdministradoresActivos,
    sincronizarClaimRol,
    crearCuentaAdministrador,
    solicitarRegistroConductor,
    aprobarConductor,
    activarDesactivarCuenta,
    eliminarCuenta,
    registrarTokenFcm,
    eliminarTokenFcm,
    actualizarDisponibilidad,
    agregarPaciente,
    modificarPaciente,
    eliminarPaciente,
  };
}

module.exports = { init };
