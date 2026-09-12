# Documentación técnica y manuales de usuario en Word — diseño

**Fecha:** 11/09/2026 · **Rama:** `docs-manuales` · **Estado:** aprobado en chat, pendiente de revisión escrita

## 1. Objetivo

Producir una serie de documentos Word (`.docx`) que un desarrollador que herede SIGeV
pueda leer sin Claude ni Mariano, más tres manuales de usuario con capturas reales, uno
por público (operador de la Comisión Directiva, socio, vecino). Todo nace de un
relevamiento del código hecho el 11/09/2026 (cinco informes, 52.000 palabras, en
`.superpowers/sdd/manuales/scan-0*.md`), cotejado contra `docs/` y contra el código.
**La verdad es el código**: donde `docs/` y el código difieren, los documentos nuevos
describen el código y la diferencia se anota en el archivo de hallazgos.

Decisiones tomadas con el operador (tres rondas de preguntas + aprobación del diseño):

| Decisión | Elegido |
|---|---|
| Público técnico | Un desarrollador que hereda el proyecto |
| Públicos del manual | Operador (CD), socio, vecino; superadmin como capítulo final del de operador |
| Reparto | Serie técnica corta (7 docs) + un manual por público (3) |
| Profundidad | Media: 15-30 páginas por doc técnico, 20-40 por manual |
| Capturas | Reales, del dev server local, de las pantallas clave |
| Ubicación | Markdown fuente + Word generado, en `docs/manuales/`, commiteado |
| Estilo | Institucional simple: portada con logo, índice, pie con versión/fecha/página |
| Credenciales | Reseteo local de `admin.prueba` y `socio.prueba`; `verificacion.m2` reactivado como superadmin de prueba |
| Proceso | Spec + plan escritos; subagentes Opus escriben, revisor Fable coteja contra código |
| Base local | Queda con lo sembrado |
| Idioma | Español; identificadores de código en inglés tal cual |
| Hallazgos | Archivo Markdown aparte, sin corregir `docs/` ni código |
| CLAUDE.md | Un párrafo corto que apunte a `docs/manuales/` y a la regla de mantenimiento |
| Parser Markdown | `marked` como devDependency |

## 2. Entregables

```
docs/manuales/
├── README.md                        ← qué hay, cómo se regeneran los Word, convenciones
├── HALLAZGOS-2026-09-11.md          ← inconsistencias docs↔código y dudas del relevamiento
├── tecnica/
│   ├── T1-vision-y-panorama.md
│   ├── T2-arquitectura-y-codigo.md
│   ├── T3-instalacion-despliegue-operacion.md
│   ├── T4-modelo-de-datos.md
│   ├── T5-tesoreria-y-mercadopago.md
│   ├── T6-modulos-de-dominio.md
│   └── T7-seguridad-privacidad-calidad.md
├── usuario/
│   ├── M1-manual-del-operador.md
│   ├── M2-manual-del-socio.md
│   └── M3-guia-del-vecino.md
├── img/
│   ├── logo.png                     ← copia de assets/logo.png para la portada
│   ├── m1/NN-slug.png               ← capturas del manual del operador
│   ├── m2/NN-slug.png
│   └── m3/NN-slug.png
└── word/
    ├── SIGeV-T1-Vision-y-panorama.docx … SIGeV-T7-Seguridad-privacidad-calidad.docx
    ├── SIGeV-M1-Manual-del-operador.docx
    ├── SIGeV-M2-Manual-del-socio.docx
    └── SIGeV-M3-Guia-del-vecino.docx

scripts/docs/
├── build-docx.ts                    ← Markdown → .docx (librería `docx` + `marked`)
├── capture.ts                       ← capturas con playwright-core sobre el Chrome instalado
├── capture-plan.ts                  ← la lista de capturas (URL, rol, viewport, nombre)
└── reset-test-passwords.ts          ← contraseñas conocidas para los usuarios de prueba (solo local)
```

Además: `package.json` (scripts `docs:build` y `docs:capture`; devDependencies `marked`
y `playwright-core`) y un párrafo nuevo en `CLAUDE.md`.

Fuera de alcance: corregir `docs/01`-`11`, `README.md` o código; cualquier archivo de
`src/`, `prisma/` o `tests/`. El `git diff --stat` final tiene que tocar solo
`docs/manuales/`, `docs/superpowers/`, `scripts/docs/`, `package.json`,
`package-lock.json` y `CLAUDE.md`.

