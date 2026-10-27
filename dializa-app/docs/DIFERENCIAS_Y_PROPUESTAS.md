> Actualización 26-10-2026: este documento describe la base histórica. Para los contratos, privacidad, recuperación y límites vigentes de H01–H10 consulte [la entrega actual](REVISION_H01_H10_CODEX.md); ante discrepancias prevalece el código del SHA revisado.

# Otras diferencias con daily-app: análisis y propuestas

Pedido del prompt de Codex: **analizar y proponer una decisión; no corregir
en silencio**. Nada de lo de esta lista se aplicó salvo donde se indica
"APLICADO". Cada punto necesita tu aprobación (o la de Codex) antes de
tocarlo.

## Aplicado en la Fase 1 (para que lo veas)

| # | Hallazgo | Qué se hizo |
| --- | --- | --- |
| F1 | `firestore.rules` tenía las funciones auxiliares (`esAdmin`, `rolDe`, …) **fuera** de `service cloud.firestore`. Usan `$(database)`, así que el archivo no habría desplegado. Error mío de una pasada anterior. | **APLICADO**: movidas dentro de `match /databases/{database}/documents`. **No verificado con un compilador de reglas** (no hay emulador aquí): lo cubre `npm run test:reglas:firestore`. |
| F2 | Con "autorización al asignar" un chofer con varios viajes futuros daría acceso a muchos pacientes a la vez sobre un único nodo RTDB. | **APLICADO como decisión de diseño**: `viajes` autoriza desde `conductor_en_camino`; `solicitudes` desde `asignado`. Ver `docs/ARQUITECTURA.md`. Es una desviación consciente del "conceder al asignar"; si prefieres otra, es un cambio de una constante (`ESTADOS_AUTORIZAN`). |
| F3 | GPS "dentro del documento de `historial_viajes`" (orden anterior) vs. "nunca un arreglo sin límite en un documento" (prompt actual). | **APLICADO**: subcolección `gps_viajes/{viajeId}/muestras`; el historial guarda el resumen `gps{conteo,primerTs,ultimoTs}` y comparte `viajeId`. |

## Pendientes de decisión

### 1. El claim `chofer` se emite antes de la aprobación
- **Hoy**: `solicitarRegistroConductor` hace `setCustomUserClaims(uid,{rol:'chofer'})` al registrarse. Las reglas de RTDB solo miran el claim, así que un chofer **sin aprobar** puede escribir `lat/lng/timestamp` en SU nodo (no lo lee nadie salvo admin; las reglas ya validan rangos). Las Cloud Functions sí lo bloquean (`aprobado!==true`).
- **daily-app**: igual en el claim; pero ahí la aprobación también se exige en el servidor.
- **Propuesta**: emitir el claim `chofer` solo en `aprobarConductor`, y que el cliente fuerce `getIdToken(true)` cuando detecta `aprobado:true`. Riesgo: sin ese refresco el chofer recién aprobado no podría escribir su ubicación hasta ~1 h. Necesita un cambio de cliente (Fase 2/3).

### 2. `exigirPerfilValido` es más permisivo que daily-app
- **Hoy**: si el claim y el rol de Firestore discrepan, gana Firestore (sin registrar la discrepancia), y acepta `activo` ausente (solo bloquea `activo===false`).
- **daily-app**: exigía `activo===true`.
- **Propuesta**: (a) registrar en auditoría toda discrepancia claim/Firestore; (b) tras un backfill que ponga `activo:true` en cuentas antiguas, exigir `activo===true`. Aplicarlo hoy dejaría fuera a las cuentas creadas sin ese campo.

### 3. Operaciones reducidas respecto de daily-app
- El paciente **no puede cancelar** su solicitud pendiente, y el admin no tiene operaciones de estado sobre un viaje. **Propuesta**: `cancelarSolicitudPaciente` (solo desde `solicitado`/`asignado`, con archivo e historial) y `adminCambiarEstado` (con auditoría), junto con las pantallas de la Fase 3.

### 4. Notificaciones de estado y de cancelación (daily-app)
- Hoy solo se notifica la asignación. **Propuesta**: trigger en `viajes`/`solicitudes` que avise al paciente en `conductor_en_camino`, `conductor_llego`, `finalizado` y `cancelado`, y al chofer cuando se cancela. Fase 3 o 5.

### 5. Geocodificación inversa y POI en Dart
- Faltan los métodos Dart (las funciones de servidor existen detrás del flag). **Propuesta**: Fase 4, con el flag apagado hasta que pasen las pruebas externas.

### 6. Ruta: `puntosRuta` en vez de polilínea codificada
- dializa-app dibuja `puntosRuta`; daily-app devolvía polilínea codificada. Sin impacto funcional; **propuesta**: mantener `puntosRuta` y documentarlo.

### 7. Privacidad de lectura en Firestore (hallazgos nuevos, importantes)
Con la corrección B, `solicitudes` ahora guarda **direcciones de origen y destino**, y hoy cualquier usuario autenticado puede leerlas:
- `solicitudes/*` y `viajes/*`: lectura para cualquier autenticado → un paciente puede leer los viajes y direcciones de otros.
- `usuarios/*`: lectura para cualquier autenticado, y ese documento contiene `fcmToken` → cualquier usuario puede leer el token de otro.
- **Propuesta** (reglas; hay que alinearla con las consultas de las pantallas de Fase 3):
  - `solicitudes`: admin; el paciente dueño; el chofer asignado; y los choferes aprobados solo si `estado=='solicitado'`.
  - `viajes`: admin, el paciente (id del documento) y el chofer asignado.
  - mover `fcmToken` a un documento privado (`usuarios_privado/{uid}`) legible solo por el servidor.
- No se aplicó porque cambia lo que ven las pantallas existentes y el prompt pidió no quitar ni reinterpretar protecciones sin acuerdo; **recomiendo aprobarlo antes de usar datos reales de pacientes.**

### 8. Regla "por dueño" (`esDueno`) y validación de coordenadas
- Sin cambios: `esDueno` sigue definida y usada solo donde ya existía (`respuestas_paciente`, `choferes_privado`); las colecciones nuevas (`historial_viajes`, `gps_viajes`) usan `esAdmin()` y no la amplían (punto 11.4).
- `validarCoordenada` ya validaba el rango (activo); la restricción a Chile sigue detrás de `RESTRICCION_GEOGRAFICA_CHILE_ACTIVA` (apagado) y los validadores nuevos de origen/destino/GPS **respetan ese mismo flag** (hay un test).
