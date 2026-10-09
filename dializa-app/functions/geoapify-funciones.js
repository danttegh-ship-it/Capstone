// Las 6 funciones de Geoapify, puerto completo de daily-app. TODAS estan
// detras de config.GEOAPIFY_HABILITADO (punto 6.9 del requerimiento:
// "integralo pero dejalo con la opcion desactivado hasta nuevo aviso").
// Mientras ese flag sea false, cada funcion devuelve un error claro antes
// de leer ningun secreto ni llamar a Geoapify, asi no se gasta cuota por
// accidente.
//
// Convencion de coordenadas (igual que en daily-app, documentada aunque
// el requerimiento diga que no hace falda -- se deja por claridad del
// codigo, punto 12.10): el modelo interno usa {lat, lng}; Geoapify usa
// distintos ordenes segun endpoint, y cada funcion hace la conversion
// explicita.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const {
  validarTextoBusqueda,
  validarCoordenada,
  validarWaypoints,
  validarPuntosGps,
  validarModoTransporte,
  validarRadioMetros,
  validarCategoriaLugar,
} = require("./validaciones");
const { leerCache, escribirCache, fetchConReintento } = require("./geoapify");
const { RESTRICCION_GEOGRAFICA_CHILE_ACTIVA, GEOAPIFY_HABILITADO } = require("./config");

// Tres secretos distintos: el usuario genero 3 API keys de Geoapify
// separadas (una por producto). buscarDirecciones y obtenerDireccionInversa
// reusan la de geocoding (son el mismo producto de Geoapify); buscarLugaresCercanos
// usa tambien la de geocoding porque Geoapify factura Places dentro del
// mismo plan que Geocoding en el nivel gratuito.
const GEOAPIFY_KEY_RUTA = defineSecret("GEOAPIFY_KEY_RUTA");
const GEOAPIFY_KEY_MAPMATCHING = defineSecret("GEOAPIFY_KEY_MAPMATCHING");
const GEOAPIFY_KEY_GEOCODING = defineSecret("GEOAPIFY_KEY_GEOCODING");

function exigirGeoapifyHabilitado() {
  if (!GEOAPIFY_HABILITADO) {
    throw new HttpsError(
      "failed-precondition",
      "La integracion con Geoapify esta desactivada por ahora. Se activara cuando se confirme su uso en la app final."
    );
  }
}

function extraerCoordenadasRuta(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "MultiLineString") return geometry.coordinates.flat();
  return [];
}

