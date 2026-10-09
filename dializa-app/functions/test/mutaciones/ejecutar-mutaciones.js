#!/usr/bin/env node
// Verificacion por mutaciones de las pruebas unitarias de functions/.
//
// Que hace: para cada mutacion de la lista, copia functions/ a una carpeta
// temporal, introduce UN error deliberado (reemplazo exacto de texto),
// ejecuta `npm test` en la copia y cuenta cuantas pruebas fallan. El codigo
// original nunca se modifica. Al final ejecuta la suite sobre el codigo
// original para comprobar que sigue pasando.
//
// Uso (desde dializa-app/functions):
//   node test/mutaciones/ejecutar-mutaciones.js > ../../docs/evidencias/mutaciones_AAAA-MM-DD.log
//
// Limites: nueve mutaciones seleccionadas a mano sobre validaciones criticas.
// No mide la cobertura del codigo ni reemplaza las pruebas de reglas o de
// integracion. Funciona en Windows, macOS y Linux (solo requiere Node).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const RAIZ = path.resolve(__dirname, "..", "..");

const MUTACIONES = [
  { id: "M1", archivo: "viajes.js", buscar: "if (!permitidas.includes(nuevoEstado))", reemplazo: "if (false)", descripcion: "Se elimina la validacion de transiciones de estado" },
  { id: "M2", archivo: "viajes.js", buscar: "if (datos[campoConductor(coleccion)] !== uid)", reemplazo: "if (false)", descripcion: "Se elimina la verificacion de que el chofer sea el asignado" },
  { id: "M3", archivo: "viajes.js", buscar: "if (ESTADOS_NO_REASIGNABLES.includes(estadoPrevio))", reemplazo: "if (false)", descripcion: "Se permite reasignar un viaje en curso" },
  { id: "M4", archivo: "historial.js", buscar: "if (ctx.archivoSnap.exists) return false;", reemplazo: "", descripcion: "Se quita la idempotencia del archivo del historial" },
  { id: "M5", archivo: "gps.js", buscar: "if (conteoActual + nuevas.length > GPS_MAX_MUESTRAS_POR_VIAJE)", reemplazo: "if (false)", descripcion: "Se quita el tope de muestras GPS por viaje" },
  { id: "M6", archivo: "validaciones.js", buscar: "if (t < ahoraMs - GPS_ANTIGUEDAD_MAXIMA_MS || t > ahoraMs + GPS_ADELANTO_MAXIMO_MS)", reemplazo: "if (false)", descripcion: "Se quita la ventana de tiempo de las muestras GPS" },
  { id: "M7", archivo: "cuentas.js", buscar: "await auth.revokeRefreshTokens(objetivoUid);", reemplazo: "", descripcion: "Desactivar una cuenta ya no revoca los refresh tokens" },
  { id: "M8", archivo: "cuentas.js", buscar: "if (abiertos.length > 0)", reemplazo: "if (false)", descripcion: "Se permite eliminar un chofer con viajes abiertos" },
  { id: "M9", archivo: "autorizacionUbicacion.js", buscar: "nodo.autorizacionVersion > version", reemplazo: "false", descripcion: "Una reconciliacion tardia puede sobrescribir una mas nueva" },
];

function copiar(origen, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const e of fs.readdirSync(origen, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const o = path.join(origen, e.name);
    const d = path.join(destino, e.name);
    if (e.isDirectory()) copiar(o, d);
    else fs.copyFileSync(o, d);
  }
  const nm = path.join(origen, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(destino, "node_modules"), "junction");
}

function ejecutarPruebas(dir) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["test"], { cwd: dir, encoding: "utf8", env: { ...process.env, TEST_MOSTRAR_ENTORNO: "1" }, shell: process.platform === "win32" });
  const salida = (r.stdout || "") + (r.stderr || "");
  const num = (k) => { const m = salida.match(new RegExp(`^# ${k} (\\d+)`, "m")); return m ? Number(m[1]) : null; };
  const fallidas = [...salida.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1].trim());
  const entorno = (salida.match(/entorno de test: (.*)$/m) || [])[1] || "desconocido";
  return { pasan: num("pass"), fallan: num("fail"), fallidas, entorno };
}

console.log("# Verificacion por mutaciones - Dializa App");
console.log(`# Fecha: ${new Date().toISOString()}`);
console.log(`# Node ${process.version} en ${os.platform()} ${os.release()}`);
console.log("# Comando: node test/mutaciones/ejecutar-mutaciones.js (desde dializa-app/functions)");
console.log("");

let detectadas = 0;
for (const m of MUTACIONES) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `mut-${m.id}-`));
  try {
    copiar(RAIZ, tmp);
    const archivo = path.join(tmp, m.archivo);
    const original = fs.readFileSync(archivo, "utf8");
    if (!original.includes(m.buscar)) {
      console.log(`${m.id} | ${m.archivo} | NO APLICADA: no se encontro el texto a reemplazar | ${m.descripcion}`);
      continue;
    }
    fs.writeFileSync(archivo, original.replace(m.buscar, m.reemplazo));
    const r = ejecutarPruebas(tmp);
    if (r.fallan > 0) detectadas++;
    console.log(`${m.id} | ${m.archivo} | pasan=${r.pasan} fallan=${r.fallan} | ${m.descripcion}`);
    console.log(`     cambio: "${m.buscar}" -> "${m.reemplazo}"`);
    for (const f of r.fallidas) console.log(`     falla: ${f}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const base = ejecutarPruebas(RAIZ);
console.log("");
console.log(`# Mutaciones detectadas: ${detectadas} de ${MUTACIONES.length}`);
console.log(`# Codigo original: pasan=${base.pasan} fallan=${base.fallan}`);
console.log(`# Entorno de las pruebas: ${base.entorno}`);
