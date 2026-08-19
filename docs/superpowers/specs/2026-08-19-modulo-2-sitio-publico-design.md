# Módulo 2 — Sitio público, noticias y actividades (spec de diseño)

Fecha: 2026-08-19 · Estado: aprobada por Mariano (entrevista de 3 rondas + diseño presentado)
Referencias: `docs/05-flujos-funcionales.md`, `docs/04-modelo-de-datos.md`, `docs/07-plan-de-etapas.md`

## 1. Contexto y alcance

El sitio público hoy es un placeholder (`src/app/(public)/page.tsx`, "Sitio en construcción").
El Módulo 2 lo convierte en el sitio institucional real y agrega una sección nueva no
prevista en los docs originales: **Actividades** (calendario de los dos salones de la sede).

**Entra:**

1. Home real: hero + botones ASOCIATE/REEMPADRONATE con estados + últimas noticias.
2. Cartelera de noticias: modelo `News`, ABM admin con editor visual básico e imagen de
   portada, páginas públicas `/noticias` y `/noticias/[slug]`.
3. Actividades: modelo `Activity`, ABM admin, página pública `/actividades` con grilla
   semanal por salón y selector de año.
4. Página `/ubicacion`: mapa OpenStreetMap embebido + dirección + contacto.
5. Pantalla `/admin/configuracion` (solo superadmin): toggle `asociate_activo` y datos
   de contacto editables.
6. Footer con datos legales, nav de secciones en el header, `not-found.tsx` y `error.tsx`.
7. SEO: metadataBase, title template, robots, sitemap dinámico, Open Graph, JSON-LD.
8. CSP completa + `Permissions-Policy` en `next.config.ts`.
9. Assets: hero optimizado vía `next/image`, logo reducido, set de favicons.
10. Primer uso de caché estática con invalidación por tag en las páginas públicas.
11. Actualización de docs (`04`, `05`, `07`, `CLAUDE.md`) para reflejar todo lo anterior.

**Fuera de alcance (decidido en la entrevista):**

- **Estatuto**: NO va en el sitio público. Se difiere al Módulo 5 (panel del socio, `/mi`),
  donde se publicará como PDF autenticado. `docs/07` se actualiza en consecuencia.
- **Reservas/alquiler de salones**: el calendario es solo consulta. Si algún día se pide
  un circuito de reservas, se especifica como módulo aparte.
- Turnstile (M3), wizard ASOCIATE (M3), uploads de documentos personales (M3).
- Re-import del padrón: el `datos/padron_socios.xlsx` commiteado ES la versión final
  confirmada por Mariano (283 filas, sin DNIs duplicados, 287/288 sin DNI). No se toca.

## 2. Modelo de datos (migración nº 5)

Convención del repo: modelos PascalCase en inglés, campos camelCase con `@map` a
snake_case, `@@map` plural, comentarios en español explicando el porqué.

### `News` → tabla `news`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int autoincrement | |
| `title` | VarChar(160) | |
| `slug` | VarChar(180) UNIQUE | generado desde el título, editable antes y después de publicar; si cambia, la URL vieja da 404 (aceptado: sitio chico, sin SEO heredado) |
| `body` | Text | **HTML ya sanitizado en el servidor** (nunca se guarda HTML crudo del cliente) |
| `coverImagePath` | VarChar(255) nullable | ruta relativa dentro de `UPLOADS_DIR/news/` |
| `status` | enum `NewsStatus` (`draft`, `published`) | |
| `publishedAt` | DateTime nullable | se setea al publicar por primera vez |
| `authorId` | Int? FK → `users`, onDelete SetNull | |
| `createdAt` / `updatedAt` | timestamps estándar | |

Índices: `@@index([status, publishedAt])` para el listado público.

### `Activity` → tabla `activities`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | Int autoincrement | |
| `name` | VarChar(120) | ej. "Gimnasia mujeres" |
| `room` | enum `Room` (`historic`, `glass`) | Salón Histórico / Salón Vidriado. Salones fijos: no se crea tabla (YAGNI) |
| `weekdays` | Json | array de enteros 1–7 (lunes=1), validado por zod |
| `startTime` / `endTime` | VarChar(5) | "HH:MM" hora de pared local. **Excepción documentada a la convención de UTC**: es un horario recurrente, no un instante; convertirlo a UTC lo rompería con cualquier cambio de huso |
| `year` | SmallInt | año de vigencia; la página pública tiene selector de año |
| `active` | Boolean default true | ocultar sin borrar |
| `createdAt` / `updatedAt` | timestamps | |

Índice: `@@index([year, room])`.

