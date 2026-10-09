# Reporte de la entrega — Fase 0 + Fase 1

Alcance: backend, modelo de datos, historial, GPS, seed, reglas, correcciones
A–E y tests. **No incluye** pantallas nuevas (Fase 3), splash/Auth tipada
(Fase 2), Geoapify real (Fase 4), iOS nativo (Fase 5) ni la matriz de 115
puntos (Fase 6).

## Fase 0 — entorno

| Herramienta | Resultado |
| --- | --- |
| Node 22.22.2, npm 10.9.7, Python 3.11, Java | Presentes |
| Flutter / Dart SDK | No hay |
| Firebase CLI / Emulator Suite | No hay; `npm install firebase-tools` → HTTP 403 |
| Registro npm | Al inicio de esta pasada respondía 403 incluso para `lodash`: **no se pudo instalar `firebase-functions` ni `firebase-admin` reales** |

Consecuencia: los tests de `functions/` usan dobles (declarado más abajo).
Base: `dializa-app-combinada.zip`. `.gitignore` actualizado (node_modules,
logs de Firebase, `.env*`, cuentas de servicio, `secrets.properties`,
`apis_*.txt`, etc.; `google-services.json`/`GoogleService-Info.plist`
quedan como líneas comentadas, punto 11.13).

## Archivos cambiados y por qué

**Backend (`functions/`)**
- `historial.js` *(nuevo)*: id estable de viaje, archivo idempotente dentro de la transacción.
- `autorizacionUbicacion.js` *(nuevo)*: reconciliación de `pacienteAutorizado` en RTDB (corrección A).
- `gps.js` *(nuevo)*: `registrarMuestrasGps`.
- `viajes.js`: correcciones B y C; `asignarViaje`, `sincronizarAutorizacionUbicacion`; archivo y reconciliación en cada cierre.
- `cuentas.js`: corrección D; higiene de token FCM (`registrarTokenFcm` dedupe, `eliminarTokenFcm`); bloqueo de baja de chofer con viajes abiertos; `eliminarPaciente` archiva.
- `index.js`: cableado (RTDB perezoso); ahora **27** funciones (23 + `asignarViaje`, `sincronizarAutorizacionUbicacion`, `registrarMuestrasGps`, `eliminarTokenFcm`).
- `validaciones.js`: `validarFecha/Hora`, `validarMuestrasGps`, `validarPuntoViaje`, `validarNecesidades`, `validarTextoOpcional`.
- `notificaciones.js`: el trigger de asignación también dispara si cambia `viajeId` (reasignación al mismo chofer).
- `scripts/seed-cuentas.js`, `scripts/seed-lib.js` *(nuevos)*: seed privado.
- `package.json`: scripts `test`, `check`, `seed`.

**Reglas e índices**: `firestore.rules` (helpers dentro de `match`; `viajes` write:false; `historial_viajes` y `gps_viajes` solo lectura admin), `database.rules.json` (`viajeAutorizado`/`autorizacionVersion` write:false; validación de rangos), `firestore.indexes.json` (`historial_viajes` por `pacienteId`+`archivadoEn↓` y `conductorId`+`archivadoEn↓`), `firebase.json` (ignora `scripts` y `test` al desplegar).

**Flutter (mínimo; no compilado aquí)**: `admin_home.dart` (asignar vía callable, SnackBar con el mensaje del servidor, import sin uso eliminado), `auth_service.dart` (gestión FCM por sesión + `cerrarSesion`), `main.dart` (arranca la gestión), `login_screen.dart` (ya no registra el token: lo hace la gestión por sesión), `chofer_home.dart` / `paciente_home.dart` (usan `AuthService().cerrarSesion()`; `paciente_home` además conserva los cambios del flag de dirección de pasadas anteriores).

**Tests**: `functions/test/*.test.js` + `helpers/`, `tests/*.rules.test.js` ampliados, `package.json` raíz.
**Docs**: `README.md`, `docs/ARQUITECTURA.md`, `ESTADOS_VIAJE.md`, `CONFIGURACION.md`, este reporte y `DIFERENCIAS_Y_PROPUESTAS.md`.

## Cambios de modelo/reglas y compatibilidad

- `viajes/{pacienteId}`: nuevos campos `viajeId`, `asignadoEn`, `asignadoPor` y `actorUid` en las entradas de `historial`. Los documentos viejos siguen funcionando (id `legacy_…`, `esLegacy:true`).
- `solicitudes/{id}`: ahora guarda `origen`, `destino`, `necesidades` (campos existentes conservados).
- Nuevas colecciones: `historial_viajes`, `gps_viajes` (+ subcolecciones `muestras`, `derivadas` reservada).
- RTDB `ubicaciones/{uid}`: campos de servidor `viajeAutorizado`, `autorizacionVersion`. `pacienteAutorizado` sigue en el mismo lugar.
- **Ruptura controlada**: una app de admin anterior (`.set()` directo a `viajes`) deja de poder asignar cuando se despliegan las reglas. Orden de despliegue en `docs/CONFIGURACION.md` §4.
- `crearSolicitudViaje` ahora **exige** `origen` y `destino`. No hay cliente que la llame todavía, así que no rompe nada existente.