## 3. Convenciones de redacción

- **Español rioplatense.** Los manuales tratan de **vos** al lector ("Hacé clic en…").
  Los técnicos van en impersonal o segunda persona informal, sin mezclar.
- **Fechas** DD/MM/AAAA, **moneda** `$ 1.234,56`, zona horaria Argentina.
- **Identificadores en inglés tal cual** (`registerPayment`, `fee_values`, `CRON_SECRET`),
  siempre en `código inline`. Un identificador por frase; el resto en palabras.
- **Sin transcribir código.** Un documento técnico explica qué hace una pieza, dónde vive
  (ruta del archivo) y qué invariante sostiene; el lector abre el archivo si quiere el
  detalle. Se admiten bloques cortos de comandos (`bash`) y de `.env`.
- **Citas al estatuto** con el `REG-xx` de `docs/02` cuando la regla viene de ahí.
- **Cada afirmación es verificable**: el escritor la saca del código o del informe de
  relevamiento (que cita `archivo:línea`), y el revisor la coteja. Lo que no se pudo
  verificar no se escribe.
- **Un manual no explica el código.** No dice "la action valida…"; dice "el sistema no te
  deja… y te muestra el mensaje …", con el texto literal del mensaje.
- **Las pantallas se nombran como en la interfaz** (Tesorería → Sin conciliar), no por
  URL; la URL va entre paréntesis la primera vez.
- **Copy por tipo de reporte** (reclamo se presenta ante un organismo; iniciativa la trata
  la Comisión) revisado en cada frase que hable de reportes (lección del Módulo 7).

## 4. Índice de cada documento

Cada documento abre con: título, "Para quién es y qué da por sabido", "Cómo leer este
documento" (3-5 líneas) y, en los técnicos, "Dónde está en el código" al final de cada
capítulo. Cada uno cierra con un apéndice "Documentos relacionados" que apunta a los
otros de la serie y a `docs/`.

### T1 — Visión y panorama (15-20 páginas)

1. Qué es SIGeV y para quién (la asociación, el estatuto, la IGJ; los cuatro procesos
   que digitaliza; qué NO es).
2. Los tres públicos y los tres roles (`superadmin`, `admin`, `socio`, acumulables);
   quién ve qué.
3. Mapa del sitio: tabla de todas las URLs públicas, de `/mi` y de `/admin`, con una
   línea cada una (fuente: informes 01, 02, 03).
4. Los módulos, en el orden en que se construyeron (0 a 7 más las fases intermedias),
   con una frase de qué trae cada uno y su fecha de cierre.
5. Estado al 11/09/2026: qué está en producción, qué está mergeado sin desplegar
   (`payment_split`, N° público de reportes, llave colaborador, etc.), qué espera
   (`fix-withdrawal-reasons`, `EMAIL_ALLOWLIST`, IGJ).
6. Cómo se desarrolló: Claude Code + specs y planes en `docs/superpowers/`, el rol de
   `CLAUDE.md`, qué significa un "test de fuente".
7. Guía de lectura de la serie (qué documento abrir según la tarea) y glosario
   (acta, adherente, devengo, cuota de ingreso, cartelera, libro, cohorte, preapproval,
   bandeja, reparto…).

### T2 — Arquitectura y código (25-30 páginas)

1. Stack con versiones reales (`package.json`): Next 16.3.1 App Router, React 19.2, Prisma
   7.9 con `@prisma/adapter-mariadb`, Auth.js v5 beta, Tailwind 4, shadcn, docx, pdf-lib,
   sharp, mercadopago, nodemailer.
2. Un solo proyecto, tres zonas: `(public)`, `/mi`, `/admin`, más `/api`. Cómo se
   protege cada zona (proxy → layout → cada action) y por qué la nav es display.
3. Estructura de carpetas comentada (`src/` a tres niveles; una línea por carpeta).
4. Capas: pantalla (RSC) → server action → módulo de dominio (`src/lib/*`) → Prisma.
   Qué va en cada capa y qué no (red fuera de transacciones, PDF después del commit).
5. Patrones transversales, con ejemplo y archivo: gateway propio para servicios
   externos; reglas como funciones puras; Prisma inyectado en módulos puros;
   funciones compartidas en vez de copiadas (`coverageFloor`, `activeExemption`,
   `validateSubmission`, `loadEligibilityInputs`); un solo proceso (mutex y limiters en
   memoria); `cache-tags`; auditoría best-effort vs estricta; transiciones `updateMany`
   condicionales; numeración sin huecos.
