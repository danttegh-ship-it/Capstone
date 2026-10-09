// Dobles EN MEMORIA de Firestore, Realtime Database y Auth para tests
// unitarios. Imitan SOLO lo que usan las Cloud Functions de dializa-app.
//
// Firestore: las transacciones usan concurrencia OPTIMISTA como la real:
// cada documento tiene una version; al confirmar, si algun documento leido
// cambio, se reintenta el callback completo. Tambien se exige "todas las
// lecturas antes de las escrituras" (error si no).
// Limitaciones (no emulan): indices, limites de tamano, reglas de seguridad,
// latencia, `FieldValue`, rutas con puntos en update(). Por eso hay ademas
// tests de reglas pensados para el Emulator Suite (tests/*.rules.test.js).

require("./entorno");
const { HttpsError } = require("firebase-functions/v2/https");

const clonar = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const cede = () => new Promise((r) => setImmediate(r));

let contadorId = 0;
function idAuto() {
  contadorId += 1;
  return `auto${String(contadorId).padStart(6, "0")}${"x".repeat(8)}`;
}

class FakeFirestore {
  constructor() {
    this.docs = new Map(); // ruta -> datos
    this.versiones = new Map(); // ruta -> n (persiste tras borrar)
    this.fallarEscrituraEn = null; // ruta que provoca error (tests de fallo)
  }
  _v(ruta) {
    return this.versiones.get(ruta) || 0;
  }
  _escribir(ruta, datos) {
    if (this.fallarEscrituraEn && ruta.startsWith(this.fallarEscrituraEn)) throw new Error(`fallo simulado escribiendo ${ruta}`);
    if (datos === null) this.docs.delete(ruta);
    else this.docs.set(ruta, clonar(datos));
    this.versiones.set(ruta, this._v(ruta) + 1);
  }
  collection(nombre) {
    return new FakeCollection(this, nombre);
  }
  doc(ruta) {
    const partes = ruta.split("/");
    return new FakeDocRef(this, ruta, partes[partes.length - 1]);
  }
  batch() {
    const ops = [];
    const db = this;
    return {
      set(ref, datos, opts) { ops.push(() => ref._set(datos, opts)); return this; },
      update(ref, datos) { ops.push(() => ref._update(datos)); return this; },
      delete(ref) { ops.push(() => ref._delete()); return this; },
      async commit() { for (const op of ops) op(); },
    };
  }
  async runTransaction(fn, { maxIntentos = 10 } = {}) {
    for (let intento = 0; intento < maxIntentos; intento++) {
      const lecturas = new Map();
      const escrituras = [];
      const tx = {
        async get(ref) {
          if (escrituras.length > 0) throw new Error("Firestore: las lecturas deben ir antes de las escrituras en una transaccion.");
          await cede();
          lecturas.set(ref.path, ref.db._v(ref.path));
          return ref._snap();
        },
        set(ref, datos, opts) { escrituras.push({ ref, tipo: "set", datos: clonar(datos), opts }); return tx; },
        update(ref, datos) { escrituras.push({ ref, tipo: "update", datos: clonar(datos) }); return tx; },
        delete(ref) { escrituras.push({ ref, tipo: "delete" }); return tx; },
      };
      const resultado = await fn(tx);
      await cede();
      const conflicto = [...lecturas].some(([ruta, v]) => this._v(ruta) !== v);
      if (conflicto) continue;
      // Validacion previa (update sobre inexistente) y aplicacion atomica.
      for (const e of escrituras) {
        if (e.tipo === "update" && !this.docs.has(e.ref.path)) throw new Error(`NOT_FOUND: no existe ${e.ref.path}`);
      }
      for (const e of escrituras) {
        if (e.tipo === "set") e.ref._set(e.datos, e.opts);
        else if (e.tipo === "update") e.ref._update(e.datos);
        else e.ref._delete();
      }
      return resultado;
    }
    throw new Error("Transaccion: demasiados reintentos por conflicto.");
  }
}

