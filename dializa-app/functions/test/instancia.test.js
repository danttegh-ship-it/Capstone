const test = require("node:test");
const assert = require("node:assert/strict");
const { montar, sembrarUsuarios, UID } = require("./helpers/montaje");
const { peticion } = require("./helpers/memoria");
const call = (f, data, uid = UID.chofer, rol = "chofer") => f.run(peticion(uid, rol, data));
test("H01: orden y GPS pendientes no afectan una nueva asignacion del mismo chofer", async () => {
 const e = montar(); await sembrarUsuarios(e.db,e.auth);
 const datos = {pacienteId:UID.paciente,choferId:UID.chofer,fecha:"2026-10-26",hora:"12:00"};
 const a = await call(e.viajes.asignarViaje,datos,UID.admin,"admin");
 const b = await call(e.viajes.asignarViaje,datos,UID.admin,"admin");
 const vieja = {coleccion:"viajes",id:UID.paciente,viajeId:a.viajeId,estadoEsperado:"asignado"};
 await assert.rejects(call(e.viajes.cancelarAsignacionConductor,vieja),{code:"failed-precondition"});
 await call(e.viajes.actualizarEstadoViaje,{...vieja,viajeId:b.viajeId,nuevoEstado:"conductor_en_camino"});
 await assert.rejects(call(e.gps.registrarMuestrasGps,{...vieja,muestras:[{lat:-33,lng:-70,timestampMs:Date.now()}]}),{code:"failed-precondition"});
 assert.equal((await e.db.doc(`viajes/${UID.paciente}`).get()).data().estado,"conductor_en_camino");
 assert.equal((await e.db.collection("gps_viajes").get()).size,0);
});
test("H01: instancia ausente y estado esperado obsoleto son rechazados", async () => {
 const e=montar();await sembrarUsuarios(e.db,e.auth);
 await e.db.doc(`viajes/${UID.paciente}`).set({viajeId:"instancia_0001",choferId:UID.chofer,estado:"asignado"});
 const data={coleccion:"viajes",id:UID.paciente,nuevoEstado:"conductor_en_camino"};
 await assert.rejects(call(e.viajes.actualizarEstadoViaje,data),{code:"invalid-argument"});
 await assert.rejects(call(e.viajes.actualizarEstadoViaje,{...data,viajeId:"instancia_0001",estadoEsperado:"en_viaje"}),{code:"failed-precondition"});
});