## Correcciones A–E

| | Estado |
| --- | --- |
| A Autorización de ubicación | Implementada y probada con dobles (concesión, revocación, paciente anterior, reasignación, evento tardío, fallo de RTDB, `update()` vs `set()`). Reglas RTDB ampliadas (no ejecutadas). |
| B `crearSolicitudViaje` | Implementada y probada con dobles (persistencia y validación de origen/destino/necesidades, rate limit 1 cada 5 s por usuario, cuenta activa). |
| C Cancelación validada | Implementada y probada con dobles (válida desde 3 estados × 2 colecciones; rechazada en 3 estados; ajeno; concurrente). La UI actual del chofer aún puede mostrar el botón en cualquier estado: el servidor lo rechaza; el ajuste de UI es Fase 3. |
| D Desactivar en Auth | Implementada y probada con dobles. Alcance acotado a lo que Firebase garantiza (ver ARQUITECTURA). |
| E Renovación FCM | Servidor: implementado y probado con dobles. **Cliente Dart: escrito, no compilado ni probado** (sin Flutter SDK). |

## Tests: ejecutados vs. pendientes

**Ejecutados** (`cd functions && npm test`, salida real: *77 tests, 77 pasan, 0 fallan*). Qué son: tests **unitarios con dobles** (Firestore/RTDB/Auth en memoria con transacciones optimistas; `firebase-functions/v2/https` también es un doble porque el paquete real no se pudo instalar). La primera línea de cada archivo lo declara. Cubren: archivo sin pérdida e idempotente (incluido viaje legado), cancelación válida/inválida, asignación concurrente, autorización/revocación de ubicación (incluido evento tardío), GPS ajeno/inválido/posterior al cierre/tope/frecuencia/carrera con el cierre, `update()` que no borra la autorización, seed que no cambia roles existentes ni expone la contraseña, validadores nuevos.
Verificación de que los tests detectan fallos: 9 mutaciones del código fuente, cada una hizo fallar entre 2 y 6 tests; el código restaurado vuelve a 77/77.

**No ejecutados** (necesitan herramientas que no hay aquí):

| Qué | Comando | Requiere |
| --- | --- | --- |
| Reglas de Firestore (incluye `historial_viajes`, `gps_viajes`, `viajes` write:false, datos privados del conductor) | `npm install && npm run test:reglas:firestore` | Node + Firebase CLI + emulador (descarga) + Java |
| Reglas de RTDB (incluye `viajeAutorizado`/`autorizacionVersion` no escribibles, `set()` rechazado, rangos) | `npm run test:reglas:database` | idem |
| Tests con `firebase-functions`/`firebase-admin` reales | `cd functions && npm install && npm test` | acceso al registro npm |
| Integración end-to-end contra emuladores (callables reales + reglas) | no escrita aún | Emulator Suite; se propone para la Fase 6 |
| Seed contra el emulador / proyecto real | ver `docs/CONFIGURACION.md` §8 | credenciales o emulador |
| `flutter analyze`, `flutter test` | `flutter analyze && flutter test` | Flutter SDK |

## Puntos del requerimiento tocados en esta fase
6.4 (autorización mixta, sin cambio de modelo), 9.2, 9.5 y 14.2 (token FCM por sesión), 9.10 (protecciones de admin intactas), 10.2 (datos del conductor siguen privados), 10.3 y 10.10 (solicitudes con historial y cambios de estado, ahora archivados), 10.8 (rate limit por usuario+acción en solicitudes y GPS), 11.4 (`esDueno` sin ampliar), 11.9/11.10 (flags respetados por los validadores nuevos), 11.13 (`.gitignore`, líneas de `google-services.json` comentadas). La matriz completa de 115 puntos es Fase 6.

## Fuera de lo pedido (lo que toqué además)
- Reglas: `viajes` pasó a `write:false` (consecuencia necesaria de `asignarViaje`).
- 4 funciones nuevas (`asignarViaje`, `sincronizarAutorizacionUbicacion`, `registrarMuestrasGps`, `eliminarTokenFcm`).
- `registrarTokenFcm` ahora limpia el token de otras cuentas; `eliminarCuenta` de chofer y `eliminarPaciente` cambiaron de comportamiento (ver arriba).
- Se reasigna solo si el viaje no está en `conductor_llego`/`en_viaje`.
- Validación de rangos en las reglas RTDB.
- `login_screen.dart` dejó de registrar el token (lo hace la gestión por sesión).
- Hallazgos de privacidad sin aplicar (`DIFERENCIAS_Y_PROPUESTAS.md` §7).

## Decisiones que necesito de ti
1. ¿Apruebas las propuestas 1–7 de `DIFERENCIAS_Y_PROPUESTAS.md`? La **7** (quién puede leer direcciones y tokens) la recomiendo antes de usar datos reales.
2. ¿Te sirve que `viajes` autorice la ubicación desde `conductor_en_camino` (y no desde la asignación)?
