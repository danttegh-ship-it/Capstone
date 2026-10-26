// Validaciones server-side para las Cloud Functions de dializa-app.
//
// Version ampliada: puerto completo de daily-app/firebase/functions/validaciones.js,
// adaptado a los nombres de campos que usa dializa-app. Todo dato que llega
// del cliente se valida aqui antes de tocar Firestore o gastar cuota de una
// API externa.

const { HttpsError } = require("firebase-functions/v2/https");
const config = require("./config");

function requerido(valor, nombreCampo) {
  if (valor === undefined || valor === null || valor === "") {
    throw new HttpsError("invalid-argument", `El campo '${nombreCampo}' es obligatorio.`);
  }
}

function longitudMaxima(valor, maximo, nombreCampo) {
  if (typeof valor === "string" && valor.length > maximo) {
    throw new HttpsError("invalid-argument", `El campo '${nombreCampo}' supera los ${maximo} caracteres.`);
  }
}

function validarUid(uid) {
  requerido(uid, "uid");
  if (typeof uid !== "string" || uid.length < 10 || uid.length > 128) {
    throw new HttpsError("invalid-argument", "uid invalido.");
  }
  return uid;
}

function validarEmail(email) {
  requerido(email, "email");
  const patron = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof email !== "string" || !patron.test(email)) {
    throw new HttpsError("invalid-argument", "Correo electronico invalido.");
  }
  return email.trim().toLowerCase();
}

function validarPassword(password) {
  requerido(password, "password");
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpsError("invalid-argument", "La contrasena debe tener al menos 8 caracteres.");
  }
  const tieneLetra = /[a-zA-Z]/.test(password);
  const tieneNumero = /[0-9]/.test(password);
  if (!tieneLetra || !tieneNumero) {
    throw new HttpsError("invalid-argument", "La contrasena debe incluir al menos una letra y un numero.");
  }
  return password;
}

function validarNombre(nombre) {
  requerido(nombre, "nombre");
  if (typeof nombre !== "string" || nombre.trim().length < 2) {
    throw new HttpsError("invalid-argument", "El nombre debe tener al menos 2 caracteres.");
  }
  longitudMaxima(nombre, 120, "nombre");
  return nombre.trim();
}

function validarTelefono(telefono) {
  if (telefono === undefined || telefono === null || telefono === "") return null;
  const patron = /^[0-9+\-\s]{6,20}$/;
  if (typeof telefono !== "string" || !patron.test(telefono)) {
    throw new HttpsError("invalid-argument", "Telefono invalido.");
  }
  return telefono.trim();
}

// Formatos chilenos: antiguo (4 letras + 2 numeros) y nuevo (2 letras + 4 numeros).
function validarPatente(patente) {
  requerido(patente, "patente");
  const limpio = String(patente).toUpperCase().replace(/[\s-]/g, "");
  const formatoAntiguo = /^[A-Z]{4}[0-9]{2}$/;
  const formatoNuevo = /^[A-Z]{2}[0-9]{4}$/;
  if (!formatoAntiguo.test(limpio) && !formatoNuevo.test(limpio)) {
    throw new HttpsError("invalid-argument", "Formato de patente invalido.");
  }
  return limpio;
}

function validarLicencia(licencia) {
  requerido(licencia, "licencia");
  if (typeof licencia !== "string" || licencia.trim().length < 3) {
    throw new HttpsError("invalid-argument", "Numero de licencia invalido.");
  }
  longitudMaxima(licencia, 40, "licencia");
  return licencia.trim();
}

// Texto libre de busqueda (direcciones). Solo se usa si GEOAPIFY_HABILITADO
// esta en true (ver geoapify-funciones.js); se deja lista igual para cuando
// se active.
function validarTextoBusqueda(texto) {
  requerido(texto, "texto");
  if (typeof texto !== "string") {
    throw new HttpsError("invalid-argument", "El texto de busqueda debe ser una cadena.");
  }
  const limpio = texto.trim();
  if (limpio.length < 3 || limpio.length > 150) {
    throw new HttpsError(
      "invalid-argument",
      "El texto de busqueda debe tener entre 3 y 150 caracteres."
    );
  }
  return limpio;
}

// Coordenada global. La restriccion geografica a Chile (exigirChile) existe
// pero esta DESACTIVADA por defecto -- ver RESTRICCION_GEOGRAFICA_CHILE_ACTIVA
// en config.js. Se deja implementada para activarla con un solo cambio.
function validarCoordenada(lat, lng, { exigirChile = false } = {}) {
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new HttpsError("invalid-argument", "lat/lng deben ser numeros.");
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new HttpsError("invalid-argument", "lat/lng fuera de rango valido.");
  }
  if (exigirChile) {
    const dentroDeChile = lat >= -56 && lat <= -17 && lng >= -76 && lng <= -66;
    if (!dentroDeChile) {
      throw new HttpsError("invalid-argument", "Las coordenadas deben estar dentro de Chile continental.");
    }
  }
  return { lat, lng };
}

