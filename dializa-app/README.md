# Dializa App

Aplicación para coordinar traslados de pacientes a sus sesiones de diálisis
(confirmación de asistencia, asignación de chofer, seguimiento en vivo y
notificaciones). Desarrollada en Flutter/Dart con backend en Firebase
(Cloud Functions, Firestore, Realtime Database, Auth, Cloud Messaging).

> **Estado:** la Fase 1 (backend, modelo de datos, historial, GPS, seed, reglas
> y tests) está implementada. Las Fases 2-6 (Auth/splash en Flutter, las 3
> interfaces completas, Geoapify real, iOS nativo y verificación completa)
> siguen pendientes. Ver `docs/FASE1_REPORTE.md`.

Esta es ahora **la aplicación principal del proyecto**. Nace como el
trabajo de UI/UX de dializa-app, combinado con la lógica de negocio y el
backend de nuestro desarrollo anterior ("daily-app", Kotlin/Jetpack
Compose), siguiendo punto por punto el documento
`requerimientos_de_la_app.txt` que definió qué se tomaba de cada lado. El
detalle completo de esa combinación está en `docs/ARQUITECTURA.md`.

## Qué se mantuvo tal cual (no se tocó)

Por pedido explícito: todo el trabajo visual/UX de dializa-app se dejó
intacto. Nada de lo siguiente cambió de diseño, solo (en algunos casos) la
fuente de datos detrás:

- Texto grande y simple pensado para adultos mayores.
- Confirmaciones por snackbar.
- Navegación simple basada en rol (admin / chofer / paciente).
- Diseño responsive multiplataforma.
- Gestión de pacientes desde el panel de admin (misma pantalla, ahora
  llama a Cloud Functions en vez de escribir directo a Firestore -- ver
  más abajo).
- Reasignación de chofer/hora desde el panel de admin.
- El concepto central de la app -- confirmación de asistencia del
  paciente (`respuestas_paciente`) -- se mantuvo como lo pidió el cliente
  final, en vez del flujo de solicitud bajo demanda que tenía daily-app
  (ese flujo se agregó aparte, ver abajo).

## Qué se incorporó desde daily-app

- **Roles con autorización mixta**: el cliente sigue leyendo
  `usuarios/{uid}.rol` de Firestore para decidir qué pantalla mostrar,
  pero las Cloud Functions sensibles exigen el *custom claim* de Firebase
  Auth (más difícil de falsificar), con reparación automática para
  cuentas antiguas. Detalle en `docs/ARQUITECTURA.md`.
- **Aprobación de choferes**: un chofer nuevo queda `aprobado: false`
  hasta que un admin lo revisa (pantalla `AdminConductoresScreen`, nueva).
- **Registro de vehículo del chofer** (`RegistroConductorScreen`, nueva):
  patente, licencia, modelo, si es adaptado para movilidad reducida.
- **Máquina de estados del viaje**: `solicitado → asignado →
  conductor_en_camino → conductor_llego → en_viaje → finalizado`, o
  `cancelado`. El chofer la avanza desde su panel. Detalle completo en
  `docs/ESTADOS_VIAJE.md`.
- **Viaje bajo demanda** (`solicitudes/{id}`): además de la asignación
  manual del admin, se portó el modelo donde el paciente pide un
  traslado (con origen, destino y necesidades) y un chofer disponible lo
  acepta. Las Cloud Functions están listas; **todavía no tiene pantalla
  propia en el cliente** (Fase 3).
- **Historial y GPS** (Fase 1): cada viaje cerrado se archiva en
  `historial_viajes`; el recorrido GPS observado se guarda en
  `gps_viajes/{viajeId}/muestras`. Detalle en `docs/ARQUITECTURA.md`.
- **Notificaciones push (FCM)**: se notifica al chofer cuando se le
  asigna un viaje o una solicitud.
- **Ubicación del chofer en Realtime Database**, con autorización
  granular: solo el paciente autorizado para ese viaje puede leer la
  ubicación de su chofer, y un admin siempre puede leerla.
- **Validación de datos centralizada** (`functions/validaciones.js`):
  emails, teléfonos, patentes chilenas, coordenadas, roles, estados, etc.,
  reutilizada por todas las Cloud Functions.
- **Rate limiting y caché** para las llamadas externas (`rateLimit.js`,
  reutilizado del trabajo anterior sobre Geoapify).
- **Auditoría** (`auditoria`): queda registro de quién aprobó/desactivó
  cuentas y por qué.
- **Protección de "último admin"**: no se puede desactivar ni eliminar la
  última cuenta de administrador activa, ni un admin puede
  desactivarse/eliminarse a sí mismo.

## Funciones integradas pero desactivadas a propósito (feature flags)

Varios puntos del requerimiento pedían explícitamente integrar la
función pero dejarla apagada hasta nueva indicación. Cada una se resolvió
con un flag -- **no con código a medio hacer ni comentado**: el código
existe completo, probado estáticamente, y una sola línea activa cada uno.

