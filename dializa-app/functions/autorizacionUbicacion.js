// Autorizacion RTDB con fencing monotono reservado en RTDB ANTES de
// consultar Firestore. No depende de relojes ni empates de Date.now().
// Cada reserva invalida cualquier escritor anterior, incluso si sus lecturas
// tardan. El commit solo aplica si conserva la generacion reservada.
// Firestore y RTDB no son una transaccion distribuida: los triggers con retry
// reparan fallos transitorios. Una caida no se declara sincronizada.
// Los estados de autorizacion manual y bajo demanda conservan su contrato.

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
    const ref = obtenerRtdb().ref(`ubicaciones/${choferUid}`);
    const reserva = await ref.transaction((actual) => {
      const nodo = actual && typeof actual === "object" ? { ...actual } : {};
      nodo.reconciliacionGeneracion = (Number.isSafeInteger(nodo.reconciliacionGeneracion) ? nodo.reconciliacionGeneracion : 0) + 1;
      return nodo;
    });
    if (!reserva.committed) throw new Error("No se pudo reservar una generacion RTDB.");
    const version = reserva.snapshot.val().reconciliacionGeneracion;

    const [viajesSnap, solicitudesSnap] = await Promise.all([
      db.collection("viajes").where(campoConductor("viajes"), "==", choferUid).get(),
      db.collection("solicitudes").where(campoConductor("solicitudes"), "==", choferUid).get(),
    ]);
    const viajes = viajesSnap.docs.map((d) => ({ id: d.id, datos: d.data() }));
    const solicitudes = solicitudesSnap.docs.map((d) => ({ id: d.id, datos: d.data() }));
    const elegido = elegirAutorizado(viajes, solicitudes);

    const resultado = await ref.transaction((actual) => {
        const nodo = actual && typeof actual === "object" ? { ...actual } : {};
        if (nodo.reconciliacionGeneracion !== version) {
          return undefined; // llego tarde: ya hay una reconciliacion mas nueva
        }
        nodo.autorizacionVersion = version;
        nodo.autorizacionValidaHasta = Date.now() + 300000;
        if (elegido) {
          nodo.pacienteAutorizado = elegido.pacienteId;
          nodo.viajeAutorizado = elegido.viajeId;
        } else {
          delete nodo.pacienteAutorizado;
          delete nodo.viajeAutorizado;
        }
        return nodo;
      });

    const confirmado=resultado.snapshot.val()||{};
    return {
      aplicado: Boolean(resultado && resultado.committed),
      pacienteAutorizado: confirmado.pacienteAutorizado || null,
      viajeAutorizado: confirmado.viajeAutorizado || null,
    };
  }

  async function sincronizarCuenta(uid) {
    const ref=obtenerRtdb().ref(`cuentasAutorizadas/${uid}`);
    const reserva=await ref.transaction(actual=>({...actual,generacion:(Number.isSafeInteger(actual?.generacion)?actual.generacion:0)+1}));
    if(!reserva.committed) throw new Error("No se pudo reservar espejo de cuenta.");
    const generacion=reserva.snapshot.val().generacion;
    const snap=await db.collection("usuarios").doc(uid).get();
    const datos=snap.exists?snap.data():{};
    const activo=datos.activo===true && !datos.operacionCuenta && !datos.bajaEnCurso;
    await ref.transaction(actual=>{
      if(actual?.generacion!==generacion) return undefined;
      return {generacion,activo,rol:datos.rol||null,aprobado:datos.aprobado===true,validoHasta:Date.now()+300000};
    });
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
        if (!(await reconciliar(uid)).aplicado) todoBien = false;
      } catch (error) {
        todoBien = false;
        console.error(`No se pudo reconciliar la autorizacion de ubicacion de ${uid}:`, error);
      }
    }
    return todoBien;
  }

  return { reconciliar, reconciliarSeguro, sincronizarCuenta };
}

module.exports = { init, elegirAutorizado, ESTADOS_AUTORIZAN };
