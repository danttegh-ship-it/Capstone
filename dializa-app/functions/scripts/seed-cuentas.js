#!/usr/bin/env node
// SEED PRIVADO de cuentas de ejemplo (Admin SDK). Se ejecuta a mano desde
// una maquina de confianza; NO se despliega (ver `ignore` en firebase.json)
// ni se expone como Cloud Function.
//
// Uso (desde la carpeta functions/):
//   # 1. Simulacion (por defecto: no escribe nada)
//   node scripts/seed-cuentas.js --project dializa-app
//
//   # 2. Crear de verdad
//   SEED_PASSWORD='<contrasena-que-elijas>' \
//   GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/cuenta-de-servicio.json \
//   node scripts/seed-cuentas.js --project dializa-app --confirmar
//
//   # 3. Contra el Emulator Suite (sin credenciales reales)
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//   SEED_PASSWORD='<contrasena>' node scripts/seed-cuentas.js --project dializa-app --emulador --confirmar
//
// Opciones:
//   --project <id>                 OBLIGATORIO. Debe coincidir con el proyecto
//                                  por defecto de .firebaserc (proteccion contra
//                                  correrlo en el proyecto equivocado).
//   --confirmar                    sin esto solo se muestra el plan.
//   --emulador                     exige variables *_EMULATOR_HOST y no usa
//                                  credenciales reales.
//   --cuentas a@x.cl,b@x.cl        reemplaza la lista por defecto.
//   --aprobar-conductores-de-prueba  los conductores NUEVOS nacen aprobados.
//                                  Sin esta opcion nacen aprobado:false y un
//                                  admin los aprueba en la pantalla Conductores.
//
// Garantias: solo CREA cuentas nuevas; si el correo ya existe en Auth no se
// toca (ni rol, ni claim, ni perfil, ni contrasena). Nunca imprime la
// contrasena ni credenciales.

const fs = require("fs");
const path = require("path");
const { CUENTAS_POR_DEFECTO, planificar, ejecutarPlan, normalizarEmail } = require("./seed-lib");

function argumentos(argv) {
  const out = { confirmar: false, emulador: false, aprobar: false, project: null, cuentas: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--confirmar") out.confirmar = true;
    else if (a === "--emulador") out.emulador = true;
    else if (a === "--aprobar-conductores-de-prueba") out.aprobar = true;
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--cuentas") out.cuentas = String(argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean);
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  return out;
}

function proyectoPorDefecto() {
  const ruta = path.join(__dirname, "..", "..", ".firebaserc");
  return JSON.parse(fs.readFileSync(ruta, "utf8")).projects.default;
}

async function main() {
  const args = argumentos(process.argv.slice(2));
  const esperado = proyectoPorDefecto();

  if (!args.project) throw new Error("Falta --project <id>.");
  if (args.project !== esperado) {
    throw new Error(`--project '${args.project}' no coincide con el proyecto de .firebaserc ('${esperado}'). Abortado.`);
  }
  for (const v of ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"]) {
    if (process.env[v] && process.env[v] !== esperado) {
      throw new Error(`La variable ${v} apunta a otro proyecto. Abortado.`);
    }
  }
  if (args.emulador) {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("--emulador exige FIREBASE_AUTH_EMULATOR_HOST y FIRESTORE_EMULATOR_HOST.");
    }
  } else if (args.confirmar && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Falta GOOGLE_APPLICATION_CREDENTIALS (cuenta de servicio del proyecto) para escribir en el proyecto real.");
  }
  if (args.confirmar && !process.env.SEED_PASSWORD) {
    throw new Error("Falta la variable de entorno SEED_PASSWORD.");
  }

  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: esperado });
  const auth = admin.auth();
  const db = admin.firestore();

  const emails = (args.cuentas || CUENTAS_POR_DEFECTO).map(normalizarEmail);
  const existentes = new Set();
  for (const email of emails) {
    try {
      await auth.getUserByEmail(email);
      existentes.add(email);
    } catch (error) {
      if (!error || error.code !== "auth/user-not-found") throw error;
    }
  }

  const plan = planificar(emails, existentes);
  console.log(`Proyecto: ${esperado}${args.emulador ? " (emulador)" : ""}`);
  console.log(args.confirmar ? "Modo: ESCRITURA" : "Modo: simulacion (agrega --confirmar para escribir)");
  for (const p of plan) console.log(`  ${p.accion.padEnd(16)} ${String(p.email)}${p.rol ? `  -> ${p.rol}` : ""}`);

  if (!args.confirmar) return;

  const resultados = await ejecutarPlan({ auth, db, plan, password: process.env.SEED_PASSWORD, aprobarConductores: args.aprobar });
  console.log("\nResultado:");
  for (const r of resultados) console.log(`  ${r.resultado.padEnd(18)} ${r.email}${r.rol ? `  (${r.rol})` : ""}${r.detalle ? `  ${r.detalle}` : ""}`);
  if (resultados.some((r) => r.resultado === "error")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