function validarWaypoints(waypoints, { minimo = 2, maximo = 25 } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < minimo || waypoints.length > maximo) {
    throw new HttpsError(
      "invalid-argument",
      `Se requieren entre ${minimo} y ${maximo} puntos (waypoints).`
    );
  }
  return waypoints.map((punto) => {
    if (!punto || typeof punto !== "object") {
      throw new HttpsError("invalid-argument", "Cada waypoint debe ser un objeto {lat, lng}.");
    }
    return validarCoordenada(punto.lat, punto.lng);
  });
}

function validarPuntosGps(puntos) {
  if (!Array.isArray(puntos) || puntos.length < 2 || puntos.length > 200) {
    throw new HttpsError(
      "invalid-argument",
      "Se requieren entre 2 y 200 puntos GPS con timestamp."
    );
  }
  return puntos.map((punto) => {
    if (!punto || typeof punto !== "object") {
      throw new HttpsError("invalid-argument", "Cada punto GPS debe ser un objeto.");
    }
    const { lat, lng } = validarCoordenada(punto.lat, punto.lng);
    if (typeof punto.timestamp !== "string" || Number.isNaN(Date.parse(punto.timestamp))) {
      throw new HttpsError("invalid-argument", "Cada punto GPS necesita un timestamp ISO 8601 valido.");
    }
    return { lat, lng, timestamp: punto.timestamp };
  });
}

function validarModoTransporte(modo) {
  const permitidos = ["drive", "walk", "bicycle"];
  if (!permitidos.includes(modo)) {
    throw new HttpsError(
      "invalid-argument",
      `modo invalido. Debe ser uno de: ${permitidos.join(", ")}.`
    );
  }
  return modo;
}

function validarRadioMetros(radio) {
  if (typeof radio !== "number" || radio < 100 || radio > 3000) {
    throw new HttpsError("invalid-argument", "radioMetros debe estar entre 100 y 3000.");
  }
  return radio;
}

const CATEGORIAS_LUGAR_PERMITIDAS = [
  "healthcare.hospital",
  "healthcare.clinic_or_praxis",
  "healthcare.pharmacy",
  "healthcare",
  "public_transport",
];

function validarCategoriaLugar(categoria) {
  if (!CATEGORIAS_LUGAR_PERMITIDAS.includes(categoria)) {
    throw new HttpsError(
      "invalid-argument",
      `categoria invalida. Debe ser una de: ${CATEGORIAS_LUGAR_PERMITIDAS.join(", ")}.`
    );
  }
  return categoria;
}

const ROLES_VALIDOS = ["admin", "chofer", "paciente"];

function validarRol(rol) {
  if (!ROLES_VALIDOS.includes(rol)) {
    throw new HttpsError("invalid-argument", `rol invalido. Debe ser uno de: ${ROLES_VALIDOS.join(", ")}.`);
  }
  return rol;
}

// Estados de la maquina de estados del viaje/solicitud (ver docs/ESTADOS_VIAJE.md).
const ESTADOS_VALIDOS = [
  "solicitado",
  "asignado",
  "conductor_en_camino",
  "conductor_llego",
  "en_viaje",
  "finalizado",
  "cancelado",
];

function validarEstado(estado) {
  if (!ESTADOS_VALIDOS.includes(estado)) {
    throw new HttpsError("invalid-argument", `estado invalido. Debe ser uno de: ${ESTADOS_VALIDOS.join(", ")}.`);
  }
  return estado;
}


// ---------------------------------------------------------------------
// Fase 1: viajes asignados por el admin, muestras GPS y solicitudes.
// ---------------------------------------------------------------------

// Fecha calendario real "YYYY-MM-DD" (rechaza 2026-02-31).
function validarFecha(fecha) {
  requerido(fecha, "fecha");
  const m = typeof fecha === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) throw new HttpsError("invalid-argument", "fecha debe tener formato YYYY-MM-DD.");
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new HttpsError("invalid-argument", "fecha no existe en el calendario.");
  }
  return fecha;
}

function validarHora(hora) {
  requerido(hora, "hora");
  if (typeof hora !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
    throw new HttpsError("invalid-argument", "hora debe tener formato HH:mm (24 horas).");
  }
  return hora;
}

// Limites del GPS acumulado (ver docs/ARQUITECTURA.md, seccion GPS).
const GPS_MAX_MUESTRAS_POR_LLAMADA = 50;
const GPS_MAX_MUESTRAS_POR_VIAJE = 5000;
const GPS_ANTIGUEDAD_MAXIMA_MS = 15 * 60 * 1000;
const GPS_ADELANTO_MAXIMO_MS = 60 * 1000;

