// SDK reales contra Emulator Suite. Nunca admite un proyecto no demo.
const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');const path=require('node:path');
const backend=createRequire(path.join(__dirname,'../functions/package.json'));
const admin=backend('firebase-admin');
const project=process.env.GCLOUD_PROJECT;
if(!project?.startsWith('demo-') || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw Error('Solo Emulator Suite completo con proyecto demo.');
admin.initializeApp({projectId:project,databaseURL:`https://${project}-default-rtdb.firebaseio.com`});
const db=admin.firestore(),auth=admin.auth(),rtdb=admin.database();
const autorizacion=backend('./autorizacionUbicacion').init(db,()=>rtdb);
const cuentas=backend('./cuentas').init(db,{autorizacion});
const viajes=backend('./viajes').init(db,cuentas,{autorizacion});
const gps=backend('./gps').init(db,cuentas);
const call=(f,uid,rol,data)=>f.run({auth:{uid,token:{rol}},data});
const ids=['admin_0001','admin_0002','chofer_001','paciente_01','paciente_02'];
test.beforeEach(async()=>{
 for(const collection of await db.listCollections()) await db.recursiveDelete(collection);
 await rtdb.ref().remove();
 const usuarios=await auth.listUsers();if(usuarios.users.length)await auth.deleteUsers(usuarios.users.map(u=>u.uid));
 for(const uid of ids){const rol=uid.startsWith('admin')?'admin':uid.startsWith('chofer')?'chofer':'paciente';
  await auth.createUser({uid,email:`${uid}@example.test`});await auth.setCustomUserClaims(uid,{rol});
  await db.doc(`usuarios/${uid}`).set({rol,nombre:uid,activo:true,aprobado:rol==='chofer'});
 }
 await db.doc('choferes_privado/chofer_001').set({disponible:true});
});
test.after(async()=>{await admin.app().delete();});
const asignar=()=>call(viajes.asignarViaje,'admin_0001','admin',{pacienteId:'paciente_01',choferId:'chofer_001',fecha:'2026-10-26',hora:'12:00'});
async function avanzar(viajeId,estadoEsperado,nuevoEstado){return call(viajes.actualizarEstadoViaje,'chofer_001','chofer',{coleccion:'viajes',id:'paciente_01',viajeId,estadoEsperado,nuevoEstado});}
test('H01/H08: instancia obsoleta falla; GPS aceptado se conserva al finalizar',async()=>{
 const anterior=await asignar();const actual=await asignar();
 await assert.rejects(call(viajes.cancelarAsignacionConductor,'chofer_001','chofer',{coleccion:'viajes',id:'paciente_01',viajeId:anterior.viajeId,estadoEsperado:'asignado'}),{code:'failed-precondition'});
 await avanzar(actual.viajeId,'asignado','conductor_en_camino');await avanzar(actual.viajeId,'conductor_en_camino','conductor_llego');await avanzar(actual.viajeId,'conductor_llego','en_viaje');
 const lote={coleccion:'viajes',id:'paciente_01',viajeId:actual.viajeId,muestras:[{lat:-33,lng:-70,timestampMs:Date.now()}]};
 await call(gps.registrarMuestrasGps,'chofer_001','chofer',lote);await call(gps.registrarMuestrasGps,'chofer_001','chofer',lote);
 await avanzar(actual.viajeId,'en_viaje','finalizado');
 assert.equal((await db.doc(`historial_viajes/${actual.viajeId}`).get()).data().gps.conteo,1);
 assert.equal((await db.collection(`gps_viajes/${actual.viajeId}/muestras`).get()).size,1);
});
test('H04: transacciones reales impiden desactivacion cruzada de todos los admins',async()=>{
 const result=await Promise.allSettled([
 call(cuentas.activarDesactivarCuenta,'admin_0001','admin',{uid:'admin_0002',activo:false}),
 call(cuentas.activarDesactivarCuenta,'admin_0002','admin',{uid:'admin_0001',activo:false})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await db.collection('usuarios').where('rol','==','admin').where('activo','==',true).get()).size,1);
});
test('H05: registros simultaneos conservan un propietario real del token',async()=>{
 await Promise.all([
 call(cuentas.registrarTokenFcm,'paciente_01','paciente',{sesionId:'sesion_real_000001',token:'token-emulador'}),
 call(cuentas.registrarTokenFcm,'paciente_02','paciente',{sesionId:'sesion_real_000002',token:'token-emulador'})]);
 const tokens=await db.collection('fcmTokens').get();assert.equal(tokens.size,1);
 assert.equal((await db.collection('usuarios_privado').where('fcmToken','==','token-emulador').get()).size,1);
});
test('H06: baja generica archiva, borra Auth y revoca ubicacion',async()=>{
 const {viajeId}=await asignar();await avanzar(viajeId,'asignado','conductor_en_camino');
 await call(cuentas.eliminarCuenta,'admin_0001','admin',{uid:'paciente_01'});
 assert.equal((await db.doc(`historial_viajes/${viajeId}`).get()).data().estadoFinal,'cancelado');
 await assert.rejects(auth.getUser('paciente_01'),{code:'auth/user-not-found'});
 assert.equal((await rtdb.ref('ubicaciones/chofer_001/pacienteAutorizado').get()).val(),null);
});
test('H07: baja no convierte una solicitud en_viaje a cancelado',async()=>{
 await db.doc('solicitudes/sol_real_activa').set({pacienteId:'paciente_01',conductorId:'chofer_001',estado:'en_viaje'});
 await assert.rejects(call(cuentas.eliminarPaciente,'admin_0001','admin',{uid:'paciente_01'}),{code:'failed-precondition'});
 assert.equal((await db.doc('solicitudes/sol_real_activa').get()).data().estado,'en_viaje');
 assert.equal((await auth.getUser('paciente_01')).disabled,false);
});
