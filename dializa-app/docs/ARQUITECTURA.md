> Actualización 26-10-2026: este documento describe la base histórica. Para los contratos, privacidad, recuperación y límites vigentes de H01–H10 consulte [la entrega actual](REVISION_H01_H10_CODEX.md); ante discrepancias prevalece el código del SHA revisado.

# Arquitectura de Dializa App

Este documento explica cómo quedó combinado el proyecto después de fusionar
daily-app (nuestro desarrollo anterior, Kotlin/Jetpack Compose) dentro de
dializa-app (Flutter/Dart, ahora la aplicación principal), siguiendo
`requerimientos_de_la_app.txt` punto por punto.

## Por qué Flutter y no Kotlin

dializa-app es un proyecto Flutter. Kotlin y Dart son lenguajes distintos
que no se pueden mezclar en un mismo binario: **nada del código Kotlin de
daily-app se copió literal**. Lo que se hizo fue portar la *lógica* (las
mismas reglas de negocio, los mismos nombres de función donde tenía
sentido) reescrita en Dart. El backend (Cloud Functions, Node.js) sí es
compartible tal cual entre cualquier frontend, así que ahí la reutilización
fue mucho más directa.

## Mapeo de datos: daily-app → dializa-app

| Concepto | daily-app | dializa-app (ahora) |
| --- | --- | --- |
| Perfil + rol | `usuarios/{uid}` (igual) | `usuarios/{uid}` + custom claim `rol` |
| Datos sensibles del conductor | `conductores_privado/{uid}` | `choferes_privado/{uid}` (patente, licencia, modeloVehiculo, vehiculoAdaptado, disponible) |
| Asignación fija admin→chofer+hora | no existía tal cual | `viajes/{pacienteId}` (asignación VIGENTE; ahora se escribe con la Cloud Function `asignarViaje`) |
| Historial de viajes cerrados | no existía | `historial_viajes/{viajeId}` (Fase 1, ver abajo) |
| Recorrido GPS del viaje | no existía | `gps_viajes/{viajeId}/muestras/{t}` (Fase 1, ver abajo) |
| Viaje bajo demanda del paciente | `solicitudes/{id}` | `solicitudes/{id}` (puerto directo) |
| Respuesta de asistencia | no existía | `respuestas_paciente/{uid}` (ya existía en dializa-app, sin cambios) |
| Rate limiting | `rateLimits/{uid_accion}` | igual |
| Auditoría | `auditoria/{id}` | igual |
| Ubicación en vivo del chofer | RTDB `ubicaciones/{uid}` | igual + autorización persistida por el servidor (Fase 1) |

## Autorización "mixta" (punto 6.4)

El cliente Flutter sigue leyendo `usuarios/{uid}.rol` desde Firestore para
decidir qué pantalla mostrar tras el login -- es rápido y es como ya
funcionaba dializa-app. Pero ninguna Cloud Function sensible confía solo en
ese documento: `exigirPerfilValido()` (en `functions/cuentas.js`) revisa
primero el **custom claim** `rol` de Firebase Auth (mucho más difícil de
falsificar que un documento de Firestore), y si una cuenta todavía no tiene
ese claim (por ejemplo, una cuenta muy antigua), cae de vuelta a leer
Firestore y de paso repara el claim para la próxima vez.

Esto importa especialmente para Realtime Database: **RTDB no puede leer
documentos de Firestore**, así que `database.rules.json` depende
enteramente del custom claim (`auth.token.rol`). Si alguna vez un chofer
no puede compartir su ubicación y en la consola de Firestore su rol se ve
correcto, lo primero que hay que revisar es si su custom claim está
sincronizado (se fija automáticamente en `aprobarConductor` y
`solicitarRegistroConductor`).

## Flujo de viaje: dos modelos conviviendo

