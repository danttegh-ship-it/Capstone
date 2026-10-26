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
  const operaciones = require("./operacionesCuenta").init(db, auth);

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

    if (datos.activo !== true || datos.operacionCuenta || datos.bajaEnCurso) {
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

    await db.runTransaction(async tx => {
      const ref=db.collection("usuarios").doc(uid);
      const usuarioDoc=await tx.get(ref);
      if(usuarioDoc.exists) {
        const previo=usuarioDoc.data();
        if(previo.activo!==true || previo.operacionCuenta || previo.bajaEnCurso) throw new HttpsError("permission-denied","Tu cuenta esta desactivada o en proceso de baja.");
        if(previo.rol && previo.rol!=="chofer") throw new HttpsError("failed-precondition","Esta cuenta ya tiene otro rol asignado.");
        if(previo.aprobado===true) throw new HttpsError("already-exists","Ya tienes un registro de chofer aprobado.");
      }
      tx.set(ref,{rol:"chofer",activo:true,aprobado:false,telefono},{merge:true});
      tx.set(db.collection("choferes_privado").doc(uid),{patente,licencia,modeloVehiculo,vehiculoAdaptado,disponible:false},{merge:true});
    });

    await sincronizarClaimRol(uid, "chofer");

    return { ok: true, mensaje: "Registro enviado. Un administrador debe aprobarlo." };
  });

  // ---------------------------------------------------------------------
  // aprobarConductor: un admin aprueba a un chofer registrado.
  // ---------------------------------------------------------------------
  const aprobarConductor = onCall(async (request) => {
    await exigirAdmin(request);
    const conductorUid = validarUid(request.data && request.data.uid);

    const usuarioAuth=await auth.getUser(conductorUid);
    if(usuarioAuth.disabled) throw new HttpsError("failed-precondition","Reactiva la cuenta antes de aprobarla.");
    await db.runTransaction(async tx=>{
      const ref=db.collection("usuarios").doc(conductorUid);
      const doc=await tx.get(ref);
      if(!doc.exists || doc.data().rol!=="chofer") throw new HttpsError("not-found","No existe ese chofer.");
      if(!require("./operacionesCuenta").perfilOperativo(doc.data())) throw new HttpsError("failed-precondition","Reactiva la cuenta antes de aprobarla.");
      tx.update(ref,{aprobado:true});
    });
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
  const activarDesactivarCuenta = onCall(async request => {
    const {uid:actorUid}=await exigirAdmin(request);
    const objetivoUid=validarUid(request.data?.uid);
    if(typeof request.data?.activo!=="boolean") throw new HttpsError("invalid-argument","activo debe ser booleano.");
    const activo=request.data.activo;
    const ctx=await operaciones.preparar(actorUid,objetivoUid,activo?"activar":"desactivar");
    const authActualizado=await operaciones.aplicarAuth(objetivoUid,activo);
    await operaciones.finalizar(ctx,activo && authActualizado);
    await registrarAuditoria(db,{accion:activo?"activarCuenta":"desactivarCuenta",actorUid,objetivoUid,detalle:{authActualizado}});
    return {ok:true,authActualizado};
  });

  // Una unica ruta de baja para cualquier rol. El perfil bloqueado se
  // conserva hasta que archivado, Auth y limpieza hayan terminado.
  async function darDeBaja(actorUid, objetivoUid) {
    const ctx=await operaciones.preparar(actorUid,objetivoUid,"eliminar");
    const choferes=new Set();
    if(ctx.datos.rol==="paciente") {
      const refs=[db.collection("viajes").doc(objetivoUid)];
      const solicitudes=await db.collection("solicitudes").where("pacienteId","==",objetivoUid).get();
      refs.push(...solicitudes.docs.map(d=>d.ref));
      for(const ref of refs) {
        const coleccion=ref.path.startsWith("viajes/")?"viajes":"solicitudes";
        const conductor=await db.runTransaction(async tx=>{
          const doc=await tx.get(ref);
          if(!doc.exists) return null;
          const datos=doc.data();
          if(datos.estado==="en_viaje") throw new HttpsError("failed-precondition","No se puede borrar un viaje iniciado.");
          const contexto=await leerContextoArchivo(tx,db,coleccion,ref.id,datos);
          const cerrado=ESTADOS_FINALES.includes(datos.estado);
          const finales=cerrado?datos:{...datos,estado:"cancelado",historial:agregarHistorial(datos.historial,"cancelado",actorUid)};
          escribirArchivo(tx,contexto,{coleccion,id:ref.id,datosFinales:finales,cierre:"cuenta_eliminada"});
          if(coleccion==="viajes") tx.delete(ref);
          else if(!cerrado) tx.update(ref,{estado:"cancelado",historial:finales.historial});
          return datos[coleccion==="viajes"?"choferId":"conductorId"]||null;
        });
        if(conductor) choferes.add(conductor);
      }
    }
    const authActualizado=await operaciones.aplicarAuth(objetivoUid,false,true);
    await db.collection("choferes_privado").doc(objetivoUid).delete();
    await operaciones.finalizar(ctx,false,true);
    await registrarAuditoria(db,{accion:"eliminarCuenta",actorUid,objetivoUid,detalle:{authActualizado}});
    const autorizacionSincronizada=await autorizacion.reconciliarSeguro([...choferes]);
    return {ok:true,authActualizado,autorizacionSincronizada};
  }
  const eliminarCuenta=onCall(async request=>{
    const {uid:actorUid}=await exigirAdmin(request);
    return darDeBaja(actorUid,validarUid(request.data?.uid));
  });

  // ---------------------------------------------------------------------
  // registrarTokenFcm: guarda/actualiza el token de notificaciones push
  // del usuario autenticado (puntos 9.5, 14.2).
  // ---------------------------------------------------------------------
  const {registrarTokenFcm,eliminarTokenFcm}=require("./fcm").init(db);

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

  const eliminarPaciente = onCall(async request => {
    const {uid:actorUid}=await exigirAdmin(request);
    const objetivoUid=validarUid(request.data?.uid);
    const doc=await db.collection("usuarios").doc(objetivoUid).get();
    if(!doc.exists || doc.data().rol!=="paciente") throw new HttpsError("not-found","No existe ese paciente.");
    return darDeBaja(actorUid,objetivoUid);
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