6. El shell del panel y sus componentes (`PageHeader`, `FormMessage`, `EmptyState`,
   badges, pestañas por URL vs Radix, `section-tabs`, `synced-fields`), y el de `/mi`.
7. Formularios: el patrón central (server action + `useActionState`, mensajes, Turnstile).
8. Tema y color: tokens, `--primary`, la regla de contraste, modo oscuro.
9. Checklist para un desarrollador nuevo (primer día, primera pantalla, primera action).

### T3 — Instalación, despliegue y operación (25-30 páginas)

1. Entorno local en Windows/Linux: Node 24, Docker (`sigev-db`), `.env`, `npm ci`,
   `prisma migrate dev`, seed, `import-calles`, `import-padron`, `import-deuda`,
   `seed-holidays`, `generate-assets`, `import-estatuto`; correr el dev server; correr
   las suites. Cómo restaurar la base a la línea de base.
2. `.env` completo, variable por variable (fuente `.env.example` y el informe 05).
3. Tabla `Configuration`: cada llave, quién la edita, qué pasa si falta.
4. Producción: el VPS (`/root/dev/ciudadela`), PM2 (`sigev`, puerto 3006, una instancia),
   Nginx, Cloudflare (proxy, WAF, caché de imágenes), Brevo, Turnstile, Mercado Pago.
5. Despliegue con `deploy.sh` paso a paso; qué hacer si hay migración; verificación
   post-deploy (resumen de `docs/10` §4.x); rollback.
6. Crontab de seis líneas: cada cron, horario, qué hace, cuándo saltea, `?force=`,
   `CRON_SECRET`, `cron_runs`.
7. Backups: `backup.sh`, `BACKUP_DIR`, `LAST_OK`, qué se respalda (base, uploads,
   recibos), cómo se restaura.
8. `/admin/salud`: qué mide, las varas por cron, *act* vs *review*, qué hacer ante cada
   rojo.
9. Logs y diagnóstico: `pm2 logs`, qué NO aparece en los logs (Ley 25.326), el 403
   sin rastro de Cloudflare, el 429 de MP.
10. Runbooks cortos: cambiar el valor de cuota; correr un devengo perdido; reenviar una
    invitación; recuperar un webhook perdido (reconcile manual); dar de alta un usuario
    de gestión; qué hacer al lanzar (`EMAIL_ALLOWLIST`).

### T4 — Modelo de datos (20-25 páginas)

1. Cómo leer el esquema: Prisma, nombres de modelo vs tabla, convenciones (UTC,
   `civilDayOf`, soft state por columnas).
2. Diagrama de dominios (bloques y flechas, en texto/ASCII o imagen simple).
3. Un capítulo por dominio, con tabla modelo | tabla SQL | campos clave | relaciones |
   para qué sirve: sistema y auth; socios y padrón (Member, Membership, Book, Movement);
   solicitudes de alta; tesorería (Fee, FeeValue, Payment, Receipt, ReceiptSequence,
   OtherIncome, FeeExemption); Mercado Pago (MpSubscription, WebhookEvent,
   MpUnmatchedPayment); re-empadronamiento (ReregistrationProcess, Presentation,
   BoardNotice, Holiday); contenido y reportes (News, Activity, Minute, Document,
   InstitutionalDocument, Report, ReportFile, ReportSequence); notificaciones,
   auditoría, cron_runs, action_tokens, member_requests.
4. Enums, uno por uno, con el significado de cada valor y quién lo escribe.
5. Uniques y FKs que sostienen invariantes; y las invariantes que NO están en la base
   (viven en código) y por qué.
6. Las 24 migraciones en una tabla (fecha, nombre, qué agrega, si muda datos).
7. Datos importados: `padron_socios.xlsx`, `deuda.xlsx`, `calles_inicial.csv`, feriados.

### T5 — Tesorería y Mercado Pago (30 páginas)

1. Vocabulario: cuota, período, devengo, piso de cobertura, valor vigente, recibo,
   imputación, débito, link, bandeja, reparto, conciliación.
