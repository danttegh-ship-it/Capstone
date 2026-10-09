# Diseño de ingeniería — Dializa App (corte semana 9)

Los diagramas se construyeron a partir del código de `dializa-app/` (no de la
propuesta). GitHub los dibuja directamente (Mermaid). Cada sección indica qué
está **implementado** y qué está **propuesto**.

## 1. Arquitectura y responsabilidades

```mermaid
flowchart TB
  APP["App Flutter · Android (iOS planificado)<br/>Login · Paciente · Chofer · Administrador"]
  AU["Firebase Authentication<br/>claim rol"]
  CF["Cloud Functions v2 · 27 funciones<br/>cuentas · viajes · historial · GPS · autorización"]
  FS[("Cloud Firestore<br/>usuarios · viajes · solicitudes · historial")]
  RT[("Realtime Database<br/>ubicaciones del chofer")]
  FCM["Cloud Messaging"]
  GEO["Geoapify<br/>(apagado por flag)"]
  APP -->|"1 · inicia sesión"| AU
  APP -->|"2 · llama funciones"| CF
  APP -->|"3 · lee según reglas;<br/>paciente escribe su respuesta"| FS
  APP -->|"4 · chofer publica su posición"| RT
  CF -->|"escrituras de negocio"| FS
  CF -->|"autoriza lectura de ubicación"| RT
  CF -->|"avisa asignación"| FCM
  FCM -->|"notificación"| APP
  CF -.->|"proxy con clave secreta"| GEO
```

| Componente | Responsabilidad | Estado |
| --- | --- | --- |
| App Flutter | Interfaz por rol; lee su rol en `usuarios/{uid}` y abre la pantalla que corresponde | Implementado (Android probado en emulador; ver Anexo A) |
| Authentication | Identidad; custom claim `rol` usado por el servidor y por las reglas de RTDB | Implementado |
| Cloud Functions | Toda escritura de negocio: cuentas, viajes, historial, GPS, autorización, notificaciones | Implementado; probado con dobles |
| Firestore | Datos de negocio; el cliente solo escribe `respuestas_paciente/{uid}` | Implementado; reglas sin ejecutar en emulador |
| Realtime Database | Posición en vivo del chofer y autorización de lectura | Implementado; reglas sin ejecutar en emulador |
| Geoapify | Geocodificación, rutas y map matching mediante el servidor | Código existente, **apagado** (`GEOAPIFY_HABILITADO=false`); integración real en Etapa 4 |

**Geoapify no obtiene el GPS del dispositivo.** La posición del chofer viene del
sensor del teléfono (`ubicacion_actual.dart`); Geoapify solo convierte
direcciones en coordenadas y calcula rutas.

## 2. Modelo de datos (implementado)

```mermaid
erDiagram
  USUARIOS ||--o| CHOFERES_PRIVADO : "si rol = chofer"
  USUARIOS ||--o| RESPUESTAS_PACIENTE : "si rol = paciente"
  USUARIOS ||--o| VIAJES : "paciente (id del doc)"
  USUARIOS ||--o{ SOLICITUDES : "paciente pide"
  VIAJES ||--o{ HISTORIAL_VIAJES : "al cerrar o reasignar"
  SOLICITUDES ||--o| HISTORIAL_VIAJES : "al cerrar"
  HISTORIAL_VIAJES ||--o| GPS_VIAJES : "mismo viajeId"
  USUARIOS {
    string uid PK
    string rol "admin | chofer | paciente"
    string nombre
    bool activo
    bool aprobado "solo chofer"
    string fcmToken
  }
  CHOFERES_PRIVADO {
    string uid PK
    string patente
    string licencia
    string modeloVehiculo
    bool vehiculoAdaptado
    bool disponible
  }
  RESPUESTAS_PACIENTE {
    string uid PK
    bool asistira
    string comoLlega
    bool necesitaMovilidad
    string direccion
    string fecha
  }
  VIAJES {
    string pacienteId PK
    string viajeId
    string choferId
    string fecha
    string hora
    string estado
    array historial
  }
  SOLICITUDES {
    string id PK
    string pacienteId
    string conductorId
    map origen
    map destino
    map necesidades
    string estado
  }
  HISTORIAL_VIAJES {
    string viajeId PK
    string cierre
    string estadoFinal
    map gps "conteo, primerTs, ultimoTs"
  }
  GPS_VIAJES {
    string viajeId PK
    subcol muestras "id = timestamp"
  }
```

