const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const assert = require('node:assert/strict');
let env;
const clients = new Map();
const db = (uid) => {
 if (!clients.has(uid)) clients.set(uid, env.authenticatedContext(uid).firestore());
 return clients.get(uid);
};
const punto = {lat: -33.45, lng: -70.66, direccion: 'Direccion ficticia'};
const solicitud = () => ({pacienteId:'paciente', conductorId:null, estado:'solicitado', creadoEn:'2026-11-19', historial:[], origen:punto, destino:punto, necesidades:{sillaRuedas:false, acompanante:false}, notas:''});
const hist = (estado, actorUid='chofer') => ({estado,actorUid,fecha:'2026-11-19T12:00:00Z'});
before(async () => { env = await initializeTestEnvironment({ projectId:'demo-dializa-spark', firestore:{rules:fs.readFileSync('firestore.spark.rules','utf8')} }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async (ctx) => {
  const fixtureDb = ctx.firestore();
  for (const [uid,rol,aprobado,activo] of [['admin','admin',false,true],['paciente','paciente',false,true],['otro','paciente',false,true],['chofer','chofer',true,true],['segundo','chofer',true,true],['bloqueado','chofer',true,false]]) {
   await fixtureDb.doc(`usuarios/${uid}`).set({nombre:uid,rol,aprobado,activo});
  }
 });
});
describe('Spark: operaciones con roles y transiciones verificadas', () => {
 it('paciente crea solicitud propia; el chofer la consulta y solo uno acepta', async () => {
  await assertSucceeds(db('paciente').doc('solicitudes/s1').set(solicitud()));
  const pendientes = await assertSucceeds(db('chofer').collection('solicitudes').where('estado','==','solicitado').get());
  assert.equal(pendientes.size,1);
  const aceptar = (uid) => db(uid).runTransaction(async tx => {
   const ref = db(uid).doc('solicitudes/s1'); const s = await tx.get(ref);
   if (s.data().estado !== 'solicitado') throw Error('ocupada');
   tx.update(ref,{estado:'asignado',conductorId:uid,historial:[hist('asignado',uid)]});
  });
  const r = await Promise.allSettled([aceptar('chofer'),aceptar('segundo')]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 });
 it('no permite suplantar pacientes, asignarse conductor ni modificar datos de una solicitud al aceptar', async () => {
  await assertFails(db('otro').doc('solicitudes/s1').set(solicitud()));
  await assertFails(db('paciente').doc('solicitudes/s1').set({...solicitud(),estado:'asignado',conductorId:'chofer'}));
  await db('paciente').doc('solicitudes/s1').set(solicitud());
  await assertFails(db('chofer').doc('solicitudes/s1').update({estado:'asignado',conductorId:'chofer',origen:{...punto,direccion:'alterada'},historial:[hist('asignado')]}));
  await assertFails(db('bloqueado').doc('solicitudes/s1').get());
 });
 it('admin edita paciente y bloquea/reactiva conductor sin borrarlo; otros roles no', async () => {
  await assertSucceeds(db('admin').doc('usuarios/paciente').update({nombre:'Nuevo nombre'}));
  await assertSucceeds(db('admin').doc('usuarios/chofer').update({activo:false}));
  assert.equal((await db('admin').doc('usuarios/chofer').get()).exists,true);
  await assertFails(db('chofer').doc('choferes_privado/chofer').set({disponible:true}));
  await assertSucceeds(db('admin').doc('usuarios/chofer').update({activo:true}));
  await assertSucceeds(db('chofer').doc('choferes_privado/chofer').set({disponible:true}));
  await assertFails(db('paciente').doc('usuarios/paciente').update({rol:'admin'}));
  await assertFails(db('admin').doc('usuarios/chofer').delete());
 });
 it('asigna viaje, rechaza saltos/otro conductor y exige archivo al finalizar', async () => {
  const ref = db('admin').doc('viajes/paciente');
  await assertSucceeds(ref.set({viajeId:'v1',choferId:'chofer',choferNombre:'chofer',fecha:'2026-11-19',hora:'15:00',estado:'asignado',asignadoPor:'admin',asignadoEn:'hoy',historial:[hist('asignado','admin')]}));
  const driver = db('chofer').doc('viajes/paciente');
  await assertFails(driver.update({estado:'finalizado',historial:[hist('asignado','admin'),hist('finalizado')]}));
  let h=[hist('asignado','admin')];
  await assertFails(db('segundo').doc('viajes/paciente').update({estado:'conductor_en_camino',historial:[...h,hist('conductor_en_camino','segundo')]}));
  for (const estado of ['conductor_en_camino','conductor_llego','en_viaje']) {h.push(hist(estado));await assertSucceeds(driver.update({estado,historial:h}));}
  h.push(hist('finalizado'));
  await assertFails(driver.update({estado:'finalizado',historial:h}));
  const datos=(await driver.get()).data();
  const batch=db('chofer').batch();batch.update(driver,{estado:'finalizado',historial:h});
  batch.set(db('chofer').doc('historial_viajes/v1'),{...datos,estado:'finalizado',historial:h,origenColeccion:'viajes',origenId:'paciente',pacienteId:'paciente',estadoFinal:'finalizado',conductorNombre:'chofer',archivadoEn:'hoy'});
  await assertSucceeds(batch.commit());
 });
 it('ubicacion idle solo admin/dueno; paciente asignado lee y pierde acceso al cancelar', async () => {
  const {FieldValue}=require('firebase/compat/app').firestore;
  const loc = () => ({lat:-33.45,lng:-70.66,timestamp:Date.now(),actualizadoEn:FieldValue.serverTimestamp(),coleccion:'sesion',id:'chofer',pacienteAutorizado:null,viajeAutorizado:null});
  await assertSucceeds(db('chofer').doc('ubicaciones/chofer').set(loc()));
  await assertFails(db('paciente').doc('ubicaciones/chofer').get());
  await assertFails(db('segundo').doc('ubicaciones/chofer').set(loc()));
  await env.withSecurityRulesDisabled(async ctx => {await ctx.firestore().doc('viajes/paciente').set({viajeId:'v1',choferId:'chofer',estado:'asignado'});});
  await assertSucceeds(db('chofer').doc('ubicaciones/chofer').set({...loc(),coleccion:'viajes',id:'paciente',pacienteAutorizado:'paciente',viajeAutorizado:'v1'}));
  await assertSucceeds(db('paciente').doc('ubicaciones/chofer').get());
  await assertFails(db('otro').doc('ubicaciones/chofer').get());
  await env.withSecurityRulesDisabled(async ctx => {await ctx.firestore().doc('viajes/paciente').update({estado:'cancelado'});});
  await assertFails(db('paciente').doc('ubicaciones/chofer').get());
 });
 it('GPS autentico solo durante el viaje propio; rechaza terceros y timestamps antiguos', async () => {
  await env.withSecurityRulesDisabled(async ctx=>{await ctx.firestore().doc('viajes/paciente').set({viajeId:'v1',choferId:'chofer',estado:'en_viaje'});});
  const resumen={conductorId:'chofer',origenColeccion:'viajes',origenId:'paciente',conteo:1};
  const muestra={lat:-33.45,lng:-70.66,t:Date.now(),fase:'en_viaje',fuente:'gps'};
  const batch=db('chofer').batch();batch.set(db('chofer').doc('gps_viajes/v1'),resumen);batch.set(db('chofer').doc('gps_viajes/v1/muestras/1'),muestra);
  await assertSucceeds(batch.commit());
  await assertFails(db('segundo').doc('gps_viajes/v1/muestras/2').set(muestra));
  await assertFails(db('chofer').doc('gps_viajes/v1/muestras/2').set({...muestra,t:1}));
  await env.withSecurityRulesDisabled(async ctx=>{await ctx.firestore().doc('viajes/paciente').update({estado:'finalizado'});});
  await assertFails(db('chofer').doc('gps_viajes/v1/muestras/2').set(muestra));
 });
});
