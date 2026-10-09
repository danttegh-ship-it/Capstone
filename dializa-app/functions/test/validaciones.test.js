// Tests unitarios de validaciones.js -- puerto de
// daily-app/firebase/functions/test/validaciones.test.js, ampliado con
// los validadores nuevos de dializa-app (rol, estado). Mismo enfoque:
// sin framework de testing (assert + helpers propios), para poder
// correrlo con `node test/validaciones.test.js` sin depender de `npm
// install` en un entorno sin acceso a la red.

require("./helpers/entorno"); // usa firebase-functions real si esta instalado; si no, un doble
const validaciones = require("../validaciones");

let pasados = 0;
let fallidos = 0;

function ok(descripcion, condicion) {
  if (condicion) {
    pasados++;
  } else {
    fallidos++;
    console.error(`FALLO: ${descripcion}`);
  }
}

function esperarError(descripcion, fn) {
  try {
    fn();
    fallidos++;
    console.error(`FALLO (no lanzo error): ${descripcion}`);
  } catch (e) {
    pasados++;
  }
}

// --- validarEmail ---------------------------------------------------------
ok("email valido pasa", validaciones.validarEmail("a@b.cl") === "a@b.cl");
esperarError("email sin arroba falla", () => validaciones.validarEmail("ab.cl"));

// --- validarPassword -------------------------------------------------------
ok("password valida pasa", validaciones.validarPassword("abc12345") === "abc12345");
esperarError("password corta falla", () => validaciones.validarPassword("ab12"));
esperarError("password sin numero falla", () => validaciones.validarPassword("abcdefgh"));

// --- validarNombre -----------------------------------------------------------
ok("nombre valido pasa", validaciones.validarNombre("  Ana  ") === "Ana");
esperarError("nombre de 1 letra falla", () => validaciones.validarNombre("A"));

// --- validarTelefono ---------------------------------------------------------
ok("telefono valido pasa", validaciones.validarTelefono("+56 9 1234 5678") === "+56 9 1234 5678");
ok("telefono vacio es null (opcional)", validaciones.validarTelefono("") === null);
esperarError("telefono con letras falla", () => validaciones.validarTelefono("abc123"));

// --- validarPatente ------------------------------------------------------------
ok("patente formato nuevo pasa", validaciones.validarPatente("ab1234") === "AB1234");
ok("patente formato antiguo pasa", validaciones.validarPatente("abcd12") === "ABCD12");
esperarError("patente invalida falla", () => validaciones.validarPatente("123456"));

// --- validarLicencia -----------------------------------------------------------
ok("licencia valida pasa", validaciones.validarLicencia("L-12345") === "L-12345");
esperarError("licencia muy corta falla", () => validaciones.validarLicencia("ab"));

// --- validarTextoBusqueda --------------------------------------------------------
ok(
  "texto valido pasa",
  validaciones.validarTextoBusqueda("  Av Providencia 123  ") === "Av Providencia 123"
);
esperarError("texto de 2 letras falla", () => validaciones.validarTextoBusqueda("ab"));
esperarError("texto de 200 letras falla", () => validaciones.validarTextoBusqueda("a".repeat(200)));

// --- validarCoordenada -------------------------------------------------------------
ok(
  "coordenada global valida pasa",
  JSON.stringify(validaciones.validarCoordenada(-33.45, -70.65)) ===
    JSON.stringify({ lat: -33.45, lng: -70.65 })
);
esperarError("coordenada fuera de rango falla", () => validaciones.validarCoordenada(200, 0));
ok(
  "coordenada en Chile pasa con exigirChile",
  !!validaciones.validarCoordenada(-33.45, -70.65, { exigirChile: true })
);
esperarError("coordenada fuera de Chile falla con exigirChile", () =>
  validaciones.validarCoordenada(40.7, -74.0, { exigirChile: true })
);

// --- validarWaypoints --------------------------------------------------------------
ok(
  "2 waypoints validos pasan",
  validaciones.validarWaypoints([
    { lat: -33, lng: -70 },
    { lat: -34, lng: -71 },
  ]).length === 2
);
esperarError("1 waypoint falla (minimo 2)", () => validaciones.validarWaypoints([{ lat: -33, lng: -70 }]));

// --- validarPuntosGps ----------------------------------------------------------------
ok(
  "puntos GPS validos pasan",
  validaciones.validarPuntosGps([
    { lat: -33, lng: -70, timestamp: "2026-01-01T10:00:00Z" },
    { lat: -34, lng: -71, timestamp: "2026-01-01T10:05:00Z" },
  ]).length === 2
);
esperarError("punto GPS sin timestamp falla", () =>
  validaciones.validarPuntosGps([
    { lat: -33, lng: -70 },
    { lat: -34, lng: -71, timestamp: "2026-01-01T10:00:00Z" },
  ])
);

// --- validarModoTransporte -------------------------------------------------------------
ok("modo 'drive' pasa", validaciones.validarModoTransporte("drive") === "drive");
esperarError("modo invalido falla", () => validaciones.validarModoTransporte("teletransporte"));

// --- validarRadioMetros ------------------------------------------------------------------
ok("radio 1500 pasa", validaciones.validarRadioMetros(1500) === 1500);
esperarError("radio fuera de rango falla", () => validaciones.validarRadioMetros(5000));

// --- validarCategoriaLugar ---------------------------------------------------------------
ok("categoria 'healthcare' pasa", validaciones.validarCategoriaLugar("healthcare") === "healthcare");
esperarError("categoria invalida falla", () => validaciones.validarCategoriaLugar("comida"));

// --- validarRol (nuevo en dializa-app) --------------------------------------------------
ok("rol 'chofer' pasa", validaciones.validarRol("chofer") === "chofer");
esperarError("rol invalido falla", () => validaciones.validarRol("superadmin"));

// --- validarEstado (nuevo en dializa-app) ------------------------------------------------
ok("estado 'asignado' pasa", validaciones.validarEstado("asignado") === "asignado");
esperarError("estado invalido falla", () => validaciones.validarEstado("en_pausa"));

// --- validarUid ------------------------------------------------------------------------
ok("uid valido pasa", validaciones.validarUid("a".repeat(28)) === "a".repeat(28));
esperarError("uid muy corto falla", () => validaciones.validarUid("abc"));

console.log(`\n${pasados} pasados, ${fallidos} fallidos de ${pasados + fallidos} tests.`);
process.exit(fallidos > 0 ? 1 : 0);
