# Evidencia de compilacion y validacion pendiente

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
