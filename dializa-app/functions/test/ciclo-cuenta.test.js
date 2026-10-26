const test=require('node:test');const assert=require('node:assert/strict');
const {montar,sembrarUsuarios,UID}=require('./helpers/montaje');const {peticion}=require('./helpers/memoria');
const call=(f,u,r,d)=>f.run(peticion(u,r,d));
async function env(){const e=montar();await sembrarUsuarios(e.db,e.auth);return e;}
test('H03: registro y aprobacion no reactivan cuentas deshabilitadas',async()=>{
 const e=await env();await e.db.doc(`usuarios/${UID.chofer}`).update({aprobado:false});
 await call(e.cuentas.activarDesactivarCuenta,UID.admin,'admin',{uid:UID.chofer,activo:false});
 await assert.rejects(call(e.cuentas.solicitarRegistroConductor,UID.chofer,'chofer',{patente:'AB1234',licencia:'12345678',telefono:'+56912345678'}),{code:'permission-denied'});
 await assert.rejects(call(e.cuentas.aprobarConductor,UID.admin,'admin',{uid:UID.chofer}),{code:'failed-precondition'});
 assert.equal((await e.db.doc(`usuarios/${UID.chofer}`).get()).data().activo,false);
 assert.equal(e.auth.usuarios.get(UID.chofer).disabled,true);
});
test('H04: desactivacion cruzada conserva al menos un admin operativo',async()=>{
 const e=await env();const r=await Promise.allSettled([
 call(e.cuentas.activarDesactivarCuenta,UID.admin,'admin',{uid:UID.admin2,activo:false}),
 call(e.cuentas.activarDesactivarCuenta,UID.admin2,'admin',{uid:UID.admin,activo:false})]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(await e.cuentas.contarAdministradoresActivos(),1);
});
test('H04: bajas cruzadas conservan un administrador',async()=>{
 const e=await env();const r=await Promise.allSettled([
 call(e.cuentas.eliminarCuenta,UID.admin,'admin',{uid:UID.admin2}),call(e.cuentas.eliminarCuenta,UID.admin2,'admin',{uid:UID.admin})]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(await e.cuentas.contarAdministradoresActivos(),1);
});
test('H06: baja generica de paciente archiva y revoca como baja especifica',async()=>{
 const e=await env();await e.db.doc(`viajes/${UID.paciente}`).set({viajeId:'instancia_baja_01',estado:'conductor_en_camino',choferId:UID.chofer,historial:[]});
 await e.autorizacion.reconciliar(UID.chofer);
 await call(e.cuentas.eliminarCuenta,UID.admin,'admin',{uid:UID.paciente});
 const a=(await e.db.doc('historial_viajes/instancia_baja_01').get()).data();
 assert.equal(a.estadoFinal,'cancelado');assert.equal(a.pacienteNombre,'Paciente Uno');
 assert.equal((await e.db.doc(`viajes/${UID.paciente}`).get()).exists,false);
 assert.equal(e.rtdb._leer(`ubicaciones/${UID.chofer}/pacienteAutorizado`),null);
 assert.equal(e.auth.usuarios.has(UID.paciente),false);
});
for(const endpoint of ['eliminarCuenta','eliminarPaciente'])for(const coleccion of ['viajes','solicitudes'])test(`H07: ${endpoint} rechaza baja en_viaje ${coleccion} sin mutar`,async()=>{
 const e=await env();const id=coleccion==='viajes'?UID.paciente:'sol_en_viaje_001';
 await e.db.doc(`${coleccion}/${id}`).set({viajeId:'instancia_activa_01',pacienteId:UID.paciente,conductorId:UID.chofer,choferId:UID.chofer,estado:'en_viaje',historial:[]});
 await assert.rejects(call(e.cuentas[endpoint],UID.admin,'admin',{uid:UID.paciente}),{code:'failed-precondition'});
 assert.equal((await e.db.doc(`${coleccion}/${id}`).get()).data().estado,'en_viaje');assert.equal((await e.db.doc(`usuarios/${UID.paciente}`).get()).data().activo,true);
 assert.equal((await e.db.collection('historial_viajes').get()).size,0);
});
test('H06/H07: fallo parcial de Auth deja baja bloqueada y reintentable',async()=>{
 const e=await env();const original=e.auth.deleteUser.bind(e.auth);e.auth.deleteUser=async()=>{throw Error('Auth temporalmente caido');};
 await assert.rejects(call(e.cuentas.eliminarCuenta,UID.admin,'admin',{uid:UID.paciente}));
 const perfil=(await e.db.doc(`usuarios/${UID.paciente}`).get()).data();assert.equal(perfil.bajaEnCurso,true);assert.equal(perfil.activo,false);
 await assert.rejects(call(e.viajes.asignarViaje,UID.admin,'admin',{pacienteId:UID.paciente,choferId:UID.chofer,fecha:'2026-10-26',hora:'12:00'}),{code:'failed-precondition'});
 e.auth.deleteUser=original;await call(e.cuentas.eliminarCuenta,UID.admin,'admin',{uid:UID.paciente});
 assert.equal((await e.db.doc(`usuarios/${UID.paciente}`).get()).exists,false);
});
