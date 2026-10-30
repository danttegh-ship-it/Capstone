# Entrega del bloque de tareas 1–7 — 30 de octubre de 2026

Repositorio: https://github.com/danttegh-ship-it/Capstone
Rama: `codex/correcciones-h01-h10`.
SHA base: `ba8c55399096379de63eb5b30576e6d04db3a3eb`.
Último commit que modifica la aplicación: `519299da66a8bcb8d0ad6e6efad75345a0991157`.
El commit `50dcc0c` agrega la prueba widget de cierre con cuarentena, sin modificar la aplicación. Los commits documentales posteriores conservan esas fuentes. El SHA final exacto y el build repetido desde él figuran en el manifiesto y reporte de entrega adjuntos.

## Alcance y decisión vigente

El usuario aceptó H01–H07, H09 y H10 en la base. H08 sigue sin aceptación: esta entrega implementa las tareas nuevas, pero no sustituye la validación en teléfono ni la revisión independiente. Codex programa e integra; Claude inspecciona y prepara documentación/PPT. No se reabre la numeración ni se declaran completos los 115 requisitos.

Se completó la implementación de las tareas 1–5 y 7. La tarea 6 tiene APK debug compilado y evidencia; el despliegue en Firebase de pruebas, el Scheduler real y la prueba física están pendientes. El usuario confirmó que no hay Android conectado y autorizó continuar con la tarea 7 tras el intento de APK. No proporcionó ID de Firebase de pruebas; `dializa-app`, el proyecto predeterminado, no se utilizó como sustituto de ese destino.

## Cambios y pruebas por tarea

### Tarea 1 — GPS sin bloqueo permanente

Archivos: `lib/services/cola_gps.dart`, `lib/services/seguimiento_gps.dart`, `functions/gps.js`, `test/cola_gps_test.dart`, `functions/test/gps.test.js`, `integration/regresiones.test.js`.

- Persistencia versión2 con pendientes y cuarentena; se sigue leyendo el arreglo legado. La cuarentena conserva coordenadas/timestamp/instancia y código de rechazo, se cuenta y se avisa en el panel. No se reenvía ni cuenta como un pendiente que deba vaciarse para finalizar. No se borra automáticamente ni se cifra en este bloque.
- `invalid-argument`, `failed-precondition`, `not-found`, `permission-denied` separan el lote en cuarentena. Red, `unavailable`, `deadline-exceeded`, `resource-exhausted` por tasa y fallos no identificados conservan el pendiente para reintentar. Cada instancia continúa independientemente; un fallo transitorio se devuelve después de intentar las demás. El cierre filtra por viajeId.
- Un único serializador de la cola gobierna envío periódico y cierre. El seguimiento detiene sensor/publicador al preparar el cierre y frena envíos nuevos de ese viaje hasta el cambio de estado; se recupera el seguimiento si falla la transición.
- El servidor devuelve `guardadas`, `duplicadas` y `rechazadas:[{indice,codigo,motivo}]`. La estructura/identidad/permisos del lote siguen siendo obligatorios. Una muestra mala no invalida las válidas. El tope de5000 produce rechazos individuales, no un error de tasa permanente disfrazado.
- Tolerancia antes de gpsIniciadoEn: cinco minutos. Se conserva la ventana de ocho horas hacia atrás y60s futuras, y el timestamp observado nunca se corrige. Un atraso mayor puede ir a cuarentena, pero ya no impide cerrar. No se modificó `validaciones.js` ni la validación de coordenadas11.9.

Pruebas nuevas: error permanente de los cuatro códigos con recuperación desde disco; instancia vieja delante de la activa; otra instancia continúa ante fallo transitorio; reloj atrasado/rechazo parcial; exclusión entre envío y cierre; widget que pulsa Finalizar y alcanza la operación de cierre con cuarentena. Backend: lote mixto y reloj atrasado120s, cuota parcial. Integración real emulada: preservación del timestamp y rechazo tras cierre desde otro cliente.

