// Tests UNITARIOS de los validadores agregados en la Fase 1.
const test = require("node:test");
const assert = require("node:assert/strict");
require("./helpers/entorno");
const v = require("../validaciones");

const lanza = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

test("validarFecha: calendario real YYYY-MM-DD", () => {
  assert.equal(v.validarFecha("2026-10-07"), "2026-10-07");
  assert.equal(v.validarFecha("2028-02-29"), "2028-02-29");
  for (const malo of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-10-7", "07-10-2026", "", null, 20261007]) {
    assert.equal(lanza(() => v.validarFecha(malo)), "invalid-argument", String(malo));
  }
});

test("validarHora: HH:mm 24h", () => {
  assert.equal(v.validarHora("00:00"), "00:00");
  assert.equal(v.validarHora("23:59"), "23:59");
  for (const malo of ["24:00", "9:30", "12:60", "12:5", "ab:cd", "", null]) {
    assert.equal(lanza(() => v.validarHora(malo)), "invalid-argument", String(malo));
  }
});

test("validarMuestrasGps: ordena, deduplica por timestamp y rechaza lotes invalidos completos", () => {
  const ahora = 1_800_000_000_000;
  const ok = v.validarMuestrasGps([
    { lat: -33, lng: -70, timestampMs: ahora - 1000 },
    { lat: -33.1, lng: -70.1, timestampMs: ahora - 3000 },
    { lat: -33, lng: -70, timestampMs: ahora - 1000 },
  ], ahora);
  assert.deepEqual(ok.map((m) => m.t), [ahora - 3000, ahora - 1000]);
  assert.equal(lanza(() => v.validarMuestrasGps([{ lat: -33, lng: -70, timestampMs: ahora - 16 * 60000 }], ahora)), "invalid-argument");
  assert.equal(lanza(() => v.validarMuestrasGps([{ lat: -33, lng: -70, timestampMs: ahora + 61000 }], ahora)), "invalid-argument");
  assert.equal(lanza(() => v.validarMuestrasGps([{ lat: -33, lng: -70, timestampMs: ahora + 59000 }], ahora)), null);
  assert.equal(lanza(() => v.validarMuestrasGps([{ lat: 100, lng: -70, timestampMs: ahora }], ahora)), "invalid-argument");
  assert.equal(lanza(() => v.validarMuestrasGps([], ahora)), "invalid-argument");
  assert.equal(lanza(() => v.validarMuestrasGps(Array.from({ length: 51 }, (_, i) => ({ lat: 0, lng: 0, timestampMs: ahora - i })), ahora)), "invalid-argument");
});

test("validarPuntoViaje / validarNecesidades / validarTextoOpcional", () => {
  assert.deepEqual(v.validarPuntoViaje({ lat: -33, lng: -70, direccion: " Calle " }, "origen"), { lat: -33, lng: -70, direccion: "Calle" });
  assert.deepEqual(v.validarPuntoViaje({ lat: -33, lng: -70 }, "origen"), { lat: -33, lng: -70, direccion: null });
  assert.equal(lanza(() => v.validarPuntoViaje(null, "origen")), "invalid-argument");
  assert.equal(lanza(() => v.validarPuntoViaje({ lat: -33, lng: -70, direccion: 5 }, "origen")), "invalid-argument");
  assert.deepEqual(v.validarNecesidades(undefined), { sillaRuedas: false, acompanante: false, observaciones: null, contactoEmergencia: null });
  assert.equal(v.validarNecesidades({ sillaRuedas: true }).sillaRuedas, true);
  assert.equal(v.validarNecesidades({ sillaRuedas: "true" }).sillaRuedas, false, "solo booleano estricto");
  assert.equal(lanza(() => v.validarNecesidades("texto")), "invalid-argument");
  assert.equal(v.validarTextoOpcional("  hola ", 10, "x"), "hola");
  assert.equal(v.validarTextoOpcional("", 10, "x"), null);
  assert.equal(lanza(() => v.validarTextoOpcional("a".repeat(11), 10, "x")), "invalid-argument");
});

test("el flag RESTRICCION_GEOGRAFICA_CHILE_ACTIVA (apagado por defecto) tambien rige origen/destino y GPS", () => {
  const config = require("../config");
  const ahora = Date.now();
  const fuera = { lat: 40.4, lng: -3.7 }; // Madrid
  assert.equal(config.RESTRICCION_GEOGRAFICA_CHILE_ACTIVA, false);
  assert.equal(lanza(() => v.validarPuntoViaje(fuera, "origen")), null);
  try {
    config.RESTRICCION_GEOGRAFICA_CHILE_ACTIVA = true;
    assert.equal(lanza(() => v.validarPuntoViaje(fuera, "origen")), "invalid-argument");
    assert.equal(lanza(() => v.validarMuestrasGps([{ ...fuera, timestampMs: ahora }], ahora)), "invalid-argument");
    assert.equal(lanza(() => v.validarPuntoViaje({ lat: -33.45, lng: -70.66 }, "origen")), null);
  } finally {
    config.RESTRICCION_GEOGRAFICA_CHILE_ACTIVA = false;
  }
});
