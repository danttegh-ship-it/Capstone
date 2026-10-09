# Participación individual y evidencia en Git

## 1. Repositorios

| Repositorio | Cuenta | Contenido | Visibilidad |
| --- | --- | --- | --- |
| [Jabby07/dializa-app](https://github.com/Jabby07/dializa-app) | `Jabby07` (Javiera Vidal) | Primera versión de la app Flutter: login con roles y paneles de paciente, administrador y chofer | Privado. El acceso del docente no está comprobado |
| [DantteG/Capstone](https://github.com/DantteG/Capstone) | `DantteG` (Dantte García) | Versión combinada con el backend (Etapas 0 y 1), pruebas, documentación técnica y evidencias del informe | Público |

## 2. Commits comprobados

| Repositorio | Commit | Fecha (Git) | Autor | Cambio | Cómo se comprobó |
| --- | --- | --- | --- | --- | --- |
| Jabby07/dializa-app | `dc58432` | No comprobada | Jabby07 | «Primera version del proyecto» | Captura del repositorio (Figura 8 del informe); el repositorio es privado y su historial no se pudo revisar |
| DantteG/Capstone | `ade3988` | 2026-10-09 | DantteG | Creación del repositorio | `git log` del repositorio público |
| DantteG/Capstone | `fa2133e` | 2026-10-09 | DantteG | `FASE1_REPORTE.md` y primera versión del informe (.docx) | `git log` |
| DantteG/Capstone | `a4dad4f` | 2026-10-09 | DantteG | Retira el .docx del informe | `git log` |
| DantteG/Capstone | `567efdf` | 2026-10-09 | DantteG | Código de las Etapas 0 y 1 en `dializa-app-fase1.zip` | `git log` (último commit publicado al revisar) |

Los commits posteriores de esta versión se describen en el `README.md`.

## 3. Aportes por integrante

| Integrante | Actividad | Entregable | Evidencia verificable | Fecha confirmada | Responsabilidad y complejidad | Colaboración |
| --- | --- | --- | --- | --- | --- | --- |
| Javiera Vidal | Primera versión de la aplicación Flutter: entorno, Firebase, login con roles y tres paneles | Proyecto `dializa-app` | `Jabby07/dializa-app@dc58432` (captura, Figura 8) | No confirmada | Interfaz y flujo para adultos mayores; base sobre la que se integró el backend (`ARQUITECTURA.md`: la UI de dializa-app se conservó) | Su proyecto es la base de la versión combinada |
| Javiera Vidal | Flujo de confirmación de asistencia del paciente pedido por el cliente | `paciente_home.dart`, colección `respuestas_paciente` | Código en `dializa-app/lib/screens/`; `README.md` («se mantuvo como lo pidió el cliente final») | No confirmada | Requisito central del cliente | — |
| Javiera Vidal | Ejecución de la versión combinada en su emulador y capturas | Figuras 5 a 7 del informe | Capturas del informe; su conversación de apoyo muestra que usó las cuentas de prueba del script de Dantte (Figura 9) | No confirmada | Prueba manual de los paneles de administrador y chofer | Usó `scripts/seed-cuentas.js` de Dantte |
| Javiera Vidal | Informe de avance: estructura, Gantt, respuesta al feedback, uso de IA | Informe de la Fase 2 | Primera versión del .docx en `DantteG/Capstone@fa2133e`; Figura 10 | 2026-10-09 (commit) | Documento evaluado de la entrega | Incorporó el reporte técnico de Dantte |
| Dantte García | Combinación del backend de Daily App con dializa-app: 27 Cloud Functions, modelo de datos, reglas e índices | `dializa-app/functions/`, `firestore.rules`, `database.rules.json`, `firestore.indexes.json` | `DantteG/Capstone@567efdf` y versión descomprimida | 2026-10-09 (commit); reporte fechado 2026-10-07 | Servidor, seguridad de datos, transacciones y concurrencia | Conservó la UI de Javiera y adaptó `admin_home.dart` para usar `asignarViaje` |
| Dantte García | Pruebas unitarias y documentación técnica | `functions/test/`, `docs/`, `FASE1_REPORTE.md` | `DantteG/Capstone@fa2133e`, `567efdf` | 2026-10-09 (commit) | 77 pruebas; documentación de arquitectura y estados | Entregó el reporte que Javiera incorporó al informe |

Las fechas de commit indican cuándo se subió el trabajo, no cuándo se hizo. El
trabajo de ambos se realizó con apoyo de asistentes de IA, como declara el
Anexo B del informe.

## 4. Cómo se lee la equidad

- Ambos integrantes tienen entregables propios y verificables: la aplicación
  base y el informe (Javiera) y el backend, las pruebas y la documentación
  técnica (Dantte).
- La equidad se justifica por responsabilidad y complejidad de esos
  entregables, no por el número de commits.
- En `DantteG/Capstone` solo aparecen commits de `DantteG`, incluidos los que
  suben el informe. Eso no significa que él sea el autor de todo lo subido:
  el informe y la aplicación base son trabajo de Javiera.

## 5. Limitaciones

- El historial de `Jabby07/dializa-app` no se pudo revisar (repositorio
  privado). Para que el docente vea el aporte de Javiera en Git necesita
  acceso a ese repositorio, o una exportación de su historial
  (`git log --stat` o un `git bundle`).
- El trabajo se subió en bloque y en dos repositorios separados, por lo que el
  historial no muestra cómo evolucionó.

## 6. Prácticas desde la semana 10

1. Unificar el trabajo en un solo repositorio con ambos integrantes y el
   docente como colaboradores.
2. Ramas por etapa y *pull requests* revisados por la otra persona.
3. Tareas registradas como *issues* y referenciadas en los commits.
4. Cada integrante hace sus propios commits.

No se reescribirá el historial ni se crearán commits con fechas o autores que
no correspondan.