function init(db, cuentas) {
  const { exigirPerfilValido } = cuentas;
  const { exigirLimiteTasa } = require("./rateLimit");

  // 1. Geocoding directo ------------------------------------------------
  const geocodificarDireccion = onCall({ secrets: [GEOAPIFY_KEY_GEOCODING] }, async (request) => {
    exigirGeoapifyHabilitado();
    const { uid } = await exigirPerfilValido(request);
    await exigirLimiteTasa(db, uid, "geocodificarDireccion", 60000, 20);

    const texto = validarTextoBusqueda(request.data && request.data.texto);
    const claveCache = `geocode:${texto.toLowerCase()}`;
    const cacheado = leerCache(claveCache);
    if (cacheado) return cacheado;

    const apiKey = GEOAPIFY_KEY_GEOCODING.value();
    const url =
      "https://api.geoapify.com/v1/geocode/search" +
      `?text=${encodeURIComponent(texto)}&filter=countrycode:cl&apiKey=${apiKey}`;

    const respuesta = await fetchConReintento(url);
    if (!respuesta.ok) {
      if (respuesta.status === 401) throw new HttpsError("failed-precondition", "La clave de Geocoding API no es valida.");
      throw new HttpsError("unavailable", `Geoapify Geocoding respondio con estado ${respuesta.status}.`);
    }

    const cuerpo = await respuesta.json();
    const resultados = (cuerpo.features || []).map((f) => ({
      etiqueta: f.properties.formatted,
      lat: f.properties.lat,
      lng: f.properties.lon,
      ciudad: f.properties.city || null,
      placeId: f.properties.place_id || null,
    }));

    const resultado = { resultados };
    escribirCache(claveCache, resultado);
    return resultado;
  });

  // 2. Autocompletado (mientras se escribe) ------------------------------
  const buscarDirecciones = onCall({ secrets: [GEOAPIFY_KEY_GEOCODING] }, async (request) => {
    exigirGeoapifyHabilitado();
    const { uid } = await exigirPerfilValido(request);
    await exigirLimiteTasa(db, uid, "buscarDirecciones", 60000, 30);

    const texto = validarTextoBusqueda(request.data && request.data.texto);
    const claveCache = `autocomplete:${texto.toLowerCase()}`;
    const cacheado = leerCache(claveCache);
    if (cacheado) return cacheado;

    const apiKey = GEOAPIFY_KEY_GEOCODING.value();
    const url =
      "https://api.geoapify.com/v1/geocode/autocomplete" +
      `?text=${encodeURIComponent(texto)}&filter=countrycode:cl&apiKey=${apiKey}`;

    const respuesta = await fetchConReintento(url);
    if (!respuesta.ok) {
      if (respuesta.status === 401) throw new HttpsError("failed-precondition", "La clave de Geocoding API no es valida.");
      throw new HttpsError("unavailable", `Geoapify Autocomplete respondio con estado ${respuesta.status}.`);
    }

    const cuerpo = await respuesta.json();
    const resultados = (cuerpo.features || []).map((f) => ({
      etiqueta: f.properties.formatted,
      lat: f.properties.lat,
      lng: f.properties.lon,
      placeId: f.properties.place_id || null,
    }));

    const resultado = { resultados };
    escribirCache(claveCache, resultado);
    return resultado;
  });

  // 3. Geocodificacion inversa (coordenadas -> texto) --------------------
  const obtenerDireccionInversa = onCall({ secrets: [GEOAPIFY_KEY_GEOCODING] }, async (request) => {
    exigirGeoapifyHabilitado();
    const { uid } = await exigirPerfilValido(request);
    await exigirLimiteTasa(db, uid, "obtenerDireccionInversa", 60000, 20);

    const { lat, lng } = validarCoordenada(request.data && request.data.lat, request.data && request.data.lng, {
      exigirChile: RESTRICCION_GEOGRAFICA_CHILE_ACTIVA,
    });

    const claveCache = `reverse:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cacheado = leerCache(claveCache);
    if (cacheado) return cacheado;

    const apiKey = GEOAPIFY_KEY_GEOCODING.value();
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${apiKey}`;

    const respuesta = await fetchConReintento(url);
    if (!respuesta.ok) {
      if (respuesta.status === 401) throw new HttpsError("failed-precondition", "La clave de Geocoding API no es valida.");
      throw new HttpsError("unavailable", `Geoapify Reverse Geocoding respondio con estado ${respuesta.status}.`);
    }

    const cuerpo = await respuesta.json();
    const feature = cuerpo.features && cuerpo.features[0];
    const resultado = {
      etiqueta: feature ? feature.properties.formatted : null,
    };
    escribirCache(claveCache, resultado);
    return resultado;
  });

  // 4. Calculo de ruta -----------------------------------------------------
  const calcularRuta = onCall({ secrets: [GEOAPIFY_KEY_RUTA] }, async (request) => {
    exigirGeoapifyHabilitado();
    const { uid } = await exigirPerfilValido(request);
    await exigirLimiteTasa(db, uid, "calcularRuta", 60000, 20);

    const waypoints = validarWaypoints(request.data && request.data.waypoints, { minimo: 2, maximo: 10 });
    const modo = validarModoTransporte((request.data && request.data.modo) || "drive");

    const waypointsTexto = waypoints.map((p) => `${p.lat},${p.lng}`).join("|");
    const claveCache = `ruta:${modo}:${waypointsTexto}`;
    const cacheado = leerCache(claveCache);
    if (cacheado) return cacheado;

    const apiKey = GEOAPIFY_KEY_RUTA.value();
    const url =
      "https://api.geoapify.com/v1/routing" +
      `?waypoints=${encodeURIComponent(waypointsTexto)}&mode=${encodeURIComponent(modo)}&apiKey=${apiKey}`;

    const respuesta = await fetchConReintento(url);
    if (!respuesta.ok) {
      if (respuesta.status === 401) throw new HttpsError("failed-precondition", "La clave de Routing API no es valida.");
      throw new HttpsError("unavailable", `Geoapify Routing respondio con estado ${respuesta.status}.`);
    }

    const cuerpo = await respuesta.json();
    const feature = cuerpo.features && cuerpo.features[0];
    if (!feature) throw new HttpsError("not-found", "No se encontro una ruta entre los puntos dados.");

    const puntosRuta = extraerCoordenadasRuta(feature.geometry).map(([lon, lat]) => ({ lat, lng: lon }));

    const resultado = {
      distanciaMetros: feature.properties.distance,
      duracionSegundos: feature.properties.time,
      puntosRuta,
    };
    escribirCache(claveCache, resultado);
    return resultado;
  });

  // 5. Lugares cercanos (POIs) ---------------------------------------------
  const buscarLugaresCercanos = onCall({ secrets: [GEOAPIFY_KEY_GEOCODING] }, async (request) => {
    exigirGeoapifyHabilitado();
    const { uid } = await exigirPerfilValido(request);
    await exigirLimiteTasa(db, uid, "buscarLugaresCercanos", 60000, 15);

    const { lat, lng } = validarCoordenada(request.data && request.data.lat, request.data && request.data.lng, {
      exigirChile: RESTRICCION_GEOGRAFICA_CHILE_ACTIVA,
    });
    const radioMetros = validarRadioMetros((request.data && request.data.radioMetros) || 1500);
    const categoria = validarCategoriaLugar((request.data && request.data.categoria) || "healthcare");

    const claveCache = `lugares:${categoria}:${lat.toFixed(4)},${lng.toFixed(4)}:${radioMetros}`;
    const cacheado = leerCache(claveCache);
    if (cacheado) return cacheado;

    const apiKey = GEOAPIFY_KEY_GEOCODING.value();
    const url =
      "https://api.geoapify.com/v2/places" +
      `?categories=${encodeURIComponent(categoria)}` +
      `&filter=circle:${lng},${lat},${radioMetros}` + // Places API usa lon,lat
      `&bias=proximity:${lng},${lat}` +
      `&apiKey=${apiKey}`;

    const respuesta = await fetchConReintento(url);
    if (!respuesta.ok) {
      if (respuesta.status === 401) throw new HttpsError("failed-precondition", "La clave de Places API no es valida.");
      throw new HttpsError("unavailable", `Geoapify Places respondio con estado ${respuesta.status}.`);
    }

    const cuerpo = await respuesta.json();
    const resultados = (cuerpo.features || []).map((f) => ({
      nombre: f.properties.name || f.properties.formatted,
      lat: f.properties.lat,
      lng: f.properties.lon,
      distanciaMetros: f.properties.distance || null,
    }));

    const resultado = { resultados };
    escribirCache(claveCache, resultado);
    return resultado;
  });

  // 6. Map Matching ---------------------------------------------------------
  const ajustarRutaGps = onCall({ secrets: [GEOAPIFY_KEY_MAPMATCHING] }, async (request) => {
    exigirGeoapifyHabilitado();
    const { uid } = await exigirPerfilValido(request);
    await exigirLimiteTasa(db, uid, "ajustarRutaGps", 60000, 10);

    const puntos = validarPuntosGps(request.data && request.data.puntos);
    const modo = validarModoTransporte((request.data && request.data.modo) || "drive");

    const apiKey = GEOAPIFY_KEY_MAPMATCHING.value();
    const url = `https://api.geoapify.com/v1/mapmatching?apiKey=${apiKey}`;

    const cuerpoPeticion = {
      mode: modo,
      waypoints: puntos.map((p) => ({ location: [p.lng, p.lat], timestamp: p.timestamp })),
    };

    const respuesta = await fetchConReintento(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoPeticion),
    });

    if (!respuesta.ok) {
      if (respuesta.status === 401) throw new HttpsError("failed-precondition", "La clave de Map Matching API no es valida.");
      throw new HttpsError("unavailable", `Geoapify Map Matching respondio con estado ${respuesta.status}.`);
    }

    const cuerpo = await respuesta.json();
    const feature = cuerpo.features && cuerpo.features[0];
    if (!feature) throw new HttpsError("not-found", "No se pudo ajustar la trayectoria a las vias.");

    const puntosAjustados = extraerCoordenadasRuta(feature.geometry).map(([lon, lat]) => ({ lat, lng: lon }));

    return {
      puntosAjustados,
      distanciaMetros: feature.properties ? feature.properties.distance : null,
    };
  });

  return {
    geocodificarDireccion,
    buscarDirecciones,
    obtenerDireccionInversa,
    calcularRuta,
    buscarLugaresCercanos,
    ajustarRutaGps,
  };
}

module.exports = { init };
