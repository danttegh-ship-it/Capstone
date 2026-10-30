// Migracion privada previa a reglas H10. Simula salvo --confirmar.
// Nunca registra tokens ni claves; usar solo en el proyecto identificado.
const { randomUUID } = require("node:crypto");
async function main() {
  const args = process.argv.slice(2),
    proyecto = args[args.indexOf("--project") + 1];
  if (!args.includes("--project") || !proyecto || proyecto.startsWith("--"))
    throw Error("Falta --project <id>");
  const confirmar = args.includes("--confirmar");
  const fs = require("node:fs"),
    path = require("node:path");
  const esperado = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../.firebaserc"), "utf8"),
  ).projects.default;
  if (
    proyecto !== esperado &&
    !(
      proyecto.startsWith("demo-") &&
      process.env.FIRESTORE_EMULATOR_HOST &&
      process.env.FIREBASE_DATABASE_EMULATOR_HOST
    )
  )
    throw Error("Proyecto no autorizado por .firebaserc ni emulador demo.");
  if (confirmar && !process.env.FIREBASE_DATABASE_URL)
    throw Error("FIREBASE_DATABASE_URL es obligatoria antes de escribir.");
  const admin = require("firebase-admin");
  admin.initializeApp({
    projectId: proyecto,
    ...(process.env.FIREBASE_DATABASE_URL
      ? { databaseURL: process.env.FIREBASE_DATABASE_URL }
      : {}),
  });
  const db = admin.firestore(),
    fcm = require("../fcm").init(db),
    authz = require("../autorizacionUbicacion").init(db, () =>
      admin.database(),
    );
  const usuarios = await db.collection("usuarios").get();
  console.log(
    `Proyecto ${proyecto}: ${usuarios.size} perfiles; ${confirmar ? "ESCRITURA" : "SIMULACION"}`,
  );
  if (!confirmar) return;
  for (const doc of usuarios.docs) {
    const datos = doc.data();
    if (
      datos.fcmToken &&
      require("../operacionesCuenta").perfilOperativo(datos)
    )
      await fcm.registrarTokenFcm.run({
        auth: { uid: doc.id },
        data: { sesionId: `migracion_${randomUUID()}`, token: datos.fcmToken },
      });
    // Transaccion separada tambien elimina tokens de cuentas inactivas.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      if (!snap.exists) return;
      const perfil = { ...snap.data() };
      delete perfil.fcmToken;
      tx.set(doc.ref, perfil);
    });
    await authz.sincronizarCuenta(doc.id);
  }
  console.log(
    "Migracion completada; no se modificaron roles ni se activaron cuentas.",
  );
}
function describirErrorSeguro(error) {
  const codigo = /^[a-zA-Z0-9_./-]{1,80}$/.test(String(error?.code || "error"))
    ? String(error?.code || "error")
    : "error";
  let mensaje = String(error?.message || "Error sin mensaje");
  for (const [nombre, valor] of Object.entries(process.env)) {
    if (
      /TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL|API_KEY/i.test(nombre) &&
      valor?.length >= 8
    )
      mensaje = mensaje.split(valor).join("[OCULTO]");
  }
  mensaje = mensaje
    .replace(
      /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
      "[CLAVE OCULTA]",
    )
    .replace(/Bearer\s+[a-zA-Z0-9._~+/-]+/gi, "Bearer [OCULTO]")
    .replace(
      /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
      "[TOKEN OCULTO]",
    )
    .replace(
      /(token|api[_-]?key|password|secret|authorization|private_key)(["']?\s*[:=]\s*["']?)[^"'&\s,;]+/gi,
      "$1$2[OCULTO]",
    )
    .replace(/https?:\/\/[^\s"']+/gi, (valor) => {
      try {
        const url = new URL(valor);
        if (url.username || url.password) {
          url.username = "OCULTO";
          url.password = "OCULTO";
        }
        if (url.search) url.search = "?parametros=OCULTOS";
        return url.toString();
      } catch {
        return "[URL OCULTA]";
      }
    });
  return `${codigo}: ${mensaje.slice(0, 500)}`;
}
if (require.main === module)
  main().catch((error) => {
    console.error("Migracion no completada:", describirErrorSeguro(error));
    process.exitCode = 1;
  });
module.exports = { main, describirErrorSeguro };
