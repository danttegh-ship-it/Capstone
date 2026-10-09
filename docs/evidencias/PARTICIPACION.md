# Participación individual y evidencia en Git

## 1. Repositorios y cuentas

| Repositorio | Propietaria/o | Contenido | Visibilidad |
| --- | --- | --- | --- |
| [Jabby07/dializa-app](https://github.com/Jabby07/dializa-app) | Javiera Vidal (cuenta `Jabby07`) | Primera versión de la app Flutter: login con roles y pantallas de paciente, administrador y chofer | Privado: el docente debe estar invitado como colaborador |
| [DantteG/Capstone](https://github.com/DantteG/Capstone) | Dantte García (cuenta `DantteG`) | Versión combinada con el backend (Etapas 0 y 1), pruebas, documentación técnica y evidencias de este informe | Público |

Cada integrante usa una sola cuenta de GitHub. Los commits de `DantteG` aparecen
con el correo `164922422+DantteG@users.noreply.github.com`.

## 2. Commits verificables al corte (2026-10-09)

| Repositorio | Commit | Fecha | Autor | Cambio |
| --- | --- | --- | --- | --- |
| Jabby07/dializa-app | `dc58432` | Sin fecha exacta: la captura del Anexo A dice "last week" `[CONFIRMAR fecha]` | Jabby07 | "Primera version del proyecto" |
| DantteG/Capstone | `ade3988` | 2026-10-09 | DantteG | Creación del repositorio |
| DantteG/Capstone | `fa2133e` | 2026-10-09 | DantteG | `FASE1_REPORTE.md` |
| DantteG/Capstone | `567efdf` | 2026-10-09 | DantteG | Código de las Etapas 0 y 1 en `dializa-app-fase1.zip` |
| DantteG/Capstone | (commit de esta versión) | 2026-10-09 | DantteG | Código descomprimido en `dializa-app/`, README y evidencias de `docs/` |

El historial de `Jabby07/dializa-app` solo se pudo revisar mediante la captura
del Anexo A, porque el repositorio es privado.

## 3. Aportes por integrante

| Integrante | Actividad realizada | Entregable | Evidencia en Git | Fecha | Resultado |
| --- | --- | --- | --- | --- | --- |
| Javiera Vidal | Configuración del entorno Flutter y Firebase; primera versión de la app con login y tres paneles | Proyecto Flutter `dializa-app` | `Jabby07/dializa-app@dc58432` | `[CONFIRMAR fecha]` | Primera versión publicada |
| Javiera Vidal | Ejecución de la versión combinada en su emulador, creación de cuentas de prueba y capturas | Figuras 5 a 7 del informe | Sin commit (capturas en el informe) | `[CONFIRMAR fecha y commit probado]` | App funcionando para admin y chofer; panel de paciente sin captura |
| Javiera Vidal | Requerimientos con el cliente (flujo de confirmación de asistencia) y diseño de interfaz para adultos mayores | `paciente_home.dart`, `respuestas_paciente` | `Jabby07/dializa-app@dc58432` | Fase 1 | Implementado |
| Javiera Vidal | Redacción del informe de avance, Carta Gantt y respuesta al feedback | Informe de la Fase 2 | `[PENDIENTE: subir el .docx final a docs/informe/]` | 2026-10-09 | Entregado |
| Dantte García | Combinación del backend anterior (Daily App) con dializa-app: 27 Cloud Functions, reglas e índices | `dializa-app/functions/`, `firestore.rules`, `database.rules.json` | `DantteG/Capstone@567efdf` y commit de esta versión | 2026-10-07 (reporte) / 2026-10-09 (Git) | 77/77 pruebas unitarias |
| Dantte García | Pruebas unitarias, mutaciones y documentación técnica | `functions/test/`, `docs/`, `FASE1_REPORTE.md` | `DantteG/Capstone@fa2133e`, `567efdf` | 2026-10-07 / 2026-10-09 | Ver `INFORME_PRUEBAS.md` |

## 4. Equidad del trabajo

La carga se reparte por **responsabilidad y complejidad**, no por número de
commits:

- Javiera es responsable de la experiencia de usuario, del contacto con los
  requerimientos del cliente y de la documentación del avance.
- Dantte es responsable del servidor, la seguridad de los datos y las pruebas.
- Ambos comparten las Etapas 2, 4 y 5 (ver Tabla 8 del informe).

## 5. Limitaciones que el equipo reconoce

- **El trabajo se hizo mayoritariamente fuera de Git** y se subió en bloque: un
  commit por integrante en su repositorio, y el código de la Etapa 1 subido
  primero como `.zip`. Por eso el historial no muestra la evolución del trabajo.
- **Hay dos repositorios separados.** Ninguno muestra todavía commits de ambos
  integrantes.

## 6. Cómo se corregirá desde la semana 10

1. Unificar en un solo repositorio con ambos integrantes como colaboradores
   (y el docente invitado).
2. Trabajar en ramas por etapa y abrir un *pull request* revisado por la otra
   persona antes de unir a `main`.
3. Registrar las tareas como *issues* en un tablero (GitHub Projects) y
   referenciarlas en los commits (`#n`).
4. Hacer commits pequeños y frecuentes, cada uno con su propio autor.

No se reescribirá el historial ni se crearán commits con fechas o autores que no
correspondan.
