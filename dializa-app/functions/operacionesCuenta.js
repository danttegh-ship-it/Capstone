// Operaciones de cuenta: decision Firestore atomica, Auth fuera de la
// transaccion y finalizacion con id de operacion. Un fallo deja un perfil
// bloqueado y reintentable; nunca se tragan fallos reales de Auth.
const { randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { ESTADOS_FINALES } = require("./historial");
function perfilOperativo(datos) {
  return datos && datos.activo === true && !datos.operacionCuenta && !datos.bajaEnCurso;
}
function init(db, auth) {
 async function preparar(actorUid, uid, accion) {
  const ref=db.collection("usuarios").doc(uid);
  return db.runTransaction(async tx=>{
   const [actor, objetivo]=await Promise.all([tx.get(db.collection("usuarios").doc(actorUid)),tx.get(ref)]);
   if(!actor.exists || actor.data().rol!=="admin" || !perfilOperativo(actor.data())) throw new HttpsError("permission-denied","El administrador ya no esta activo.");
   if(!objetivo.exists) throw new HttpsError("not-found","Usuario no encontrado.");
   if(uid===actorUid) throw new HttpsError("failed-precondition","No puedes cambiar tu propia cuenta.");
   const datos=objetivo.data();
   if(datos.operacionCuenta) {
     if(datos.operacionCuenta.accion!==accion) throw new HttpsError("failed-precondition","Hay otra operacion pendiente. Reintenta esa operacion primero.");
     return {ref,datos,operacion:datos.operacionCuenta};
   }
   if(datos.rol==="admin" && datos.activo===true && accion!=="activar") {
    const admins=await tx.get(db.collection("usuarios").where("rol","==","admin").where("activo","==",true));
    if(admins.docs.filter(d=>perfilOperativo(d.data())).length<=1) throw new HttpsError("failed-precondition","No puedes retirar al ultimo administrador activo.");
   }
   if(accion==="eliminar" && ["paciente","chofer"].includes(datos.rol)) {
    const viajes=datos.rol==="paciente" ? [await tx.get(db.collection("viajes").doc(uid))] : (await tx.get(db.collection("viajes").where("choferId","==",uid))).docs;
    const solicitudes=(await tx.get(db.collection("solicitudes").where(datos.rol==="paciente"?"pacienteId":"conductorId","==",uid))).docs;
    const docs=[...viajes,...solicitudes].filter(d=>d.exists);
    if(docs.some(d=>datos.rol==="chofer" ? !ESTADOS_FINALES.includes(d.data().estado||"asignado") : d.data().estado==="en_viaje")) {
     throw new HttpsError("failed-precondition",datos.rol==="paciente"?"Finaliza el viaje iniciado antes de eliminar al paciente.":"El chofer tiene viajes sin cerrar.");
    }
   }
   const operacion={id:randomUUID(),accion};
   tx.update(ref,{activo:false,operacionCuenta:operacion,bajaEnCurso:accion==="eliminar"});
   return {ref,datos,operacion};
  });
 }
 async function aplicarAuth(uid, activo, eliminar=false) {
  try {
   await auth.updateUser(uid,{disabled:!activo});
   if(!activo) await auth.revokeRefreshTokens(uid);
   if(eliminar) await auth.deleteUser(uid);
   return true;
  } catch(error) {if(error.code==="auth/user-not-found") return false;throw error;}
 }
 async function finalizar(ctx, activo, eliminar=false) {
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ctx.ref);
   if(!snap.exists && eliminar) return;
   if(!snap.exists || snap.data().operacionCuenta?.id!==ctx.operacion.id) throw new HttpsError("failed-precondition","La operacion de cuenta cambio.");
   if(eliminar) tx.delete(ctx.ref);
   else tx.update(ctx.ref,{activo,operacionCuenta:null,bajaEnCurso:false});
  });
 }
 return {preparar,aplicarAuth,finalizar};
}
module.exports={init,perfilOperativo};
