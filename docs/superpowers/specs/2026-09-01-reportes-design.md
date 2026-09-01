# Módulo 7 — Reportes: reclamos e iniciativas de vecinos y socios

**Fecha:** 01/09/2026 · **Estado:** spec aprobada por el operador (siete rondas de preguntas +
cuatro secciones de diseño aprobadas el 01/09/2026)
**Base:** informes de seis agentes de análisis (sitio público y wizards, panel `/mi`,
`/admin/solicitudes` y shell, archivos/PDF/mapa/CSP, datos e infraestructura, lenguaje visual),
guardados en el scratchpad de la sesión.
**Rama:** `reports`.

## 1. Encuadre estatutario y alcance

El estatuto respalda las dos puntas del módulo:

- **Art. 2 inc. g** (objetivos): *"Canalizar inquietudes de orden social, cultural, y deportivo de
  los vecinos del citado Barrio"*. Habla de **vecinos**, no de socios: los reclamos de no socios
  tienen base estatutaria. El cierre del Art. 2 respalda la marca de "presentado ante organismo":
  *"tendrá vinculación con los Organismos públicos que corresponda… podrá aportar proyectos,
  ideas, denunciar los hechos que afecten la seguridad e integridad de los vecinos"*.
- **Art. 6, Derechos, punto 2**: *"Proponer iniciativas para el beneficio del barrio, a ser
  evaluadas por la Comisión Directiva."*

**Qué es**: un registro de lo que el vecino plantea y de lo que la asociación hizo con eso, con un
PDF por reporte para llevarlo al organismo. **Qué NO es**: un sistema de tickets municipal. No
promete resolución, no tiene seguimiento ni SLA, no reemplaza el reclamo directo del vecino ante
la SCPL o el municipio. Ningún reclamo contra otro socio se convierte en expediente disciplinario
(REG-20 sigue fuera de alcance).

Docs que se actualizan antes de programar: párrafo de alcance en `docs/01`, **REG-37** en
`docs/02`, modelo en `docs/04`, flujos en `docs/05`, **Módulo 7** en `docs/07`, retención y
re-encode en `docs/08`, y una sección "Patrones que estrenó el Módulo 7" en `CLAUDE.md`.

## 2. Decisiones del operador (01/09/2026)

| Tema | Decisión |
|---|---|
| Tipos | Un wizard, dos tipos: **Reclamo** (problema en la vía pública) e **Iniciativa** (propuesta). Ambos para socios y vecinos |
| Anonimato | **Reservado ante el organismo**: la asociación siempre conoce la identidad; "reservado" = el PDF y la presentación omiten nombre, DNI y contacto |
| DNI del vecino | **Obligatorio** (frente y dorso). Imágenes conservadas **360 días** después de presentado o desestimado; nombre y DNI en texto se conservan con el reporte |
| Estados | `received` → `filed` (presentado; "tratada" para iniciativas) o `dismissed` (desestimado, con motivo) |
| Anti-abuso | Entra directo a la cola: Turnstile + límites por IP + DNI obligatorio. Sin confirmación de email |
| Ubicación | Mapa Leaflet (tiles IGN) + límite del barrio + pin arrastrable + "Usar mi ubicación" + calle con `StreetPicker` + altura/referencia. **Obligatoria en reclamos, opcional en iniciativas y en "Otro reporte"**. Fuera del polígono: avisa y deja enviar |
| Fotos | Hasta 2, opcionales, jpg/png/webp, 10 MB. **Privadas y re-codificadas con sharp** (sin EXIF/GPS) |
| Correos al que reporta | Acuse al enviar + aviso al presentar/tratar. Al desestimar no se avisa |
| Comisión | **Correo inmediato con identidad completa** por cada reporte nuevo a `digest_recipients` **y** sección en el resumen diario |
| Socio en `/mi` | Sub-pestañas **Institucional \| Reportes** dentro de Solicitudes; atajo en el home. El **suspendido puede reportar** |
| Organismos | Lista fija en código: MCR, SCPL, Concejo Deliberante, Provincia del Chubut, Camuzzi, Otro (con texto) |
| Roles | Admin y superadmin presentan y desestiman |
| Iniciativas | Mismo flujo; el segundo estado se lee "Tratada por la Comisión" y admite acta opcional (`MinutePicker`, default "sin acta") |
| PDF | Ficha + fotos + **mini-mapa** compuesto en el servidor con tiles del IGN; si el IGN no responde, sale sin mapa |
| SCPL | Aviso con el WhatsApp del bot (+54 9 2975 26-0760) + campo opcional "N° de reclamo SCPL" |
| Organismo sugerido | Subtipo SCPL → SCPL; el resto → MCR. Preseleccionado **y dicho con todas las letras** antes de confirmar |
| Transparencia | Landing con contadores del año (recibidos · presentados), solo números |
| Mapa admin | **En esta fase**: vista Mapa con pines por estado |
| Retención | Purga como **paso del cron del digest** (sin línea nueva de crontab) |
| URL | Menú "Reportes", landing y wizard en `/reportes` |
| Arquitectura | **Módulo propio con tablas propias**; el **borrador nace al terminar el paso 1** y los archivos se suben de a uno contra su llave |
| Paso 1 | Tipo + reserva de identidad en la misma pantalla |

