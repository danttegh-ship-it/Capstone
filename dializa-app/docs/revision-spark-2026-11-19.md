# Revision de los paneles en Firebase Spark — 19 de noviembre de 2026

Base: `e10545a386aae280acb3a6d375ee3fb7bcc760bf`.
Codigo compilado: `1f19cf38a7cb058f977e5475b6ad912bc095061a`.
Rama: `codex/correcciones-h01-h10`.
Proyecto de pruebas: `dializa-pruebas`. No se contrato Blaze.

## Cambios y comprobaciones

| Punto | Implementacion | Comprobacion |
|---|---|---|
| Mapa del paciente | Arrastrar, gestos y botones Acercar/Alejar, limites de zoom | Widget prueba zoom y desplazamiento |
| Direccion tras seleccionar punto o GPS | Geocodificador nativo Android/iOS; completa el campo correspondiente | Widget prueba direccion resuelta y ausencia de cobertura |
| Solicitud de traslado | En pruebas se escribe en `solicitudes` con identidad del paciente autenticado | Emulador y prueba remota con paciente/chofer temporales |
| Aceptacion y estados | Transaccion, disponibilidad, un solo ganador por solicitud, orden de estados, archivo atomico al cerrar | Emulador y prueba remota completa |
| Rechazo despues de aceptar | Vuelve a solicitado, desasigna, conserva `rechazadoPor` y libera disponibilidad | Prueba de reglas dedicada |
| Ubicacion del chofer | Automatica durante su sesion, independiente de disponibilidad; sin boton de compartir ni interruptor de GPS | Compilacion y reglas. Falta prueba fisica |
| Segundo plano Android | Servicio de ubicacion con notificacion persistente y permisos declarados | Compila. Falta comprobar pantalla bloqueada en telefono |
| Pacientes | Editar nombre, retirar de la lista mediante baja logica y bloquear acceso a datos | Prueba remota de edicion y baja |
| Asignar chofer y hora | Transaccion de admin, validacion de participantes, instancia nueva y conservacion del archivo anterior | Emulador y asignacion remota visible para conductor |
| Conductores | Aprobar, Bloquear acceso y Desbloquear acceso; conserva cuenta y datos | Emulador y prueba remota de bloqueo/reactivacion |
| Errores | Mensajes breves; los errores operativos dejan de mostrar excepcion y stack trace | Analisis y pruebas Flutter |
| Historial y GPS | Conserva ficha de Javiera, controles del mapa y cola con cuarentena; resumen Spark usa conteo/primerTs/ultimoTs | Regresion Flutter y reglas |

El paciente de prueba no estaba hardcodeado: el panel consulta `usuarios` por rol.
El error NOT_FOUND provenia de los callables no desplegados. `OperacionesApp`
selecciona transacciones Spark exclusivamente cuando el ID de proyecto es
`dializa-pruebas`. Los otros proyectos conservan los callables originales.

## Seguridad y diferencias del modo de pruebas

- `firestore.rules` y `database.rules.json` originales permanecen intactos.
- Las reglas Spark estan separadas en `firestore.spark.rules`, con configuracion
  de despliegue `firebase.spark.json`. Se publicaron solo en `dializa-pruebas`.
- El paciente no puede asignar choferes, alterar estados ni cambiar su rol.
- El chofer aprobado y activo solo puede cambiar sus traslados; las reglas
  verifican transiciones, historial y archivo al finalizar/cancelar.
- Al aceptar se exige disponibilidad y se cambia a false en la misma transaccion.
  No se agrega la regla pendiente de otro viaje activo ni se cambia la politica
  existente de `rechazadoPor`.
- En Spark la ubicacion vive en Firestore `ubicaciones/{uid}`. El paciente solo
  puede leerla mientras exista una relacion de viaje vigente verificada por las
  reglas. No se usa un permiso abierto ni un Scheduler para esta autorizacion.
- Se conservan los timestamps GPS observados, la deduplicacion y la cuarentena.
  Las muestras de pruebas admiten hasta 8 horas de antiguedad y 60 segundos futuros.
- El bloqueo y la baja Spark impiden operar sobre los datos mediante reglas;
  conservan la cuenta de Authentication. No equivalen a borrar o deshabilitar
  remotamente esa cuenta en Authentication.
- Reasignar un viaje manual se permite antes de iniciarlo o tras su cierre.
  Se conserva la proteccion contra reemplazar un recorrido que ya esta iniciado.
- No se agregaron claves de servicio ni `google-services.json` al repositorio.

## Comandos y resultados

Las rutas de herramientas y del equipo se omiten en las evidencias publicadas.

1. `dart pub get`: dependencias resueltas; se incorporo `geocoding`.
   El primer `flutter pub get` aviso que Windows no permitia symlinks de escritorio;
   se resolvieron dependencias con Dart y Android compilo con `--no-pub`.
2. `flutter test --no-pub`: **38 pruebas correctas**.
3. `dart analyze lib`: **0 errores, 0 warnings**; 4 avisos previos de Radio obsoleto
   en `paciente_home.dart`.
4. Emulador Firestore local: `mocha tests/firestore.spark.test.js
   tests/firestore.rules.test.js --timeout 30000`: **14 pruebas correctas**.
   Se uso `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` y datos demo.
