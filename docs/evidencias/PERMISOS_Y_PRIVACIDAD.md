# Permisos de lectura y escritura y decisiones de privacidad

Fuente: `dializa-app/firestore.rules`, `dializa-app/database.rules.json`,
`dializa-app/functions/autorizacionUbicacion.js` y las consultas del cliente en
`dializa-app/lib/screens/`. Las Cloud Functions usan el Admin SDK y **no**
pasan por las reglas; las reglas controlan lo que puede hacer cualquier cliente
(la app, la consola o un cliente modificado).

**Estado de verificación:** las reglas están escritas y revisadas, pero **no se
han ejecutado en el emulador** (`INFORME_PRUEBAS.md`, tipo C). Este documento
describe lo que el código declara, no un comportamiento comprobado.

## 1. Situación actual

### 1.1 Escrituras: restringidas

Ningún cliente puede escribir en `usuarios`, `choferes_privado`, `viajes`,
`solicitudes`, `historial_viajes`, `gps_viajes`, `auditoria` ni `rateLimits`:
todas esas escrituras pasan por Cloud Functions, que validan rol y estado. La
única escritura directa permitida es `respuestas_paciente/{uid}`, por el propio
paciente o un administrador. Cualquier colección no listada está denegada.

### 1.2 Lecturas limitadas

| Colección | Quién puede leer |
| --- | --- |
| `choferes_privado/{uid}` (patente, licencia, vehículo) | El propio chofer o un administrador |
| `historial_viajes/{id}` | Solo administrador |
| `gps_viajes/{id}/**` | Solo administrador |
| `auditoria/{id}` | Solo administrador |
| `rateLimits/{id}` | Nadie |

### 1.3 Lecturas abiertas a cualquier usuario autenticado

| Colección | Datos expuestos | Riesgo |
| --- | --- | --- |
| `usuarios/{uid}` | Nombre, rol, estado y **`fcmToken`** | Cualquier usuario puede leer el perfil y el token de notificación de otro |
| `viajes/{pacienteId}` | Paciente, chofer, fecha, hora, estado | Un paciente puede ver los viajes de otros |
| `solicitudes/{id}` | **Direcciones de origen y destino**, necesidades | Hoy no hay pantalla que cree solicitudes, pero el servidor ya las acepta |
| `respuestas_paciente/{uid}` | Asistencia, **necesidad de ayuda de movilidad**, **dirección de retiro** | Un paciente puede leer los datos de otros |

Por eso **el principio de mínimo privilegio se cumple en las escrituras, pero
solo parcialmente en las lecturas**.

### 1.4 Realtime Database (`ubicaciones/{uid}`)

| Campo | Lectura | Escritura |
| --- | --- | --- |
| Nodo completo | El propio chofer, un administrador o el paciente cuyo uid está en `pacienteAutorizado` | — |
| `lat`, `lng`, `timestamp` | (igual) | El propio chofer, si su token tiene el claim `rol = chofer`; se validan rangos |
| `pacienteAutorizado`, `viajeAutorizado`, `autorizacionVersion` | (igual) | Nadie desde el cliente; solo el servidor |

Límite conocido: un chofer **aún no aprobado** ya tiene el claim `chofer`, así
que puede escribir su propia posición (nadie más la lee).

### 1.5 Desde qué estado se comparte la ubicación

**Implementado** en `functions/autorizacionUbicacion.js`
(`ESTADOS_AUTORIZAN`):

| Colección | Estados en que el paciente puede leer la ubicación del chofer | Motivo documentado |
| --- | --- | --- |
| `viajes` (asignación del administrador) | `conductor_en_camino`, `conductor_llego`, `en_viaje` | El administrador puede asignar con días de anticipación; conceder al asignar daría acceso antes de tiempo y a varios pacientes a la vez |
| `solicitudes` (pedido del paciente) | `asignado`, `conductor_en_camino`, `conductor_llego`, `en_viaje` | El paciente pidió el viaje y un chofer lo aceptó |

Este comportamiento está implementado y cubierto por pruebas unitarias
(`autorizacion.test.js`). **Falta que el equipo lo confirme como decisión de
negocio**; `FASE1_REPORTE.md` lo dejó planteado como pregunta. Si se decide
cambiarlo, hay que modificar `ESTADOS_AUTORIZAN`, sus pruebas y esta tabla.

## 2. Propuesta de reglas de lectura (no aplicada)

Las reglas siguientes **no se aplicaron** al código: cambiarlas sin poder
ejecutarlas en el emulador dejaría la versión evaluada sin validar. Se dejan
como propuesta para la semana 10, junto con sus pruebas.