## 3. Catálogo (código puro, `src/lib/reports/catalog.ts`)

### 3.1 Reclamos: categorías y tipos

Slugs en inglés (código), etiquetas en castellano (UI). `scpl: true` marca los tipos que el vecino
puede y debe reclamar también ante la SCPL.

| Categoría (`slug`) | Tipos (`slug` · etiqueta · SCPL) |
|---|---|
| `water` · Agua potable | `no_water` Falta de agua ✔ · `low_pressure` Falta presión de agua ✔ · `leak` Pérdida de agua en la red ✔ · `other` Otro |
| `sewage` · Cloacas y saneamiento | `blocked` Cloacas tapadas ✔ · `internal_overflow` Desborde interno ✔ · `manhole_overflow` Desborde en boca de registro ✔ · `manhole_cover` Tapa de registro en malas condiciones ✔ · `other` Otro |
| `electricity` · Electricidad y luminarias | `voltage` Problemas de tensión ✔ · `streetlight` Falta de alumbrado público / luminaria quemada ✔ · `pole` Poste dañado / peligro en vía pública ✔ · `other` Otro |
| `waste` · Residuos | `general` Residuos generales · `vacant_lot` Residuos en terrenos / baldíos · `dump` Basural a cielo abierto / microbasural · `other` Otro |
| `streets` · Calles y vía pública | `pothole` Baches / pozos en calzada · `dirt_road` Calle de tierra en mal estado · `sidewalk` Veredas rotas · `other` Otro |
| `trees` · Árboles y espacios verdes | `pruning` Poda de árboles · `fall_risk` Árbol en riesgo de caída · `roots` Raíces levantando veredas / viviendas · `green_space` Falta de mantenimiento de espacios verdes |
| `transport` · Transporte público | `no_shelter` Falta de garitas / refugios · `no_signage` Falta de señalización de paradas · `shelter_damaged` Garitas / refugios en mal estado · `other` Otro |
| `other` · Otro reporte | sin tipos: va directo a la descripción |

Íconos (mapa nombre → componente en el componente cliente, nunca en `lib/`): `Droplets`,
`Waves`, `Zap`, `Trash2`, `TrafficCone`, `TreeDeciduous`, `BusFront`, `MessageSquareWarning`.

### 3.2 Iniciativas: categorías

`social` Social · `cultural` Cultural · `sports` Deportiva · `works` Obras e infraestructura ·
`safety` Seguridad · `other` Otra. Sin tipos. Íconos: `Users`, `Palette`, `Trophy`, `HardHat`,
`Shield`, `Lightbulb`.

### 3.3 Organismos (`ReportAgency`)

`mcr` Municipalidad de Comodoro Rivadavia (MCR) · `scpl` SCPL · `council` Concejo Deliberante ·
`province` Provincia del Chubut · `camuzzi` Camuzzi · `other` Otro (exige `filedAgencyOther`).
Para una iniciativa el asiento se lee "Tratada por la Comisión Directiva"; el organismo es
opcional y el acta también.

