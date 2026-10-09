// Utilidades compartidas para hablar con Geoapify desde el servidor:
// cache en memoria de corta duracion + reintento con backoff solo en
// errores transitorios (429/5xx). Portado desde
// daily-app/firebase/functions/geoapify.js.
//
// IMPORTANTE: este modulo nunca debe recibir ni loguear la API key en
// texto plano en logs persistentes; se usa solo dentro del proceso de
// la Cloud Function, que ya corre en el servidor.

const CACHE_TTL_MS = 60 * 1000; // 60s
const CACHE_MAX_ENTRADAS = 500;

const cache = new Map();

function leerCache(clave) {
  const entrada = cache.get(clave);
  if (!entrada) return null;
  if (Date.now() - entrada.guardadoEn > CACHE_TTL_MS) {
    cache.delete(clave);
    return null;
  }
  return entrada.valor;
}

function escribirCache(clave, valor) {
  if (cache.size >= CACHE_MAX_ENTRADAS) {
    const primeraClave = cache.keys().next().value;
    cache.delete(primeraClave);
  }
  cache.set(clave, { valor, guardadoEn: Date.now() });
}

/**
 * fetch con reintento SOLO para 429 (rate limit de Geoapify) y 5xx
 * (error transitorio del servidor). Cualquier otro codigo (401, 400,
 * etc.) se retorna tal cual, sin reintentar, porque reintentar un error
 * de cliente no lo va a arreglar.
 */
async function fetchConReintento(url, opciones = {}, intentosRestantes = 2, esperaMs = 400) {
  const respuesta = await fetch(url, opciones);

  const esReintentable = respuesta.status === 429 || respuesta.status >= 500;

  if (esReintentable && intentosRestantes > 0) {
    await new Promise((resolve) => setTimeout(resolve, esperaMs));
    return fetchConReintento(url, opciones, intentosRestantes - 1, esperaMs * 2);
  }

  return respuesta;
}

module.exports = { leerCache, escribirCache, fetchConReintento };
