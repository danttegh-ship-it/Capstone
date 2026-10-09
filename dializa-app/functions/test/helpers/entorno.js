// Prepara el entorno de los tests unitarios de Cloud Functions.
//
// Si `firebase-functions` esta instalado (npm install), se usa el paquete
// REAL (onCall real, HttpsError real). Si no -- por ejemplo en un sandbox
// sin acceso al registro de npm -- se inyecta un DOBLE minimo de
// `firebase-functions/v2/https` con la misma interfaz que usan los tests
// (`onCall(handler).run(request)` y `HttpsError`). `USANDO_DOBLE_HTTPS`
// permite que el resultado de los tests declare cual de los dos se uso.
//
// IMPORTANTE: esto son tests UNITARIOS con dobles (Firestore/RTDB/Auth en
// memoria, ver memoria.js). NO sustituyen a las pruebas de integracion
// contra el Emulator Suite (tests/*.rules.test.js y los de integracion).

const Module = require("module");

let USANDO_DOBLE_HTTPS = false;
try {
  require.resolve("firebase-functions/v2/https");
} catch (e) {
  USANDO_DOBLE_HTTPS = true;
  class HttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
      this.name = "HttpsError";
    }
  }
  const dobleHttps = {
    HttpsError,
    onCall(opcionesOHandler, maybeHandler) {
      const handler = typeof opcionesOHandler === "function" ? opcionesOHandler : maybeHandler;
      const f = (req) => handler(req);
      f.run = (req) => handler(req);
      return f;
    },
  };
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "firebase-functions/v2/https") return dobleHttps;
    if (request === "firebase-admin/auth") return { getAuth: () => { throw new Error("getAuth no disponible en tests: inyecta un auth doble."); } };
    return original.call(this, request, parent, isMain);
  };
}

if (process.env.TEST_MOSTRAR_ENTORNO !== "0") {
  console.log(`# entorno de test: ${USANDO_DOBLE_HTTPS ? "DOBLE de firebase-functions/v2/https (paquete real no instalado)" : "firebase-functions REAL"}; Firestore/RTDB/Auth = dobles en memoria`);
}

module.exports = { USANDO_DOBLE_HTTPS };