`suggestedAgency({ kind, category, subtype })`: reclamo con tipo `scpl: true` → `scpl`; cualquier
otro reclamo → `mcr`; iniciativa → `null` (sin sugerencia; el formulario arranca en "Comisión
Directiva" sin organismo).

### 3.4 Límite del barrio (`src/lib/reports/boundary.ts`)

El polígono de `datos/limites-barrio.kml` (un `Placemark` "Ciudadela", 20 vértices, lng/lat)
transcripto como constante `BARRIO_BOUNDARY: Array<[lat, lng]>`, más `BARRIO_BOUNDS` (caja
envolvente) y `isInsideBoundary(lat, lng)` por ray casting. Un test parsea el KML del repo y
verifica que la constante coincide vértice por vértice: si alguien actualiza el archivo sin tocar
la constante, el test lo dice. El mismo módulo exporta `boundaryToSvgPath(width, height)` para la
silueta de la landing y del PDF.

## 4. Modelo de datos

Dos tablas nuevas y dos agregados aditivos. Migración `add_reports`, estrictamente aditiva.

```prisma
enum ReportKind      { claim  initiative }
enum ReportStatus    { draft  received  filed  dismissed }
enum ReportFileKind  { photo  dni_front  dni_back }
enum ReportAgency    { mcr  scpl  council  province  camuzzi  other }

model Report {
  id               Int            @id @default(autoincrement())
  kind             ReportKind
  status           ReportStatus   @default(draft)
  anonymous        Boolean        @default(false)   // reservado ante el organismo
  memberId         Int?           @map("member_id")  // socio autor (SetNull)
  // Identidad como FOTO al momento de reportar (para el socio, copiada de su ficha).
  reporterName     String?        @map("reporter_name")  @db.VarChar(160)
  reporterDni      String?        @map("reporter_dni")   @db.VarChar(12)
  reporterPhone    String?        @map("reporter_phone") @db.VarChar(40)
  reporterEmail    String?        @map("reporter_email") @db.VarChar(191)
  consentAt        DateTime?      @map("consent_at")
  category         String?        @db.VarChar(40)   // slug del catálogo
  subtype          String?        @db.VarChar(60)   // slug del tipo (solo reclamos)
  description      String?        @db.VarChar(2000)
  lat              Decimal?       @db.Decimal(9, 6)
  lng              Decimal?       @db.Decimal(9, 6)
  outsideBoundary  Boolean        @default(false) @map("outside_boundary")
  streetId         Int?           @map("street_id")   // SetNull
  streetName       String?        @map("street_name") @db.VarChar(120)
  addressDetail    String?        @map("address_detail") @db.VarChar(160)
  scplTicket       String?        @map("scpl_ticket") @db.VarChar(40)
  claimTokenHash   String?        @unique @map("claim_token_hash") @db.Char(64)
  submittedAt      DateTime?      @map("submitted_at")
  filedAt          DateTime?      @map("filed_at")
  filedById        Int?           @map("filed_by_id")           // User, SetNull
  filedAgency      ReportAgency?  @map("filed_agency")
  filedAgencyOther String?        @map("filed_agency_other") @db.VarChar(80)
  filedReference   String?        @map("filed_reference") @db.VarChar(80)  // expediente
  filedMinuteId    Int?           @map("filed_minute_id")       // Minute, SetNull (iniciativas)
  dismissedAt      DateTime?      @map("dismissed_at")
  dismissedById    Int?           @map("dismissed_by_id")       // User, SetNull
  dismissReason    String?        @map("dismiss_reason") @db.VarChar(300)
  dniPurgedAt      DateTime?      @map("dni_purged_at")
  ip               String?        @db.VarChar(45)
  userAgent        String?        @map("user_agent") @db.VarChar(255)
  createdAt        DateTime       @default(now()) @map("created_at")
  updatedAt        DateTime       @updatedAt @map("updated_at")
  files            ReportFile[]
  notifications    Notification[]

  @@index([status, kind])
  @@index([memberId, status])
  @@index([submittedAt])
  @@map("reports")
}

model ReportFile {
  id        Int            @id @default(autoincrement())
  reportId  Int            @map("report_id")   // Cascade
  kind      ReportFileKind
  path      String         @db.VarChar(255)    // relativa a UPLOADS_DIR: reports/{reportId}/{uuid}.jpg
  mime      String         @db.VarChar(100)    // siempre image/jpeg (salida de sharp)
  size      Int
  width     Int
  height    Int
  createdAt DateTime       @default(now()) @map("created_at")

  @@index([reportId, kind])
  @@map("report_files")
}
```

Agregados: `Notification.reportId Int? @map("report_id")` con relación `SetNull` (calco de
`applicationId`), y tres valores **al final** de `NotificationType`: `report_received`,
`report_filed`, `report_board_alert`.

Invariantes de aplicación (no hay unique parcial en MariaDB):

- **Una foto por ranura**: `photo` acumula hasta 2; `dni_front` y `dni_back` reemplazan al anterior
  (`deleteMany` + `unlink` best-effort, como `documents/storage.ts`).
- **Transiciones como `updateMany` condicionales** por estado (patrón `tokens.consume`):
  `draft → received` (envío), `received → filed`, `received → dismissed`. `count === 0` es "ya
  resuelto o no existe", con el mismo mensaje para los dos.
- El número visible es el `id`: "Reporte N° 14". No es una serie numerada (REG-33 es de recibos).

## 5. Flujos

### 5.1 Vecino (público, anónimo hasta que se identifica)

1. **Landing `/reportes`** (cache 3600 s). Silueta del barrio, contadores del año civil argentino
   (`received`+`filed`+`dismissed` con `submittedAt` en el año = "recibidos"; `filed` = "presentados"),
   dos puertas: Reclamo / Iniciativa → `/reportes/nuevo?tipo=reclamo|iniciativa`.
2. **Paso 1 · Empezar** (`/reportes/nuevo`). Tipo (preseleccionado por `?tipo=`) y reserva de
   identidad, ambos `ChoiceCard`. Turnstile. Action `startReportAction`: guardas →
   `reportDraftLimiter.allows(ip)` → Turnstile → zod → `record` → crea `Report{status:draft,
   kind, anonymous, ip, userAgent}` y emite la llave (`randomBytes(32)` base64url; persiste sólo
   `hashToken`). Respuesta: `{ kind: "started", claim }`. El wizard hace
   `history.replaceState(null, "", "/reportes/nuevo/<claim>")`. **Ninguna action del wizard
   revalida rutas.**
3. **Paso 2 · Tus datos.** Campos: nombre y apellido, DNI (7-9 dígitos), teléfono, email. Dos
   ranuras (frente, dorso), cada una `<form>` propio con `useActionState` propio →
   `uploadReportFileAction(claim, kind, file)`. "Continuar" → `saveReporterAction(claim, datos)`
   valida zod y que existan `dni_front` y `dni_back`.
4. **Paso 3 · Tu reporte.** Mosaico de categorías; tipos; `Callout` SCPL + `scplTicket`;
   descripción; mapa + calle + referencia; dos ranuras de foto; consentimiento; "Enviar reporte"
   → `submitReportAction(claim, …)`: `reportSubmitLimiter.allows(ip)` → zod (reglas por tipo:
   ubicación obligatoria si `kind=claim && category!=other`) → revalida en la base que el borrador
   tenga identidad y ambos DNI → `updateMany{status:draft→received, submittedAt, outsideBoundary,
   consentAt…}` → después del commit: acuse al vecino, alerta a la Comisión, `audit
   report_submitted`. Si el envío del acuse falla, el reporte igual quedó enviado (best-effort).
5. **Confirmación.** `TramiteTimeline` (Recibido ✔ → La Comisión lo canaliza → Presentado ante el
   organismo), N° en mono, "Te avisamos por email cuando lo presentemos".
6. **Retome** `/reportes/nuevo/[claim]`: rehidrata el borrador (`peek`, nunca consume); si ya fue
   enviado muestra la confirmación; si la llave no existe, "Este enlace no es válido".
   `robots: { index: false }`, `dynamic = "force-dynamic"`, prefijo en `disallow`.

### 5.2 Socio (`/mi`)

- `/mi/solicitudes/reportes`: lista (`take 20`, `orderBy id desc`) con `EmptyState` + botón
  "Nuevo reporte". `requireMember({ allowSuspended: true })`.
- `/mi/solicitudes/reportes/nuevo`: paso 1 sin Turnstile → `startMemberReportAction` con
  `requireMember({ allowSuspended: true })` y `reportMemberLimiter` (5/24 h por `memberId`);
  copia `fullName`, `dni`, `phone`, `email` de la ficha al borrador y `memberId`. Paso 3 idéntico.
  Stepper "Paso N de 2". Las actions del socio reciben la llave igual que las públicas, y además
  verifican `memberId === actor.memberId` en el `where`.
- Home `/mi`: tercera celda "Solicitudes y reportes" → `/mi/solicitudes` (grid `grid-cols-2
  sm:grid-cols-3`).

### 5.3 Admin (`/admin/solicitudes/reportes`)

- **Lista**: chips `Sin presentar` (`received`) · `Presentados` (`filed`) · `Desestimados`
  (`dismissed`) · `Todos` (los tres; nunca `draft`). Cada chip cuenta y filtra exactamente lo
  mismo (`src/lib/admin/reports-queue.ts`, calco de `presentation-queue.ts`). Filtros GET: `tipo`
  (reclamo/iniciativa), `categoria`, `q` (busca en `description`, `streetName`, `reporterName` y
  el N°). Paginación 50. Orden: `submittedAt desc`.
- **Ficha** `[id]`: todo lo del reporte, DNI inline (`<img>` vía la ruta autenticada), fotos,
  mini mapa de solo lectura, línea de tiempo, y los dos formularios:
  - **Marcar presentado** (`fileReportAction`): `requireAdmin` → zod (`agency`, `agencyOther` si
    `other`, `filedAt` fecha civil ≤ hoy, `reference?`, `minuteId?` sólo iniciativas) →
    `updateMany{received→filed}` → `audit report_filed {agency, minuteId?}` → correo al que reporta
    (`report_filed`) → `revalidatePath`. Frase viva en el formulario: "Se va a asentar como
    presentado ante {organismo} el {fecha}" / "…como tratada por la Comisión Directiva (sin acta)".
  - **Desestimar** (`dismissReportAction`): motivo 5-300 caracteres → `updateMany{received→dismissed}`
    → `audit report_dismissed` (sin el motivo). Sin correo.
- **Mapa** `/mapa`: mismos chips; markers sólo de reportes con coordenadas; color por estado
  (`received` primary, `filed` success, `dismissed` muted); popup con N°, categoría y enlace.
- **Contadores**: la pestaña muestra `count(status: received)`; el tablero suma "N reportes sin
  presentar" al desglose de la tarjeta de Solicitudes. Las dos consultas viven en
  `src/lib/reports/counts.ts` para que digan el mismo número (hoy las de Altas están duplicadas;
  no se tocan).

## 6. Superficies y componentes

### 6.1 Público

```
src/app/(public)/reportes/
  page.tsx                    landing (Server Component, revalidate 3600)
  barrio-silhouette.tsx       SVG inline del polígono (server-safe)
  nuevo/page.tsx              wizard (Server Component: streets, consent text, turnstile key)
  nuevo/[claim]/page.tsx      retome
  report-wizard.tsx           "use client" — marco (draft en cliente para pasos 1-3 + claim)
  step-start.tsx / step-identity.tsx / step-report.tsx / report-done.tsx
  category-grid.tsx           mosaico de categorías (radiogroup accesible)
  file-slot.tsx               ranura con vista previa (URL.createObjectURL), un useActionState
  location-picker.tsx         "use client" Leaflet: polígono, pin, tap/drag, geolocalización
  location-picker-loader.tsx  dynamic(ssr:false)
  actions.ts                  "use server": start, saveReporter, uploadFile, removeFile, submit
  wizard-shared.ts            tipos de estado redeclarados (regla de "use server")
```

Reutiliza tal cual: `ChoiceCard`, `Field`, `NavButtons`, `LegalDetails`, `CONTROL_HEIGHT`,
`FOCUS_RING`, `StreetPicker`, `TurnstileWidget`, `FormMessage`, `Callout`, `TramiteTimeline`,
`map-config.ts`. **Extensiones aditivas**: `ProcessRail` gana `phases?: Array<{ icon; label }>`
y `subject?: string` (defaults = los actuales, ASOCIATE no cambia); el pin de marca de
`sede-map.tsx` se extrae a `src/components/map/brand-pin.ts` y `sede-map.tsx` lo importa
(cambio de una línea, sin efecto visual).

Detalles de UX que no se negocian (lecciones del repo): `NavButtons` con `submit` XOR `onNext`;
un `useActionState` por ranura; `file.size` antes de `arrayBuffer()`; sin `capture` en el input
de archivo; `useFormResetSync` en el paso 2 (tiene radios/checkbox); foco al `<h1 tabIndex={-1}>`
por paso; `role="status"` sr-only "Paso N de M"; inputs de 16 px mínimo; targets ≥ 44 px; el mapa
lleva `role="group"` + `aria-label`, botón de geolocalización en `z-[1000]`, y **la calle en texto
es la alternativa accesible al mapa** (un par de coordenadas solo no es accesible ni imprimible).
El `dragging` de Leaflet queda encendido también en touch: acá el usuario tiene que mover el mapa
con un dedo, y el scroll-trap se evita con una altura acotada (`h-[22rem]`) y `scrollWheelZoom`
apagado.

### 6.2 Socio

```
src/app/mi/solicitudes/layout.tsx              nuevo: <h1> + <MiSolicitudesTabs>
src/app/mi/solicitudes/page.tsx                INSTITUCIONAL: sólo pierde su <h1> y subtítulo
src/app/mi/solicitudes/reportes/page.tsx
src/app/mi/solicitudes/reportes/nuevo/page.tsx
src/app/mi/solicitudes/reportes/nuevo/[claim]/page.tsx
src/app/mi/solicitudes/reportes/actions.ts     start (socio) + re-export de las públicas envueltas en requireMember
src/lib/mi/solicitudes-tabs.ts                 MI_SOLICITUDES_TABS + isMiSolicitudesTabActive
src/components/mi/solicitudes-tabs.tsx
```

La regla de activación: "reportes gana por prefijo; el resto bajo `/mi/solicitudes` es
institucional" (trampa documentada del prefijo hermano). `MI_TABS` **no se toca**;
`tests/mi-nav.test.ts` sigue verde.

### 6.3 Admin

```
src/lib/admin/solicitudes-tabs.ts              + { href: "/admin/solicitudes/reportes", label: "Reportes" } y rama en isSolicitudesTabActive
src/app/admin/solicitudes/layout.tsx           tercer count; Record<href, count> en vez del ternario
src/app/admin/page.tsx                         desglose "· N reportes sin presentar"
src/app/admin/solicitudes/reportes/page.tsx    lista
src/app/admin/solicitudes/reportes/mapa/page.tsx + reports-map.tsx (+ loader)
src/app/admin/solicitudes/reportes/[id]/page.tsx + file-form.tsx + dismiss-form.tsx + report-mini-map(-loader).tsx
src/app/admin/solicitudes/reportes/actions.ts  fileReportAction, dismissReportAction
src/lib/admin/reports-queue.ts                 REPORT_VIEWS, parseReportView, reportHref, parseReportFilters
src/lib/admin/status-badges.ts                 + reportStatusBadgeVariant, reportKindBadgeVariant
src/components/admin/filter-chips.tsx          NUEVO y compartible: FilterChips({ label, chips: {key,label,href,count}[], active })
src/components/admin/report-kind-icon.tsx      ícono por tipo (lucide en cliente)
```

`nav.ts` y `dashboard-cards.ts` **no se tocan**: Reportes es una pestaña, no una sección.

Tarjeta de la lista: `<Card>` con `border-l-4` por estado (`border-l-primary` sin presentar,
`border-l-success` presentado, `border-l-border` desestimado), cabecera `N° 14` en
`font-mono tabular-nums` + `Badge` de tipo con ícono + `Badge` de estado; título
"Categoría › Tipo" como link a la ficha (`INLINE_LINK`, foco visible); metadatos separados por
`·`; badges de aviso con `title` + `sr-only` ("Reservado", "Fuera del barrio", "Socio N° 12",
"N° SCPL 123"); tira de miniaturas `size-16 rounded-md object-cover` (hasta 2).

## 7. Dominio (`src/lib/reports/`)

| Archivo | Responsabilidad | Prisma |
|---|---|---|
| `catalog.ts` | categorías, tipos, organismos, etiquetas, `suggestedAgency`, `agencyLabel`, `kindLabel`, `statusLabel` | no |
| `boundary.ts` | polígono, `isInsideBoundary`, `boundaryToSvgPath`, `BARRIO_BOUNDS` | no |
| `rules.ts` | `validateSubmission(draft)` (ubicación obligatoria por tipo, identidad completa, DNI presentes), `canTransition`, `retentionDueAt(closedAt) = +360 días`, `DRAFT_TTL_HOURS = 48`, `REPORT_MESSAGES` (textos únicos por causal) | no |
| `service.ts` | `makeReports({ db, now })`: `startDraft`, `findByClaim`, `saveReporter`, `submit`, `file`, `dismiss`, `listForMember`, `counts` | inyectado |
| `storage.ts` | `makeReportFileStore({ db, rootDir })`: `save({ reportId, kind, data })` (sharp → jpeg, ranura, `unlink` del reemplazado), `read(file)`, `deleteAll(reportId)`, `deleteDni(reportId)` | inyectado |
| `images.ts` | `processImage(buf, { maxSide })` con sharp: `rotate()` (EXIF), `resize({ withoutEnlargement })`, `jpeg({ quality })`, **sin `withMetadata()`** → `{ data, width, height }` | no |
| `static-map.ts` | `tileFor(lat,lng,z)`, `pixelInTile`, `renderStaticMap({ lat, lng, zoom: 16, size: [600, 400], fetchFn, timeoutMs: 4000 })` → PNG con tiles IGN (fallback OSM), contorno del barrio y pin | no |
| `pdf.ts` | `renderReportPdf(data, { photos, map })` con pdf-lib; `safe()` con transliteración; fotos en recuadros con aspecto; falla suave por foto | no |
| `notify.ts` | `makeReportNotifier({ db, mailer, baseUrl })`: `sendReceived`, `sendFiled`, `sendBoardAlert(recipients)`; best-effort, loguea sólo el código | inyectado |
| `retention.ts` | `purgeReportRetention({ db, store, now })` → `{ dniPurged, draftsPurged }` | inyectado |
| `counts.ts` | `pendingReportsCount(db)` (el número de la pestaña y del tablero) | inyectado |
| `claim.ts` | `mintClaim()`, `hashClaim(raw)` (sha256, `tokens.ts`), `CLAIM_RE` | no |

Limiters nuevos en `src/lib/auth/rate-limiter.ts`, con justificación escrita:
`reportDraftLimiter` (IP, 5/60 min), `reportSubmitLimiter` (IP, 5/60 min),
`reportUploadLimiter` (IP, 30/60 min: cuatro archivos por reporte más reintentos),
`reportMemberLimiter` (memberId, 5/24 h).

## 8. Archivos, rutas y cabeceras

- Carpeta `UPLOADS_DIR/reports/{reportId}/{uuid}.jpg` (cubierta por `backup.sh` sin tocarlo).
  `reportId` validado como entero positivo antes de armar la ruta.
- `GET /api/admin/reportes/[id]/archivos/[fileId]`: `requireAdmin`, `findFirst({ id, reportId })`,
  `Content-Type: image/jpeg`, `inline`, `no-store, private`, `Vary: Cookie`, `nosniff`. Auditoría
  `report_dni_view` sólo cuando `kind` es `dni_front`/`dni_back` (una foto de un bache no es un
  dato personal; el DNI sí). 404 si el archivo falta, sin asiento.
- `GET /api/mi/reportes/[id]/archivos/[fileId]`: `requireMember({ allowSuspended: true })`,
  `where: { id: fileId, report: { id, memberId: actor.memberId } }`; ajeno → 404, nunca 403.
- `GET /api/admin/reportes/[id]/pdf`: `requireAdmin`, genera a pedido (fotos leídas del disco,
  mini-mapa con timeout), `Content-Disposition: inline; filename="reporte-14.pdf"`, auditoría
  `report_pdf_export {hasMap, photos}` después de tener los bytes. Se dispara desde
  `<Button asChild><a href>`.
- `next.config.ts`: tres entradas específicas con
  `Content-Security-Policy: default-src 'none'; sandbox; frame-ancestors 'none'` (las imágenes
  van en `<img>`, no en iframe, así que no hace falta reabrir el framing), más dos entradas
  `Permissions-Policy: camera=(), microphone=(), geolocation=(self)` para `/reportes/:path*` y
  `/mi/solicitudes/reportes/:path*`. La CSP de los handlers se exporta como constante y un test
  verifica que `next.config.ts` la contiene (patrón `institutional-documents/response.ts`).
- `robots.ts`: `disallow` `/reportes/nuevo/` y `/mi` ya está. `sitemap.ts`: `/reportes`.
- `public-nav.ts`: `["/reportes", "Reportes"]` después de Ubicación. Test nuevo
  `tests/public-nav.test.ts` (hrefs únicos, `/reportes` presente, cada href con `page.tsx`).

## 9. Correos, digest y cron

Plantillas en `templates.ts` (texto plano y HTML en paralelo, `esc()` sobre todo dato del usuario):

- `reportReceivedEmail({ number, kind, categoryLabel, contactEmail })`: "Recibimos tu reporte
  N° 14 … Lo va a revisar la Comisión Directiva y, si corresponde, lo va a presentar ante el
  organismo. Te avisamos por este medio cuando eso pase." Cierra con la línea de derechos
  (docs/08): rectificación o supresión de datos escribiendo a `contact_email`.
- `reportFiledEmail({ number, agencyLabel, filedAt, reference?, initiative })`: "Presentamos tu
  reporte N° 14 ante la SCPL el 12/09/2026 (expediente 1234)" / "La Comisión Directiva trató tu
  iniciativa N° 14 el …".
- `reportBoardAlertEmail({ number, kind, categoryLabel, subtypeLabel?, street, description,
  reporter: { name, dni, phone, email, anonymous }, panelUrl })`: el correo inmediato a la
  Comisión, con identidad completa y botón "Ver en el panel".

Mailer: `sendToReport({ reportId, to, type, message, summary })` como tercera variante; el aviso a
la Comisión se manda con `sendToReport` una vez por destinatario (fila por envío, como el digest).

Digest (`digest.ts`, cuatro puntos): `reportsReceived`, `reportsReceivedClaims`,
`reportsReceivedInitiatives` (ventana del día civil anterior por `submittedAt`) y
`reportsPending` (cola `received`, al momento). Renglón: "Reportes: 3 recibidos ayer (2 reclamos,
1 iniciativa) · 7 sin presentar". Cuenta como novedad sólo `reportsReceived > 0`: la cola sin
novedades no dispara un correo solo.

