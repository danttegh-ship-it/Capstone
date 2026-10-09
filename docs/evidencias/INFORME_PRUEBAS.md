# Informe de pruebas — corte semana 9 (Fase 2)

Este documento respalda la Tabla 5 y el Anexo A del Informe de Avance de la
Fase 2. Separa lo que se **ejecutó** de lo que está **escrito pero no
ejecutado**, e indica fecha, comando, entorno y versión de cada ejecución.

## 1. Ejecuciones registradas

| # | Fecha | Qué | Comando | Entorno | Versión del código | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | 2026-10-07 | Pruebas unitarias del backend (ejecución original de la Etapa 1) | `cd functions && npm test` | Node 22.22.2, npm 10.9.7 (declarado en `FASE1_REPORTE.md`) | Base del zip `dializa-app-fase1.zip` | 77 pasan, 0 fallan (declarado; no se conserva el registro) |
| E2 | 2026-10-07 | 9 mutaciones del código (ejecución original) | — | Igual que E1 | Igual que E1 | Cada mutación hizo fallar entre 2 y 6 pruebas (declarado; **no se documentó cuáles fueron las 9 mutaciones**) |
| E3 | 2026-10-09 | Repetición de las pruebas unitarias | `cd dializa-app/functions && npm test` | Linux, Node 22.22.0, npm 10.9.4, sin `node_modules` | Contenido de `dializa-app-fase1.zip` (commit `567efdf`), hoy en `dializa-app/` | **77 pasan, 0 fallan.** Registro completo: [`pruebas_unitarias_2026-10-09.log`](pruebas_unitarias_2026-10-09.log) |
| E4 | 2026-10-09 | Revisión de sintaxis de los `.js` | `npm run check` | Igual que E3 | Igual que E3 | Sin errores (mismo registro) |
| E5 | 2026-10-09 | Lectura de los JSON de configuración | `node -e "JSON.parse(...)"` | Igual que E3 | Igual que E3 | `firebase.json`, `firestore.indexes.json`, `database.rules.json` y ambos `package.json` son JSON válidos |
| E6 | 2026-10-09 | Nueva verificación por mutaciones (sección 3) | Script que modifica una línea, corre `npm test` y restaura | Igual que E3 | Igual que E3 | **9 de 9 mutaciones detectadas**; con el código original vuelve a 77/77 |

Las ejecuciones E3 a E6 se hicieron con apoyo de un asistente de IA (Claude) en
un entorno Linux, y se declaran en el Anexo B del informe.

## 2. Qué son las 77 pruebas

Son **pruebas unitarias con dobles en memoria**: Firestore, Realtime Database y
Authentication se reemplazan por implementaciones en memoria con transacciones
optimistas (`functions/test/helpers/memoria.js`), y `firebase-functions/v2/https`
también es un doble porque el paquete real no se pudo instalar
(`functions/test/helpers/entorno.js`). La primera línea de cada archivo lo
declara.

| Archivo | Pruebas | Qué cubre |
| --- | ---: | --- |
| `functions/test/viajes.test.js` | 27 | Solicitudes (corrección B), cancelación válida e inválida (corrección C), archivo en `historial_viajes` sin pérdida ni duplicados, `asignarViaje` (concurrencia, reasignación, permisos) |
| `functions/test/cuentas.test.js` | 13 | Desactivación en Auth (corrección D), tokens FCM (corrección E), bajas de chofer y paciente |
| `functions/test/gps.test.js` | 12 | `registrarMuestrasGps`: viaje ajeno, datos inválidos, tope, frecuencia, cierre, carrera con el cierre |
| `functions/test/autorizacion.test.js` | 10 | Autorización de ubicación (corrección A): concesión, revocación, paciente anterior, evento tardío, fallo de RTDB, `update()` vs `set()` |
| `functions/test/seed.test.js` | 9 | Script de cuentas: no cambia roles existentes, no expone la contraseña |
| `functions/test/validaciones-fase1.test.js` | 5 | Validadores nuevos de fecha, hora, puntos, necesidades y GPS |
| `functions/test/validaciones.test.js` | 1 | Una sola prueba que agrupa 38 comprobaciones de validadores (correo, teléfono, patente, coordenadas, etc.) |
| **Total** | **77** | |

