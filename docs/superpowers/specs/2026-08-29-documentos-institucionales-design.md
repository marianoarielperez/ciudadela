# Documentos institucionales — diseño

**Fecha:** 29/08/2026 · **Estado:** aprobado por el operador (3 rondas de preguntas + diseño)

Módulo nuevo: gestión de documentos institucionales desde el panel de admin
(sección **Documentos** en Contenido) y su publicación a los socios en
**/mi/documentos**, que reemplaza a la actual /mi/estatuto.

## 1. Alcance y decisiones de producto

- **Cuatro tipos**: NORMAS (estatuto, reglamentos), MEMORIAS (una por año),
  BALANCES (uno por año), OTROS DOCUMENTOS (libre).
- **Visibilidad: solo socios logueados en /mi** (como el estatuto hoy). Nada
  público en esta etapa.
- **Solo PDF.** Un documento institucional publicado a socios se ve igual en
  todos lados y el navegador lo abre inline.
- **Sin estados borrador/publicado**: subir = publicar. Eliminar es la forma
  de despublicar.
- **Año (ejercicio)**: obligatorio y **único por tipo** para memorias y
  balances (una Memoria 2025; para reemplazarla se edita la existente).
  Opcional para normas y otros.
- **Títulos**: memorias y balances se titulan solos por tipo y año
  ("Memoria 2025", "Balance 2025"); normas y otros llevan título libre.
- **Descripción**: campo opcional de texto plano, ≤200 caracteres, visible
  al socio bajo el título.
- **Destacado**: flag manual `featured`, solo para NORMAS, a lo sumo uno
  (marcar uno desmarca el anterior). Es el documento que /mi/documentos
  muestra arriba de todo.
- **Permisos**: admin y superadmin por igual (es Contenido, como Noticias).
  Subir, editar y eliminar quedan auditados con el actor.
- **El estatuto actual se migra al nuevo sistema** (script one-shot); la
  página /mi/estatuto y la ruta /api/mi/estatuto se retiran.

## 2. Modelo de datos

Tabla nueva. NO se extiende el modelo `Document` existente: ese es para
documentación **personal** de trámite (DNI/anexos, solo-admin, auditado por
vista) y no tiene título/año/orden; mezclar acá ensuciaría sus guardas.

```prisma
enum InstitutionalDocumentType {
  norm
  annual_report
  balance
  other
}

model InstitutionalDocument {
  id           Int                       @id @default(autoincrement())
  type         InstitutionalDocumentType
  title        String                    @db.VarChar(160)
  description  String?                   @db.VarChar(200)
  year         Int?
  yearKey      String?                   @unique @db.VarChar(30) @map("year_key")
  fileName     String                    @db.VarChar(255) @map("file_name")
  size         Int
  featured     Boolean                   @default(false)
  uploadedById Int?                      @map("uploaded_by_id")
  uploadedBy   User?                     @relation(fields: [uploadedById], references: [id], onDelete: SetNull)
  createdAt    DateTime                  @default(now()) @map("created_at")
  updatedAt    DateTime                  @updatedAt @map("updated_at")

  @@index([type, year])
  @@map("institutional_documents")
}
```

- **`yearKey` es la garantía de unicidad "una memoria por año", y la da la
  base, no un `if`.** MySQL no tiene índices parciales, así que la clave se
  materializa solo para memoria/balance (`"annual_report:2025"`,
  `"balance:2025"`); para normas y otros queda `NULL`, y los `NULL` de un
  unique de MySQL no chocan entre sí. La derivación de `yearKey` es una
  función pura del dominio, única para create y update.
- La violación del unique se lee con `src/lib/treasury/unique-violation.ts`
  (el helper que ya sabe que con `@prisma/adapter-mariadb` no existe
  `meta.target`) y produce un error legible: "Ya hay un Balance 2025; editá
  el existente."
- `year` obligatorio para memoria/balance se valida en el dominio (guarda de
  servicio), con mensaje propio.
- `fileName` es `{uuid}.pdf`, relativo a `UPLOADS_DIR/institucional/`.
- Migración Prisma puramente aditiva (enum + tabla), convención
  `add_institutional_documents`.

## 3. Storage

Módulo nuevo `src/lib/institutional-documents/storage.ts`, calcado de
`news/images.ts` + `documents/storage.ts`:

- Reusa `uploadsDir()` de `@/lib/news/images` (único dueño del default de
  `UPLOADS_DIR`; no se duplica).
- Validación: tamaño ≤ **10 MB** (chequeado sobre `file.size` Y sobre los
  bytes reales), magic bytes **solo `%PDF-`**. El mime persistido nunca
  viene del cliente (es siempre `application/pdf`).
- Naming: `institucional/{crypto.randomUUID()}.pdf`. La validación de nombre
  para servir es una regex estricta UUID+`.pdf` en un módulo puro sin
  `node:` (patrón `image-url.ts`).
- Borrado best-effort con ENOENT como éxito (patrón `deleteNewsCover`).
- Al vivir bajo `UPLOADS_DIR`, **`backup.sh` lo cubre sin tocarlo** — hoy el
  estatuto no tiene backup fuera de git.

