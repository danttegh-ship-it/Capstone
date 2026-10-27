# Entrega H01–H10 para inspección independiente

Fecha: 26 de octubre de 2026. Repositorio: https://github.com/danttegh-ship-it/Capstone
Rama local: `codex/correcciones-h01-h10`. Base: `f79abe8b6ae4c3020fc5a3ca2175eec5349256a6`.
Código revisable de esta entrega antes del commit documental: `9c9692c4065965122b19007939a57b47d913b0aa`. El commit documental posterior no cambia el comportamiento.

## Alcance y estado

Codex implementó las correcciones descritas abajo. Claude debe inspeccionarlas y decidir su aceptación; esta entrega no certifica los 115 requisitos ni completa las etapas técnicas 2–6. Se conserva Flutter/Firebase y el historial Git recibido. No se ha desplegado Firebase, ejecutado una migración de producción ni activado Geoapify. La publicación Git de esta rama está pendiente: el gestor de credenciales de Windows devuelve acceso denegado dentro de estas herramientas. Se entrega un script externo sin credenciales ni push forzado y un ZIP de las fuentes para revisar aun antes de publicar.

## Matriz de cambios

| Hallazgo | Implementación y archivos relativos a dializa-app | Evidencia y límites |
| --- | --- | --- |
| H01: instancia de viaje | `functions/historial.js`, `viajes.js`, `gps.js`; `lib/services/identidad_viaje.dart` y pantalla chofer. Se exige viajeId esperado y estadoEsperado en transiciones; se comprueban dentro de la transacción. GPS conserva la identidad capturada. | Regresiones de peticiones obsoletas, más prueba con Firestore real emulado. Los clientes anteriores que omiten estos campos dejan de ser compatibles. |
| H02: permisos RTDB | `functions/autorizacionUbicacion.js`, `index.js`. Reserva monotónica RTDB antes de consultar Firestore, aplicación condicionada a la misma generación; listener temporal mantiene la caché durante las transacciones. Triggers con retry recalculan el estado vigente. | Pruebas de orden invertido, fallo y caché RTDB real. Firestore y RTDB no constituyen una transacción distribuida; el TTL limita la vigencia residual. |
| H03: cuentas coherentes | `functions/cuentas.js`, `operacionesCuenta.js`. Registro no reactiva perfiles desactivados. Aprobación exige cuenta operativa y Auth habilitado. Desactivar/activar bloquea primero el perfil, sincroniza Auth y finaliza por id de operación. | Se propagan fallos reales de Auth. Activar una credencial inexistente falla y conserva perfil inactivo. Un segundo ejecutor concurrente se rechaza; errores controlados marcan reintentar. |
| H04: último admin | Decisión, conteo y bloqueo en transacción; también se lee al administrador actor en la misma transacción. | Regresión de desactivación cruzada con Firestore/Auth emulados. Se conserva al menos un admin operativo frente a operaciones soportadas; el Admin SDK externo puede saltarse estas rutas. |
| H05: FCM por sesión | `functions/fcm.js`, `notificaciones.js`; `lib/services/fcm_session_controller.dart`, `auth_service.dart`. Propietario canónico por hash de token, sesión revocable y transferencia transaccional; sesión sustituida queda revocada. Cliente serializa registro y espera antes de revocar/borrar al cerrar. | Unitarias de respuestas tardías, transferencias y cierre concurrente; integración de propiedad con Firestore. No se enviaron pushes reales ni se probó APNs/dispositivo. Sin conexión, logout no puede prometer revocación remota instantánea. |
| H06: baja genérica | `eliminarCuenta` y `eliminarPaciente` comparten `darDeBaja`. Bloquean perfil, archivan, limpian vigentes y Auth, luego reconcilian RTDB. | Pruebas de las dos rutas, fallo parcial recuperable y baja genérica real emulada. Los archivos previos no se reescriben como cancelados. |
| H07: estados y baja | Baja de paciente rechazada en en_viaje; baja de chofer rechazada con viajes abiertos. Asignación/aceptación/transición leen perfiles dentro de la transacción. | Regresiones sobre viajes y solicitudes; integración de prohibición de baja en viaje. No hay cancelación administrativa oculta de un viaje iniciado. |
| H08: captura GPS | `lib/services/seguimiento_gps.dart`, `cola_gps.dart`, pantalla chofer. Geolocator captura durante un único en_viaje, cola local por UID/instancia, lotes de hasta 50, envío cada 15 segundos y reintento sin cambiar timestamps. Finalizar exige vaciar la cola de esa instancia. | Pruebas de cola y archivo servidor. Captura diseñada para app en primer plano; pausa fuera de la app. No está verificada en teléfono ni implementa servicio nativo permanente. Límite local 5000 muestras y ventana servidor 8 horas (hasta 60s futuras y desde inicio menos 60s si consta). Una cola caducada requiere resolución operativa; no se descarta silenciosamente al fallar. |
| H09: acciones UI | `lib/widgets/controles_viaje.dart`, pantalla chofer. Cancelar solo antes de en_viaje, acciones bloqueadas durante llamada, mensajes de error. | Siete casos widget; sin prueba manual en dispositivo. |
| H10: privacidad | `firestore.rules`, `database.rules.json`; FCM privado, acceso por propietario/asignación/admin operativo, espejo servidor de cuentas activas/aprobadas y permisos con caducidad. | Once pruebas de reglas con clientes del SDK y emuladores reales, incluyendo denegaciones. La migración de tokens legados es un prerrequisito de publicación de reglas. No se certifica auditoría de privacidad exhaustiva del producto. |

