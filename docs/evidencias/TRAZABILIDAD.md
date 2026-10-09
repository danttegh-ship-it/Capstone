# Matriz de trazabilidad de requerimientos (cobertura parcial)

## Alcance

- El documento original de requerimientos (`requerimientos_de_la_app.txt`, con
  **115 puntos** numerados) **no está en este repositorio** ni en los archivos
  revisados. Sin él no se puede contrastar la numeración ni la redacción de
  cada punto.
- Esta matriz incluye los **29 puntos** que el código o la documentación citan
  explícitamente y cuyo propósito se entiende del comentario. Otros puntos
  citados de pasada (8.7, 12.8, 13.4, 13.9, 13.11, 13.13, 14.1 y 14.3) no se
  describen porque el comentario no basta.
- **29 de 115 es la cobertura de la trazabilidad, no el porcentaje de
  desarrollo terminado.** Hay requisitos implementados que no están en la
  matriz porque el código no cita su número, y requisitos citados que siguen
  pendientes.
- La descripción de cada punto se dedujo del comentario del código.

## Definiciones

- **Alcance Etapa 1:** «Sí» si `FASE1_REPORTE.md` lo declara entre los puntos
  tocados en esa etapa; «—» si corresponde a otra etapa o no se indica.
- **Origen:** de dónde viene el código según `ARQUITECTURA.md` y `README.md`:
  *UI dializa-app* (aplicación base Flutter de Javiera Vidal) o *backend
  combinado* (lógica portada desde Daily App en las Etapas 0 y 1, trabajo de
  Dantte García). Que un archivo aparezca en un commit de integración no
  determina por sí solo quién lo escribió.
- **Verificación directa:** una prueba ejecutada ejercita específicamente ese
  requisito y falla si se rompe.
- **Verificación indirecta:** pruebas ejecutadas pasan por ese código, pero
  ninguna aísla el requisito; se indica qué queda sin cubrir.
- **Implementado:** el código existe, sin prueba ejecutada.
- **Apagado:** el código existe detrás de un flag desactivado.
- Todas las pruebas ejecutadas son unitarias con dobles en memoria
  (`INFORME_PRUEBAS.md`, tipo A).

## Matriz

