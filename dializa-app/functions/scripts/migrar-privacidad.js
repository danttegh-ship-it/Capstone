// Migracion privada previa a reglas H10. Simula salvo --confirmar.
// Nunca registra tokens ni claves; usar solo en el proyecto identificado.
const {randomUUID}=require("node:crypto");
async function main(){
 const args=process.argv.slice(2), proyecto=args[args.indexOf("--project")+1];
 if(!args.includes("--project") || !proyecto || proyecto.startsWith("--")) throw Error("Falta --project <id>");
 const confirmar=args.includes("--confirmar");
 const admin=require("firebase-admin");admin.initializeApp({projectId:proyecto,...(process.env.FIREBASE_DATABASE_URL?{databaseURL:process.env.FIREBASE_DATABASE_URL}:{})});
 const db=admin.firestore(),fcm=require("../fcm").init(db),authz=require("../autorizacionUbicacion").init(db,()=>admin.database());
 const usuarios=await db.collection("usuarios").get();
 console.log(`Proyecto ${proyecto}: ${usuarios.size} perfiles; ${confirmar?"ESCRITURA":"SIMULACION"}`);
 if(!confirmar)return;
 for(const doc of usuarios.docs){
  const datos=doc.data();
  if(datos.fcmToken && require("../operacionesCuenta").perfilOperativo(datos)) await fcm.registrarTokenFcm.run({auth:{uid:doc.id},data:{sesionId:`migracion_${randomUUID()}`,token:datos.fcmToken}});
  // Transaccion separada tambien elimina tokens de cuentas inactivas.
  await db.runTransaction(async tx=>{const snap=await tx.get(doc.ref);if(!snap.exists)return;const perfil={...snap.data()};delete perfil.fcmToken;tx.set(doc.ref,perfil);});
  await authz.sincronizarCuenta(doc.id);
 }
 console.log("Migracion completada; no se modificaron roles ni se activaron cuentas.");
}
main().catch(()=>{console.error("Migracion no completada; revisar acceso y configuracion sin publicar credenciales.");process.exitCode=1;});