2. Ciclo de vida de una cuota: calendario (`periods.ts`), devengo mensual, `coverageFloor`,
   deuda valuada a valor vigente, `allocate` (más viejas primero), recibo con número
   tardío dentro de la transacción, PDF después del commit, anulación y reembolso.
3. `fee_values`: la única fuente de montos; cómo se registra un valor nuevo.
4. Los seis caminos de cobro y el núcleo compartido (`validateInput` / `preparePart` /
   `writePaymentAndFees` / `issueReceipt`): efectivo, link de pago (`pago:{id}:{n}`,
   vencimiento 72 h, sello HMAC), débito por webhook, vinculación de suscripciones,
   bandeja con reparto (portador + partes), pago desde `/mi`.
5. Ingresos no societarios (`other_incomes`) y por qué no llevan recibo.
6. Exención de cuota: `fee_exemptions`, cuotas `exempt` materializadas, `activeExemption`
   como única fuente de las cinco guardas, anulación con revalidación.
7. Mercado Pago: el gateway (12 métodos y sus trampas), planes como referencia,
   preapproval sin plan, el webhook (firma, `WebhookEvent`, idempotencia por
   `mpPaymentId`), el procesador (nunca falla por regla de negocio), `resolve.ts`
   (las nueve reglas, "la suscripción manda"), las tres semánticas de suscripción viva,
   la conciliación diaria (dos fuentes, `isOwnCollection`, 207), la bandeja.
8. Los cinco crons de plata y avisos (tabla) y el recordatorio en detalle.
9. Correos: la cañería (allowlist en el transporte, `MailBudget`, `Notification.failed`)
   y la tabla de las 27 plantillas (asunto, disparador, destinatario).
10. Cómo se prueba: sandbox de MP (resumen de `docs/11` J), tests unitarios con gateway
    mockeado, tests de integración contra MariaDB.

### T6 — Módulos de dominio (25 páginas)

1. Solicitudes de alta (ASOCIATE): estados y transiciones, elegibilidad por DNI (las 8
   causales), residencia y categorías, `colaborador_habilitado`, cuota de ingreso
   (REG-14), vencimientos 3/7 días y el cron de mantenimiento, acuse vs admisión,
   aprobación y asiento en acta, rechazo, retome por token.
2. Socios, libros e histórico: `Member` y `Membership`, categorías y estados, movimientos,
   alta manual y modo carga, baja individual y en lote (cancelación de débito después del
   commit, `WITHDRAWAL_DEBIT_CALL_BUDGET`), cesantía por mora, recategorización, la ficha.
3. Solicitudes de socios (`member_requests`): tipos, "una pendiente por tipo", mutex.
4. Re-empadronamiento (Art. 9° bis): proceso, cohorte congelada, wizard público y carga
   presencial, cola de validación, las dos aritméticas de plazos (días corridos vs
   hábiles) y `hasExpired`, cartelera por lotes, checklist, bajas en lote, cierre del
   libro (transacción, updateMany por conjuntos, renumeración `planMigration`).
5. Reportes (Módulo 7): borrador con llave, wizard público y del socio, sharp y EXIF,
   `validateSubmission`, transiciones `updateMany`, N° público, PDF, mapa, purga.
6. Actas (`Minute`): tipos, numeración única por tipo, `MinutePicker` y su default,
   export PDF/Word, `discardUnusedMinute`.
7. Contenido: noticias (portadas en `UPLOADS_DIR/news`), actividades, documentos
   institucionales y el estatuto importado, cartelera pública.
8. Usuarios y roles: alta de usuario de gestión, invitación, degradación, `requireSuperadminUsers`.
9. Padrón electoral: qué lista, el Excel, las reglas.

### T7 — Seguridad, privacidad y calidad (20 páginas)

1. Modelo de amenazas resumido: qué es público, qué es personal (DNI, domicilio, deuda),
   qué es dinero.
2. Sesión y credenciales: Auth.js Credentials + bcrypt, JWT de 8 h con techo de 7 días,
   `passwordChangedAt`, frescura de sesión, roles vivos contra la fila.
3. Tokens de un solo uso (`action_tokens`): tipos, TTL, consumo atómico.
4. Turnstile: dónde sí y dónde no, y por qué.
5. Rate limiters: tabla de los 21 con cupo, ventana y clave; la premisa de un proceso.
6. Cabeceras y CSP: la global, las 8 entradas por ruta, la lección de `setHeader`, el
   test que las sincroniza.