**Regla de negocio (en `src/lib/activities/`, pura y testeada):** dos actividades
activas del mismo salón y mismo año que compartan al menos un día de la semana no
pueden solaparse en horario (`startA < endB && startB < endA`). El alta/edición que
viola la regla se rechaza con mensaje es-AR indicando con cuál actividad choca.
Validaciones adicionales: `startTime < endTime`, weekdays no vacío, año entre 2024 y 2100.

### Configuración (sin migración: tabla clave/valor existente)

| Clave | Tipo de `value` | Estado |
|---|---|---|
| `asociate_activo` | boolean | ya sembrada (`false`) |
| `contact_phone` | string \| null | nueva, editable desde `/admin/configuracion` |
| `contact_email` | string \| null | nueva, editable desde `/admin/configuracion` |

Se crea **`src/lib/config.ts`**: lector tipado (`getConfigBool(key)`, `getConfigString(key)`)
que reemplaza el patrón inline de `src/lib/members/service.ts:21` de acá en adelante
(el existente no se migra en este módulo para no ampliar el diff).

Los **datos institucionales estáticos** NO van a configuración sino a constantes en
`src/lib/site.ts` (cambian una vez por década y conviene versionarlos):

- Dirección: Cerro Catedral N° 286, Barrio Ciudadela, Comodoro Rivadavia, Chubut.
- Coordenadas: -45.79713687, -67.4940670.
- Fundación: 4 de agosto de 1964. Fundación legal: 27 de febrero de 2015.
- Personería jurídica 4139 — Resolución 184/15.

## 3. Rutas y pantallas

### Público — `src/app/(public)/`

| Ruta | Contenido |
|---|---|
| `/` | Hero (`assets/hero.jpg` como static import de `next/image`, overlay sutil en el tercio inferior, logo, nombre) + botones ASOCIATE y REEMPADRONATE + tarjetas de las últimas 3 noticias publicadas + link "Ver todas las noticias" |
| `/noticias` | Listado paginado (10 por página, paginación GET como el padrón) de publicadas, orden `publishedAt` desc |
| `/noticias/[slug]` | Detalle: título, fecha, portada, cuerpo. 404 si no existe o es borrador |
| `/actividades` | Selector de año (default: año actual) + grilla semanal (lunes a domingo) por salón, cada actividad con nombre y horario. Empty state si el año no tiene actividades |
| `/ubicacion` | Iframe de OpenStreetMap centrado en las coordenadas de la sede + dirección + teléfono/email desde configuración + datos institucionales |

**Estados de los botones del hero** (según `docs/05:9-12`):

- `asociate_activo=false` (estado actual): ASOCIATE deshabilitado + banner
  "Las asociaciones están suspendidas temporalmente. Para más información acercate a
  la sede vecinal." (el texto con fecha de re-empadronamiento llega recién con el M6).