Además existen `rateLimits`, `auditoria` (solo servidor) y, en Realtime
Database, `ubicaciones/{uid}` con `lat`, `lng`, `timestamp`,
`pacienteAutorizado`, `viajeAutorizado` y `autorizacionVersion`.

Restricciones relevantes (implementadas en `firestore.rules`,
`database.rules.json` y `functions/`):

- `viajes/{pacienteId}` guarda solo la asignación **vigente**; cada cierre se
  copia a `historial_viajes` dentro de la misma transacción.
- `gps_viajes` acepta como máximo 50 muestras por llamada y 5000 por viaje, con
  marca de tiempo entre 15 minutos antes y 60 segundos después de la hora del
  servidor.
- `historial_viajes` tiene índices por `pacienteId` y por `conductorId`,
  ordenados por `archivadoEn` (`firestore.indexes.json`).

## 3. Máquina de estados del viaje (implementada en `functions/viajes.js`)

```mermaid
stateDiagram-v2
  [*] --> solicitado: paciente crea solicitud (solo solicitudes)
  [*] --> asignado: admin asigna (viajes)
  solicitado --> asignado: chofer acepta
  asignado --> solicitado: chofer devuelve (rechazarSolicitud)
  asignado --> conductor_en_camino: chofer
  conductor_en_camino --> conductor_llego: chofer
  conductor_llego --> en_viaje: chofer
  en_viaje --> finalizado: chofer
  asignado --> cancelado: chofer
  conductor_en_camino --> cancelado: chofer
  conductor_llego --> cancelado: chofer
  finalizado --> [*]
  cancelado --> [*]
```

Solo el chofer asignado avanza el estado. Cualquier otra transición se rechaza
en el servidor (`failed-precondition`). Esto está cubierto por pruebas y por la
mutación M1 (`docs/evidencias/INFORME_PRUEBAS.md`).

## 4. Flujo de navegación de los tres roles

```mermaid
flowchart TD
  I[Inicio de la app] --> L[LoginScreen<br/>correo + contraseña]
  L -->|"¿Olvidaste tu contraseña?"| R[Correo de recuperación]
  L -->|rol = admin| AH[AdminHome<br/>pacientes, respuestas, asignar chofer y hora]
  L -->|rol = chofer| CH[ChoferHome<br/>disponibilidad, viajes, estados, compartir ubicación]
  L -->|rol = paciente| PH[PacienteHome<br/>¿asiste? → ¿cómo llega? → ¿ayuda de movilidad?]
  AH --> AC[AdminConductoresScreen<br/>aprobar o desactivar choferes]
  CH -->|chofer sin aprobar| RC[RegistroConductorScreen<br/>patente, licencia, vehículo]
  L -.->|"sin rol / rol desconocido"| E[Mensaje de error]
  AH -->|cerrar sesión| L
  CH -->|cerrar sesión| L
  PH -->|cerrar sesión| L
```

| Pantalla | Estado |
| --- | --- |
| Login, panel admin, gestión de conductores, panel chofer | Implementado; capturas en el Anexo A |
| Panel paciente | Implementado en código; **sin captura todavía** (no había cuenta de paciente de prueba) |
| Pantalla de inicio (splash) y restauración de sesión por rol | Propuesto (Etapa 2) |
| Solicitud de viaje del paciente, pendientes del chofer, historial del admin | Propuesto (Etapa 3); el servidor ya existe |
| Registro de vehículo (`RegistroConductorScreen`) | Implementado; se muestra dentro de `ChoferHome` mientras el chofer no está aprobado |