Purga: el route handler del digest llama `purgeReportRetention` **después** de mandar el resumen y
suma `{ dniPurged, draftsPurged }` al detalle de la `CronRun`. Borra imágenes `dni_*` de reportes
con `filedAt`/`dismissedAt` ≤ hoy − 360 días y `dniPurgedAt: null` (estampa `dniPurgedAt`), y
borra filas + carpeta de borradores con `createdAt` ≤ ahora − 48 h. Un fallo de disco en un
reporte no corta la corrida: se cuenta y se sigue. Auditoría `report_retention_purge` con conteos.

## 10. Seguridad y privacidad

- Turnstile sólo en el paso 1 público; después la llave es la barrera (regla de CLAUDE.md).
- Orden canónico en cada action pública: guardas de apertura → `allows` → Turnstile → zod →
  `record` → base. `refund` si el envío del acuse no ocurrió por SMTP.
- Sólo `X-Real-IP`. `codeOf(e)` en logs. Nunca la dirección ni el texto del vecino en `audit.detail`.
- `description`, `addressDetail`, `dismissReason`, `filedReference` se renderizan siempre como
  texto plano (`whitespace-pre-line`), nunca HTML.
- El lookup público **no toca el padrón**: el vecino se identifica con lo que declara; no hay
  oráculo de "sos socio". Un socio que reporta sin loguearse queda como vecino.
