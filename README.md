# Dializa App — Proyecto APT Capstone (PTY4614)

Repositorio vigente: https://github.com/danttegh-ship-it/Capstone

Entrega de correcciones técnicas: [H01–H10, pruebas y pendientes](dializa-app/docs/REVISION_H01_H10_CODEX.md). Codex programa e integra por commits; Claude revisa y prepara documentación/PPT. El material académico inferior corresponde a cortes históricos, no acredita por sí solo la versión actual.

Aplicación móvil para coordinar el traslado de pacientes que asisten a
diálisis. Tiene tres roles: **paciente** (confirma asistencia y si necesita
ayuda de movilidad), **chofer** (ve sus viajes y avanza su estado) y
**administrador** (gestiona pacientes y choferes y asigna viajes). Está hecha en
Flutter, con backend en Firebase (Authentication, Firestore, Realtime Database,
Cloud Functions y Cloud Messaging).

- **Integrantes:** Dantte García · Javiera Vidal
- **Docente:** Mario Herrera Salas · Duoc UC, sede Maipú, sección 004D
- **Nombre anterior:** Dialy-App (Fase 1)
- **Versión entregada con el Informe de Avance Fase 2:** etiqueta [`entrega-fase2`](https://github.com/danttegh-ship-it/Capstone/tree/f79abe8b6ae4c3020fc5a3ca2175eec5349256a6) (corte semana 9). Ver la sección «Versiones».

> **Fases y etapas.** Las *Fases 1, 2 y 3* son las evaluaciones de la
> asignatura. El desarrollo técnico se divide en *Etapas 0 a 6*. Los documentos
> técnicos de `dializa-app/docs/` se escribieron antes de este acuerdo y llaman
> "Fase 0…6" a las etapas: **Fase técnica N = Etapa N**. Por ejemplo,
> `FASE1_REPORTE.md` es el reporte de las Etapas 0 y 1.

## Dónde está cada cosa

| Carpeta o archivo | Contenido |
| --- | --- |
| [`dializa-app/`](dializa-app/) | Código de la aplicación (Flutter) y del backend (`functions/`) |
| [`dializa-app/docs/FASE1_REPORTE.md`](dializa-app/docs/FASE1_REPORTE.md) | Reporte de las Etapas 0 y 1: qué se cambió, por qué y qué falta |
| [`dializa-app/docs/ARQUITECTURA.md`](dializa-app/docs/ARQUITECTURA.md) | Arquitectura y decisiones de diseño |
| [`dializa-app/docs/ESTADOS_VIAJE.md`](dializa-app/docs/ESTADOS_VIAJE.md) | Máquina de estados del viaje |
| [`dializa-app/docs/CONFIGURACION.md`](dializa-app/docs/CONFIGURACION.md) | Instalación, despliegue y pruebas |
| [`dializa-app/docs/DIFERENCIAS_Y_PROPUESTAS.md`](dializa-app/docs/DIFERENCIAS_Y_PROPUESTAS.md) | Propuestas pendientes de decisión del equipo |
| [`docs/diagramas/DISENO.md`](docs/diagramas/DISENO.md) | Diagramas de arquitectura, datos, estados y navegación |
| [`docs/evidencias/INDICE_EVIDENCIAS.md`](docs/evidencias/INDICE_EVIDENCIAS.md) | **Índice de evidencias del informe** |
| [`docs/evidencias/INFORME_PRUEBAS.md`](docs/evidencias/INFORME_PRUEBAS.md) | Pruebas ejecutadas y pendientes, con fechas y comandos |
| [`docs/evidencias/TRAZABILIDAD.md`](docs/evidencias/TRAZABILIDAD.md) | Matriz de requerimientos (parcial) |
| [`docs/evidencias/PERMISOS_Y_PRIVACIDAD.md`](docs/evidencias/PERMISOS_Y_PRIVACIDAD.md) | Quién lee y escribe cada dato, y decisiones de privacidad |
| [`docs/evidencias/PARTICIPACION.md`](docs/evidencias/PARTICIPACION.md) | Aporte de cada integrante y su evidencia en Git |

## Estado al corte de la semana 9

Alcance de las Etapas 0 y 1: backend, modelo de datos, historial de viajes,
GPS, carga inicial de cuentas, reglas de seguridad, correcciones A–E y pruebas.
**No incluye** pantallas nuevas (Etapa 3), pantalla de inicio y autenticación
tipada (Etapa 2), Geoapify real (Etapa 4), iOS nativo (Etapa 5) ni la matriz de
115 puntos (Etapa 6).

### Etapa 0 — entorno

| Herramienta | Resultado |
| --- | --- |
| Node 22, npm 10, Python 3.11, Java | Presentes |
| Flutter / Dart SDK | No disponibles en el entorno de la Etapa 1 |
| Firebase CLI / Emulator Suite | No disponibles (`npm install firebase-tools` respondió HTTP 403) |
| Registro npm | Sin acceso: no se instalaron `firebase-functions` ni `firebase-admin` reales |

Por eso las pruebas de `functions/` usan dobles en memoria (ver abajo).

### Etapa 1 — qué se cambió

**Backend (`dializa-app/functions/`)**
- `historial.js` *(nuevo)*: identificador estable de viaje y archivo idempotente dentro de la transacción.
- `autorizacionUbicacion.js` *(nuevo)*: reconciliación de `pacienteAutorizado` en Realtime Database (corrección A).
- `gps.js` *(nuevo)*: `registrarMuestrasGps`.
- `viajes.js`: correcciones B y C; `asignarViaje` y `sincronizarAutorizacionUbicacion`; archivo y reconciliación en cada cierre.
- `cuentas.js`: corrección D; tokens FCM sin duplicados (`registrarTokenFcm`, `eliminarTokenFcm`); no se puede dar de baja a un chofer con viajes abiertos; `eliminarPaciente` archiva.
- `index.js`: ahora exporta **27** funciones (23 + `asignarViaje`, `sincronizarAutorizacionUbicacion`, `registrarMuestrasGps`, `eliminarTokenFcm`).
- `validaciones.js`: fecha, hora, muestras GPS, puntos de viaje, necesidades y textos opcionales.
- `notificaciones.js`: la notificación de asignación también se envía si cambia `viajeId`.
- `scripts/seed-cuentas.js`, `scripts/seed-lib.js` *(nuevos)*: carga privada de cuentas de prueba.

**Reglas e índices:** `firestore.rules` (`viajes` solo lo escribe el servidor;
`historial_viajes` y `gps_viajes` solo los lee un admin), `database.rules.json`
(`viajeAutorizado` y `autorizacionVersion` no escribibles; validación de
rangos), `firestore.indexes.json` (`historial_viajes` por paciente y por
conductor).

**Flutter (cambios mínimos, sin compilar en el entorno de la Etapa 1):**
`admin_home.dart` asigna mediante `asignarViaje`; `auth_service.dart` gestiona el
token FCM por sesión y el cierre de sesión; `main.dart`, `login_screen.dart`,
`chofer_home.dart` y `paciente_home.dart` se ajustaron a eso.

### Correcciones A–E

| | Corrección | Estado |
| --- | --- | --- |
| A | Autorización de ubicación | Implementada y probada con dobles. Reglas de RTDB ampliadas (no ejecutadas) |
| B | `crearSolicitudViaje` con origen, destino, necesidades y límite de 1 cada 5 s | Implementada y probada con dobles |
| C | Cancelación validada en el servidor | Implementada y probada con dobles. La interfaz del chofer aún muestra el botón en cualquier estado (se ajusta en la Etapa 3) |
| D | Desactivar la cuenta también en Authentication | Implementada y probada con dobles |
| E | Renovación del token FCM | Servidor probado con dobles. **Cliente Dart escrito, sin compilar ni probar** |

## Pruebas

| Verificación | Tipo | Estado | Detalle |
| --- | --- | --- | --- |
| Pruebas unitarias del backend | A: lógica de `functions/` con dobles en memoria de Firestore, RTDB y Auth, y sustituto de `firebase-functions` | ✅ **77/77** (2026-10-09) | `cd dializa-app/functions && npm test` · [registro](docs/evidencias/pruebas_unitarias_2026-10-09.log) |
| Mutaciones del código | Comprobación de que las pruebas A detectan 9 errores elegidos | ✅ **9/9 detectadas** (2026-10-09) | `node test/mutaciones/ejecutar-mutaciones.js` · [registro](docs/evidencias/mutaciones_2026-10-09.log) |
| Sintaxis JavaScript | `node --check` sobre 9 archivos | ✅ (2026-10-09) | `cd dializa-app/functions && npm run check` |
| Lectura de JSON de configuración | Solo comprueba que los archivos sean JSON parseable | ✅ (2026-10-09) | [registro](docs/evidencias/json_2026-10-09.log) |
| Las mismas 77 pruebas con `firebase-functions` real | B: Firestore, RTDB y Auth siguen siendo dobles | ❌ No ejecutada | Requiere `npm install` con acceso al registro npm |
| Reglas de Firestore (18 casos) y RTDB (13 casos) | C: reglas reales en el Emulator Suite | ❌ Escritas, no ejecutadas | Requieren Java y Firebase CLI |
| `flutter analyze`, `flutter test`, compilación | E: cliente | ❌ No ejecutadas | Requieren Flutter SDK |
| Integración con emuladores y extremo a extremo | D y E | ❌ No escritas | Etapa 6 |

Las ejecuciones del 2026-10-09 las hizo un asistente de IA durante la revisión
del informe; el equipo aún no las ha repetido en sus equipos. Detalle, tipos de
prueba y comandos pendientes: [`docs/evidencias/INFORME_PRUEBAS.md`](docs/evidencias/INFORME_PRUEBAS.md).

## Cómo ejecutar

```bash
# Pruebas del backend (Node 20 o superior)
cd dializa-app/functions
npm install        # instala firebase-functions y firebase-admin
npm test           # 77 pruebas unitarias (tipo B: Firestore, RTDB y Auth siguen simulados)

# Pruebas de reglas (requiere Java y Firebase CLI)
cd ..
npm install
npm run test:reglas

# Cliente Flutter
flutter pub get
flutter analyze
flutter test
```

El archivo `android/app/google-services.json` no está en el repositorio (ver
`.gitignore`); se descarga desde la consola de Firebase. El orden de despliegue
de las reglas y funciones está en `dializa-app/docs/CONFIGURACION.md`, sección 4.

## Seguridad y decisiones abiertas

- Las **escrituras** de datos de negocio solo las hace el servidor; el cliente
  solo escribe la respuesta de asistencia del paciente.
- Las **lecturas** de `usuarios`, `viajes`, `solicitudes` y
  `respuestas_paciente` siguen abiertas a cualquier usuario autenticado. Hay
  una propuesta de reglas restringidas, **no aplicada ni probada**, en
  [`PERMISOS_Y_PRIVACIDAD.md`](docs/evidencias/PERMISOS_Y_PRIVACIDAD.md).
- La ubicación del chofer se comparte con el paciente desde
  `conductor_en_camino` en los viajes asignados por el administrador y desde
  `asignado` en las solicitudes. Está **implementado**; falta que el equipo lo
  confirme como decisión de negocio.
- Las propuestas 1 a 7 de `DIFERENCIAS_Y_PROPUESTAS.md` siguen pendientes de
  decisión.

## Versiones

| Etiqueta | Commit | Qué contiene | Estado |
| --- | --- | --- | --- |
| `avance-fase2` | `62f7649` | Primera preparación de las evidencias (código descomprimido, README y documentos de `docs/`) | Solo local; nunca se publicó. Se conserva sin modificar |
| `entrega-fase2` | Ver `git show entrega-fase2` | Versión entregada: documentación corregida, registros de pruebas y mutaciones, e informe final en `docs/informe/` | Ver estado de publicación abajo |

El código de la aplicación (`dializa-app/lib`, `dializa-app/functions` sin
`test/mutaciones`, reglas e índices) es el mismo en ambas etiquetas y en el
commit `567efdf` (salvo `android/app/google-services.json`, que el `.gitignore`
excluye): solo cambiaron la documentación, los registros y el script de
mutaciones.

**Si el informe se modifica antes de publicar:** hacer un commit nuevo con el
.docx corregido y mover la etiqueta **antes del primer `git push`**
(`git tag -f -a entrega-fase2 -m "Version entregada"`). Una vez publicada, la
etiqueta no se mueve: cualquier cambio posterior va en una etiqueta nueva
(por ejemplo, `entrega-fase2-r1`).

**Estado de publicación al preparar esta versión:** existe localmente. El
último commit publicado en GitHub era `567efdf`. La publicación y el acceso del
docente deben comprobarse después de hacer `git push`.

## Uso de inteligencia artificial

El código del backend, las pruebas y la documentación técnica se desarrollaron
con apoyo de asistentes de IA (Codex de OpenAI y Claude de Anthropic). El equipo
definió los requerimientos, revisó los cambios y ejecutó las pruebas. La
declaración completa está en el Anexo B del informe.
