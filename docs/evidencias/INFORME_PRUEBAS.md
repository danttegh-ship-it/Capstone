# Informe de pruebas — corte semana 9 (Fase 2)

Este documento respalda la Tabla 6 y el Anexo A.3 del Informe de Avance de la
Fase 2. Para cada verificación indica qué se ejecutó, quién lo ejecutó, con qué
comando, en qué entorno, sobre qué versión y con qué resultado, y separa lo
ejecutado de lo que está escrito pero no ejecutado.

## 1. Tipos de prueba del proyecto

| Tipo | Qué ejercita de verdad | Qué sigue simulado | Archivos | Estado al corte |
| --- | --- | --- | --- | --- |
| **A. Unitarias con dobles y sustituto de `firebase-functions`** | La lógica de negocio de `functions/` (validaciones, transiciones, transacciones optimistas, idempotencia) | Firestore, Realtime Database y Authentication (dobles en memoria, `test/helpers/memoria.js`) y `firebase-functions/v2/https` (doble mínimo, `test/helpers/entorno.js`) | `functions/test/*.test.js` | **Ejecutadas: 77/77** |
| **B. Las mismas unitarias con `firebase-functions` instalado** | Además, el `onCall` y el `HttpsError` reales del paquete | Firestore, RTDB y Authentication siguen siendo dobles en memoria; `firebase-admin` no se ejercita contra servicios reales | Igual que A, tras `npm install` | **No ejecutadas** (sin acceso al registro npm) |
| **C. Reglas de seguridad en emuladores** | `firestore.rules` y `database.rules.json` reales, evaluados por el Emulator Suite | Los datos de prueba | `tests/firestore.rules.test.js` (18 casos), `tests/database.rules.test.js` (13 casos) | **Escritas, no ejecutadas** |
| **D. Integración con componentes emulados** | Cloud Functions llamadas como callables contra Firestore/RTDB/Auth emulados y las reglas | Nada de Firebase, salvo que corre en local | — | **No escritas** (Etapa 6) |
| **E. Cliente Flutter y extremo a extremo** | Análisis estático y pruebas de widgets del cliente; flujo completo en dispositivo | — | `test/widget_test.dart` (1 prueba de renderizado del login) | **No ejecutadas** (sin Flutter SDK en el entorno disponible) |

Instalar las dependencias (`npm install`) convierte el tipo A en el tipo B,
pero **no** convierte las 77 pruebas en pruebas de integración ni valida
`firebase-admin` contra servicios reales.

## 2. Ejecuciones registradas

| # | Fecha | Qué | Quién ejecutó | Comando | Entorno | Versión | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | 2026-10-07 | Tipo A (ejecución original de la Etapa 1) | Entorno de trabajo de la Etapa 1 (sandbox sin Flutter ni acceso a npm), según `FASE1_REPORTE.md` | `cd functions && npm test` | Node 22.22.2, npm 10.9.7 (declarado) | Contenido de `dializa-app-fase1.zip` | 77 pasan, 0 fallan (declarado; no se conserva el registro) |
| E2 | 2026-10-07 | 9 mutaciones (ejecución original) | Igual que E1 | No documentado | Igual que E1 | Igual que E1 | Cada una hizo fallar entre 2 y 6 pruebas (declarado; **no se documentó cuáles fueron**) |
| E3 | 2026-10-09 | Tipo A | Asistente de IA (Claude) en la revisión del informe | `cd dializa-app/functions && npm test` | Linux, Node 22.22.0, npm 10.9.4, sin `node_modules` | Código del commit `567efdf`, descomprimido sin cambios en `dializa-app/` | **77 pasan, 0 fallan.** [Registro](pruebas_unitarias_2026-10-09.log) |
| E4 | 2026-10-09 | Sintaxis JavaScript | Igual que E3 | `cd dializa-app/functions && npm run check` (`node --check` sobre 9 archivos `.js`) | Igual que E3 | Igual que E3 | Sin errores (al final del mismo registro) |
| E5 | 2026-10-09 | Lectura de JSON | Igual que E3 | Ver [registro](json_2026-10-09.log) | Igual que E3 | Igual que E3 | Los 6 archivos son JSON parseable. **No** demuestra que las reglas, índices o la configuración sean correctos o desplegables |
| E6 | 2026-10-09 | 9 mutaciones reproducibles | Igual que E3 | `cd dializa-app/functions && node test/mutaciones/ejecutar-mutaciones.js` | Igual que E3 | Igual que E3 | **9 de 9 detectadas**; código original 77/77. [Registro](mutaciones_2026-10-09.log) |

Las ejecuciones E3 a E6 las hizo un asistente de IA durante la revisión del
informe. **El equipo todavía no las ha repetido en sus equipos**; cuando lo
haga, debe agregar una fila con fecha, quién ejecutó, comando, entorno, commit y
resultado, y guardar la salida en esta carpeta.