**Límites:** estas pruebas verifican la lógica de negocio, pero **no** evalúan
las reglas de seguridad, los índices, el comportamiento real de los SDK de
Firebase ni el cliente Flutter.

## 3. Verificación por mutaciones (E6, 2026-10-09)

Una mutación es un cambio deliberado que introduce un error en el código. Si las
pruebas fallan, se comprueba que detectan ese error. Cada mutación se aplicó
sobre una copia, se ejecutó `npm test` y se descartó la copia.

| ID | Archivo | Error introducido | Pruebas que fallan | Prueba que lo detecta (ejemplo) |
| --- | --- | --- | ---: | --- |
| M1 | `viajes.js` | Se elimina la validación de transiciones de estado | 5 | `actualizarEstadoViaje: transiciones validas e invalidas` |
| M2 | `viajes.js` | Se elimina la verificación de que el chofer sea el asignado | 1 | `C: un chofer ajeno no puede cancelar` |
| M3 | `viajes.js` | Se permite reasignar un viaje en curso | 1 | `asignarViaje: un viaje en curso (conductor_llego / en_viaje) NO se puede reasignar` |
| M4 | `historial.js` | Se quita la idempotencia del archivo | 1 | `historial: archivar es IDEMPOTENTE` |
| M5 | `gps.js` | Se quita el tope de 5000 muestras por viaje | 1 | `GPS: tope de 5000 muestras por viaje` |
| M6 | `validaciones.js` | Se quita la ventana de tiempo de las muestras GPS | 2 | `GPS: ... timestamps fuera de ventana ... se rechazan` |
| M7 | `cuentas.js` | Desactivar una cuenta ya no revoca los refresh tokens | 1 | `D: desactivar -> ... refresh tokens revocados` |
| M8 | `cuentas.js` | Se permite eliminar un chofer con viajes abiertos | 1 | `eliminarCuenta de un chofer con viajes sin cerrar es RECHAZADA` |
| M9 | `autorizacionUbicacion.js` | Una reconciliación tardía puede sobrescribir una más nueva | 1 | `A: un evento TARDIO ... no revoca ni concede` |

Resultado: **9 de 9 mutaciones detectadas.** Siete de ellas las detecta una sola
prueba, por lo que esas zonas dependen de un único caso. Este conjunto de 9
mutaciones reemplaza al de la ejecución E2, que no quedó documentado.

## 4. Escrito pero no ejecutado

| Qué | Archivo | Casos | Comando | Requiere | Estado |
| --- | --- | ---: | --- | --- | --- |
| Reglas de Firestore | `tests/firestore.rules.test.js` | 18 | `npm install && npm run test:reglas:firestore` | Node, Firebase CLI, Emulator Suite, Java | Pendiente |
| Reglas de Realtime Database | `tests/database.rules.test.js` | 13 | `npm run test:reglas:database` | Igual | Pendiente |
| Backend con `firebase-functions` y `firebase-admin` reales | `functions/test/*` | 77 | `cd functions && npm install && npm test` | Acceso al registro npm | Pendiente: el 2026-10-09 tampoco se pudo (sin acceso al registro desde el entorno usado) |
| Análisis y prueba del cliente Flutter | `test/widget_test.dart` | 1 | `flutter analyze && flutter test` | Flutter SDK | Pendiente |
| Integración de extremo a extremo | — | — | — | Emulator Suite | No escrita (Etapa 6) |

Cuando el equipo ejecute cualquiera de estas pruebas, debe agregar una fila a la
sección 1 con fecha, comando, entorno, commit y resultado, y guardar la salida
en esta carpeta.
