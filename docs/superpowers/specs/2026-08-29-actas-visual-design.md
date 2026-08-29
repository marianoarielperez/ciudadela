# Rediseño de /admin/actas — diseño aprobado

Fecha: 29/08/2026. Acordado con el operador en tres rondas de preguntas más una
aclaración de propósito. Canon visual: "refinado + un gesto" (el de Salud y
Configuración). Alcance: las cuatro pantallas de la sección + export PDF/Word.

## Qué es un acta en el sistema (premisa que gobierna todo)

Un `Minute` NO es el acta del libro: es la **constancia de lo que pasó POR el
sistema** bajo esa acta. El acta real, en papel, es más grande: la Comisión
decide cuestiones que el sistema no ve (festejos, obras, gestiones ante la IGJ)
y en ese mismo documento formaliza los movimientos asentados en el sistema. Por
eso:

- El modelo no lleva ni llevará "contenido" del acta acá: la fuente de verdad es
  el libro físico. **Cero migraciones en este rediseño** (`git diff --stat
  prisma/` vacío al terminar).
- El export es un **insumo para redactar el acta real**: se titula "Constancia
  de asientos del sistema", jamás se presenta como el acta.

## Decisiones acordadas (rondas 1-3)

| Tema | Decisión |
|---|---|
| Contenido del acta | No se agrega campo de transcripción. El export baja lo que existe: metadata + referencias. |
| Formato de export | **PDF + Word** (misma constancia en dos formatos; el Word es la versión editable para pegar en el acta real). Se suma la dependencia `docx`. |
| Listado | Tarjetas con paginación de 20 + chips por tipo + búsqueda + select de año. Sin pestañas. |
| Detalle | Referencias completas: las 9 clases de FKs entrantes, no solo movimientos. |
| Datos personales en el export | **Completos (nombre, DNI, N° de socio)** — es el insumo de un documento societario formal. Compensado con auditoría por descarga y headers privados. |
| Gesto de la pantalla | **Cronología por año**: tarjetas agrupadas bajo encabezados de año. |
| Acciones de la tarjeta | Tarjeta entera → detalle (link estirado). Export y Editar viven en el detalle. |
| Permiso de descarga | `requireAdmin` (coherente con la sección y con el export del padrón, que también lleva DNIs). |
| Alcance | Las 4 pantallas (listado, detalle, alta, edición). |
| Metadata de carga | No se muestra (`createdBy`/`createdAt` quedan solo en auditoría). |

## 1. Listado (`/admin/actas`)