- Consentimiento: checkbox obligatorio con `privacy_consent_text` de `Configuration` y
  `consentAt` en la fila.
- WAF de Cloudflare: `docs/10` §4.8 gana un pendiente "revisar Security → Events por POST a
  `/reportes` tras el despliegue". No se abre ninguna regla por adelantado.
- Sin `EMAIL_ALLOWLIST` levantada nada de esto manda correos a vecinos reales: es el entorno
  andando, no un fallo.

## 11. Textos clave (voz de la asociación)

- Paso 1, reserva: "¿Cómo querés figurar en la presentación?" · "Con mi nombre" / "De forma
  reservada — La Asociación siempre sabe quién reporta; lo reservado es la presentación ante el
  municipio, la SCPL u otro organismo."
- Callout SCPL: "Este reclamo también conviene hacerlo directo a la SCPL por WhatsApp al
  +54 9 2975 26-0760. Nosotros lo tomamos y lo elevamos, pero pedí tu número de reclamo ahí: es
  lo que después permite seguirlo." + campo "N° de reclamo SCPL (opcional)".
- Fuera del barrio: "El punto queda fuera del barrio Ciudadela. Podés enviarlo igual; la Comisión
  decide si lo canaliza."
- Confirmación: "Recibimos tu reporte N° 14. La Comisión Directiva lo revisa y, si corresponde,
  lo presenta ante el organismo. Te avisamos por email cuando eso pase."