## 4. Serving

Dos route handlers finos que comparten un helper de respuesta:

- **`GET /api/mi/documentos/[id]`** — `requireMember({ allowSuspended: true })`
  (el suspendido lee, como hoy el estatuto; el dado de baja no). Headers
  defensivos calcados de la ruta actual del estatuto: `application/pdf`,
  `Content-Disposition: inline; filename="…"` (derivado del título,
  slugificado en servidor), `Cache-Control: no-store, private`,
  `Vary: Cookie`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`.
- **`GET /api/admin/documentos/[id]`** — `requireAdmin()`, mismo helper.
- **Sin auditoría por vista**: no es documentación personal (la auditoría
  por visualización queda para DNIs/facturas). La auditoría de este módulo
  es de gestión (§5).
- Documento inexistente o archivo faltante → 404.
- No hay visor embebido/iframe → **no se toca la CSP de `next.config.ts`**.

## 5. /admin/documentos

Molde visual: `/admin/configuracion` (pestañas Radix con ícono + tira de
estado) con las convenciones del shell.

- **Nav**: ítem en Contenido (`nav.ts`: `{ href: "/admin/documentos",
  label: "Documentos", icon: "library" }`, sin `superadminOnly`) + entrada
  en `NAV_ICONS` (Lucide `Library`) + card del tablero en
  `dashboard-cards.ts`. Los tests de sincronización existentes fuerzan la
  consistencia.
- **Página principal**: `PageHeader` ("Documentos", acción "Subir
  documento") + **tira de estado** (4 mini-cards con chip
  `size-9 bg-primary/10 text-primary`): norma vigente, última memoria,
  último balance, total de documentos — cero queries extra: se derivan del
  listado ya consultado. Debajo, **pestañas Radix `?tab=`** (patrón
  `MemberTabs`/`ConfigTabs`, config pura en
  `src/lib/admin/documentos-tabs.ts` con íconos como strings):
  **Normas** (`scale`) · **Memorias** (`book-open`) · **Balances**
  (`chart-column`) · **Otros** (`files`).
- Dentro de Memorias/Balances: **chips de año** para filtrar (una fila de
  chips, no un dropdown). Filas de tabla: título, año como `Badge`, tamaño,
  fecha, quién lo subió; la norma destacada lleva badge "Vigente"
  (`success`, vía `status-badges.ts`). `EmptyState size="list"` por pestaña
  vacía, nunca un `thead` sin filas.
- **Alta** (`/admin/documentos/nuevo`) y **edición**
  (`/admin/documentos/[id]`): patrón Noticias (`useActionState` +
  `useSyncedForm`, `FormMessage`, migas "Nuevo"/"Editar", el `<h1>` de
  edición es el título del documento). El tipo llega preseleccionado desde
  la pestaña activa (`?tipo=`). Form por tipo:
  - memoria/balance: año + descripción + archivo (título derivado, se
    muestra como texto, no como input);
  - normas: título + descripción + año opcional + archivo + check "Marcar
    como norma vigente";
  - otros: título + descripción + año opcional + archivo.
- **Reemplazo del PDF** = subir otro archivo en edición; el viejo se borra
  después del update y del audit (patrón portada de Noticias, compensación
  de huérfanos incluida: si el INSERT/UPDATE falla, se borra el archivo
  recién escrito).
- **Marcar vigente**: en la misma transacción, desmarcar el anterior
  (`updateMany featured: false` + `update featured: true`).
- **Eliminar**: botón con `window.confirm` (patrón `DeleteActivityButton`),
  orden delete → audit → unlink best-effort (el asiento va antes de tocar
  el disco).
- **Auditoría**: `institutional_document_create / update / delete` con el
  patrón exacto de `news_create` (audit fuera del try, con IP de
  `x-real-ip`, `detail` con título/tipo/año).
- Todas las actions: `requireAdmin()` primero, `parseForm` + File aparte
  (patrón `coverFrom`), `redirect` fuera del try.

## 6. /mi/documentos

- La pestaña "Estatuto" pasa a **"Documentos"** en `src/lib/mi/nav.ts`
  (ícono `library` — alta en el union `MiTabIcon` y en el mapa de
  `mi-tabs.tsx`). La QuickLink del inicio cambia a "Documentos" /
  "Estatuto, memorias y balances".
- `/mi/estatuto/page.tsx` queda como `redirect("/mi/documentos")` (no se
  rompen marcadores). `/api/mi/estatuto` se elimina.
- **Página** (`/mi/documentos/page.tsx`, `force-dynamic`,
  `requireMember({ allowSuspended: true })` como todo el panel):
  - **Arriba, la norma vigente destacada** (`featured`): tarjeta con el
    lenguaje visual de la credencial — `rounded-2xl` + ring, eyebrow en
    mayúsculas espaciadas "NORMA VIGENTE", título grande, descripción, CTA
    "Abrir el estatuto (PDF)" (o el título que tenga). Sobria, sin foto: el
    parentesco con la credencial es tipográfico.
  - **Debajo, secciones por tipo** (Normas sin la destacada, Memorias,
    Balances, Otros documentos) con el encabezado de panel de Salud
    (`PanelHeader`: chip celeste + título). Cada documento es una
    **fila-link entera** al PDF (target ≥44px, `outline-hidden` +
    `focus-visible:ring`): ícono, título, descripción, año y fecha.
    Memorias y balances ordenados por año descendente; normas y otros por
    fecha de subida descendente.
  - Secciones vacías no se renderizan. Sin ningún documento:
    `EmptyState` "Los documentos van a aparecer acá cuando la Comisión los
    publique."
  - `max-w-3xl`, responsive de pulgar, modo oscuro por tokens. Sin verde ni
    ámbar crudos: tokens `--success`/`--warning` si hicieran falta.
- Sugerencia anotada para el futuro (no en esta etapa): sección
  "Por ejercicio" que junte memoria + balance del mismo año.

## 7. Migración del estatuto actual

Script one-shot `scripts/import-estatuto.ts` (patrón `import-padron.ts`):

- Copia `datos/estatuto.pdf` a `UPLOADS_DIR/institucional/{uuid}.pdf` y crea
  la fila (`type: norm`, `title: "Estatuto social"`, `featured: true`).
- **Idempotente**: si ya existe una norma `featured`, no hace nada y lo
  dice.
- Lo corre el operador en el VPS post-deploy (el comando exacto queda
  escrito en el plan; no se inventa de memoria).
- `datos/estatuto.pdf` y `estatuto.docx` quedan en el repo como fuente
  histórica; el sistema deja de leerlos.

## 8. Tests

- **Puros sin Prisma** (cliente inyectado, nunca importado): derivación de
  título y `yearKey`, guarda de año obligatorio, regla del `featured` único,
  validación de nombre de archivo.
- **Storage** con el molde de `news-images.test.ts`: traversal, separadores
  Windows, byte nulo, doble extensión, PDF disfrazado (magic bytes), tamaño.
- **Rutas** con el molde de `application-document-route.test.ts`: 403 sin
  sesión, 404 por documento inexistente y por archivo faltante, headers.
- **Actions `-auth`**: cada action corta sin `requireAdmin` ok (molde
  `news-actions-auth.test.ts`).
- **Nav**: actualización de `admin-nav.test.ts`, `dashboard-cards.test.ts` y
  `mi-nav.test.ts` (la pestaña nueva, la página en disco, el orden).

## 9. Qué NO toca

- Nada de `src/lib/treasury/*` (salvo importar `unique-violation.ts`, que es
  lectura), nada de `src/lib/mp/*`, webhooks, crons, `resolve.ts` ni
  `registerPayment`. Verificable con `git diff --stat` al cerrar, como se
  hizo con la exención.
- Ninguna variable de entorno nueva. Ningún cambio de CSP.
- El modelo `Document` existente y sus rutas quedan intactos.

---

## 12. Estado

**IMPLEMENTADO — 30/08/2026**, rama `institutional-documents` (18 commits, de
`8378505` a la importación del estatuto). Cubre las nueve secciones de esta
spec: modelo y migración (§2), dominio puro (§1), storage bajo
`UPLOADS_DIR/institucional` (§3), las dos rutas autenticadas del PDF (§4), la
sección **Documentos** del panel con sus tres pantallas (§5), `/mi/documentos`
con la norma destacada (§6), el script one-shot `scripts/import-estatuto.ts`
(§7) y los tests (§8).

Verificado al cerrar: suite completa en verde (247 archivos, 3640 tests), lint
sin errores, build OK, y el perímetro de §9 —`src/lib/treasury` y
`src/lib/mp` sin un solo archivo tocado— comprobado con
`git diff --stat main...HEAD`, no de memoria.

Pendiente operativo: correr `npx tsx scripts/import-estatuto.ts` en el VPS una
sola vez, después del deploy.

## 13. Desvíos de ejecución

Dos cosas salieron distinto de lo planificado. Ninguna cambia el alcance.

- **§9 decía "ningún cambio de CSP", y `next.config.ts` cambió.** La CSP dura
  que los dos handlers del PDF emiten en su `Response` no llegaba al cliente:
  la entrada global de `headers()` la pisa con `setHeader`, que REEMPLAZA en
  vez de sumar, así que el PDF se servía con la CSP genérica del sitio. Se
  agregaron dos entradas explícitas —`/api/mi/documentos/:id` y
  `/api/admin/documentos/:id`, una por ruta porque no comparten prefijo y el
  único comodín que las abarcaría capturaría de más— con
  `default-src 'none'; sandbox; frame-ancestors 'none'` (commit `e19075f`). El
  operador levantó la restricción a mitad del plan. `X-Frame-Options: DENY`
  de la entrada global queda como está a propósito: estas rutas no tienen
  visor embebido y nadie las framea.
- **La fecha de carga se quitó de las filas de `/mi/documentos`** (§6 la
  listaba junto al año), a pedido del operador: es contabilidad interna y no
  le dice nada al socio —para memorias y balances el ejercicio ya está en el
  título, y un documento resubido no cambia de contenido— (commit `e1d2fda`).
  La fecha sigue en el listado del admin, que es donde sirve.