```
// usuarios: el propio usuario, un admin, o el chofer asignado a ese paciente
match /usuarios/{uid} {
  allow read: if esDueno(uid) || esAdmin() || choferAsignadoA(uid);
  allow write: if false;
}
// viajes: el paciente dueño, el chofer asignado o un admin
match /viajes/{pacienteId} {
  allow read: if esDueno(pacienteId) || esAdmin()
              || resource.data.choferId == request.auth.uid;
  allow write: if false;
}
// respuestas_paciente: el paciente, un admin o el chofer asignado
match /respuestas_paciente/{uid} {
  allow read: if esDueno(uid) || esAdmin() || choferAsignadoA(uid);
  allow write: if esDueno(uid) || esAdmin();
}
// solicitudes: admin, paciente dueño, chofer asignado y choferes
// aprobados solo mientras esté en 'solicitado'
match /solicitudes/{id} {
  allow read: if esAdmin()
              || resource.data.pacienteId == request.auth.uid
              || resource.data.conductorId == request.auth.uid
              || (esConductor() && resource.data.estado == 'solicitado');
  allow write: if false;
}
function choferAsignadoA(pacienteId) {
  return esConductor()
    && exists(/databases/$(database)/documents/viajes/$(pacienteId))
    && get(/databases/$(database)/documents/viajes/$(pacienteId)).data.choferId == request.auth.uid;
}
```

### 2.1 Compatibilidad con las consultas actuales del cliente

| Pantalla | Consulta | ¿Permitida con la propuesta? |
| --- | --- | --- |
| `login_screen.dart` | `usuarios/{uid propio}` | Sí (`esDueno`) |
| `admin_home.dart` | `usuarios where rol == paciente`; `usuarios where rol == chofer and aprobado == true`; `respuestas_paciente/{uid}`; `viajes/{uid}` | Sí (`esAdmin`) |
| `admin_conductores_screen.dart` | `usuarios where rol == chofer`; `choferes_privado/{uid}` | Sí (`esAdmin`) |
| `chofer_home.dart` | `usuarios/{uid propio}`; `choferes_privado/{uid propio}` | Sí |
| `chofer_home.dart` | `viajes where choferId == uid` | Sí: la condición `resource.data.choferId == request.auth.uid` coincide con el filtro de la consulta |
| `chofer_home.dart` | `usuarios/{pacienteId}` y `respuestas_paciente/{pacienteId}` del paciente asignado | Sí (`choferAsignadoA`), solo si existe `viajes/{pacienteId}` con ese chofer |
| `paciente_home.dart` | `respuestas_paciente/{uid propio}` | Sí (`esDueno`) |

Esta compatibilidad es un análisis de las reglas frente al código; se confirma
solo al ejecutar las pruebas de la sección 2.2 en el emulador.

### 2.2 Pruebas que deben acompañar el cambio

Para cada colección, un caso permitido y uno denegado por rol: paciente dueño,
otro paciente, chofer asignado, chofer no asignado, administrador y usuario no
autenticado. Mientras no se ejecuten, el estado del cambio será «modificado,
pendiente de validación».

### 2.3 Token de notificación

Restringir `usuarios` no basta: el chofer asignado seguiría pudiendo leer el
`fcmToken` del paciente. La propuesta es mover el token a
`usuarios_privado/{uid}` (`allow read, write: if false`), lo que exige cambiar
`registrarTokenFcm`, `eliminarTokenFcm` y `notificaciones.js` en el servidor; el
cliente no lee el token.

## 3. Precisión de algunas afirmaciones

- **Firestore y Realtime Database no comparten transacciones.** La operación de
  negocio se confirma en Firestore y la autorización de ubicación se escribe
  después en RTDB. Si esa segunda escritura falla, la operación **no** se
  revierte: la respuesta indica `autorizacionSincronizada: false` y se puede
  reparar con `sincronizarAutorizacionUbicacion`. Las versiones
  (`autorizacionVersion`) evitan que una reconciliación tardía pise una más
  nueva.
- **Tokens FCM.** El servidor evita duplicados y borra el token al cerrar
  sesión, pero eso no garantiza que la notificación llegue: depende de los
  permisos del teléfono, del sistema operativo y del servicio de Google.
- **`.gitignore`.** Que hoy excluya credenciales no demuestra que nunca hayan
  estado en el historial. El archivo `dializa-app-fase1.zip` (commit `567efdf`)
  incluía `android/app/google-services.json`. Ese archivo y
  `lib/firebase_options.dart` contienen identificadores de cliente de Firebase,
  que no son contraseñas; conviene restringir esas claves en Google Cloud por
  aplicación y por API.
- **Desactivar una cuenta** impide iniciar sesión y renovar el token, pero un
  token ya emitido sigue siendo válido hasta por una hora en las reglas de RTDB.

## 4. Decisiones pendientes antes de usar datos reales

| # | Decisión | Estado |
| --- | --- | --- |
| P1 | Restringir la lectura de `usuarios`, `viajes`, `solicitudes` y `respuestas_paciente` (sección 2) | Propuesta escrita; no aplicada ni probada |
| P2 | Mover `fcmToken` a un documento privado | Propuesta; requiere cambios en el servidor |
| P3 | Plazo de conservación del recorrido GPS y del historial | Sin definir |
| P4 | Confirmar los estados que autorizan la ubicación (sección 1.5) | Implementado; falta confirmación del equipo |
| P5 | Consentimiento de pacientes y choferes para ubicación y datos de movilidad | Sin definir |
| P6 | Emitir el claim `chofer` solo al aprobar al conductor | Propuesta 1 de `DIFERENCIAS_Y_PROPUESTAS.md` |