5. `firebase deploy --config firebase.spark.json --only firestore:rules
   --project dializa-pruebas --non-interactive`: compilacion y publicacion correctas.
6. Prueba remota con clientes Firebase autenticados mediante tokens de cuentas QA:
   crear solicitud como paciente, consultar como chofer, aceptar, en camino,
   llego, en viaje, finalizar y archivar; editar paciente; asignar viaje como
   admin; bloquear, rechazar operacion bloqueada y desbloquear; baja de paciente
   y rechazo de acceso a viaje. **Correcta**. Las cuentas y documentos QA
   temporales se eliminaron. El PERMISSION_DENIED del log es el rechazo esperado
   mientras la cuenta estaba bloqueada.
7. `flutter build apk --debug --no-pub` desde el SHA de codigo indicado:
   **APK generado**, ultima compilacion 33.6 s. Persisten avisos de compatibilidad
   futura de Kotlin en cloud_functions/firebase_database; no bloquearon el build.
8. `aapt2 dump resources`: el recurso `project_id` del APK es `dializa-pruebas`.
9. `adb devices -l`: no hay telefono conectado. No se presenta una prueba
   sintetica o del emulador como evidencia de GPS real.

## APK

Nombre: `dializa-pruebas-debug-1f19cf3.apk`.

SHA-256:

```text
C9E4F4C2E6B42B05D845D600B5476F4091836B3D742B276BE3CDEC3C02D546A0
```

Se compilo en la copia de pruebas con el mismo SHA de codigo y con los archivos
locales de configuracion Firebase apuntando a pruebas. Esos archivos no se
incluyen en los commits. Tambien hay una copia del APK en Descargas del equipo.

## Validacion pendiente en telefono

1. Instalar el APK nuevo e iniciar sesion como paciente.
2. Acercar/alejar y mover el mapa; seleccionar origen y destino, comprobar
   las calles o el aviso de falta de cobertura y enviar la solicitud.
3. Entrar como conductor, conceder ubicacion, activar disponibilidad para
   aceptar solicitudes y comprobar que la solicitud aparece y se puede aceptar.
   La disponibilidad no controla ni apaga la ubicacion.
4. Completar los estados hasta finalizar. Cancelar debe seguir oculto en en_viaje.
5. Comprobar ubicacion con la app minimizada y la pantalla bloqueada, su
   notificacion persistente y que se detiene al cerrar sesion/bloquear la cuenta.
6. Con un segundo telefono, comprobar la vista del paciente y la revocacion
   al finalizar; comprobar las muestras observadas reales en gps_viajes.
7. Desde admin editar un nombre, asignar chofer/hora, bloquear y desbloquear
   conductor, retirar un paciente ficticio y consultar historial.

Android conserva control de los permisos, GPS, bateria y detencion forzada.
No se promete seguimiento despues de forzar la detencion o apagar el telefono.
El geocodificador nativo necesita cobertura del proveedor: un punto sin calle
devuelve un aviso y permite escribir la direccion; no inventa una calle.
Las notificaciones push de servidor no se implementan con este adaptador Spark.
H08 sigue pendiente de aceptacion de la evidencia fisica.

## Commits de implementacion

- `7eb718b`: mapa, geocodificador y pruebas de direcciones/zoom.
- `829b563`: operaciones Spark, pantallas administrativas/solicitudes y reglas.
- `1070e9a`: ubicacion automatica y adaptacion de GPS/ubicacion a Firestore.
- `2330eb3`: reintento del sensor sin repetir dialogos ni ocultar errores.
- `1f19cf3`: disponibilidad y rechazo compatibles con el contrato previo.

Las evidencias de comandos estan en `docs/evidencias-spark/`.

## Archivos por commit

### 7eb718b

- `dializa-app/lib/screens/solicitar_traslado_screen.dart`
- `dializa-app/lib/services/direccion_service.dart`
- `dializa-app/pubspec.lock`
- `dializa-app/pubspec.yaml`
- `dializa-app/test/controles_mapa_test.dart`
- `dializa-app/test/pantallas_traslado_test.dart`

### 829b563

- `dializa-app/firebase.spark.json`
- `dializa-app/firestore.spark.rules`
- `dializa-app/lib/screens/admin_conductores_screen.dart`
- `dializa-app/lib/screens/admin_home.dart`
- `dializa-app/lib/screens/solicitar_traslado_screen.dart`
- `dializa-app/lib/screens/solicitudes_chofer_screen.dart`
- `dializa-app/lib/services/errores_viaje.dart`
- `dializa-app/lib/services/operaciones_app.dart`
- `dializa-app/tests/firestore.spark.test.js`

### 1070e9a

- `dializa-app/android/app/src/main/AndroidManifest.xml`
- `dializa-app/lib/screens/chofer_home.dart`
- `dializa-app/lib/services/seguimiento_gps.dart`
- `dializa-app/lib/services/ubicacion_repository.dart`

### 2330eb3

- `dializa-app/lib/services/seguimiento_gps.dart`

### 1f19cf3

- `dializa-app/firestore.spark.rules`
- `dializa-app/lib/screens/admin_home.dart`
- `dializa-app/lib/services/operaciones_app.dart`
- `dializa-app/tests/firestore.spark.test.js`
