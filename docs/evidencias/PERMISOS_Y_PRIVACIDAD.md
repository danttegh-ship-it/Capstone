# Permisos de lectura y escritura y decisiones de privacidad pendientes

Fuente: `dializa-app/firestore.rules` y `dializa-app/database.rules.json`
(versión de este repositorio). Las Cloud Functions usan el Admin SDK y **no**
pasan por estas reglas; las reglas controlan lo que puede hacer cualquier
cliente (la app, la consola o un cliente modificado).

**Estado:** las reglas están escritas y revisadas, pero **no se han ejecutado
en el emulador** (ver `INFORME_PRUEBAS.md`, sección 4). Esta tabla describe lo
que el código declara, no un comportamiento comprobado.

## 1. Quién puede leer y escribir (Firestore)

| Colección | Lectura desde el cliente | Escritura desde el cliente | Datos sensibles | Observación |
| --- | --- | --- | --- | --- |
| `usuarios/{uid}` | **Cualquier usuario autenticado** | Nadie | Nombre, rol, `fcmToken` | Un paciente puede leer el token de notificación de otra persona → propuesta 7 |
| `choferes_privado/{uid}` | El propio chofer o un admin | Nadie | Patente, licencia, vehículo | Correcto según el punto 10.2 |
| `viajes/{pacienteId}` | **Cualquier usuario autenticado** | Nadie (solo `asignarViaje`) | Paciente, chofer, fecha y hora | Un paciente puede ver viajes ajenos → propuesta 7 |
| `solicitudes/{id}` | **Cualquier usuario autenticado** | Nadie | **Direcciones de origen y destino**, necesidades | Hoy no hay pantalla que cree solicitudes; antes de habilitarlas hay que restringir la lectura |
| `respuestas_paciente/{uid}` | **Cualquier usuario autenticado** | El propio paciente o un admin | Asistencia, necesidad de movilidad, **dirección de retiro** | No figura en la propuesta 7 y también debería restringirse |
| `historial_viajes/{id}` | Solo admin | Nadie | Recorrido resumido, nombres | Correcto |
| `gps_viajes/{id}/**` | Solo admin | Nadie | Recorrido GPS completo | Correcto; falta definir el plazo de conservación |
| `auditoria`, `rateLimits` | Admin / nadie | Nadie | — | Correcto |
| Cualquier otra | Nadie | Nadie | — | Denegado por defecto |

## 2. Realtime Database (`ubicaciones/{uid}`)

| Campo | Lectura | Escritura |
| --- | --- | --- |
| Nodo completo | El propio chofer, un admin, o el paciente cuyo uid está en `pacienteAutorizado` | — |
| `lat`, `lng`, `timestamp` | (igual) | El propio chofer, si su token tiene el claim `rol = chofer`; se validan rangos |
| `pacienteAutorizado`, `viajeAutorizado`, `autorizacionVersion` | (igual) | Nadie desde el cliente; solo el servidor |

**Límite conocido:** un chofer **aún no aprobado** ya tiene el claim `chofer`,
así que puede escribir su propia posición. Nadie más la lee, pero conviene
emitir el claim recién al aprobarlo (propuesta 1 de
`DIFERENCIAS_Y_PROPUESTAS.md`).

## 3. Precisión de algunas afirmaciones

- **Firestore y Realtime Database no comparten transacciones.** La operación
  de negocio se confirma en Firestore y la autorización de ubicación se escribe
  después en RTDB. Si esa segunda escritura falla, la operación **no** se
  revierte: la respuesta indica `autorizacionSincronizada: false` y se puede
  reparar con `sincronizarAutorizacionUbicacion`. Las versiones
  (`autorizacionVersion`) evitan que una reconciliación tardía pise una más
  nueva. No es una transacción atómica entre ambos servicios.
- **Tokens FCM.** El servidor evita duplicados y borra el token al cerrar
  sesión, pero eso **no garantiza** que la notificación llegue: depende de los
  permisos del teléfono, del sistema operativo y del servicio de Google.
- **`.gitignore`.** Que hoy excluya credenciales no demuestra que nunca hayan
  estado en el historial. El archivo `dializa-app-fase1.zip` (commit
  `567efdf`) incluía `android/app/google-services.json`. Ese archivo y
  `lib/firebase_options.dart` contienen identificadores de cliente de Firebase,
  que no son contraseñas, pero se recomienda **restringir esas claves en Google
  Cloud** (por aplicación Android/iOS y por API).
- **Desactivar una cuenta** impide iniciar sesión y renovar el token, pero un
  token ya emitido sigue siendo válido hasta por una hora en las reglas de RTDB.

## 4. Decisiones que el equipo debe tomar antes de usar datos reales

| # | Decisión | Propuesta | Responsable | Estado |
| --- | --- | --- | --- | --- |
| P1 | Quién lee `viajes`, `solicitudes` y `respuestas_paciente` | Admin, el paciente dueño y el chofer asignado (propuesta 7) | Equipo | Pendiente |
| P2 | Dónde se guarda `fcmToken` | Moverlo a `usuarios_privado/{uid}`, legible solo por el servidor | Equipo | Pendiente |
| P3 | Cuánto tiempo se conserva el GPS y el historial | Definir plazo y borrado (por ejemplo, al terminar el piloto) | Equipo y cliente | Pendiente |
| P4 | Desde qué estado se autoriza la ubicación | Hoy: `viajes` desde `conductor_en_camino`; `solicitudes` desde `asignado` | Equipo | Pendiente de confirmar |
| P5 | Consentimiento del paciente y del chofer para registrar ubicación y datos de salud (necesidad de movilidad) | Texto de consentimiento en el registro | Equipo y cliente | Pendiente |
| P6 | Claim `chofer` antes de la aprobación | Emitirlo en `aprobarConductor` (propuesta 1) | Equipo | Pendiente |