7. Archivos: tres raíces fuera de `public/`, magic bytes, `nosniff`, `no-store`, sharp
   solo en reportes (deuda anotada para DNIs), retención y purga.
8. Ley 25.326 en el código: qué se enmascara en logs (`log-safe`), `maskedName`,
   `Notification.error` con código y no dirección, `EMAIL_ALLOWLIST`, 404 vs 403.
9. Auditoría: `audit()` vs `auditStrict`, tabla de asientos por acción (resumen de la
   tabla del informe 02), la ficha del alta que lee `audit_log`.
10. Webhook: `x-Signature`, `WebhookEvent`, respuestas 200 a lo que no se atiende.
11. Calidad: cómo correr `vitest`, la suite de integración y qué necesita, los 13 tests
    "de fuente" y qué convención fija cada uno, `tsc`, `lint`, `build`; qué no hay (CI).
12. Deuda conocida y decisiones abiertas (lista corta, con puntero a HALLAZGOS).

### M1 — Manual del operador (35-40 páginas + capítulo superadmin)

0. Antes de empezar: qué es el panel, quién tiene acceso, el navegador, el celular.
1. Entrar y salir; recuperar la contraseña; qué pasa si la sesión venció.
2. Inicio: el tablero y sus tarjetas.
3. Solicitudes → Altas: la cola, la ficha de un alta, ver los documentos, aprobar y
   asentar en acta (con el resumen para acta), rechazar, reenviar el enlace, qué correos
   recibe el vecino en cada paso.
4. Solicitudes → De socios: recategorizaciones y bajas pedidas desde `/mi`; aplicar y
   rechazar.
5. Solicitudes → Reportes: la bandeja, la ficha, el mapa, presentar/desestimar, el PDF.
6. Reempadronamiento: el tablero, validar una presentación, carga presencial, la
   cartelera por lotes (fijar fecha, imprimir el cartel, qué acredita), qué ve el vecino.
7. Socios: Padrón (buscar, filtrar, exportar), la ficha (pestañas), acciones societarias
   (baja, recategorización, suspensión), alta manual, modo carga, invitar por correo,
   Libros e Histórico.
8. Tesorería: Deudores (lista, gestión manual, cesantía en lote), Efectivo (registrar un
   pago, el recibo), Link de pago (generar, mandar, qué ve el socio), Recibos (buscar,
   reimprimir, anular), Sin conciliar (qué es, aplicar, repartir entre socios, ingreso no
   societario, reembolso), Suscripciones (vincular una existente), Otros ingresos,
   Valores de cuota (solo superadmin: se remite al cap. 13), Exenciones (otorgar, anular).
9. Actas: cargar, numerar, exportar; el acta en cada acción.
10. Noticias y Actividades: publicar, editar, portada, días de actividad.
11. Documentos: publicar para los socios.
12. Los correos que manda el sistema (tabla: qué, a quién, cuándo) y el resumen diario.
13. **Solo superadmin**: Usuarios (alta, roles, invitación, desactivar), Configuración
    (5 pestañas: planes de MP, destinatarios del resumen, llave colaborador, valor de
    cuota, …), Salud (leer el veredicto, qué hacer), Padrón electoral (armar y exportar),
    Reempadronamiento (convocar con acta, checklist, bajas en lote, cerrar el libro).
14. Preguntas frecuentes y problemas comunes (no me llega el correo, el socio dice que
    pagó y no figura, un pago sin socio, un error rojo en Salud, un 403 al subir un archivo).

### M2 — Manual del socio (20 páginas)

1. Qué es "Mi cuenta" y quién puede entrar.
2. Primera vez: el correo de invitación, crear la contraseña, verificar el correo;
   recuperar la contraseña; por qué puede vencer la sesión.
3. Inicio: qué muestra.
4. Mi cuenta: la deuda y las cuotas, pagar con Mercado Pago (paso a paso, qué pasa al
   volver, cuándo llega el recibo), descargar recibos.
5. Débito automático: qué es, requisitos, adherirse (paso a paso en MP), la regla del mes
   en curso, cancelar.
6. Mis datos: qué se puede cambiar y qué no (y por qué), cambio de domicilio.
7. Solicitudes: institucional (cambio de categoría, baja) y Reportes (presentar y seguir).
8. Documentos: estatuto y documentos publicados.
9. Si estás suspendido: qué podés hacer y qué no.
10. Los correos que vas a recibir. Preguntas frecuentes.