El admin asigna chofer+hora desde la misma pantalla de siempre
(`admin_home.dart`), pero desde la Fase 1 la escritura ya no es un
`.set()` directo: llama a la Cloud Function `asignarViaje`, que archiva el
viaje anterior del paciente antes de reemplazarlo (un `.set()` lo habría
perdido). Sobre la asignación corre la máquina de estados (`estado` +
`historial`) que el propio chofer avanza: `asignado → conductor_en_camino →
conductor_llego → en_viaje → finalizado`, o `cancelado` mientras no esté
`en_viaje`. Ver `docs/ESTADOS_VIAJE.md`.

Por separado, el modelo de **solicitud bajo demanda** de daily-app
(`solicitudes/{id}`): el paciente pide un traslado con origen, destino y
necesidades (`crearSolicitudViaje`), un chofer disponible lo **acepta**
(`aceptarSolicitud`) y avanza por la misma máquina de estados. Una solicitud
pendiente solo se puede aceptar: **no existe rechazo de pendientes**.
`rechazarSolicitud` es exclusivo del chofer que ya aceptó (estado
`asignado`) y se arrepiente: la solicitud vuelve a `solicitado` para otro
chofer. Las pantallas para este flujo llegan en la Fase 3.

## Fase 1: historial, GPS, autorización de ubicación y cuentas

### Historial (`historial_viajes/{viajeId}`)

- `viajes/{pacienteId}` es SOLO la asignación vigente. Cada viaje cerrado
  se copia a `historial_viajes/{viajeId}`.
- **Id estable por instancia de viaje (`viajeId`)**: en `solicitudes` es el id
  del documento; en `viajes` lo genera el servidor en `asignarViaje`. Los
  documentos de `viajes` anteriores a la Fase 1 no lo tienen: se les calcula
  un id determinista `legacy_<paciente>_<chofer>_<fecha>_<hora>` y el archivo
  queda marcado `esLegacy: true`. Un `viajes` legado sin `estado` se trata
  como `asignado`.
- **Cuándo se archiva** (siempre dentro de la MISMA transacción que cambia el
  estado, así no hay "cerró pero no archivó"):
  1. el chofer lleva el viaje a `finalizado` o `cancelado`
     (`actualizarEstadoViaje` / `cancelarAsignacionConductor`);
  2. el admin reasigna un viaje no iniciado (`asignarViaje`, cierre
     `reasignado`);
  3. se elimina la cuenta del paciente (`eliminarPaciente`, cierre
     `cuenta_eliminada`; las solicitudes abiertas se cancelan y archivan).
- **Sin pérdida ni duplicados**: el documento se crea solo si no existe
  (idempotente). Reintentos, triggers duplicados y llamadas concurrentes se
  serializan por las transacciones de Firestore (concurrencia optimista):
  queda UN archivo y nunca se sobrescribe el primero. Un viaje cerrado ya
  archivado que luego se reemplaza con `asignarViaje` no se vuelve a copiar.
- **Contenido**: `viajeId, esLegacy, origenColeccion, origenId, pacienteId,
  pacienteNombre, conductorId, conductorNombre, estadoFinal, cierre,
  historial[{estado,fecha,actorUid?}], fecha, hora, origen, destino,
  necesidades, notas, creadoEn, archivadoEn, gps{conteo,primerTs,ultimoTs}`.
  Los nombres se desnormalizan para que borrar una cuenta no borre la
  evidencia.
- **Consultas** por paciente o conductor: `where pacienteId == X` /
  `where conductorId == X` ordenado por `archivadoEn desc` (índices en
  `firestore.indexes.json`).
- **Reglas**: solo un admin lee; nadie escribe desde el cliente.

### GPS (`gps_viajes/{viajeId}/muestras/{t}`)

- Decisión: **subcolección de Firestore**, nunca un arreglo dentro de un
  documento. El historial NO embebe los puntos: guarda el resumen
  `gps{conteo,primerTs,ultimoTs}` y el recorrido se lee de la subcolección
  con el mismo `viajeId` (un documento con miles de puntos chocaría con el
  límite de 1 MiB y obligaría a reescribirlo entero en cada punto).