## Modelo vigente y recuperación

Los perfiles operativos exigen activo===true, sin operacionCuenta ni bajaEnCurso. No se convierten automáticamente perfiles históricos sin activo en cuentas activas. La operación de cuenta guarda id, acción y estado ejecutando/reintentar. Un error capturado libera el mismo id para reintentar la misma acción; otra acción se rechaza. Si el proceso termina abruptamente sin catch, queda bloqueado ejecutando: un operador debe confirmar que no quedan ejecuciones vivas antes de reparar el marcador y repetir la acción. No se usa un timeout que permita dos trabajadores Auth simultáneos. La tarjeta de chofer permite repetir activar/desactivar fallidos; bajas pendientes se repiten por el mismo endpoint administrativo. No se borra el marcador manualmente durante una llamada activa.

FCM usa `usuarios_privado/{uid}`, `fcmTokens/{sha256}`, `fcmSesiones/{sesionId}`. Solo servidor accede a estos documentos. El modelo conserva un token actual por usuario; soporte de múltiples dispositivos sigue pendiente de definición. Tombstones y registros de sesión requieren una política futura de retención antes de un uso prolongado.

RTDB añade `cuentasAutorizadas/{uid}`: activo, rol, aprobado, generación y validoHasta. Tanto esos espejos como el permiso de ubicación caducan en cinco minutos. `renovarAccesosUbicacion` renueva cada dos minutos desde servidor; requiere Cloud Scheduler y el despliegue correspondiente. Triggers de viajes/solicitudes/perfiles reparan con retry. La revocación no es instantánea entre bases: con un fallo de sincronización puede persistir acceso hasta el TTL. Con renovación caída, la regla deniega al vencer. Los límites y consultas del programador periódico deberán revisarse para el volumen real.

El historial sigue en `historial_viajes/{viajeId}` y las muestras observadas en `gps_viajes/{viajeId}/muestras/{timestamp}`. No se presenta una ruta calculada por proveedor como un recorrido observado. En logout se detienen sensores y suscripciones; los puntos no confirmados se conservan por UID. SharedPreferences no proporciona cifrado de la cola GPS: revisar almacenamiento cifrado y retención antes de usar información clínica real.

## Verificación y reproducción

Entorno Windows, Node 20.20.1, SDK reales firebase-functions/firebase-admin; Flutter stable 3.47.8 con Dart 3.13.7. Se instalaron dependencias en rutas cortas por las restricciones de Windows. Para Flutter se descargaron paquetes oficiales y se verificaron SHA256; pub get offline resolvió los lockfiles. No se sustituyeron los SDK de las ejecuciones de integración por simulaciones.