### M3 — Guía del vecino (15-20 páginas)

1. El sitio: inicio, noticias, actividades, ubicación (el mapa y la sede), documentos.
2. Asociarse (ASOCIATE): requisitos, los 6 pasos con captura de cada uno, la cuota de
   ingreso y el pago, qué pasa después (la Comisión resuelve; el acta), los correos,
   retomar un trámite, por qué puede rechazarse.
3. Re-empadronarse (REEMPADRONATE): quién tiene que hacerlo, los 4 pasos, plazos, qué
   pasa si no lo hago, la cartelera.
4. Reportes: reclamo vs iniciativa, los 3 pasos, la foto y la ubicación, el número de
   reporte, cómo sigue.
5. Ingresar y recuperar el acceso (remite a M2).
6. Privacidad: qué datos se piden y para qué (Ley 25.326, en dos párrafos).
7. Preguntas frecuentes.

### HALLAZGOS-2026-09-11.md

Una tabla por informe (01 a 05) con: qué dice `docs/`/`CLAUDE.md`/`README`, qué dice el
código (archivo:línea), gravedad (doc desactualizada / deuda de código / duda), y
sugerencia. Sin corregir nada. Se compila desde las secciones "no está documentado" y
"dudas e inconsistencias" de los cinco informes.

## 5. Plantilla Word

Generada íntegramente con `docx` (ya en `dependencies`, v9.7.1). A4, márgenes 2,5 cm.

- **Portada**: logo (`docs/manuales/img/logo.png`, ~5 cm), "SIGeV — Sistema Integral de
  Gestión Vecinal", título del documento, subtítulo (serie técnica N° / manual de …),
  "Asociación Vecinal del Barrio Ciudadela", versión y fecha. Sin encabezado ni pie.
- **Índice**: campo TOC de Word (niveles 1-3) en su propia página. Como `docx` no
  calcula el índice, el script de build **abre cada Word con Word por COM** (está
  instalado) para actualizar campos y guardar; si Word no está, deja el campo y avisa
  que hay que actualizarlo con F9.
- **Estilos**: Título 1 en celeste de marca `#0079BC` 18 pt con línea inferior; Título 2
  14 pt; Título 3 12 pt negrita; cuerpo Calibri 11 pt, interlineado 1,15; código inline
  Consolas 10 pt con sombreado gris claro; bloques de código Consolas 9,5 pt en tabla de
  una celda sombreada; citas con barra izquierda; tablas con encabezado sombreado celeste
  claro y bordes finos, anchos en DXA repartidos según el número de columnas; listas con
  numeración/viñetas de Word (nunca "•" literal); imágenes centradas, ancho máximo 16 cm,
  con leyenda "Figura N — texto" en cursiva 9 pt.
- **Encabezado** (desde la página 2): nombre del documento a la izquierda, "SIGeV" a la
  derecha. **Pie**: "SIGeV — v1.0 — 11/09/2026 — Página X de Y".
- **Salto de página** antes de cada Título 1.

### Markdown admitido

Títulos `#` a `####`; párrafos; **negrita**, *cursiva*, `código`; enlaces (se escriben como
texto + URL entre paréntesis en el Word); listas `-` y `1.` con dos niveles; tablas GFM;
bloques de código con lenguaje; citas `>`; imágenes `![leyenda](../img/m1/01-x.png)`
(la leyenda se vuelve "Figura N — leyenda"); línea horizontal `---`; un bloque de
metadatos YAML al inicio con `title`, `subtitle`, `series`, `version`, `date`. Cualquier
otra sintaxis hace fallar el build con un mensaje que dice archivo y línea.

## 6. Pipeline

- `npm run docs:build` → `tsx scripts/docs/build-docx.ts [archivo.md …]`; sin argumentos
  compila los diez. Lee el Markdown con `marked` (lexer → tokens), arma el documento con
  `docx`, escribe en `docs/manuales/word/`, y después intenta la pasada de Word por COM
  (PowerShell) para actualizar el índice. Falla ruidoso ante sintaxis no admitida o imagen
  faltante.