| ID | Requisito (según el código) | Alcance Etapa 1 | Implementación | Prueba y qué cubre | Estado | Origen |
| --- | --- | --- | --- | --- | --- | --- |
| 6.4 | Autorización mixta: rol en Firestore para la interfaz y custom claim en el servidor | Sí | `functions/cuentas.js` (`exigirPerfilValido`) | Las pruebas de permisos de `viajes.test.js` y `cuentas.test.js` pasan por la verificación de rol. No hay prueba del caso «sin claim → lee Firestore y repara el claim» | Verificación indirecta | Backend combinado |
| 6.9 | Geoapify integrado pero apagado | — | `functions/geoapify-funciones.js`, `lib/config/feature_flags.dart` | Ninguna | Apagado (Etapa 4) | Backend combinado |
| 9.2 | Verificación de rol en el servidor | Sí | `functions/cuentas.js` | `asignarViaje: validaciones y permisos`; `GPS: roles distintos de chofer (paciente, admin) son rechazados` | Verificación directa | Backend combinado |
| 9.4 | Solo choferes aprobados reciben viajes | — | `admin_conductores_screen.dart`, `admin_home.dart`, `cuentas.js` | La aprobación en el servidor no tiene prueba propia; la pantalla no se ha probado | Implementado | Backend combinado |
| 9.5 / 14.2 | Token FCM ligado a la sesión | Sí | `lib/services/auth_service.dart`, `cuentas.js` | `E: registrarTokenFcm …`, `E: eliminarTokenFcm …` (servidor). El cliente Dart no se ha compilado | Servidor: verificación directa; cliente: implementado | Backend combinado |
| 9.6 | Verificación de correo | — | `auth_service.dart` (`sendEmailVerification`) | Ninguna | Implementado | Backend combinado |
| 9.7 | Recuperación de contraseña | — | `login_screen.dart`, `auth_service.dart` (`enviarRecuperacionPassword`) | Ninguna prueba ejecutada. `test/widget_test.dart` solo comprueba que el login **muestra** el enlace «¿Olvidaste tu contraseña?»; no acciona el diálogo ni el envío | Implementado; visible en la Figura 5 del informe | Backend combinado |
| 9.10 | Protección del último administrador | Sí | `functions/cuentas.js` | `D: protecciones previas se mantienen (no auto-desactivarse, ni al ultimo admin)` | Verificación directa | Backend combinado |
| 10.2 | Datos del conductor privados | Sí | `firestore.rules` (`choferes_privado`) | `tests/firestore.rules.test.js` (no ejecutada) | Implementado | Backend combinado |
| 10.3 / 10.10 | Solicitudes con historial de estados, archivadas al cerrar | Sí | `viajes.js`, `historial.js` | `historial: …` (3 pruebas) y mutación M4 | Verificación directa | Backend combinado |
| 10.6 | Usuarios escritos solo por el servidor | — | `firestore.rules`, `cuentas.js` | Reglas no ejecutadas | Implementado | Backend combinado |
| 10.7 | Auditoría de acciones administrativas | — | `functions/auditoria.js` | Ninguna prueba comprueba el registro de auditoría | Implementado | Backend combinado |
| 10.8 | Límite de frecuencia por usuario y acción | Sí | `functions/rateLimit.js` | `B: rate limit …`; `GPS: limite de frecuencia por chofer` | Verificación directa | Backend combinado |
| 11.4 | Regla «por dueño» sin ampliar | Sí | `firestore.rules` (`esDueno`) | Reglas no ejecutadas | Implementado | Backend combinado |
| 11.9 / 11.10 | Restricción geográfica a Chile (apagada) | Sí | `validaciones.js`, `config.js` | `validaciones-fase1.test.js` comprueba que los validadores respetan el flag | Apagado; flag verificado | Backend combinado |
| 11.13 | Credenciales fuera del repositorio | Sí | `.gitignore` | Revisión manual: el `.zip` del commit `567efdf` incluía la configuración de Firebase para Android (`PERMISOS_Y_PRIVACIDAD.md` §3) | Parcial | Ambos |
| 11.14 | Permisos escalonados de ubicación y notificaciones | — | `lib/services/permisos_service.dart` | Ninguna | Apagado | Backend combinado |
| 12.10 | Conversión de coordenadas entre el modelo interno y Geoapify | — | `geoapify-funciones.js` | Ninguna | Apagado | Backend combinado |
| 13.1 / 13.2 | Solicitud de viaje y aceptación | — | `functions/viajes.js` | `B: …` (4 pruebas); `aceptarSolicitud: dos choferes a la vez` | Servidor: verificación directa; **sin pantalla** (Etapa 3) | Backend combinado |
| 13.5 | Disponibilidad del chofer | — | `cuentas.js` (`actualizarDisponibilidad`), `chofer_home.dart` | Ninguna prueba propia | Implementado; visible en la Figura 7 del informe | Backend combinado |
| 13.8 / 13.10 | Asignación de chofer y hora por el administrador, conservando la interfaz | — | `admin_home.dart` (UI), `viajes.js` (`asignarViaje`) | `asignarViaje: …` (6 pruebas) y mutación M3. El cliente no se ha compilado tras el cambio | Servidor: verificación directa; cliente: implementado | UI dializa-app + backend combinado |
| 13.12 | Máquina de estados del viaje | — | `viajes.js` (`TRANSICIONES_CONDUCTOR`) | `actualizarEstadoViaje: transiciones validas e invalidas` y mutación M1 | Verificación directa | Backend combinado |
| 14.4 | Deep link de notificaciones | — | `mensajeria_service.dart`, `notificaciones.js` | Ninguna | Parcial (solo abre la app) | Backend combinado |
| 16.4 | Prueba de widget de la pantalla de login | — | `test/widget_test.dart` | No ejecutada. El propio archivo advierte que `LoginScreen` usa `FirebaseAuth.instance` y puede requerir inicializar Firebase de prueba para correr | Escrita, no ejecutada | Backend combinado |
| — | Confirmación de asistencia del paciente (¿asiste?, ¿cómo llega?, ¿ayuda de movilidad?) | — | `paciente_home.dart`, `respuestas_paciente` | Ninguna; sin captura | Implementado | UI dializa-app |

## Resumen

- 29 puntos trazados de 115.
- 15 puntos con alguna prueba unitaria ejecutada: 12 con verificación directa
  en el servidor (9.2, 9.5, 14.2, 9.10, 10.3, 10.10, 10.8, 13.1, 13.2, 13.8,
  13.10 y 13.12), 1 con verificación indirecta (6.4) y 2 cuyo flag está
  verificado (11.9 y 11.10).
- Ningún punto tiene todavía prueba de reglas, de cliente o de extremo a extremo
  ejecutada.

## Prueba propuesta para la recuperación de contraseña (9.7)

No se agregó al código porque no se puede ejecutar en el entorno disponible.

1. Extraer de `LoginScreen` la dependencia de `AuthService` (por ejemplo, un
   parámetro opcional del constructor) para poder pasar un doble.
2. Con un doble que registra las llamadas: tocar «¿Olvidaste tu contraseña?»,
   escribir un correo válido, confirmar y comprobar que se llamó a
   `enviarRecuperacionPassword` con ese correo y que aparece el mensaje de
   confirmación.
3. Correo vacío o inválido: comprobar que no se llama al servicio y se muestra
   el error de validación.
4. El doble lanza una excepción del servicio: comprobar que se muestra un
   mensaje de error y la pantalla no queda bloqueada.

## Para completar la matriz

1. Agregar el documento original de requerimientos en `docs/requerimientos/`.
2. Contrastar la numeración y la redacción de los 29 puntos.
3. Marcar cuáles son del MVP y cuáles son exigibles en la Fase 2.
4. Completar los 115 puntos en la Etapa 6.