class FakeCollection {
  constructor(db, ruta) {
    this.db = db;
    this.ruta = ruta;
    this.filtros = [];
  }
  doc(id) {
    const real = id || idAuto();
    return new FakeDocRef(this.db, `${this.ruta}/${real}`, real);
  }
  async add(datos) {
    const ref = this.doc();
    await ref.set(datos);
    return ref;
  }
  where(campo, op, valor) {
    const c = new FakeCollection(this.db, this.ruta);
    c.filtros = [...this.filtros, { campo, op, valor }];
    return c;
  }
  async get() {
    const prefijo = `${this.ruta}/`;
    const docs = [];
    for (const [ruta, datos] of this.db.docs) {
      if (!ruta.startsWith(prefijo) || ruta.slice(prefijo.length).includes("/")) continue;
      const cumple = this.filtros.every(({ campo, op, valor }) => {
        const v = datos[campo];
        if (op === "==") return v === valor;
        if (op === "in") return valor.includes(v);
        if (op === "!=") return v !== valor;
        throw new Error(`operador no soportado por el doble: ${op}`);
      });
      if (cumple) docs.push(new FakeDocRef(this.db, ruta, ruta.slice(prefijo.length))._snap());
    }
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeDocRef {
  constructor(db, path, id) {
    this.db = db;
    this.path = path;
    this.id = id;
  }
  collection(nombre) {
    return new FakeCollection(this.db, `${this.path}/${nombre}`);
  }
  _snap() {
    const existe = this.db.docs.has(this.path);
    const datos = existe ? clonar(this.db.docs.get(this.path)) : undefined;
    return { id: this.id, ref: this, exists: existe, data: () => clonar(datos) };
  }
  async get() { await cede(); return this._snap(); }
  _set(datos, opts) {
    if (opts && opts.merge && this.db.docs.has(this.path)) this.db._escribir(this.path, { ...this.db.docs.get(this.path), ...clonar(datos) });
    else this.db._escribir(this.path, datos);
  }
  _update(datos) {
    if (!this.db.docs.has(this.path)) throw new Error(`NOT_FOUND: no existe ${this.path}`);
    this.db._escribir(this.path, { ...this.db.docs.get(this.path), ...clonar(datos) });
  }
  _delete() { this.db._escribir(this.path, null); }
  async set(datos, opts) { await cede(); this._set(datos, opts); }
  async update(datos) { await cede(); this._update(datos); }
  async delete() { await cede(); this._delete(); }
}

// --- Realtime Database ------------------------------------------------------

class FakeRtdb {
  constructor() {
    this.arbol = {};
    this.fallar = false; // simula caida de RTDB
  }
  ref(ruta) { return new FakeRtdbRef(this, ruta); }
  _partes(ruta) { return ruta.split("/").filter(Boolean); }
  _leer(ruta) {
    let n = this.arbol;
    for (const p of this._partes(ruta)) { if (n === undefined || n === null || typeof n !== "object") return null; n = n[p]; }
    return n === undefined ? null : clonar(n);
  }
  _escribir(ruta, valor) {
    const ps = this._partes(ruta);
    let n = this.arbol;
    ps.slice(0, -1).forEach((p) => { if (typeof n[p] !== "object" || n[p] === null) n[p] = {}; n = n[p]; });
    if (valor === null || valor === undefined) delete n[ps[ps.length - 1]];
    else n[ps[ps.length - 1]] = clonar(valor);
  }
}

class FakeRtdbRef {
  constructor(rtdb, ruta) { this.rtdb = rtdb; this.ruta = ruta; }
  _chequeo() { if (this.rtdb.fallar) throw new Error("RTDB no disponible (simulado)"); }
  async get() { this._chequeo(); await cede(); const v = this.rtdb._leer(this.ruta); return { val: () => v, exists: () => v !== null }; }
  async set(valor) { this._chequeo(); await cede(); this.rtdb._escribir(this.ruta, valor); }
  // update(): fusiona SOLO las claves dadas (no borra las demas), como el real.
  async update(valores) {
    this._chequeo(); await cede();
    for (const [k, v] of Object.entries(valores)) this.rtdb._escribir(`${this.ruta}/${k}`, v);
  }
  async transaction(fn) {
    this._chequeo();
    await cede();
    const actual = this.rtdb._leer(this.ruta);
    const nuevo = fn(actual);
    if (nuevo === undefined) return { committed: false, snapshot: { val: () => actual } };
    this.rtdb._escribir(this.ruta, nuevo);
    return { committed: true, snapshot: { val: () => nuevo } };
  }
}

// --- Auth ----------------------------------------------------------------------

class FakeAuth {
  constructor() {
    this.usuarios = new Map(); // uid -> {uid,email,disabled,claims,tokensRevocados}
    this.llamadas = [];
  }
  _noExiste() { const e = new Error("There is no user record."); e.code = "auth/user-not-found"; return e; }
  agregar({ uid, email, disabled = false, claims = {} }) { this.usuarios.set(uid, { uid, email, disabled, claims, tokensRevocados: 0 }); return this.usuarios.get(uid); }
  async getUserByEmail(email) {
    const u = [...this.usuarios.values()].find((x) => x.email === String(email).toLowerCase());
    if (!u) throw this._noExiste();
    return { ...u };
  }
  async createUser({ email, password, displayName, emailVerified }) {
    if ([...this.usuarios.values()].some((x) => x.email === email)) { const e = new Error("exists"); e.code = "auth/email-already-exists"; throw e; }
    const uid = `uid_${email.replace(/[^a-z0-9]/gi, "")}_${this.usuarios.size}`.padEnd(12, "0");
    this.llamadas.push({ metodo: "createUser", email, tienePassword: Boolean(password) });
    return this.agregar({ uid, email, claims: {} }) && { uid };
  }
  async updateUser(uid, cambios) {
    const u = this.usuarios.get(uid); if (!u) throw this._noExiste();
    Object.assign(u, cambios.disabled !== undefined ? { disabled: cambios.disabled } : {});
    this.llamadas.push({ metodo: "updateUser", uid, cambios });
    return { ...u };
  }
  async setCustomUserClaims(uid, claims) { const u = this.usuarios.get(uid); if (!u) throw this._noExiste(); u.claims = { ...claims }; this.llamadas.push({ metodo: "setCustomUserClaims", uid, claims }); }
  async revokeRefreshTokens(uid) { const u = this.usuarios.get(uid); if (!u) throw this._noExiste(); u.tokensRevocados += 1; this.llamadas.push({ metodo: "revokeRefreshTokens", uid }); }
  async deleteUser(uid) { if (!this.usuarios.delete(uid)) throw this._noExiste(); this.llamadas.push({ metodo: "deleteUser", uid }); }
}

// --- Helpers de test --------------------------------------------------------------------

/** Construye un `request` de callable. */
function peticion(uid, rol, data) {
  return { auth: uid ? { uid, token: rol ? { rol } : {} } : null, data };
}

/** Atrapa el error de una promesa y lo devuelve (o null si no fallo). */
async function error(promesa) {
  try { await promesa; return null; } catch (e) { return e; }
}

module.exports = { FakeFirestore, FakeRtdb, FakeAuth, peticion, error, HttpsError, clonar };
