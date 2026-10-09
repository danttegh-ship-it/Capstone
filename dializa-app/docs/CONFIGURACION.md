# Configuración paso a paso

## 1. Requisitos

- Flutter SDK (canal stable) y Dart.
- Firebase CLI (`npm install -g firebase-tools`), con acceso al proyecto
  `dializa-app`.
- Node.js 20 (para `functions/`).

## 2. Instalar dependencias

```bash
flutter pub get
cd functions && npm install && cd ..
```

## 3. Cargar las claves de Geoapify en Secret Manager

Las 3 claves están desactivadas por defecto (`GEOAPIFY_HABILITADO = false`
en `functions/config.js`), pero igual hay que cargarlas para cuando se
active esa función:

```bash
firebase use dializa-app

firebase functions:secrets:set GEOAPIFY_KEY_RUTA
# pega el valor real de la clave cuando el comando lo pida (no se guarda
# en este documento ni en ningun archivo versionado del proyecto)

firebase functions:secrets:set GEOAPIFY_KEY_MAPMATCHING
# idem

firebase functions:secrets:set GEOAPIFY_KEY_GEOCODING
# idem
```

Las claves reales viven solo en Firebase Secret Manager (cargadas con los
comandos de arriba) y en el archivo .txt que se entrega aparte de este
repositorio -- nunca en la documentacion ni en el codigo versionado.

## 4. Desplegar backend y reglas

**Orden importante** (Fase 1): `viajes/{pacienteId}` pasó a `write:false` y
el admin asigna con la Cloud Function `asignarViaje`. Un admin con una
versión VIEJA de la app (que hace `.set()` directo) no podría asignar tras
desplegar las reglas. Despliega en este orden:

```bash
firebase deploy --only functions                              # 1. backend nuevo
firebase deploy --only firestore:indexes                      # 2. índices (tardan unos minutos)
# 3. publicar la app nueva a los administradores
firebase deploy --only firestore:rules,database               # 4. reglas nuevas
```

Datos existentes: los documentos de `viajes` sin `viajeId`/`estado` siguen
funcionando (se archivan como `esLegacy`). Los nodos RTDB `ubicaciones/*`
existentes no necesitan migración; la primera reconciliación agrega la
autorización.

## 5. Activar Geoapify cuando se confirme su uso (punto 6.9)

1. En `functions/config.js`, cambiar `GEOAPIFY_HABILITADO: false` a `true`.
2. En `lib/config/feature_flags.dart`, cambiar `geoapifyHabilitado = false`
   a `true`.
3. Volver a desplegar funciones y recompilar la app.

## 6. Verificar que las claves de Geoapify funcionan

Mientras el flag esté activo, probar cada endpoint directo (fuera de la
app, para aislar si el problema es la clave o el código):

```bash
curl "https://api.geoapify.com/v1/geocode/search?text=Santiago,Chile&apiKey=<GEOAPIFY_KEY_GEOCODING>"
curl "https://api.geoapify.com/v1/routing?waypoints=-33.4489,-70.6693|-33.4569,-70.6483&mode=drive&apiKey=<GEOAPIFY_KEY_RUTA>"
curl -X POST "https://api.geoapify.com/v1/mapmatching?apiKey=<GEOAPIFY_KEY_MAPMATCHING>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"drive","waypoints":[{"location":[-70.6693,-33.4489],"timestamp":"2026-01-01T10:00:00Z"},{"location":[-70.6483,-33.4569],"timestamp":"2026-01-01T10:05:00Z"}]}'
```

Un `"statusCode":401` o `"error":"Invalid apiKey"` significa que la clave
no es válida; un `FeatureCollection` con resultados significa que
funciona.

## 7. Correr los tests

Hay tres niveles, con alcance distinto. **No son equivalentes**:

```bash
# (a) Unitarios de las Cloud Functions, con DOBLES en memoria de Firestore,
#     RTDB y Auth (no evalúan reglas de seguridad ni índices):
cd functions
npm install        # instala firebase-functions/firebase-admin reales
npm test           # node --test sobre test/*.test.js
npm run check      # node --check de todos los .js
```

Si `firebase-functions` NO está instalado, los tests inyectan un doble mínimo
de `firebase-functions/v2/https` y lo declaran en la primera línea de la
salida (`# entorno de test: DOBLE ...`). Con `npm install` hecho usan el
paquete real.

```bash
# (b) Reglas de Firestore y RTDB contra el Emulator Suite real (integración).
#     Desde la raíz del proyecto:
npm install
npm run test:reglas:firestore
npm run test:reglas:database
```

Se ejecutan por separado porque ambos archivos definen hooks `before/after`
globales de mocha que chocarían en una misma corrida.

```bash
# (c) Widget test de Flutter:
flutter test
```

## 8. Seed privado de cuentas de ejemplo

`functions/scripts/seed-cuentas.js` crea `admin.ejemplo@gmail.com` y
`conductor.ejemplo@gmail.com`. Es un script manual con Admin SDK: no se
despliega (`firebase.json` lo ignora) y no existe ningún endpoint público
equivalente.

Reglas del seed:

- El rol por prefijo (`admin.*` → admin, `conductor.*` → chofer, resto →
  paciente) se aplica **solo al crear** una cuenta nueva en este script.
  Después el rol vive en `usuarios/{uid}.rol` y en el custom claim `rol`; el
  login y las Cloud Functions leen eso, nunca el correo.
- Solo crea: si el correo ya existe en Auth no se toca (ni rol, ni claim, ni
  perfil, ni contraseña).
- El conductor nace `aprobado:false`. Se aprueba desde la pantalla
  *Conductores* del admin, o con `--aprobar-conductores-de-prueba` si es solo
  una cuenta de prueba.
- Simulación por defecto; escribe solo con `--confirmar`.
- Exige `--project dializa-app` igual al proyecto de `.firebaserc`, y aborta si
  `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT` apuntan a otro.
- La contraseña viene de la variable `SEED_PASSWORD` (mínimo 8, letra y
  número) y nunca se imprime ni se guarda.

```bash
cd functions
node scripts/seed-cuentas.js --project dializa-app            # simulación

# Emulador local (sin credenciales reales):
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
SEED_PASSWORD='<elige-una>' \
node scripts/seed-cuentas.js --project dializa-app --emulador --confirmar

# Proyecto real (cuenta de servicio con permisos de Auth y Firestore):
SEED_PASSWORD='<elige-una>' GOOGLE_APPLICATION_CREDENTIALS=/ruta/cuenta-de-servicio.json \
node scripts/seed-cuentas.js --project dializa-app --confirmar
```

La cuenta de servicio y la contraseña no se versionan (`.gitignore` excluye
`*service-account*.json`, `.env*`, etc.).