- `PageHeader` "Actas" + subtítulo ("El registro de lo asentado por el sistema,
  para incorporar al libro de actas") + acción primaria "Nueva acta".
- **Chips segmentados** (patrón exacto de `/admin/socios`): `Todas | Comisión
  Directiva | Asambleas`, cada uno con su conteo en `font-mono tabular-nums`.
  Cada chip filtra exactamente lo que cuenta; el activo se deriva de los filtros
  parseados.
- **Filtros**: `<form method="get">` plano con `<Input name="q">` (busca número
  exacto o `contains` sobre la descripción) + `<select name="anio">` (años
  derivados de los datos) + botón "Filtrar" `variant="secondary"`. "Limpiar
  filtros" solo si hay filtros activos.
- **Cronología (el gesto)**: dentro de la página, las tarjetas se agrupan bajo
  encabezados de año — el año en `font-heading` grande y tenue (tipográfico, no
  un h2 gritón), regla fina, y el conteo del año al lado ("2026 · 14 actas").
  Grilla `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` debajo de cada año.
- **Tarjeta**: `Card` con chip de ícono `size-9 rounded-lg bg-primary/10
  text-primary` — `Gavel` para Comisión Directiva, `Landmark` para Asamblea —,
  título = `minuteName(m)` como **link estirado** (patrón del tablero: un solo
  link semántico con `after:absolute after:inset-0`), fecha `formatDateAR`,
  descripción con `line-clamp-2`, y al pie el **conteo total de referencias**
  ("5 asientos"), no solo movimientos.
- **Paginación**: `parsePage`/`paginate`/`pageHref` + `PaginationNav`, 20 por
  página, línea "1–20 de N actas · página X de Y". El corte es por acta: un año
  puede quedar partido entre páginas y su encabezado se repite en la siguiente.
- **Vacío**: `EmptyState size="list"` con "Nueva acta" como acción; con filtros
  activos, mensaje propio + "Limpiar filtros".
- La query del listado sigue siendo **privada de la pantalla** (hoy
  `orderBy: [{date:"desc"},{number:"desc"}]`, se conserva). El conteo de
  referencias se resuelve con `_count` sobre las 9 relaciones.

## 2. Detalle (`/admin/actas/[id]`)

- `PageHeader`: h1 = `minuteName`, subtítulo con la fecha, miga "Actas / N° X".
  Acciones: **PDF** y **Word** (`Button variant="outline"` + `FileDown`, como
  `<a href>` a las rutas de export) + **Editar** (outline).
- Descripción en bloque destacado si existe.
- **"Lo que respalda esta acta"**: secciones por clase con ícono y links —
  movimientos de socios (→ ficha), exenciones concedidas y anuladas (→
  Tesorería/Exenciones), valores de cuota (→ Tesorería/Valores), solicitudes
  asentadas o rechazadas (→ solicitud), libros abiertos/cerrados (→ Libros),
  convocatorias y cierres de reempadronamiento (→ Reempadronamiento). Solo se
  renderizan clases con filas. Sin ninguna: `EmptyState size="card"` ("Esta
  acta todavía no respalda ningún asiento").
- La query del detalle amplía los `include` a las 9 relaciones con `select`
  explícitos (del socio: nombre y número para pantalla; el DNI solo lo carga la
  ruta de export).

## 3. Export — "Constancia de asientos del sistema"

**Un solo diseño, dos formatos.** Contenido:

1. Membrete institucional (logo + "Asociación Vecinal del Barrio Ciudadela").
2. Título: "Constancia de asientos del sistema"; subtítulo: `minuteName` +
   fecha del acta.
3. La descripción del acta, si existe.
4. Los asientos redactados como **renglones transcribibles**, agrupados por
   clase, al estilo del anexo de notificaciones del M6 (`NoticeLine`):
   "Se asentó el alta del socio Juan Pérez (DNI 12.345.678), socio N° 123, con
   fecha 15/08/2026." La secretaría copia estos renglones al acta real junto
   con las decisiones tomadas fuera del sistema.
5. Pie: "Generada por SIGeV el DD/MM/AAAA. Documento de uso interno, para
   incorporar al acta del libro."

**PDF**: `pdf-lib`, siguiendo el molde multi-página de
`src/lib/board/notice-pdf.ts` (wrap propio, cabecera corrida, "Hoja N de M",
transliteración tipográfica antes del reemplazo WinAnsi). Como el aviso: se
genera a pedido, **no se persiste en disco**. El molde se LEE, no se toca.

**Word**: dependencia nueva **`docx`** (JS puro, sin binarios — apto VPS).
Mismo contenido y orden que el PDF.

**Rutas**: `GET /api/admin/actas/[id]/export?formato=pdf|docx`.
- `requireAdmin()` **dentro de la ruta** (el layout no cubre route handlers);
  403 sin cabeceras de archivo.
- Id validado (`Number.isInteger && > 0`) antes de tocar la base → 404.
- `Content-Disposition: attachment; filename="acta-cd-124.pdf"` /
  `"acta-asamblea-12.docx"` — nombre derivado de tipo+número validados, nunca
  de texto libre.
- `Cache-Control: no-store, private` + `Vary: Cookie` +
  `X-Content-Type-Options: nosniff`.
- **Auditoría por descarga**, después de tener los bytes:
  `action: "minute_export"`, `entity: "minute"`, detail **solo metadatos**
  (tipo, número, formato, conteo de asientos) — nunca nombres ni DNIs, mismo
  criterio que `minuteEditAuditDetail`. IP de `x-real-ip`.
- La redacción de los renglones y el armado del contenido son **funciones puras
  compartidas por los dos formatos** (mismo criterio que
  `electoralWorkbookSpec`): un módulo `src/lib/minutes/export-content.ts` que
  los renderers de PDF y Word consumen — así no pueden divergir.

## 4. Formularios (`/nueva`, `/[id]/editar`)

- **Lógica intacta**: campos controlados, `useFormResetSync`/`useSyncedForm`,
  hidden de fecha bloqueada, schemas, redirects (`/admin/actas` y
  `/admin/actas/[id]`), auditoría.
- Visual: `Card` + `PanelHeader`, migración a `TextField`/`SelectField` de
  `synced-fields` (salda parte de la deuda anotada de selects crudos), targets
  ≥44px, `FormMessage` para errores, botón pendiente con gerundio.

## 5. Reglas duras (del mapa de riesgo)

1. **No tocar** las 10 queries de los `MinutePicker`
   (`orderBy: [{date:"desc"},{id:"desc"}], take: 30` es deliberado; ya hubo 3
   incidentes con este selector). La query del listado no se comparte.
2. **No tocar** `src/lib/members/minute-date.ts`, `minuteName` /
   `MINUTE_TYPE_LABELS`, ni `discardUnusedMinute`.
3. **No hay borrado de actas** — ni botón, ni action. La pantalla de edición
   conserva su explicación.
4. URLs y redirects actuales intactos: `/admin/actas`, `/nueva`, `/[id]`,
   `/[id]/editar`; 9 pantallas linkean al detalle.
5. Cero cambios en `schema.prisma` y cero migraciones.
6. El próximo número por tipo jamás se deriva de una lista paginada
   (`groupBy _max` si hace falta — ya existe el patrón en exenciones).
7. Corregir de paso el comentario obsoleto de `configuracion/page.tsx:70-71`
   (menciona "texto y adjuntos del acta" que no existen).

## 6. Testing y criterio de aceptación

- **Antes de rediseñar**: screen test (`renderToStaticMarkup`, molde de
  `tests/reregistration-close-minute.test.ts`) que fije el estado actual que
  debe sobrevivir: orden del listado, breadcrumbs, links al detalle, bloqueo
  de fecha en edición.
- Tests nuevos: renglones del export (función pura), nombre de archivo, ruta de
  export (403 sin admin, 404 id inválido, auditoría sin datos personales —
  aserción estilo "never copies…"), chips que filtran lo que cuentan,
  agrupación por año, paginación.
- **Criterio de cierre** (el de la unificación de `/admin/solicitudes`): la
  suite existente pasa **sin tocar una sola aserción**:
  `minute-actions`, `minute-edit`, `minute-choice`, `minute-form`,
  `reregistration-close-minute`, `admin-nav`, `exemption-member-card-screen`.
- Verificación visual en dev server (claro/oscuro, móvil 375px) antes del
  merge.
