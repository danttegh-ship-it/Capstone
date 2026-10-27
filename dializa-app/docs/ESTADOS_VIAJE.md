> Actualización 26-10-2026: este documento describe la base histórica. Para los contratos, privacidad, recuperación y límites vigentes de H01–H10 consulte [la entrega actual](REVISION_H01_H10_CODEX.md); ante discrepancias prevalece el código del SHA revisado.

# Estados del viaje

Misma máquina de estados para `viajes/{pacienteId}` (asignación manual del
admin) y `solicitudes/{id}` (viaje bajo demanda), implementada en
`functions/viajes.js`.

```
solicitado → asignado → conductor_en_camino → conductor_llego → en_viaje → finalizado
     ↓            ↓               ↓                  ↓
  (nunca aplica          cancelado (puede pasar en cualquiera de estos 4 estados)
   a `viajes`,
   que nace en
   "asignado")
```

| Estado | Quién lo dispara | Significa |
| --- | --- | --- |
| `solicitado` | El paciente (`crearSolicitudViaje`), solo en `solicitudes` | Pidió un traslado, todavía sin chofer |
| `asignado` | El admin (`asignarViaje`) o un chofer que acepta (`aceptarSolicitud`) | Ya tiene chofer asignado |
| `conductor_en_camino` | El chofer (`actualizarEstadoViaje`) | Va en camino a buscar al paciente |
| `conductor_llego` | El chofer | Llegó al punto de encuentro |
| `en_viaje` | El chofer | El paciente ya está siendo trasladado |
| `finalizado` | El chofer | Viaje terminado |
| `cancelado` | El chofer (`cancelarAsignacionConductor` o `actualizarEstadoViaje`), solo desde `asignado`, `conductor_en_camino` o `conductor_llego` | Se interrumpió antes de terminar |

Reglas:

- Solo el chofer asignado a ese viaje/solicitud puede avanzar su estado
  (`actualizarEstadoViaje` lo verifica contra `choferId`/`conductorId`).
- Las transiciones están fijas en `TRANSICIONES_CONDUCTOR` (en
  `functions/viajes.js`): no se puede saltar de `asignado` directo a
  `en_viaje`, por ejemplo.
- Al llegar a `finalizado` o `cancelado`, el chofer queda con
  `disponible: false` en `choferes_privado` -- tiene que reactivarse
  manualmente desde el switch "Disponible para viajes" antes de recibir
  otro viaje. Esto es deliberado: evita que quede "disponible" mientras
  en realidad sigue ocupado.
- Cada cambio de estado queda anotado en el arreglo `historial` del
  documento, con fecha, para trazabilidad.

## Cancelar, devolver y reasignar (Fase 1)

- **Cancelar** (corrección C): el servidor valida el estado dentro de una
  transacción. Solo es válido desde `asignado`, `conductor_en_camino` o
  `conductor_llego`. Desde `en_viaje`, `finalizado` o `cancelado` se rechaza
  (`failed-precondition`) sin cambiar nada. La interfaz solo debe mostrar la
  acción cuando es válida; el servidor es quien manda.
- **Devolver** (`rechazarSolicitud`): solo para el chofer que YA aceptó
  (estado `asignado`, solo `solicitudes`); la solicitud vuelve a
  `solicitado` y el chofer a `disponible:true`. **No existe rechazo de una
  solicitud pendiente**: en la lista de pendientes solo hay "Aceptar".
- **Reasignar** (`asignarViaje`): un viaje de `viajes` en `conductor_llego` o
  `en_viaje` no se puede reasignar; en `asignado`/`conductor_en_camino` sí
  (el anterior se archiva con cierre `reasignado`).
- **Archivo**: `finalizado` y `cancelado` copian el viaje a
  `historial_viajes` en la misma transacción. El documento vivo conserva su
  estado final hasta que se reemplace o elimine.
- **Ubicación en vivo**: el paciente puede leer la ubicación del chofer solo
  en los estados que autorizan (ver `docs/ARQUITECTURA.md`): para
  `solicitudes` desde `asignado`; para `viajes` desde `conductor_en_camino`.