/**
 * Valida un lote de muestras GPS {lat, lng, timestampMs}. Descarta
 * duplicados dentro del lote (mismo timestampMs) y devuelve el lote
 * ordenado por tiempo. Rechaza el lote COMPLETO si alguna muestra es
 * invalida (no se acepta "lo que sirva", para que el cliente se entere).
 */
function validarMuestrasGps(muestras, ahoraMs = Date.now(), antiguedadMaximaMs = GPS_ANTIGUEDAD_MAXIMA_MS) {
  if (!Array.isArray(muestras) || muestras.length < 1 || muestras.length > GPS_MAX_MUESTRAS_POR_LLAMADA) {
    throw new HttpsError(
      "invalid-argument",
      `Se requieren entre 1 y ${GPS_MAX_MUESTRAS_POR_LLAMADA} muestras GPS por llamada.`
    );
  }
  const vistos = new Set();
  const resultado = [];
  for (const m of muestras) {
    if (!m || typeof m !== "object") {
      throw new HttpsError("invalid-argument", "Cada muestra GPS debe ser un objeto.");
    }
    const { lat, lng } = validarCoordenada(m.lat, m.lng, { exigirChile: config.RESTRICCION_GEOGRAFICA_CHILE_ACTIVA });
    const t = m.timestampMs;
    if (!Number.isInteger(t)) {
      throw new HttpsError("invalid-argument", "timestampMs debe ser un entero (milisegundos epoch).");
    }
    if (t < ahoraMs - antiguedadMaximaMs || t > ahoraMs + GPS_ADELANTO_MAXIMO_MS) {
      throw new HttpsError("invalid-argument", "timestampMs fuera de la ventana permitida.");
    }
    if (vistos.has(t)) continue;
    vistos.add(t);
    resultado.push({ lat, lng, t });
  }
  return resultado.sort((a, b) => a.t - b.t);
}

function validarPuntoViaje(punto, nombre) {
  if (!punto || typeof punto !== "object") {
    throw new HttpsError("invalid-argument", `'${nombre}' es obligatorio y debe ser un objeto {lat, lng, direccion}.`);
  }
  // Respeta el flag RESTRICCION_GEOGRAFICA_CHILE_ACTIVA (apagado por defecto).
  const { lat, lng } = validarCoordenada(punto.lat, punto.lng, { exigirChile: config.RESTRICCION_GEOGRAFICA_CHILE_ACTIVA });
  let direccion = null;
  if (punto.direccion !== undefined && punto.direccion !== null) {
    if (typeof punto.direccion !== "string") {
      throw new HttpsError("invalid-argument", `'${nombre}.direccion' debe ser texto.`);
    }
    longitudMaxima(punto.direccion, 200, `${nombre}.direccion`);
    direccion = punto.direccion.trim() || null;
  }
  return { lat, lng, direccion };
}

function validarNecesidades(necesidades) {
  const n = necesidades === undefined || necesidades === null ? {} : necesidades;
  if (typeof n !== "object" || Array.isArray(n)) {
    throw new HttpsError("invalid-argument", "'necesidades' debe ser un objeto.");
  }
  const texto = (valor, maximo, campo) => {
    if (valor === undefined || valor === null || valor === "") return null;
    if (typeof valor !== "string") throw new HttpsError("invalid-argument", `'necesidades.${campo}' debe ser texto.`);
    longitudMaxima(valor, maximo, `necesidades.${campo}`);
    return valor.trim() || null;
  };
  return {
    sillaRuedas: n.sillaRuedas === true,
    acompanante: n.acompanante === true,
    observaciones: texto(n.observaciones, 500, "observaciones"),
    contactoEmergencia: texto(n.contactoEmergencia, 150, "contactoEmergencia"),
  };
}

function validarTextoOpcional(valor, maximo, campo) {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string") throw new HttpsError("invalid-argument", `'${campo}' debe ser texto.`);
  longitudMaxima(valor, maximo, campo);
  return valor.trim() || null;
}

module.exports = {
  requerido,
  longitudMaxima,
  validarUid,
  validarEmail,
  validarPassword,
  validarNombre,
  validarTelefono,
  validarPatente,
  validarLicencia,
  validarTextoBusqueda,
  validarCoordenada,
  validarWaypoints,
  validarPuntosGps,
  validarModoTransporte,
  validarRadioMetros,
  validarCategoriaLugar,
  validarRol,
  validarEstado,
  ROLES_VALIDOS,
  ESTADOS_VALIDOS,
  validarFecha,
  validarHora,
  validarMuestrasGps,
  validarPuntoViaje,
  validarNecesidades,
  validarTextoOpcional,
  GPS_MAX_MUESTRAS_POR_LLAMADA,
  GPS_MAX_MUESTRAS_POR_VIAJE,
};