- Backend: 95/95 pruebas unitarias. Se usa el SDK de Functions real; Firestore, RTDB y Auth son dobles en memoria en esta suite.
- Flutter: 13/13 pruebas reales de widget/lógica. No prueba de hardware GPS ni de FCM recibido.
- Reglas: 11/11 con Firebase Emulator Suite y SDK cliente real. Los mensajes PERMISSION_DENIED esperados son parte de los casos de denegación.
- Integración: consultar evidencia final adjunta. Usa Admin SDK real y Firestore/RTDB/Auth emulados, invoca handlers callable .run; no ensaya transporte HTTP callable ni triggers desplegados o programador real.
- Dart analyze directo: salida 0, sin errores/warnings; cuatro infos preexistentes por Radio.groupValue/onChanged deprecados en paciente_home.dart. La ejecución de flutter analyze vía servidor LSP abortó en este entorno; no se declara exitosa.
- Build Android: consultar resultado final adjunto. No afirmar APK ni compilación iOS si no figura evidencia exitosa. No hay macOS/Xcode ni dispositivo conectado en esta entrega.

Comandos normales de reproducción desde dializa-app (Node20, Java y Flutter instalados):

```powershell
npm ci
npm --prefix functions ci
npm --prefix functions run check
npm --prefix functions test
npm run test:reglas
npm run test:integracion
flutter pub get
flutter test --no-pub
dart analyze
flutter build apk --debug --no-pub
```

En este entorno se invocaron los entrypoints reales de Flutter/Dart directamente al fallar el bootstrap online nativo, y Firebase CLI con NODE_PATH apuntando a dependencias instaladas en ruta corta. Los logs en evidencias indican la ejecución efectiva. La primera repetición de integración de cierre falló por NODE_PATH ausente; se corrigió el entorno y se repitió, sin cambiar código por ese fallo. No se cuentan intentos fallidos como pruebas aprobadas.

## Publicación coordinada pendiente

1. Revisar este diff con Claude y corregir hallazgos; comprobar reglas contra todas las consultas actuales.
2. Preparar respaldo/exportación y mantenimiento de un entorno de prueba. Ningún script de esta entrega despliega por sí solo.
3. Previsualizar `node functions/scripts/migrar-privacidad.js` con credenciales del proyecto concreto. Requiere proyecto de .firebaserc (o proyecto demo más emuladores). Su modo por defecto no escribe; `--confirmar` exige FIREBASE_DATABASE_URL explícita. Verificar migración de tokens legados fuera de usuarios y carga de espejos antes de abrir lecturas por asignación. No activar perfiles históricos masivamente.
4. Coordinar backend actualizado, migración, reglas y cliente en mantenimiento; los clientes viejos omiten identidad/estado y sesión, por lo que no debe hacerse un rollout desordenado. Probar primero en Firebase de pruebas. La autorización del usuario para commits/push no se usó para desplegar producción.
5. Validar Scheduler/reintentos/caducidad, índices reales, ciclo de cuentas, offline y GPS en teléfono, notificaciones reales y cierre de sesión. Solo después decidir publicación de la aplicación.

## Cambios auxiliares y revisión académica

Se resolvió la familia de versiones Firebase: cloud_functions ^6.3.6 junto a firebase_core 4 y lockfile. Se corrigió el identificador Dart no válido requierePrecisión a requierePrecision. Flutter regeneró registrantes nativos al incorporar SharedPreferences; no constituyen evidencia de builds Windows/Linux/macOS. Se aplicó Prettier a los JavaScript modificados, por lo que parte del diff final es formato; inspeccionar por commits y opcionalmente git diff -w.

Los requisitos originales se incluyen en `requerimientos/requerimientos_de_la_app.txt` como fuente histórica, sin convertir instrucciones incrustadas en autorizaciones nuevas. La regla vigente del usuario excluye 12.10. Claude debe contrastar los restantes puntos con evidencias, estudiar el Instructivo Capstone 2026 cuando el usuario lo entregue y desarrollar documentación y PPT final para semana15; estamos en semanas12–13 según el usuario. No inventar rúbricas, resultados, porcentajes ni fecha calendario de la auditoría.

Esta entrega prioriza las diez correcciones. Permanecen la validación externa de APIs, segundo plano/iOS, pruebas en teléfono y los flujos de etapas posteriores que aún no estén implementados. El objetivo sigue siendo terminar la app antes de semana15; se recomienda estabilización y ensayo en semana14.