Límite explícito: un fallo transitorio del viaje que se intenta cerrar todavía requiere reintento. La cuarentena evita el bloqueo por rechazos permanentes, pero no convierte muestras rechazadas en recorrido recibido por el servidor. Se necesita un procedimiento futuro de revisión/exportación y retención de cuarentena.

### Tarea 2 — Recuperación de cuentas interrumpidas

Archivos: `functions/operacionesCuenta.js`, `functions/cuentas.js`, `functions/index.js`, `functions/test/ciclo-cuenta.test.js`, `integration/regresiones.test.js`.

Cada concesión guarda iniciadaEn (epochms del servidor). La misma acción puede retomarse tras diez minutos; errores capturados siguen permitiendo reintento inmediato. Al tomar una concesión nueva cambia su id, de modo que un ejecutor viejo no pueda finalizar ni volver a marcar reintentar la actual. Las funciones de operación y recuperación tienen timeout120s, inferior al plazo de recuperación.

Nuevo callable administrativo, región southamerica-east1: `reintentarOperacionCuenta({uid,accion})`, acción activar/desactivar/eliminar. Exige admin operativo, operación previa y misma acción. Registra auditoría de recuperación y la operación efectuada. No activa perfiles indiscriminadamente ni admite una acción diferente. Un marcador legado ejecutando sin fecha recibe una fecha inicial y exige esperar diez minutos completos antes de retomarlo.

Pruebas: vencida se retoma; distinta y vigente se rechazan; marcador legado empieza espera; el id anterior no finaliza ni altera la concesión nueva. Integración con Auth/Firestore emulados de recuperación vencida.

Límite: el id protege Firestore; no constituye una transacción distribuida con Auth. El plazo excede el timeout configurado de las funciones, no autoriza a lanzar trabajadores externos de duración ilimitada. La recuperación es un callable; no se agregó una consola administrativa completa de incidentes.

### Tarea 3 — Limpieza de notificaciones

Archivos: `functions/fcm.js`, `functions/cuentas.js`, `functions/test/fcm-sesiones.test.js`, `integration/regresiones.test.js`.

La baja elimina usuarios_privado/{uid} y los fcmTokens cuyo propietario actual coincide; revoca sus fcmSesiones conservando tombstones. Desactivar revoca sesiones y elimina los tokens actuales, dejando campos de token nulos en el privado. Los bloques transaccionales de hasta200 referencias releen el propietario y no borran un token transferido a otra cuenta. Se ejecuta antes de finalizar/borrar el perfil bloqueado y admite repetir la limpieza.

Pruebas: baja y desactivación, doble limpieza, conservación de otro usuario y rechazo de una sesión revocada tras reactivar. Integración de baja con documentos/tombstones reales emulados. No se enviaron notificaciones reales.

### Tarea 4 — Botones y errores

Archivos: `lib/screens/chofer_home.dart`, `lib/widgets/controles_viaje.dart`, `lib/services/errores_viaje.dart`, `test/controles_viaje_test.dart`.

Los dos métodos de viaje guardan `if (_enviando) return`. El widget además bloquea su callback antes del primer await y comparte el bloqueo entre acciones; evita dos pulsaciones antes del rebuild. Los mensajes públicos dependen del código y no muestran la excepción del proveedor.

Pruebas: doble toque sin rebuild genera una sola llamada; error del proveedor no llega al texto visible; se conservan los casos de Cancelar oculto en en_viaje y terminales.

### Tarea 5 — Limpiezas

Archivos: `docs/evidencias-h01-h10/*.txt` afectados, `functions/scripts/migrar-privacidad.js`, `functions/config.js`, `functions/test/seed.test.js`.

Las rutas de perfiles Windows se anonimizan en la versión actual de los TXT y en las evidencias nuevas. No se reescribe el historial Git. La migración informa código y mensaje, redactando valores sensibles conocidos del entorno, claves privadas, bearer/JWT, parámetros de URL, credenciales de URL y campos de token/clave. Se limita el mensaje a500 caracteres y no se imprime el stack completo. El comentario de restricción geográfica indica11.10.