- Admin, frase viva: "Se va a asentar como presentado ante SCPL el 01/09/2026." /
  "Se va a asentar como tratada por la Comisión Directiva, sin acta."

## 12. Tests

Puros (sin mocks): `reports-catalog`, `reports-boundary` (incluye el cotejo contra el KML),
`reports-rules`, `reports-static-map-math`, `reports-queue`, `mi-solicitudes-tabs`,
`solicitudes-tabs` (casos nuevos), `public-nav`, `reports-pdf` (renderiza bytes con y sin mapa,
con una foto corrupta). Con sharp real: `reports-images` (PNG generado con sharp, verifica JPEG,
tamaño, ausencia de EXIF). Con `db` inyectado: `reports-service` (transiciones condicionales,
fake que honra el `where`, guardas verificadas por mutación), `reports-retention`,
`reports-notify`. Con `vi.mock`: `reports-public-actions`, `reports-member-actions`,
`reports-admin-actions-auth` (la guarda corta en la primera línea), `report-file-routes`
(403/404/asiento/cabeceras y sincronía con `next.config.ts`), `report-pdf-route`,
`admin-digest` (sección nueva y `hasNews`), `digest-route` (la purga se llama y se registra).

## 13. Criterios de aceptación (docs/07, Módulo 7)

1. Un vecino sin cuenta crea un reclamo con DNI, ubicación y dos fotos desde el celular; recibe
   el acuse; la Comisión recibe el correo inmediato; la pestaña y el tablero muestran 1 sin presentar.