## 3. Qué cubren las 77 pruebas (tipo A)

| Archivo | Pruebas | Qué cubre |
| --- | ---: | --- |
| `functions/test/viajes.test.js` | 27 | Solicitudes (corrección B), cancelación válida e inválida (corrección C), archivo en `historial_viajes`, `asignarViaje` (concurrencia, reasignación, permisos) |
| `functions/test/cuentas.test.js` | 13 | Desactivación en Auth (corrección D), tokens FCM (corrección E), bajas de chofer y paciente |
| `functions/test/gps.test.js` | 12 | `registrarMuestrasGps`: viaje ajeno, datos inválidos, tope, frecuencia, cierre, carrera con el cierre |
| `functions/test/autorizacion.test.js` | 10 | Autorización de ubicación (corrección A) |
| `functions/test/seed.test.js` | 9 | Script de cuentas de prueba: no cambia roles existentes, no expone la contraseña |
| `functions/test/validaciones-fase1.test.js` | 5 | Validadores de fecha, hora, puntos, necesidades y GPS |
| `functions/test/validaciones.test.js` | 1 | Una prueba que agrupa 38 comprobaciones de validadores |
| **Total** | **77** | |

## 4. Verificación por mutaciones (E6)

Una mutación introduce un error a propósito para comprobar que alguna prueba lo
detecta. El script [`ejecutar-mutaciones.js`](../../dializa-app/functions/test/mutaciones/ejecutar-mutaciones.js)
copia `functions/` a una carpeta temporal, aplica un reemplazo exacto de texto,
ejecuta `npm test` en la copia y la borra; el código original no se modifica.
Al final ejecuta la suite sobre el código original.

| ID | Archivo | Error introducido | Pruebas que fallan |
| --- | --- | --- | ---: |
| M1 | `viajes.js` | Se elimina la validación de transiciones de estado | 5 |
| M2 | `viajes.js` | Se elimina la verificación de que el chofer sea el asignado | 1 |
| M3 | `viajes.js` | Se permite reasignar un viaje en curso | 1 |
| M4 | `historial.js` | Se quita la idempotencia del archivo | 1 |
| M5 | `gps.js` | Se quita el tope de muestras por viaje | 1 |
| M6 | `validaciones.js` | Se quita la ventana de tiempo de las muestras GPS | 2 |
| M7 | `cuentas.js` | Desactivar una cuenta ya no revoca los refresh tokens | 1 |
| M8 | `cuentas.js` | Se permite eliminar un chofer con viajes abiertos | 1 |
| M9 | `autorizacionUbicacion.js` | Una reconciliación tardía puede sobrescribir una más nueva | 1 |

El cambio exacto y los nombres de las pruebas que fallan están en el
[registro](mutaciones_2026-10-09.log). Siete de las nueve mutaciones las detecta
una sola prueba. Son nueve mutaciones elegidas a mano sobre validaciones
críticas: **no** miden la cobertura del código ni la calidad de toda la suite.

## 5. Escrito pero no ejecutado

| Qué | Tipo | Directorio y comando | Requiere | Cómo guardar la evidencia |
| --- | --- | --- | --- | --- |
| Pruebas con `firebase-functions` real | B | `cd dializa-app/functions && npm install && npm test > ../../docs/evidencias/pruebas_tipoB_AAAA-MM-DD.log` | Node 20 o superior y acceso al registro npm | Verificar que el registro diga «firebase-functions REAL» |
| Reglas de Firestore | C | `cd dializa-app && npm install && npm run test:reglas:firestore` | Node, Java 11 o superior, Firebase CLI (se instala con `npm install`) | Redirigir la salida a `docs/evidencias/reglas_firestore_AAAA-MM-DD.log` |
| Reglas de Realtime Database | C | `cd dializa-app && npm run test:reglas:database` | Igual | `docs/evidencias/reglas_rtdb_AAAA-MM-DD.log` |
| Análisis del cliente | E | `cd dializa-app && flutter pub get && flutter analyze` | Flutter SDK | `docs/evidencias/flutter_analyze_AAAA-MM-DD.log` |
| Pruebas del cliente | E | `cd dializa-app && flutter test` | Flutter SDK | `docs/evidencias/flutter_test_AAAA-MM-DD.log` |
| Compilación Android | E | `cd dializa-app && flutter build apk --debug` | Flutter SDK y Android SDK | Registro de la compilación |
| Integración con emuladores | D | No escrita | Emulator Suite | Etapa 6 |

Si una prueba falla, se registra el fallo, se corrige en un commit propio y se
vuelve a ejecutar; ambos registros se conservan.
