// Autorizacion de lectura de la ubicacion del chofer en Realtime Database
// (correccion A).
//
// Las reglas de RTDB no pueden consultar Firestore, asi que la autorizacion
// se PERSISTE en el nodo `ubicaciones/{choferUid}`:
//   pacienteAutorizado  uid del unico paciente que puede leer ese nodo
//   viajeAutorizado     id (viajeId) del viaje que justifica el permiso
//   autorizacionVersion marca de version (ms) de la ultima reconciliacion
// Los tres campos son `.write:false` para clientes (database.rules.json);
// solo este modulo (Admin SDK) los escribe. El chofer actualiza lat/lng/
// timestamp con `update()`, que NO toca estos campos.
//
// MODELO "RECONCILIAR": en vez de reaccionar a cada evento ("dar acceso",
// "quitar acceso"), tras CADA cambio que afecte a un chofer se recalcula
// desde Firestore a quien corresponde el acceso, y se escribe ese resultado:
//   1. Se toma `version = Date.now()` ANTES de leer Firestore.
//   2. Se leen los viajes del chofer y se elige el que autoriza (si hay).
//   3. Se escribe en RTDB con una transaccion que ABORTA si la version
//      guardada es MAYOR que la propia.
// Por que es correcto frente a eventos tardios: una reconciliacion que
// empezo despues leyo todo lo confirmado antes de empezar, incluido lo que
// motivo a la anterior. Si la anterior (mas lenta) llega tarde, su version
// es menor y se aborta; nunca revoca ni concede sobre una asignacion mas
// nueva. Supuesto documentado: relojes de las instancias de Cloud Functions
// sincronizados por NTP (error de milisegundos).
//
// Sin viaje que autorice, se deja una "lapida": se borra
// pacienteAutorizado/viajeAutorizado pero se CONSERVA la version, para que
// un evento tardio no reviva un acceso ya revocado.
//
// ESTADOS QUE AUTORIZAN (decision documentada en docs/ARQUITECTURA.md):
//   solicitudes/{id}: asignado, conductor_en_camino, conductor_llego, en_viaje
//     (el paciente pidio el viaje y un chofer lo acepto: se concede al aceptar).
//   viajes/{pacienteId}: conductor_en_camino, conductor_llego, en_viaje
//     (el admin puede asignar con dias de anticipacion y un chofer puede
//      tener varios viajes futuros; conceder al asignar daria acceso dias
//      antes y a varios pacientes distintos a la vez).

const { campoConductor, viajeIdDe } = require("./historial");

const ESTADOS_AUTORIZAN = {
  solicitudes: ["asignado", "conductor_en_camino", "conductor_llego", "en_viaje"],
  viajes: ["conductor_en_camino", "conductor_llego", "en_viaje"],
};

const PRIORIDAD_ESTADO = { en_viaje: 4, conductor_llego: 3, conductor_en_camino: 2, asignado: 1 };

function ultimoCambio(datos) {
  const h = Array.isArray(datos.historial) ? datos.historial : [];
  const ultima = h.length > 0 ? h[h.length - 1].fecha : null;
  return ultima || datos.creadoEn || datos.asignadoEn || "";
}

/**
 * Funcion pura: dados los viajes y solicitudes de UN chofer, devuelve el
 * candidato que autoriza o null. Prioriza el estado mas avanzado y, a
 * igualdad, el cambio mas reciente (determinista).
 * @param {Array<{id:string,datos:object}>} viajes   docs de `viajes`
 * @param {Array<{id:string,datos:object}>} solicitudes docs de `solicitudes`
 */
function elegirAutorizado(viajes, solicitudes) {
  const candidatos = [];
  for (const v of viajes) {
    const estado = v.datos.estado || "asignado";
    if (ESTADOS_AUTORIZAN.viajes.includes(estado)) {
      candidatos.push({ coleccion: "viajes", id: v.id, pacienteId: v.id, estado, datos: v.datos });
    }
  }
  for (const s of solicitudes) {
    if (ESTADOS_AUTORIZAN.solicitudes.includes(s.datos.estado) && s.datos.pacienteId) {
      candidatos.push({ coleccion: "solicitudes", id: s.id, pacienteId: s.datos.pacienteId, estado: s.datos.estado, datos: s.datos });
    }
  }
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => {
    const dp = PRIORIDAD_ESTADO[b.estado] - PRIORIDAD_ESTADO[a.estado];
    if (dp !== 0) return dp;
    const ua = ultimoCambio(a.datos);
    const ub = ultimoCambio(b.datos);
    if (ua !== ub) return ub.localeCompare(ua);
    return a.id.localeCompare(b.id);
  });
  const elegido = candidatos[0];
  return {
    pacienteId: elegido.pacienteId,
    viajeId: viajeIdDe(elegido.coleccion, elegido.id, elegido.datos).viajeId,
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {() => import('firebase-admin/database').Database} obtenerRtdb
 *        funcion (no valor) para no exigir RTDB al cargar el modulo.
 */
function init(db, obtenerRtdb) {
  /** Recalcula y persiste la autorizacion de UN chofer. */
  async function reconciliar(choferUid) {
    const version = Date.now(); // ANTES de leer Firestore (ver cabecera)

    const [viajesSnap, solicitudesSnap] = await Promise.all([
      db.collection("viajes").where(campoConductor("viajes"), "==", choferUid).get(),
      db.collection("solicitudes").where(campoConductor("solicitudes"), "==", choferUid).get(),
    ]);
    const viajes = viajesSnap.docs.map((d) => ({ id: d.id, datos: d.data() }));
    const solicitudes = solicitudesSnap.docs.map((d) => ({ id: d.id, datos: d.data() }));
    const elegido = elegirAutorizado(viajes, solicitudes);

    const resultado = await obtenerRtdb()
      .ref(`ubicaciones/${choferUid}`)
      .transaction((actual) => {
        const nodo = actual && typeof actual === "object" ? { ...actual } : {};
        if (typeof nodo.autorizacionVersion === "number" && nodo.autorizacionVersion > version) {
          return undefined; // llego tarde: ya hay una reconciliacion mas nueva
        }
        nodo.autorizacionVersion = version;
        if (elegido) {
          nodo.pacienteAutorizado = elegido.pacienteId;
          nodo.viajeAutorizado = elegido.viajeId;
        } else {
          delete nodo.pacienteAutorizado;
          delete nodo.viajeAutorizado;
        }
        return nodo;
      });

    return {
      aplicado: Boolean(resultado && resultado.committed),
      pacienteAutorizado: elegido ? elegido.pacienteId : null,
      viajeAutorizado: elegido ? elegido.viajeId : null,
    };
  }

  /**
   * Reconcilia varios choferes SIN hacer fallar la operacion de negocio que
   * ya se confirmo: si RTDB falla, se registra el error y se devuelve
   * false para que la funcion lo informe (`autorizacionSincronizada`) y el
   * admin pueda reparar con `sincronizarAutorizacionUbicacion`.
   */
  async function reconciliarSeguro(uids) {
    const unicos = [...new Set((uids || []).filter(Boolean))];
    let todoBien = true;
    for (const uid of unicos) {
      try {
        await reconciliar(uid);
      } catch (error) {
        todoBien = false;
        console.error(`No se pudo reconciliar la autorizacion de ubicacion de ${uid}:`, error);
      }
    }
    return todoBien;
  }

  return { reconciliar, reconciliarSeguro };
}

module.exports = { init, elegirAutorizado, ESTADOS_AUTORIZAN };