- **Quién escribe**: únicamente la Cloud Function `registrarMuestrasGps`
  (los clientes no tienen permiso de escritura), solo el chofer asignado y
  aprobado.
- **Cuándo**: estados `conductor_en_camino`, `conductor_llego` y `en_viaje`
  (cada muestra guarda su `fase`). No en `asignado`, ni en viajes ajenos,
  ni tras `finalizado`/`cancelado` (la escritura es una transacción que lee
  el estado del viaje, así que no hay carrera con el cierre).
- **Volumen**: ≤ 50 muestras por llamada; ≤ 5000 por viaje (~7 h a 1
  muestra cada 5 s); 30 llamadas/min por chofer; `timestampMs` entre
  ahora−15 min y ahora+60 s; id de muestra = timestamp (reenviar un lote no
  duplica ni infla el conteo).
- **Tres conceptos distintos**: GPS observado (`fuente:'gps'`, esto);
  ruta planificada (la calcula Geoapify bajo demanda, no se persiste aquí);
  ruta ajustada por map matching (reservada en
  `gps_viajes/{viajeId}/derivadas/{ajustada|planificada}`, solo servidor,
  Fase 4). Un dato derivado nunca reemplaza una muestra observada.
- `ubicaciones/{uid}` (RTDB, posición "en vivo") sigue actualizándose con
  `update()` de `lat/lng/timestamp`; no es el historial.

### Autorización de lectura de la ubicación (RTDB) — corrección A

Las reglas de RTDB no pueden consultar Firestore, por eso la autorización
se **persiste** en el nodo: `pacienteAutorizado`, `viajeAutorizado` y
`autorizacionVersion` (los tres `.write:false` para clientes).

- Tras cada cambio que afecta a un chofer (aceptar, rechazar, cancelar,
  avanzar estado, asignar, eliminar paciente) el servidor **reconcilia**:
  relee los viajes del chofer, elige a quién corresponde el acceso y lo
  escribe con una transacción de RTDB.
- **Eventos tardíos**: cada reconciliación toma `version = Date.now()` ANTES
  de leer Firestore y la transacción de RTDB se aborta si ya hay una versión
  mayor. Una reconciliación lenta no puede revocar ni conceder sobre una
  asignación más nueva. Sin viaje autorizante queda una "lápida" (se borra el
  paciente pero se conserva la versión). Supuesto: relojes de Cloud Functions
  sincronizados (error de milisegundos).
- **Paciente anterior**: al cambiar de viaje/paciente/chofer el nodo se
  recalcula, así que el paciente previo pierde el acceso.
- **Estados que autorizan** — decisión deliberada, distinta a "conceder al
  asignar":
  - `solicitudes`: `asignado`, `conductor_en_camino`, `conductor_llego`,
    `en_viaje` (el paciente pidió el viaje y un chofer lo aceptó: se
    concede al aceptar).
  - `viajes` (admin): solo `conductor_en_camino`, `conductor_llego`,
    `en_viaje`. El admin puede asignar con días de anticipación y un chofer
    puede tener varios viajes futuros; conceder al asignar daría acceso
    días antes y a varios pacientes a la vez, sobre un único nodo por
    chofer.
- **Fallo de RTDB**: la operación de negocio ya confirmada NO se revierte;
  la respuesta trae `autorizacionSincronizada:false` y el admin/chofer puede
  reparar con `sincronizarAutorizacionUbicacion`.
- Si algo escribe el nodo completo con `set()` se pierde la autorización
  (las reglas lo impiden al chofer; la reconciliación lo repara).

### Cuentas