2. Un socio suspendido crea una iniciativa desde `/mi` sin paso de identidad; la ve en su lista.
3. El admin descarga el PDF: sale con silueta, fotos, mini-mapa y sin identidad si es reservado;
   con el IGN caído sale igual, sin mapa.
4. Marcar presentado ante SCPL manda el aviso al vecino y deja el reporte fuera de la cola;
   desestimar no manda nada. Las dos acciones quedan auditadas sin texto ni identidad.
5. El mapa admin muestra los pines por estado y el límite del barrio; un reporte fuera del
   polígono lleva su marca en la lista.
6. Una foto con GPS en EXIF queda guardada sin metadatos (verificado con `sharp().metadata()`).
7. El cron del digest borra los DNI vencidos y los borradores viejos y lo reporta en `CronRun`.
8. `npm test`, `npm run lint` y `npm run build` en verde; la migración corre con `migrate deploy`
   sobre una copia de la base productiva; `git diff --stat` no toca `src/lib/treasury/*` ni
   `src/lib/mp/*`.

## 14. Fuera de alcance (anotado para después)

Export Excel del listado, edición de un reporte por el vecino, seguimiento público por número,
mapa público, estadísticas por zona, notificación al desestimar, adjuntar el PDF al correo de la
Comisión, y la migración de los chips de Socios al `FilterChips` nuevo.