| Función | Flag | Dónde | Motivo (según el requerimiento) |
| --- | --- | --- | --- |
| Geoapify (geocoding, ruta, map matching) | `GEOAPIFY_HABILITADO` / `geoapifyHabilitado` | `functions/config.js` + `lib/config/feature_flags.dart` | Punto 6.9: "no sé si ella realmente lo implementará en su archivo final" -- integrado y listo, apagado hasta confirmar |
| Restricción geográfica a Chile | `RESTRICCION_GEOGRAFICA_CHILE_ACTIVA` | mismos archivos | Puntos 11.9/11.10: "no aplica aún" |
| Permisos escalonados (ubicación/notificaciones) | `permisosEscalonadosActivos` | `lib/config/feature_flags.dart` | Punto 11.14: escrito y listo, pero no hay ubicación en vivo continua activa todavía |
| Regla "por dueño del documento" | `esDueno()` en `firestore.rules` | -- | Punto 11.4: definida y documentada, no se aplicó a nada nuevo (el usuario pidió que se le explique antes de usarla en más lugares) |

Mientras Geoapify está apagado, la pantalla del paciente muestra un campo
de texto simple para la dirección de retiro (en vez del buscador con
autocompletado), y la pantalla del chofer oculta los botones de
calcular ruta / probar map matching. Ver `docs/CONFIGURACION.md` para los
pasos exactos de activación cuando corresponda.

## Lo que todavía NO está implementado

- Fase 2: capa Auth tipada (repositorios/controladores), modelos `Usuario`/`Viaje`/`Solicitud`,
  registro de paciente, splash con logo nuevo y restauración de sesión por rol.
- Fase 3: pantalla del paciente para pedir un viaje, lista de pendientes con
  "Aceptar" y seguimiento GPS continuo del conductor, vista de historial y
  recorrido del admin.
- Fase 4: pruebas reales de Geoapify y activación del flag.
- Fase 5: configuración nativa de iOS (Info.plist, background modes, APNs).
- Fase 6: matriz de los 115 puntos, `flutter analyze`/`flutter test` reales.

## Estructura del proyecto

```
lib/
  config/feature_flags.dart       Flags del lado cliente
  services/                       Auth, ubicación, Geoapify, mensajería
  screens/                        Pantallas (login, admin, chofer, paciente)
functions/
  index.js                        Wiring: importa y exporta las 27 Cloud Functions
  cuentas.js                      Cuentas, roles, aprobación de choferes
  viajes.js                       Máquina de estados, asignarViaje, cancelación validada
  historial.js                    Archivo idempotente en historial_viajes
  gps.js                          Recorrido GPS observado (gps_viajes)
  autorizacionUbicacion.js        Quién puede leer la ubicación del chofer (RTDB)
  scripts/                        Seed privado de cuentas (no se despliega)
  test/                           Tests unitarios con dobles en memoria
  notificaciones.js               Triggers de FCM
  geoapify-funciones.js           Proxy a Geoapify (detrás del flag)
  validaciones.js                 Validación centralizada
  auditoria.js                    Registro de auditoría
  config.js                       Feature flags del backend
tests/                            Tests de reglas de Firestore/RTDB
docs/
  ARQUITECTURA.md                 Cómo quedó combinado el proyecto, en detalle
  ESTADOS_VIAJE.md                Máquina de estados del viaje
  CONFIGURACION.md                Instalación, despliegue, activación de flags, tests
```

## Verificado vs. no verificado

Resultados reales de la entrega de Fase 1 (sandbox sin Flutter SDK, sin
Firebase CLI/Emulator Suite y con el registro de npm bloqueado):

| Verificación | Estado | Cómo / límite |
| --- | --- | --- |
| Sintaxis de los `.js` de `functions/` | ✅ Ejecutado | `npm run check` (`node --check`) |
| Tests unitarios de `functions/` (77) | ✅ Ejecutado, 77/77 | `cd functions && npm test`. **Con dobles**: `firebase-functions/v2/https` es un doble (el paquete real no se pudo instalar) y Firestore/RTDB/Auth son dobles en memoria. No evalúan reglas ni índices |
| Los tests detectan fallos | ✅ Ejecutado | 9 mutaciones del código (quitar validación de estado, de dueño, de ventana GPS, idempotencia, revocación de tokens, etc.) hicieron fallar tests |
| Seed: lógica pura y garantías | ✅ Ejecutado (con dobles) | `test/seed.test.js`. El script real contra Auth/Firestore **no se ejecutó** |
| `firestore.rules` compila | ❌ No verificado | Se corrigió la estructura (helpers dentro de `match /databases/...`), pero ningún compilador de reglas se ejecutó |
| Tests de reglas Firestore/RTDB | ❌ No ejecutado | Escritos y ampliados; requieren Emulator Suite: `npm install && npm run test:reglas` |
| JSON (`firebase.json`, índices, `database.rules.json`, `package.json`) | ✅ Ejecutado | Parseo JSON |
| Balance de llaves de los `.dart` tocados | ⚠️ Solo chequeo sintáctico | No es `flutter analyze`; no garantiza que compile |
| `flutter analyze` / `flutter test` | ❌ No ejecutado | No hay Flutter SDK |
| Llamadas reales a Geoapify | ❌ No verificado | Fase 4 |
| Despliegue a Firebase | ❌ No ejecutado | Sin credenciales ni red |

## Primeros pasos

Ver `docs/CONFIGURACION.md` para la guía completa (dependencias, carga
de secretos, despliegue, activación de flags, cómo correr cada tier de
tests). En resumen:

```bash
flutter pub get
cd functions && npm install && npm test && cd ..
# Orden de despliegue de la Fase 1: ver docs/CONFIGURACION.md, sección 4
```