- `npm run docs:capture` → `tsx scripts/docs/capture.ts [m1|m2|m3]`: `playwright-core`
  con `channel: "chrome"` (usa el Chrome instalado, no descarga navegadores), viewport
  1280×800 a escala 1, inicia sesión con los usuarios de prueba, recorre
  `capture-plan.ts` y guarda PNG en `docs/manuales/img/<manual>/NN-slug.png`. Lee
  `DOCS_CAPTURE_BASE_URL` (default `http://localhost:3000`) y la contraseña de los
  usuarios de prueba de `SEED_TEST_PASSWORD`, que ya existe en el `.env` local para el
  seed: no se agrega ninguna variable ni ningún secreto nuevo.
- `scripts/docs/reset-test-passwords.ts`: reaplica el bcrypt de `SEED_TEST_PASSWORD` a
  `admin.prueba@sigev.local`, `socio.prueba@sigev.local` y
  `verificacion.m2@sigev.local` (y activa este último). Se niega a correr si
  `DATABASE_URL` no apunta a `localhost`.
- Verificación de cada Word: `soffice --headless --convert-to pdf` y lectura visual del
  PDF (portada, índice, una tabla, una imagen, el pie), más `validate.py` del skill docx.

## 7. Capturas: alcance y datos

Unas 45 capturas: ~25 para M1, ~10 para M2, ~10 para M3. La lista exacta vive en
`capture-plan.ts` y se escribe en la tarea de capturas del plan, pantalla por pantalla,
con el estado de datos que necesita cada una.

Estados que hay que sembrar en la base local antes de capturar (desde el propio panel o
con los scripts existentes), y que quedan sembrados:

- una noticia publicada con portada y una actividad;
- un alta en cola (`pending_review`) con documentos y una aprobada pendiente de acta;
- un cobro en la bandeja (`scripts/dev/seed-unmatched.ts`) para la captura del reparto;
- una exención vigente sobre un socio de prueba;
- un re-empadronamiento convocado (con acta) y al menos una presentación en cola y
  un lote de cartelera fijado;
- un reporte recibido con foto y ubicación;
- el socio de prueba con deuda, un recibo y sin débito (para "Adherirse").

Los datos personales que aparezcan en las capturas son de prueba; no se captura ninguna
pantalla con DNI o domicilio de un socio real del padrón importado (se usan los socios
`*.prueba` o fichas creadas para la ocasión con nombres inventados). El revisor de cada
manual verifica esto captura por captura.

## 8. Proceso de producción y verificación

Plan con una tarea por entregable, en este orden: (0) pipeline y plantilla con un
documento de prueba; (1) reset de contraseñas y siembra; (2) capturas; (3-9) T1..T7;
(10-12) M1..M3; (13) HALLAZGOS + README de la carpeta + párrafo en CLAUDE.md;
(14) verificación final. Los técnicos y los manuales se pueden escribir en paralelo
entre sí una vez que (0) y (2) están.

Cada documento: lo escribe un subagente **Opus** con el brief (índice de esta spec, los
informes de relevamiento pertinentes, los `docs/` pertinentes y acceso al código); lo
revisa un subagente **Fable** que coteja una muestra de afirmaciones contra el código,
verifica que el Markdown compile, que el Word abra y que las capturas correspondan al
texto; el escritor corrige y se cierra.

Verificación final (obligatoria, informe en `.superpowers/sdd/manuales/`): los diez
Word compilan y abren (PDF de cada uno leído en portada, índice y una página interior);
`npm test` con el mismo conteo que `main`; `npx tsc --noEmit` y `npm run lint` limpios;
`npm run build` OK; `git diff --stat` acotado a la lista de §2; ninguna captura con datos
de un socio real; las contraseñas de prueba no aparecen en ningún archivo commiteado.

## 9. Riesgos y decisiones

- **El índice del Word depende de Word por COM.** Si la automatización falla en la
  máquina de Mariano, el documento sale con el campo TOC sin calcular y un aviso en el
  build; abrirlo en Word y apretar F9 lo resuelve. Se anota en el README.
- **`playwright-core` es una devDependency nueva** además de `marked`. Usa el Chrome
  instalado; no descarga nada. Si se prefiere no agregarla, la alternativa es capturar a
  mano desde el panel del navegador, que no puede guardar archivos.
- **Deriva de las capturas.** Cada cambio visual las desactualiza; el README explica cómo
  re-capturar una sola (`npm run docs:capture m1 -- --only 07`).
- **Longitud.** Los informes de relevamiento superan lo pedido; el escritor selecciona,
  no vuelca. Las páginas objetivo de §4 son el tope.
