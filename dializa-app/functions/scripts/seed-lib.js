// Logica PURA y testeable del seed de cuentas (sin firebase-functions, sin
// red). El script real (seed-cuentas.js) solo la conecta al Admin SDK.
//
// REGLA DE ROL POR PREFIJO: se aplica UNICAMENTE aqui, al CREAR una cuenta
// nueva desde este script privado:
//     admin.*      -> admin
//     conductor.*  -> chofer
//     cualquier otro -> paciente
// Despues de creada, el rol vive en Firestore (usuarios/{uid}.rol) y en el
// custom claim `rol`. El login y las Cloud Functions leen ESO, nunca el
// correo. No existe endpoint publico que otorgue admin por prefijo.

const CUENTAS_POR_DEFECTO = ["admin.ejemplo@gmail.com", "conductor.ejemplo@gmail.com"];

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function rolPorPrefijo(email) {
  const local = normalizarEmail(email).split("@")[0] || "";
  if (local.startsWith("admin.")) return "admin";
  if (local.startsWith("conductor.")) return "chofer";
  return "paciente";
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordValida(password) {
  return typeof password === "string" && password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

function nombreDesdeEmail(email) {
  const local = normalizarEmail(email).split("@")[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Plan puro: que se haria con cada correo dado el conjunto de correos que
 * YA existen en Auth. Nunca planifica cambios sobre cuentas existentes.
 * @param {string[]} emails
 * @param {Set<string>} existentes correos (minusculas) ya presentes
 */
function planificar(emails, existentes) {
  const vistos = new Set();
  const plan = [];
  for (const crudo of emails) {
    const email = normalizarEmail(crudo);
    if (!emailValido(email)) {
      plan.push({ email: crudo, accion: "invalido" });
      continue;
    }
    if (vistos.has(email)) continue;
    vistos.add(email);
    if (existentes.has(email)) {
      plan.push({ email, accion: "omitir_existente", rol: null });
    } else {
      plan.push({ email, accion: "crear", rol: rolPorPrefijo(email) });
    }
  }
  return plan;
}

/**
 * Ejecuta el plan. `auth` y `db` son el Admin SDK (o dobles en tests).
 * NO escribe nada para `omitir_existente` ni `invalido`. Si falla la
 * escritura de Firestore tras crear el usuario en Auth, se deshace (borra
 * ese usuario recien creado) para no dejar cuentas sin perfil.
 * Nunca registra ni devuelve la contrasena.
 */
async function ejecutarPlan({ auth, db, plan, password, aprobarConductores = false, ahora = () => new Date().toISOString() }) {
  if (!passwordValida(password)) {
    throw new Error("SEED_PASSWORD invalida: minimo 8 caracteres con al menos una letra y un numero.");
  }
  const resultados = [];
  for (const item of plan) {
    if (item.accion !== "crear") {
      resultados.push({ email: item.email, rol: item.rol || null, resultado: item.accion });
      continue;
    }
    const nombre = nombreDesdeEmail(item.email);
    let uid = null;
    try {
      const usuario = await auth.createUser({ email: item.email, password, displayName: nombre, emailVerified: false });
      uid = usuario.uid;
      await auth.setCustomUserClaims(uid, { rol: item.rol });

      const perfil = { rol: item.rol, nombre, activo: true, creadoEn: ahora(), origen: "seed" };
      if (item.rol === "chofer") perfil.aprobado = aprobarConductores === true;
      await db.collection("usuarios").doc(uid).set(perfil);
      if (item.rol === "chofer") {
        await db.collection("choferes_privado").doc(uid).set({ disponible: false }, { merge: true });
      }
      resultados.push({ email: item.email, rol: item.rol, resultado: "creada", aprobado: item.rol === "chofer" ? perfil.aprobado : undefined });
    } catch (error) {
      if (uid) await auth.deleteUser(uid).catch(() => {});
      resultados.push({ email: item.email, rol: item.rol, resultado: "error", detalle: String(error && error.message ? error.message : error) });
    }
  }
  return resultados;
}

module.exports = {
  CUENTAS_POR_DEFECTO,
  rolPorPrefijo,
  planificar,
  ejecutarPlan,
  normalizarEmail,
  passwordValida,
  nombreDesdeEmail,
};