- `asociate_activo=true`: ASOCIATE linkea a `/asociate`. El wizard es del M3; en este
  módulo `/asociate` es una página placeholder mínima ("El formulario de asociación
  estará disponible próximamente") para que probar el flag no termine en un 404.
- REEMPADRONATE: oculto mientras no exista proceso de re-empadronamiento (M6).

**Header público**: nav Inicio · Noticias · Actividades · Ubicación + botón Ingresar.
Responsive con menú colapsable en mobile (sin dependencia nueva: `<details>` o un
client component mínimo). **Footer**: datos legales (personería, fundación), dirección,
"Sistema SIGeV" y link a `/ingresar` (pedido por `docs/05:18`).

Se agregan `src/app/not-found.tsx` y `src/app/error.tsx` globales con estética del sitio.

### Admin — `src/app/admin/`

Siguiendo el molde del Módulo 1 (listado tipo `actas`, formularios con `useActionState`
+ `useSyncedForm` + `parseForm`, actions con `requireAdmin()` propio, redirect fuera
del try, errores es-AR, auditoría):

| Ruta | Contenido |
|---|---|
| `/admin/noticias` | Tabla: título, estado (Badge), fecha de publicación, autor; empty state; botón "Nueva noticia" |
| `/admin/noticias/nueva` y `/admin/noticias/[id]` | Formulario: título, slug (autogenerado, editable), editor Tiptap, upload de portada con preview, estado. Acciones: guardar borrador, publicar, despublicar, eliminar (con confirmación) |
| `/admin/actividades` | Tabla con filtro por año y salón; botón "Nueva actividad" |
| `/admin/actividades/nueva` y `/admin/actividades/[id]` | Formulario: nombre, salón (select), días (checkboxes L–D), hora inicio/fin, año, activa |
| `/admin/configuracion` | **Solo superadmin** (nuevo helper `isSuperadmin` en `src/lib/auth/roles.ts` + guarda `requireSuperadmin`): toggle de `asociate_activo` + campos de contacto |

Se activan las Cards "Noticias" y "Configuración" del índice `/admin` y se agrega
"Actividades".

**Auditoría** (vocabulario snake_case existente): `news_create`, `news_update`,
`news_publish`, `news_unpublish`, `news_delete`, `activity_create`, `activity_update`,
`activity_delete`, `config_update` (con clave y valor nuevo en `detail`; escribe
`Configuration.updatedBy`, hoy siempre null).

## 4. Editor de noticias y sanitización

- **Tiptap** (`@tiptap/react`, `@tiptap/starter-kit`, extensiones link y underline).
  Toolbar básica: negrita, cursiva, subrayado, subtítulos (H2/H3), listas, links.
  Sin imágenes en el cuerpo (la imagen va como portada; decidido en la entrevista).
- **Sanitización en el servidor** con `sanitize-html` y allowlist estricta:
  `p, br, strong, em, u, a[href], ul, ol, li, h2, h3`. Links: solo `http/https`,
  `rel="noopener noreferrer"`. La lógica vive en `src/lib/news/sanitize.ts` (pura,
  testeada con payloads XSS). El HTML se sanitiza al guardar y se renderiza con
  `dangerouslySetInnerHTML` desde la base ya limpia.

## 5. Imagen de portada: upload y servido

- Subida dentro de la server action del formulario leyendo el `File` directo de
  `FormData` (`parseForm` ignora archivos por diseño — `src/lib/forms.ts:32`; no se toca).
- Validación: MIME real jpeg/png/webp (magic bytes, no extensión), máx. 5 MB
  (Nginx permite 15m). Nombre `<uuid>.<ext>` en `UPLOADS_DIR/news/` (dev `./uploads/news/`).
- Servida por **route handler público sin autenticación**: `GET /api/imagenes/noticias/[nombre]`,
  con validación anti path-traversal (el nombre debe matchear `^[0-9a-f-]{36}\.(jpg|png|webp)$`)
  y `Cache-Control: public, max-age=31536000, immutable` (el UUID hace inmutable el contenido).
- **Excepción documentada en `CLAUDE.md`**: la regla "todo upload se sirve por API
  autenticada" aplica a documentos personales (DNIs, facturas); el contenido público
  del sitio (imágenes de noticias) se sirve sin auth pero sigue viviendo en
  `UPLOADS_DIR`, fuera de `public/` y del repo.
- Al reemplazar o eliminar portada/noticia se borra el archivo huérfano del disco.

## 6. SEO

- Root layout: `metadataBase` desde `AUTH_URL`, `title: { default, template: "%s — Vecinal Ciudadela" }`,
  description, Open Graph base.
- `src/app/robots.ts`: allow público; disallow `/admin`, `/mi`, `/api`, `/ingresar`,
  `/verificar`, `/acceso`, `/redirigir`.
- `src/app/sitemap.ts`: rutas públicas fijas + noticias publicadas con `lastModified`.
- `/noticias/[slug]`: `generateMetadata` con título, description (extracto del cuerpo
  sin HTML), OG image (portada si tiene; si no, imagen institucional por defecto).
- JSON-LD `Organization` en la home (nombre, dirección, geo, logo).
- Imagen OG institucional por defecto (estática, generada del logo + marca).

## 7. CSP y cabeceras

`next.config.ts` pasa a emitir, además de las tres cabeceras actuales:

- **Content-Security-Policy**: `default-src 'self'`; `img-src 'self' data: blob:`;
  `frame-src https://www.openstreetmap.org`; `script-src`/`style-src` según lo que
  Next 16 requiera en producción (se ajusta midiendo en el build real; si hace falta
  `'unsafe-inline'` en style se acepta y se documenta). Los orígenes de Mercado Pago
  y Turnstile quedan **escritos y comentados** junto a la política para que el M3
  solo descomente (`https://sdk.mercadopago.com`, `https://challenges.cloudflare.com`, etc.).
- **Permissions-Policy**: `camera=(), microphone=(), geolocation=()`.
- `X-Frame-Options: DENY` se mantiene (no afecta el iframe saliente del mapa).
- HSTS: se verifica si Cloudflare ya la emite (comando preparado para Mariano);
  si no, se agrega en Next con `max-age` corto inicial.

## 8. Caché (primer uso en el proyecto)

Las páginas públicas se sirven **cacheadas y se invalidan por tag** desde las actions
del ABM (aprobado en el diseño): tags `news`, `activities`, `config`. La home depende
de los tres; `/noticias*` de `news`; `/actividades` de `activities`; `/ubicacion` de
`config`. El mecanismo concreto (`unstable_cache`/`"use cache"` con `revalidateTag`
sobre consultas Prisma, según el soporte real de Next 16.3) se fija en el plan de
implementación con una prueba puntual antes de generalizarlo. Las rutas de auth
existentes y todo `/admin` siguen `force-dynamic`. Si el mecanismo resultara
inestable en Next 16.3, el fallback aprobado es `force-dynamic` también en público
(el CA de Lighthouse se mide igual).

## 9. Assets

- `assets/hero.jpg` (1980×788): static import + `next/image` con `priority`, `sizes`
  correctos y placeholder blur. No se copia a `public/`.
- `public/logo.png` (363 KB): se genera versión optimizada (~≤40 KB) para el header;
  el original queda en `assets/`.
- Favicons: `icon.png`, `apple-icon.png` derivados del logo, sobre el `favicon.ico` actual.

## 10. Tests (vitest, patrón del Módulo 1: lógica pura sin base)

- `src/lib/news/`: query de listado/paginación (factory con Prisma fake), sanitización
  (payloads XSS, allowlist, links malformados), generación/normalización de slug.
- `src/lib/activities/`: regla de solapamiento (casos: mismo día sin solape, solape
  parcial, salones distintos, años distintos, actividad inactiva), validación de
  weekdays y horarios, orden de la grilla.
- `src/lib/config.ts`: lecturas tipadas con valores ausentes/corruptos.
- Route handler de imágenes: anti path-traversal.
- Actions: autorización (admin para ABMs, superadmin para configuración) — cubriendo
  el gap señalado en la revisión del M1 (acciones sin test de autorización).

## 11. Criterios de aceptación

Los de `docs/07` más los del alcance nuevo:

1. Publicar una noticia con imagen desde el panel y verla en la home desde un celular.
2. Lighthouse accesibilidad ≥ 90 en home, noticias y actividades (mobile).
3. ASOCIATE deshabilitado muestra el banner correcto con `asociate_activo=false`;
   activarlo desde `/admin/configuracion` lo habilita sin redeploy.
4. Cargar "Taekwondo niños — Salón Vidriado — martes y jueves 18:00–19:30 — 2026"
   desde el panel y verla en `/actividades` desde un celular; intentar cargar otra
   actividad solapada en el mismo salón es rechazado con mensaje claro.
5. `/ubicacion` muestra el mapa OSM centrado en la sede con la CSP activa sin errores
   de consola.
6. `robots.txt` bloquea `/admin` y `/mi`; el sitemap lista las noticias publicadas.
7. Todos los tests, `tsc`, lint y `next build` limpios.

## 12. Documentación a actualizar en este módulo

- `docs/04-modelo-de-datos.md`: entidades News y Activity, claves de configuración nuevas.
- `docs/05-flujos-funcionales.md`: flujo de actividades, nav definitivo, estatuto → M5.
- `docs/07-plan-de-etapas.md`: alcance M2 real (calendario entra, estatuto sale hacia M5),
  CA ampliados; verificación de que las ideas nuevas de Mariano estén asignadas
  (bloqueos ASOCIATE → M3; resumen mensual → M3; recibos/efectivo/notificaciones → M4;
  cuotas y cambio de categoría en panel → M5).
- `CLAUDE.md`: Next 16 (dice 15), medidas reales del hero (1980×788, dice 1868px),
  par de colores accesible `#2E9BDF` (marca) / `#0079BC` (`--primary` interactivo),
  excepción de servido público para imágenes de noticias.

## 13. Riesgos y decisiones registradas

- **Tiptap + React 19 / Next 16**: verificar compatibilidad de versiones al armar el
  plan; si la integración con React 19 diera problemas, el fallback acordable es
  textarea con párrafos (opción que Mariano descartó solo por preferencia de UX).
- **Caché por tag sobre Prisma**: es la primera vez en el repo; se prueba en una ruta
  antes de generalizar (§8, con fallback definido).
- **`.dark` sin ThemeProvider**: el sitio sigue light-only; no se monta `next-themes`
  en este módulo.
- **Toasts**: el patrón de feedback sigue siendo server-driven (`state.error` +
  querystring), como todo el repo; no se monta `<Toaster/>`.
- Los emails de contacto (`contact_phone`, `contact_email`) arrancan vacíos: la página
  Ubicación oculta la línea si no hay valor. Mariano los carga desde `/admin/configuracion`.
