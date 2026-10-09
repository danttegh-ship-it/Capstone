# Índice de evidencias — Informe de Avance Fase 2 (corte semana 9)

Versión entregada: etiqueta **`entrega-fase2`** del repositorio
`DantteG/Capstone`. Los enlaces del informe apuntan a esa etiqueta para que no
cambien cuando el proyecto siga avanzando.

Base de los enlaces: `https://github.com/DantteG/Capstone/blob/entrega-fase2/`

**Estado de publicación:** esta versión existe localmente. Debe comprobarse
que esté publicada en GitHub y que el docente pueda abrir ambos repositorios
(ver `README.md`, sección «Versiones»).

| # | Requisito de la pauta | Evidencia | Archivo | Resultado |
| --- | --- | --- | --- | --- |
| 1 | Documentación | Descripción, estado, versiones y cómo ejecutar | [`README.md`](../../README.md) | Disponible |
| 2 | Documentación | Reporte de las Etapas 0 y 1 | [`dializa-app/docs/FASE1_REPORTE.md`](../../dializa-app/docs/FASE1_REPORTE.md) | Disponible |
| 3 | Documentación | Arquitectura y decisiones | [`dializa-app/docs/ARQUITECTURA.md`](../../dializa-app/docs/ARQUITECTURA.md) | Disponible |
| 4 | Documentación | Estados del viaje | [`dializa-app/docs/ESTADOS_VIAJE.md`](../../dializa-app/docs/ESTADOS_VIAJE.md) | Disponible |
| 5 | Documentación | Instalación, despliegue y pruebas | [`dializa-app/docs/CONFIGURACION.md`](../../dializa-app/docs/CONFIGURACION.md) | Disponible |
| 6 | Documentación | Propuestas pendientes de decisión | [`dializa-app/docs/DIFERENCIAS_Y_PROPUESTAS.md`](../../dializa-app/docs/DIFERENCIAS_Y_PROPUESTAS.md) | 7 propuestas abiertas |
| 7 | Diseño de ingeniería | Arquitectura, modelo de datos, estados y navegación | [`docs/diagramas/DISENO.md`](../diagramas/DISENO.md) | Diagramas obtenidos del código |
| 8 | Programación (servidor) | 27 Cloud Functions | [`dializa-app/functions/index.js`](../../dializa-app/functions/index.js) | 27 exportaciones |
| 9 | Programación (cliente) | Pantallas de los tres roles | [`dializa-app/lib/screens/`](../../dializa-app/lib/screens/) | Capturas en el Anexo A, sin versión identificada; cliente sin compilar tras la Etapa 1 |
| 10 | Programación (pruebas) | Tipos de prueba, ejecuciones y pendientes | [`INFORME_PRUEBAS.md`](INFORME_PRUEBAS.md) | 77/77 (tipo A); reglas y cliente sin ejecutar |
| 11 | Programación (pruebas) | Registro de pruebas unitarias y sintaxis | [`pruebas_unitarias_2026-10-09.log`](pruebas_unitarias_2026-10-09.log) | 77 pasan, 0 fallan |
| 12 | Programación (pruebas) | Script y registro de mutaciones | [`ejecutar-mutaciones.js`](../../dializa-app/functions/test/mutaciones/ejecutar-mutaciones.js), [`mutaciones_2026-10-09.log`](mutaciones_2026-10-09.log) | 9 de 9 detectadas |
| 13 | Almacenamiento de datos | Registro de lectura de JSON | [`json_2026-10-09.log`](json_2026-10-09.log) | 6 archivos parseables |
| 14 | Almacenamiento de datos | Reglas de Firestore y RTDB | [`firestore.rules`](../../dializa-app/firestore.rules), [`database.rules.json`](../../dializa-app/database.rules.json) | Escritas; no ejecutadas en emulador |
| 15 | Almacenamiento de datos | Índices de `historial_viajes` | [`firestore.indexes.json`](../../dializa-app/firestore.indexes.json) | Definidos |
| 16 | Almacenamiento de datos | Permisos, propuesta de reglas y privacidad | [`PERMISOS_Y_PRIVACIDAD.md`](PERMISOS_Y_PRIVACIDAD.md) | Lecturas abiertas documentadas; propuesta no aplicada |
| 17 | Trazabilidad | Matriz de requerimientos | [`TRAZABILIDAD.md`](TRAZABILIDAD.md) | 29 de 115 puntos trazados |
| 18 | Participación (indicador 7) | Aportes, commits y limitaciones | [`PARTICIPACION.md`](PARTICIPACION.md) | Ver §5 |
| 19 | Participación (indicador 7) | Aplicación base de Javiera Vidal | [Jabby07/dializa-app](https://github.com/Jabby07/dializa-app), commit `dc58432` | Privado; acceso del docente no comprobado |
| 20 | Informe | Informe de Avance Fase 2 | [`docs/informe/`](../informe/) | Versión entregada |