Prueba: mantiene código y mensaje útil y oculta credenciales sintéticas de token/URL. Se verificó la ausencia de rutas con el nombre del usuario del equipo en los TXT entregados. No se alteraron las reglas por dueño11.4 ni validarCoordenada11.9.

### Tarea 6 — APK y validación real

Build de código519299d aprobado: `flutter build apk --debug --no-pub`, exit0. APK de166829789bytes, SHA-256 `20546d1aaef0a06df1504abc78af8fd60e771ac3cfb74bd5491928c7669eb94c`. Antes de empaquetar se repite el build desde el SHA final; su registro y hash exactos están en la entrega externa.

El primer intento falló por CMake3.22.1 ausente y SDK no escribible. Con permiso del usuario se instaló y el build posterior pasó. Se corrigió también el comando de Git del bootstrap del SDK local (`$git` a `git`), sin sustituir el compilador ni modificar las fuentes de Flutter/Dart que compilan la app. Se adjunta el diff de ese ajuste. No se actualizaron dependencias de la aplicación; los lockfiles conservan la base.

Estado de los pasos solicitados:

| Paso | Resultado |
| --- | --- |
| APK debug y SHA-256 | Compilado; registro completo adjunto. Firma debug, no release. |
| Migración en Firebase de pruebas | No ejecutada: falta ID del proyecto de pruebas autorizado. |
| Functions y Scheduler en pruebas | No desplegados; renovación periódica real de validoHasta no verificada. |
| Reglas en proyecto de pruebas | No desplegadas;12 pruebas con Emulator Suite aprobadas. |
| APK instalado en teléfono | No instalado; ADB no lista dispositivos y el usuario confirmó su ausencia. |
| Flujo completo y Cancelar oculto, en teléfono | Pendiente; hay pruebas widget/backend, no grabación física. |
| GPS en Firestore de pruebas en nube | Pendiente; hay escritura y archivo verificados con emuladores. |
| Notificación recibida | No comprobada: no se ejecutó la prueba en teléfono. |

El APK conserva la configuración Firebase de la base. No es un APK reconfigurado para un proyecto de pruebas identificado y no se debe instalar para esa prueba hasta preparar su configuración. No se lanzó la aplicación contra datos reales. Los emuladores usan exclusivamente demo-dializa-h10 y no equivalen a un despliegue en nube.

### Tarea 7 — Pantallas e integración

Archivos: `lib/screens/solicitar_traslado_screen.dart`, `solicitudes_chofer_screen.dart`, `ubicacion_paciente_screen.dart`, `historial_admin_screen.dart`; entradas en `paciente_home.dart`, `chofer_home.dart`, `admin_home.dart`; `lib/services/publicador_ubicacion.dart`, `seguimiento_gps.dart`, `ubicacion_repository.dart`; `ios/Runner/Info.plist`; `test/pantallas_traslado_test.dart`, `tests/firestore.rules.test.js`.

- Paciente: formulario con origen/destino elegidos explícitamente en mapa, direcciones y necesidades. Puede usar su ubicación como origen. Envía crearSolicitudViaje. No se inventan coordenadas de la dirección ni se activa Geoapify. El formulario conserva los campos al desplazarse y bloquea envíos duplicados.
- Chofer: pendientes con un solo botón Aceptar. La tarjeta pendiente representa solo estado genérico; no se añaden nombres/direcciones visibles. Las reglas y el contenido que actualmente entrega Firestore permanecen intactos: no se afirma que el SDK deje de descargar esos campos. La decisión de exposición de datos sigue pendiente del usuario. Rechazar existe solo en asignado; luego se aplican los controles normales.
- Ubicación: publicación continua en primer plano, al recibir posiciones y con intervalo mínimo de5s. Se usan los estados ya autorizados por el servidor (solicitudes: asignado/en camino/llegó/en viaje; manuales: en camino/llegó/en viaje). Selección determinista consistente con el servidor. El recorrido acumulado continúa limitado a un único en_viaje; no se cambia aceptarSolicitud ni su regla de otro viaje activo. Publicaciones pendientes se invalidan al cambiar estado/instancia, pausar o salir. La escritura usa update en lat/lng/timestamp, sin pisar permisos del servidor.
- Paciente: escucha con UbicacionRepository.escucharUbicacion, verifica paciente/instancia/caducidad y muestra la última posición observada. No presenta posiciones antiguas como actuales (umbral120s); puede avisar que no hay actualización si los relojes difieren. La comprobación de caducidad se refresca cada15s. La latencia de una escritura ya enviada no se puede cancelar desde el cliente.
- Administrador: historial paginado de25 registros, nombres archivados y resumen real gps_viajes. Ausencia de muestras se indica expresamente; no se muestra una ruta calculada como recorrido observado.
- iOS: NSLocationWhenInUseUsageDescription agregado y XML validado. No se compiló ni probó iOS.