- **Corrección D (`activarDesactivarCuenta`)**: además de `usuarios.activo`,
  deshabilita/habilita al usuario en Firebase Auth y revoca sus refresh
  tokens. Desactivar: Firestore primero, luego Auth; activar: Auth primero,
  luego Firestore (un fallo a medias queda del lado seguro y reintentar es
  idempotente). **Alcance real**: impide nuevos inicios de sesión y la
  renovación del token, pero un ID token ya emitido sigue siendo válido hasta
  ~1 h. Las Cloud Functions de la app se bloquean al instante
  (`exigirPerfilValido` relee Firestore); las reglas de RTDB solo ven el
  token, así que un chofer desactivado podría seguir escribiendo SU propia
  ubicación hasta que expire. No se afirma revocación inmediata universal.
- **Corrección E (FCM)**: `AuthService.iniciarGestionFcmPorSesion()` (una vez,
  desde `main`) escucha `authStateChanges`: con usuario registra el token y
  se suscribe a `onTokenRefresh` (cancelando la suscripción previa); sin
  usuario la cancela. Cubre login nuevo y sesión restaurada, sin listeners
  duplicados ni tokens asociados al usuario anterior. `AuthService.cerrarSesion()`
  pide `eliminarTokenFcm` y `deleteToken()` ANTES de `signOut`. En el
  servidor, `registrarTokenFcm` limpia ese token de cualquier otra cuenta.
- **Bajas**: `eliminarCuenta` de un chofer con viajes sin cerrar se rechaza;
  `eliminarPaciente` archiva sus viajes y reconcilia la ubicación.
- **Seed**: ver `docs/CONFIGURACION.md` (rol por prefijo SOLO al crear, en un
  script privado; el login y el servidor leen siempre el rol guardado).

## Qué quedó detrás de un feature flag (desactivado a propósito)

Ver `functions/config.js` (backend) y `lib/config/feature_flags.dart`
(cliente). Ninguno de estos dos archivos necesita más que cambiar un
`true`/`false` y volver a desplegar/compilar para activarse:

- **Geoapify** (`GEOAPIFY_HABILITADO`, punto 6.9): las 6 Cloud Functions
  existen y están probadas de forma estática, pero devuelven un error
  claro mientras el flag esté en `false`. En el cliente, la pantalla del
  paciente usa un campo de texto simple en vez del buscador con
  autocompletado, y la pantalla del chofer oculta los botones de ruta/map
  matching.
- **Restricción geográfica a Chile** (`RESTRICCION_GEOGRAFICA_CHILE_ACTIVA`,
  puntos 11.9/11.10): la validación existe (`validarCoordenada(...,
  {exigirChile: true})`) pero no se exige por defecto.
- **Permisos escalonados** (punto 11.14): `PermisosService` está escrito y
  listo, pero ninguna pantalla lo invoca todavía porque no hay ubicación
  en vivo continua activa (ver más abajo).
- **Regla "por dueño" sin aplicar a nada nuevo** (punto 11.4): la función
  `esDueno(uid)` está definida y documentada en `firestore.rules`, pero no
  se usó para abrir ningún permiso nuevo más allá de lo que ya dependía de
  ella en dializa-app (`respuestas_paciente`).

## Lo que NO se implementó en esta pasada (alcance honesto)

- **Seguimiento continuo de ubicación en segundo plano** (equivalente a
  `UbicacionForegroundService.kt`): se portó la función para compartir la
  ubicación actual *una vez* (botón "Compartir mi ubicación ahora" en el
  panel del chofer), pero no un servicio en primer plano que la empuje
  cada pocos segundos mientras la app está minimizada. Eso requiere
  trabajo nativo adicional (foreground service de Android) que no entró en
  esta pasada.
- **Pantalla de paciente para pedir un viaje bajo demanda**
  (`solicitudes`), lista de pendientes del conductor, vista de historial del
  admin: el backend está listo (Fase 1), faltan las pantallas (Fase 3).
- **Pantalla de detalle de viaje por id**: por eso el deep link de las
  notificaciones push (punto 14.4) quedó simplificado -- el tap solo trae
  la app al frente, no navega a un viaje específico todavía.
- Nada de esto se simuló como si funcionara: cada punto pendiente está
  marcado así en el checklist de `README.md`.
