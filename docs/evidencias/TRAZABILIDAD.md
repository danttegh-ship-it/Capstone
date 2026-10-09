# Matriz de trazabilidad de requerimientos (cobertura parcial)

## Alcance de esta matriz

- El documento de requerimientos completo (`requerimientos_de_la_app.txt`, con
  los **115 puntos**) **no está en este repositorio**. Hay que agregarlo en
  `docs/requerimientos/` para que la matriz pueda revisarse completa.
- Esta versión incluye **solo los puntos que el código o la documentación
  citan explícitamente** y cuyo propósito se entiende del comentario: 29 de 115 (25 %). Otros puntos citados de pasada (8.7, 12.8, 13.4, 13.9, 13.11, 13.13, 14.1 y 14.3) quedan por describir cuando se agregue el documento original. La descripción de cada punto se
  dedujo del comentario del código y debe contrastarse con el documento
  original.
- La matriz completa de los 115 puntos está planificada para la Etapa 6
  (semanas 15 a 17).

**Estados:** *Verificado* = implementado y cubierto por pruebas ejecutadas
(unitarias con dobles). *Implementado* = el código existe, sin prueba
ejecutada. *Parcial* = cubre solo una parte. *Apagado* = código existente
detrás de un flag desactivado. *Pendiente* = no implementado.

La columna *Responsable* indica quién hizo el trabajo según el reporte de la
Etapa 1 y el historial de Git; el equipo debe confirmarla.

| ID | Requisito (según el código) | MVP | Implementación | Prueba | Estado | Responsable |
| --- | --- | --- | --- | --- | --- | --- |
| 6.4 | Autorización mixta: rol en Firestore para la UI y custom claim en el servidor | Sí | `functions/cuentas.js` (`exigirPerfilValido`) | Indirecta (pruebas de permisos en `viajes.test.js` y `cuentas.test.js`) | Verificado (dobles) | Dantte |
| 6.9 | Geoapify integrado pero apagado | No | `functions/geoapify-funciones.js`, `lib/config/feature_flags.dart` | — | Apagado (Etapa 4) | Ambos |
| 9.2 | Verificación de rol en el servidor | Sí | `functions/cuentas.js` | `asignarViaje: validaciones y permisos`; `GPS: roles distintos de chofer...` | Verificado (dobles) | Dantte |
| 9.4 | Solo choferes aprobados por un admin reciben viajes | Sí | `lib/screens/admin_conductores_screen.dart`, `admin_home.dart`, `cuentas.js` | Indirecta | Implementado | Dantte |
| 9.5 / 14.2 | Token FCM ligado a la sesión | Sí | `lib/services/auth_service.dart`, `cuentas.js` | `E: registrarTokenFcm...`, `E: eliminarTokenFcm...` | Servidor verificado (dobles); cliente sin compilar | Dantte |
| 9.6 | Verificación de correo | No | `auth_service.dart` | — | Implementado (sin prueba) | Dantte |
| 9.7 | Recuperación de contraseña | Sí | `login_screen.dart`, `auth_service.dart` | `test/widget_test.dart` (no ejecutado) | Implementado; visible en la Figura 5 del informe | Dantte |
| 9.10 | Protección del último administrador | Sí | `functions/cuentas.js` | `D: protecciones previas se mantienen...` | Verificado (dobles) | Dantte |
| 10.2 | Datos del conductor privados | Sí | `firestore.rules` (`choferes_privado`) | `tests/firestore.rules.test.js` (no ejecutado) | Implementado | Dantte |
| 10.3 / 10.10 | Solicitudes con historial de estados, archivadas | Sí | `viajes.js`, `historial.js` | `historial: ...` (3 pruebas) | Verificado (dobles) | Dantte |
| 10.6 | Usuarios escritos solo por el servidor | Sí | `firestore.rules`, `cuentas.js` | Reglas no ejecutadas | Implementado | Dantte |
| 10.7 | Auditoría de acciones administrativas | Sí | `functions/auditoria.js` | Indirecta | Implementado | Dantte |
| 10.8 | Límite de frecuencia por usuario y acción | Sí | `functions/rateLimit.js` | `B: rate limit...`, `GPS: limite de frecuencia...` | Verificado (dobles) | Dantte |
| 11.4 | Regla "por dueño" sin ampliar | — | `firestore.rules` (`esDueno`) | Reglas no ejecutadas | Implementado | Dantte |
| 11.9 / 11.10 | Restricción geográfica a Chile (apagada) | No | `validaciones.js`, `config.js` | `validaciones-fase1.test.js` | Apagado | Dantte |
| 11.13 | Credenciales fuera del repositorio | Sí | `.gitignore` | Revisión manual | Parcial (ver `PERMISOS_Y_PRIVACIDAD.md` §3) | Ambos |
| 11.14 | Permisos escalonados de ubicación y notificaciones | No | `lib/services/permisos_service.dart` | — | Apagado | Dantte |
| 12.10 | Conversión de coordenadas `{lat,lng}` ↔ Geoapify | No | `geoapify-funciones.js` | — | Apagado | Dantte |
| 13.1 / 13.2 | Solicitud de viaje bajo demanda y aceptación | Sí | `functions/viajes.js` | `B: ...` (4), `aceptarSolicitud: dos choferes a la vez` | Servidor verificado; **sin pantalla** (Etapa 3) | Dantte / Javiera |
| 13.5 | Disponibilidad del chofer | Sí | `cuentas.js` (`actualizarDisponibilidad`), `chofer_home.dart` | — | Implementado; visible en la Figura 7 del informe | Dantte |
| 13.8 / 13.10 | Asignación del admin con la UI de dializa-app sin cambios | Sí | `admin_home.dart`, `viajes.js` (`asignarViaje`) | `asignarViaje: ...` (6) | Servidor verificado; cliente sin compilar tras el cambio | Javiera (UI) / Dantte (servidor) |
| 13.12 | Máquina de estados del viaje | Sí | `viajes.js` (`TRANSICIONES_CONDUCTOR`) | `actualizarEstadoViaje: transiciones...` + mutación M1 | Verificado (dobles) | Dantte |
| 14.4 | Deep link de notificaciones | No | `mensajeria_service.dart`, `notificaciones.js` | — | Parcial (solo abre la app) | Dantte |
| 16.4 | Prueba de widget de la pantalla de login | Sí | `test/widget_test.dart` | No ejecutada | Pendiente de ejecutar | Dantte |
| — | Confirmación de asistencia del paciente (¿asiste?, ¿cómo llega?, ¿ayuda de movilidad?) | Sí | `paciente_home.dart`, `respuestas_paciente` | — | Implementado (Javiera); sin captura | Javiera |

**Cobertura real al corte S9:** 29 de 115 puntos en la matriz (25 %); de ellos,
15 tienen alguna prueba unitaria ejecutada (con dobles). Ningún punto tiene todavía prueba de
reglas, de cliente o de extremo a extremo ejecutada.