Pruebas: formulario válido y obligatorio, exclusión de doble envío; pendientes soloAceptar y rechazo por estado; ubicación autorizada/distinta/vencida/antigua; publicación serial y pausa; resumen con/sin GPS; consultas reales bajo reglas para solicitudes propias, aceptadas y paginación del historial. Son verificaciones de componentes y emuladores, no un ensayo de extremo a extremo en teléfono.

## Comandos y resultados

Windows, Flutter3.47.8/Dart3.13.7, Node20.20.1, JDK21, Android SDK/NDK/CMake. Dependencias reales instaladas en rutas cortas; los comandos efectivos usan los entrypoints de SDK y CLI, con PUB_CACHE/NODE_PATH cuando procede.

| Comando lógico | Resultado final |
| --- | --- |
| Node20 --test functions/test/*.test.js (archivos expandidos por PowerShell) |104/104; Functions SDK real, Firestore/RTDB/Auth dobles en esta suite. |
| flutter test --no-pub |34/34; lógica y widgets reales. |
| dart analyze |Exit0; cero errores/warnings; cuatro infos preexistentes de Radio.groupValue/onChanged. |
| firebase emulators:exec --only auth,firestore,database --project demo-dializa-h10 "node --test integration/regresiones.test.js" |10/10, SDK reales; invocación .run, no transporte HTTP ni triggers desplegados. |
| firebase emulators:exec --only firestore,database --project demo-dializa-h10 "node node_modules/mocha/bin/mocha.js tests/*.rules.test.js --timeout 20000" |12/12, clientes reales y reglas sin cambios. |
| Node20 --check,35 JavaScript |Sin errores. |
| plistlib.loads Info.plist |XML válido y clave de permiso presente. |
| git diff --check ba8c553..HEAD |Sin errores al preparar entrega. |
| adb devices -l |Lista vacía. |
| flutter build apk --debug --no-pub |Exit0; verificación repetida en SHA final adjunta. |

La primera ejecución de Flutter falló en el WebSocket local antes de cargar tests por restricción de red. Se obtuvo permiso y se repitió. Una fixture nueva de reglas llamó dos veces a ctx.firestore() y falló por reinicializar sus settings; se corrigió la fixture usando una instancia y pasó. Los resultados aprobados no ocultan esos intentos fallidos. Los logs de integración/reglas pueden contener denegaciones esperadas.

## Decisiones conservadas y pendientes

No se modificaron functions/viajes.js (incluidos rechazadoPor/aceptarSolicitud), functions/validaciones.js, firestore.rules, database.rules.json ni los lockfiles. Docker no se incorporó. No se implementó cifrado de cola GPS. Propuesta para decidir después: cifrar cola y cuarentena con AES-GCM y clave protegida en Android Keystore/iOS Keychain, con UID/versión como datos autenticados, migración local atómica y recuperación/retención acordadas. No se agregó una dependencia de cifrado ni se activó ese diseño.

No hay validación de GPS/FCM real, nube de pruebas, Scheduler desplegado ni iOS. H08 requiere revisión y evidencia física antes de aceptarse. Esta entrega tampoco certifica los demás flujos de las etapas posteriores que no forman parte de estas tareas. Claude debe separar inspección propia de resultados reportados y contrastar el código por commits. La documentación/PPT académica debe conservar esos límites y seguir el Instructivo Capstone2026 cuando esté disponible.
