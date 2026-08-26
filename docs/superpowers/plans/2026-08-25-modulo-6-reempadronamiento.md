# Módulo 6 — Re-empadronamiento y cierre de libro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El proceso estatutario completo del Art. 9° bis y el Art. 40: los adherentes se re-empadronan (wizard público REEMPADRONATE o carga presencial), la CD valida presentaciones, notifica por email y por cartelera (por lotes, con días hábiles), declara las bajas de los no re-empadronados con ventana de recurso, y cierra el Libro 1 abriendo el Libro 2 con renumeración por antigüedad — mientras `/admin/socios` renace con pestañas Padrón | Libros | Histórico.

**Architecture:** Tres fases independientes. **6A** reorganiza `/admin/socios` (layout con pestañas por URL, listado con chips y cards responsive, libros consultables con export, padrón histórico) sin depender del proceso. **6B** crea el dominio del proceso (`reregistration_processes` + `presentations` con cohorte fija al activar + `holidays` + `board_notices`), el wizard público sin ningún paso de pago, la validación admin y el circuito de cartelera por lotes. **6C** ejecuta el cierre en tres etapas (checklist → bajas en lotes de ≤25 reutilizando `withdrawWithDebits` → transacción única solo-DB de migración con foto y renumeración REG-28). El proceso referencia al libro que depura y el cierre abre `número + 1`: nada hardcodea "Libro 2".

**Tech Stack:** Next.js 16 App Router, React 19 (`useActionState`), Prisma 7 + MariaDB, exceljs (export), pdf-lib (aviso de cartelera), lucide-react, Cloudflare Turnstile, vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-modulo-6-reempadronamiento-design.md` (aprobada 25/08/2026, 16 decisiones del operador). Ledger: `.superpowers/sdd/progress.md`.

## Global Constraints

- UI en **es-AR con "vos"**; código, variables y commits en **inglés**. Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (línea en blanco antes).
- **Núcleo de dinero intocable, SIN excepciones en este módulo**: `src/lib/treasury/*`, `src/lib/mp/*`, `src/components/admin/account-section.tsx`, `src/lib/admin/digest.ts` y `tests/integration/*` NO se modifican — solo se importan. El M6 no toca un solo archivo de plata.
- **El wizard REEMPADRONATE no tiene NINGÚN paso de pago** (decisión del operador, 25/08): no ofrece pagar, ni adherir débito, ni cambiar monto. `step-payment` de ASOCIATE y toda referencia a Mercado Pago quedan fuera. Si una tarea del wizard te tienta a "aprovechar y ofrecer el pago", la respuesta es NO.
- **Plazos**: 1ª instancia 30 días, 2ª +10, recurso +30, IGJ 90 — todos **corridos**. Solo la cartelera computa **20 días hábiles** (lun-vie menos `holidays`).
- **Fehaciencia**: email → al enviarse; cartelera → al CUMPLIRSE `boardTo`. `appealUntil` cuenta desde la fecha fehaciente. Sin validaciones de calendario electoral (180 días) ni de periodicidad.
- **La ficha nunca se escribe desde el wizard**: los datos viven en `Presentation` y se vuelcan a `Member` recién al validar, vía `memberWriter.updateMember` (que ya revoca tokens y sincroniza el email de acceso).
- **Email obligatorio en las dos vías** (web y presencial): constituye el domicilio electrónico del Art. 5° ter.
- **Cartelera por lotes**: la unidad de trabajo del operador es el AVISO (`BoardNotice`), nunca el socio individual. Una sola fecha de fijación estampa todas las filas del lote.
- Lotes que tocan MP: **≤25 socios por corrida** (presupuesto Nginx, precedente REG-34 en `src/lib/treasury/rules.ts:126-153`). Ninguna llamada de red dentro de una `$transaction`.
- Auditoría y logs: ids, códigos y flags — nunca DNI, email, teléfono ni domicilio (Ley 25.326). `book_close` usa `auditStrict`.
- Autorización siempre en ruta + action: convocar / 2ª instancia / cierre / ABM feriados = `requireSuperadmin`; validar / observar / rechazar / presencial / cartelera / export = `requireAdmin`. La nav filtra por token pero eso es display.
- **Lenguaje visual del panel, obligatorio en toda pantalla nueva o rediseñada**: componentes compartidos antes que reinventar (`PageHeader`, `FormMessage`, `EmptyState`, `PaginationNav` + `pageHref`, `SELECT_CLASS`, `INLINE_LINK`, `status-badges.ts`), tarjetas con ícono Lucide `aria-hidden` en el título, badges con palabra además de color, targets ≥44px (`min-h-11`) en admin y ≥48px en público, foco `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring` (nunca `outline-none`), colores solo por tokens (prohibido verde/ámbar crudo), `font-mono tabular-nums` en números, responsivo sin scroll horizontal del body, mapa ícono→componente SIEMPRE en el client component y nunca en `lib/` (`src/components/admin/request-type-icon.tsx:1-11` tiene el argumento).
- Migraciones con `npx prisma migrate dev` — nunca `db push`. **Ojo con `@prisma/adapter-mariadb`**: un P2002 no trae `meta.target`; toda guarda de unique usa `src/lib/treasury/unique-violation.ts` (se IMPORTA, no se copia).
- Tests: `npx vitest run`, `npm run lint`, `npm run build` antes de cada commit de tarea. Los módulos puros reciben el cliente de Prisma INYECTADO (nunca importan `@/lib/prisma`).
- Rama de trabajo: `modulo-6` (ya existe, con la spec commiteada).
- `?tab=cuenta` de la ficha del socio es **contrato público** (12 pantallas de M4 linkean ahí): `MemberTabs` y sus values no cambian.

---

# FASE 6A — `/admin/socios` reorganizado (sin proceso)

Produce software terminado por sí sola: la sección Socios con pestañas, el listado nuevo, los libros consultables y el histórico. Nada de esta fase depende del proceso de re-empadronamiento.

### Task 1: Pestañas de la sección Socios — config pura, componente y layout

**Files:**
- Create: `src/lib/admin/socios-tabs.ts`, `src/components/admin/socios-tabs.tsx`, `src/app/admin/socios/layout.tsx`
- Test: `tests/socios-tabs.test.ts`

**Interfaces:**
- Consumes: `src/lib/admin/solicitudes-tabs.ts` y `src/components/admin/solicitudes-tabs.tsx` como MOLDE (leerlos enteros; no se modifican); `src/components/mi/mi-tabs.tsx:13-20` como referencia del mapa de íconos en cliente; `src/app/admin/solicitudes/layout.tsx` como molde de layout (la variante SIN `PageHeader`: cada página hija pone su `<h1>` — el porqué está en su comentario: dos `<h1>` por pantalla fue un bug real).
- Produces:

```ts
// src/lib/admin/socios-tabs.ts (puro, sin íconos)
export type SociosTab = { href: string; label: string; icon: "users" | "book-marked" | "history" };
export const SOCIOS_TABS: SociosTab[] = [
  { href: "/admin/socios", label: "Padrón", icon: "users" },
  { href: "/admin/socios/libros", label: "Libros", icon: "book-marked" },
  { href: "/admin/socios/historico", label: "Histórico", icon: "history" },
];
export function isSociosTabActive(pathname: string, href: string): boolean;
```

Regla de matcheo (calca la de `solicitudes-tabs.ts:29-34`, "el prefijo más específico gana"): `/admin/socios/libros` y `/admin/socios/historico` matchean por prefijo; **todo lo demás bajo `/admin/socios` es Padrón** (`/admin/socios`, `/admin/socios/{id}`, `/admin/socios/{id}/baja`, `/admin/socios/carga/{n}`, `/admin/socios/nuevo`). Componente `SociosTabs({ tabs })`: calca `solicitudes-tabs.tsx` (links, `aria-current`, `min-h-11`, el `-mx-4 -my-1 … px-4 py-1` documentado del anillo de foco) y suma el ícono Lucide `size-4 aria-hidden` por pestaña (mapa `users → Users`, `book-marked → BookMarked`, `history → History` en el CLIENTE).

- [ ] **Step 1: Test de la config pura.** Casos: los tres hrefs activos en sí mismos; `/admin/socios/123` y `/admin/socios/carga/45` y `/admin/socios/nuevo` → Padrón; `/admin/socios/libros/1` → Libros; `/admin/socios/historico?q=x` (pathname sin query) → Histórico. → FAIL.
- [ ] **Step 2: Implementar config + componente + layout.** El layout solo monta `<SociosTabs tabs={SOCIOS_TABS} />` envuelto en `print:hidden`, más `{children}`. Sin `PageHeader`, sin autorización propia (las páginas heredan del layout admin como hoy; `socios/page.tsx` no llama `requireAdmin` y eso NO cambia en esta task). → PASS.
- [ ] **Step 3: Suite + lint + build.** Verificar en navegador que las páginas existentes ([id], carga, nuevo) muestran las pestañas con Padrón activa y nada se rompió.
- [ ] **Step 4: Commit** `feat(m6a): socios section tabs — padron, libros, historico`

---

### Task 2: El Padrón renace — chips-resumen, filtros con tokens, tabla→cards responsive

**Files:**
- Modify: `src/app/admin/socios/page.tsx` (reescritura de presentación), `src/lib/members/query.ts` (SOLO agregados)
- Test: `tests/members-query.test.ts` (agregar casos; las aserciones existentes NO se tocan — vigilan que `fetchPadron` siga sin `skip`/`take`)

**Interfaces:**
- Consumes: `parsePadronFilters`/`padronWhere`/`fetchPadronPage` (`src/lib/members/query.ts:17-141`, `PADRON_PAGE_SIZE = 50`); `PaginationNav` (`src/components/admin/pagination-nav.tsx:9`) + `pageHref` (`src/lib/admin/pagination.ts`); `SELECT_CLASS` (`src/lib/admin/field-styles.ts:12-13`); `INLINE_LINK` (`src/lib/admin/link-styles.ts:10-11`); `memberStatusBadgeVariant` (`src/lib/admin/status-badges.ts`); `CATEGORY_LABELS`/`STATUS_LABELS`/`EMAIL_STATUS_LABELS` (`src/lib/members/labels.ts`); el patrón segmented `SEGMENT_BASE/ACTIVE/INACTIVE` de `src/app/admin/solicitudes/socios/page.tsx:48-51,117-132`; la card responsive `RequestCard` (`solicitudes/socios/page.tsx:189-257`: `flex flex-wrap items-center justify-between gap-x-3 gap-y-1` — el badge cae abajo solo en móvil); la tabla bien hecha de `src/app/admin/tesoreria/deudores/page.tsx` (aria-labels, `text-right`, `font-mono tabular-nums`).
- Produces (agregado en `query.ts`, mismo estilo inyectado):

```ts
export type PadronCounts = {
  vigentes: number; activos: number; adherentes: number;
  suspendidos: number; bajas: number;
};
/** Conteos del libro abierto para los chips del listado. Una sola pasada
 *  con groupBy sobre Member restringido a membresía en libro abierto. */
export async function fetchPadronCounts(db: PadronDb): Promise<PadronCounts>;
```

- [ ] **Step 1: Test de `fetchPadronCounts`** con el fake de db del archivo de tests existente (groupBy por `[status, category]` → el test arma los buckets y verifica la suma). → FAIL → implementar (usar `member.groupBy({ by: ["status", "category"], where: { memberships: { some: { book: { status: "open" } } } }, _count: true })` y derivar los cinco números; `vigentes = active + suspended`). → PASS.
- [ ] **Step 2: Chips-resumen clickeables.** Fila arriba de los filtros: `Vigentes {n}` (sin filtro de estado+`?status=` vacío… NO: vigentes = link a `?status=`vacío con nota) — concretamente cinco links con el patrón segmented: **Vigentes** → `/admin/socios` (sin filtros de estado), **Activos** → `?category=active`, **Adherentes** → `?category=adherent`, **Suspendidos** → `?status=suspended`, **Bajas** → `?status=withdrawn`. Cada chip: label + número en `font-mono tabular-nums`; el activo se marca comparando con los filtros parseados vigentes (`aria-current="page"`). Los conteos NO cambian con los filtros (son el resumen del libro, no del resultado).
- [ ] **Step 3: Filtros y tabla.** El form GET conserva los names actuales (`q`, `category`, `status`, `email`, `dni` — el contrato de `parsePadronFilters`): los 4 `<select>` pasan a `SELECT_CLASS` con `aria-label` cada uno; el input de búsqueda con `placeholder="Nombre, DNI o N°"`. La tabla (`hidden md:table` conceptual: envolver la `<Table>` en `<div className="hidden md:block">`): columnas `N°` (`font-mono tabular-nums`), `Apellido y nombre` (link `INLINE_LINK` a la ficha), `DNI` (`font-mono`), `Categoría` (`Badge variant="secondary"` con label), `Estado` (`Badge` con `memberStatusBadgeVariant`), `Email` (ícono por estado: `MailCheck` verificado / `Mail` declarado / `MailX` rebotado / `Minus` sin email — cada uno `size-4 aria-hidden` + `<span className="sr-only">` con el label; la dirección NO se lista más en la celda: se ve en la ficha), `Débito` (ícono `RefreshCw text-primary` si `autoDebit`, con sr-only). Acciones: el link "Ficha" se vuelve el nombre clickeable (columna de acciones desaparece).
- [ ] **Step 4: Cards en móvil.** `<div className="md:hidden">` con una card por socio (molde `RequestCard`): título = nombre (link) + badge de estado a la derecha; línea de metadatos `N° · DNI · categoría`; fila de íconos email/débito. `CardTitle as="h2"` (es ítem de lista).
- [ ] **Step 5: Paginación y vacío.** Reemplazar la paginación manual (`socios/page.tsx:34-41,153-167`) por `PaginationNav` + `pageHref("/admin/socios", params, n)`; actualizar el comentario de cabecera de `src/lib/admin/pagination.ts:1-2` (el padrón dejó de tener implementación propia; la bandeja sigue). `EmptyState size="list"` con "Ningún socio coincide con estos filtros." + link "Limpiar filtros". El `PageHeader` de la página pasa a `title="Padrón"` con las mismas acciones (Exportar Excel, Alta manual) — el "Libro 1" del título viejo sale: el libro vigente ahora se ve en la pestaña Libros.
- [ ] **Step 6: Suite + lint + build + navegador.** 375px sin desborde horizontal; chips filtran; export intacto (el link de export NO gana parámetro de página — `parsePadronPage` separado existe para eso, `query.ts:93-100`).
- [ ] **Step 7: Commit** `feat(m6a): padron listing redesign — summary chips, tokened filters, responsive cards`

---

### Task 3: Pestaña Libros — cards, detalle consultable y export auditado

**Files:**
- Create: `src/app/admin/socios/libros/page.tsx`, `src/app/admin/socios/libros/[numero]/page.tsx`, `src/app/api/admin/libros/[numero]/export/route.ts`, `src/lib/members/books.ts`
- Modify: `src/app/admin/socios/[id]/page.tsx` (bloque "Libros" en la pestaña Ficha)
- Test: `tests/members-books.test.ts`

**Interfaces:**
- Consumes: el export existente del padrón como MOLDE del route handler (buscarlo: `src/app/api/admin/padron-export/` — leer cómo arma el workbook con exceljs, los headers de descarga y el asiento `padron_export`); `Book`/`Membership` (`prisma/schema.prisma:249-275`); `audit` con IP (`src/lib/audit.ts:27-36`); `requireAdmin`; `formatDateAR` (verificar el nombre real en `src/lib/dates.ts` antes de importar).
- Produces:

```ts
// src/lib/members/books.ts — consultas puras con db inyectada
export type BookSummary = {
  id: number; number: number; status: "open" | "closed";
  openedAt: Date; closedAt: Date | null;
  openingMinuteId: number | null; closingMinuteId: number | null;
  membershipCount: number;
};
export async function fetchBooks(db: BooksDb): Promise<BookSummary[]>;

export type BookRow = {
  memberNumber: number; memberId: number; fullName: string; dni: string | null;
  /** Libro abierto: estado/categoría VIVOS de la ficha.
   *  Libro cerrado: la FOTO (statusAtClose/categoryAtClose) — hasta que la 6C
   *  escriba esas columnas, un libro cerrado sin foto cae a los vivos. */
  status: MemberStatus; category: MemberCategory;
};
export async function fetchBookRows(db: BooksDb, bookNumber: number): Promise<{ book: BookSummary; rows: BookRow[] } | null>;
```

*(Nota: las columnas `statusAtClose`/`categoryAtClose` las crea la migración de la Task 6 — fase 6B. Esta task escribe `fetchBookRows` con el fallback "sin foto → vivos" y un comentario que lo dice; el detalle de un libro cerrado con foto se ve recién tras la 6C. Hoy solo existe el Libro 1 abierto, así que nada queda a medias en pantalla.)*

- [ ] **Step 1: Test de `fetchBookRows`** con fake de db: ordena por `memberNumber` asc; el libro inexistente devuelve `null`; con snapshot presente (campos truthy en el fake) gana la foto. → FAIL → implementar (`membership.findMany({ where: { book: { number } }, include: { member: … }, orderBy: { memberNumber: "asc" } })`). → PASS.
- [ ] **Step 2: Página Libros.** `PageHeader title="Libros"`. Una `Card` por libro (grid `gap-4 md:grid-cols-2`): `CardTitle as="h2"` con ícono `BookMarked` + "Libro N° {number}", `Badge` (`open` → "Abierto" success / `closed` → "Cerrado" secondary), `<dl>` con apertura (fecha + link al acta `/admin/actas/{id}` si hay — verificar la ruta real de actas con un grep antes de linkear), cierre ídem, y "{membershipCount} asentados" en `font-mono tabular-nums`. Link "Ver libro" a `/admin/socios/libros/{number}`.
- [ ] **Step 3: Detalle del libro.** `PageHeader` con `title="Libro N° {n}"`, breadcrumb Socios → Libros → "Libro {n}", acción "Exportar Excel" → `/api/admin/libros/{n}/export`. Aviso `FormMessage kind="neutral" box` cuando el libro está cerrado: "Este libro está cerrado: lo que ves es la foto al {fecha de cierre}." Tabla desktop / cards móvil (mismo patrón de la Task 2, sin filtros — un libro se lee entero): N°, nombre (link a la ficha), DNI, categoría, estado. `EmptyState` imposible en la práctica pero cubierto.
- [ ] **Step 4: Export.** Route handler GET: `requireAdmin` (401/403 como el export del padrón), workbook con las columnas del Step 3 + encabezado "Libro N° {n} — {estado} — exportado el {fecha}", `audit({ action: "book_export", entity: "book", entityId: String(book.id), detail: { number, status, rows } })`. Nombre de archivo `libro-{n}.xlsx`.
- [ ] **Step 5: Bloque "Libros" en la ficha.** En `src/app/admin/socios/[id]/page.tsx`, dentro del panel `ficha` (después de la Card "Datos personales"), una Card chica "Libros" (`size="sm"`, ícono `BookMarked`): una línea por membresía "Libro {n} · N° {memberNumber}" (+ " · cerrado" si aplica), `font-mono tabular-nums` en los números. La consulta ya trae `memberships` en esa página (`[id]/page.tsx:113` usa el idiom del libro abierto): ampliar el `select` para traer todas con su `book { number, status }`.
- [ ] **Step 6: Suite + lint + build + navegador** (Libro 1 con 278 asentados; export descarga; ficha muestra "Libro 1 · N° {x}").
- [ ] **Step 7: Commit** `feat(m6a): books tab — per-book cards, read-only detail and audited export`

---

### Task 4: Pestaña Histórico — todas las personas, con veredicto de reingreso

**Files:**
- Create: `src/app/admin/socios/historico/page.tsx`, `src/lib/members/history.ts`
- Test: `tests/members-history.test.ts`

**Interfaces:**
- Consumes: `padronWhere` NO (el histórico consulta desde `Member` sin exigir membresía en libro abierto — el precedente de consultar desde `Member` a propósito es `src/lib/members/electoral.ts:56-63`); `REASON_LABELS` (`labels.ts` — ya incluye `not_reregistered: "No re-empadronado"`); `paginate`/`parsePage`/`pageHref` (`src/lib/admin/pagination.ts`); `PaginationNav`.
- Produces:

```ts
// src/lib/members/history.ts — puro, db inyectada
export type ReentryVerdict =
  | { kind: "member" }                    // vigente: no aplica
  | { kind: "blocked_forever" }           // expulsión / reentryBlocked
  | { kind: "blocked_until"; until: Date }// rejectedUntil futuro (REG-05)
  | { kind: "must_settle" }               // cesante con cuotas pendientes (REG-16)
  | { kind: "clear" };                    // puede reingresar por el proceso común
export function reentryVerdict(input: {
  status: MemberStatus; reentryBlocked: boolean;
  withdrawalReason: WithdrawalReason | null;
  rejectedUntil: Date | null; pendingFees: number; now: Date;
}): ReentryVerdict;

export type HistoryFilters = { q?: string; status?: MemberStatus; reason?: WithdrawalReason };
export function parseHistoryFilters(sp: Record<string, string | string[] | undefined>): HistoryFilters;
export async function fetchHistoryPage(db: HistoryDb, f: HistoryFilters, page: number): Promise<{
  rows: Array<{ id: number; fullName: string; dni: string | null; category: MemberCategory;
    status: MemberStatus; withdrawalReason: WithdrawalReason | null; leftAt: Date | null;
    joinedAt: Date; pendingFees: number; rejectedUntil: Date | null; reentryBlocked: boolean;
    memberships: Array<{ bookNumber: number; memberNumber: number }> }>;
  total: number; page: number; pageCount: number;
}>;
```

Semántica de `reentryVerdict` (tabla, en orden): vigente (`active`/`suspended`) → `member`; `reentryBlocked || withdrawalReason === "expulsion"` → `blocked_forever` (el doble criterio es el de `canReadmit`, `src/lib/members/rules.ts:45` — citarlo en el comentario); `rejectedUntil > now` → `blocked_until`; `pendingFees > 0` → `must_settle` (REG-16: lo que bloquea es la deuda viva, no la marca `debtAtWithdrawal`); si no → `clear`.

- [ ] **Step 1: Test tabla de `reentryVerdict`** (los cinco kinds + el caso `withdrawalReason: "expulsion"` con `reentryBlocked: false` heredado de datos viejos → `blocked_forever` igual). → FAIL → implementar → PASS.
- [ ] **Step 2: `fetchHistoryPage`** con `_count: { select: { fees: { where: { status: "pending" } } } }` para `pendingFees` (verificar que la forma `_count.select.<rel>.where` funciona en Prisma 7 con un test contra el fake; si no, un `groupBy` de fees aparte por página de ids — 50 máximo). Filtro `q` por nombre O DNI (calcar las ramas de `padronWhere`, `query.ts:33-59`). Página de 50 con `paginate`.
- [ ] **Step 3: Página.** `PageHeader title="Histórico"` + bajada "Todas las personas que pasaron por la vecinal, con su recorrido y si pueden reasociarse." Filtros GET (`q`, `status`, `reason` con `SELECT_CLASS` + aria-label). Cards apiladas (una por persona, molde `RequestCard`): nombre + badge de estado; metadatos `DNI · Libro 1 · N° 1 (· Libro 2 · N° 4)` + `ingreso {joinedAt}` (+ `egreso {leftAt} · {REASON_LABELS[reason]}` si baja); y el chip de reingreso: `member` → nada; `blocked_forever` → `Badge variant="destructive"` "No puede reingresar"; `blocked_until` → `Badge variant="outline"` "Puede reintentar desde el {fecha}"; `must_settle` → `Badge variant="outline"` "Debe saldar {n} cuotas para reingresar"; `clear` → `Badge variant="success"` "Puede reasociarse". `PaginationNav` + `EmptyState`.
- [ ] **Step 4: Suite + lint + build + navegador** (buscar a "Castillo" → baja por mora con su verdicto; los 278 pasan por las páginas).
- [ ] **Step 5: Commit** `feat(m6a): historico tab — every person ever, with reentry verdict`

---

### Task 5: La baja cancela las solicitudes pendientes (mejora dirigida) + cierre de fase

**Files:**
- Modify: `src/lib/members/service.ts` (`withdraw`), `docs/07-plan-de-etapas.md` (fase 6A cerrada)
- Test: `tests/member-service.test.ts` (o donde viva la suite del servicio — grep `memberService` en `tests/` y sumar ahí)

**Interfaces:**
- Consumes: la transacción de `withdraw` (`src/lib/members/service.ts:85-141` — leerla entera; el hueco está documentado: "NO toca MemberRequest"); `MemberRequestStatus` (`schema.prisma:144-149`).
- Produces: dentro de la MISMA transacción de la baja, después del `member.update` y antes del `movement.create`:

```ts
// Una baja no deja solicitudes vivas: la bandeja admin mostraría para siempre
// una solicitud inaplicable (canWithdraw/canChangeCategory la rechazan) y el
// socio ya no puede retirarla (requireMember corta al withdrawn).
await tx.memberRequest.updateMany({
  where: { memberId: input.memberId, status: "pending" },
  data: { status: "cancelled", cancelledAt: now },
});
```

- [ ] **Step 1: Test.** Con el fake de tx de la suite existente: una baja con solicitud `pending` la deja `cancelled` con `cancelledAt`; una `accepted` no se toca; el conteo del `updateMany` no afecta el resultado de la baja. → FAIL → implementar → PASS. OJO: `markAccepted` de la baja-por-solicitud (`admin/socios/[id]/actions.ts:190-212`) corre DESPUÉS del commit sobre una solicitud que esta línea acaba de cancelar — verificar el orden real: `markAccepted` usa `updateMany({ status: "pending" })` y devolvería `count: 0` con un `console.error`. La solución: el `updateMany` nuevo EXCLUYE la solicitud que se está aplicando — `withdraw` gana un campo opcional `sparedRequestId?: number` en su input, que la action pasa cuando vino `requestId`. Test para las dos variantes.
- [ ] **Step 2: Suite entera + lint + build.** La suite de `member-requests` y la de actions existentes pasan sin tocar aserciones.
- [ ] **Step 3: Docs.** `docs/07`: sección "Módulo 6 — fase 6A" con lo entregado (estilo de las fases previas). Ledger actualizado.
- [ ] **Step 4: Commit** `feat(m6a): withdrawal cancels pending member requests; phase 6A closed`

---

# FASE 6B — Proceso, wizard público y cartelera

### Task 6: Migración — cuatro tablas, enums, foto de membresía y clave de config

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/config-keys.ts`, `src/lib/members/labels.ts` (labels nuevos al final)
- Create: `prisma/migrations/*` (la genera `prisma migrate dev`), `scripts/seed-holidays.ts`
- Test: `tests/reregistration-labels.test.ts` (chico: todo enum nuevo tiene label)

**Interfaces:**
- Produces (schema — nombres EXACTOS que consumen las tasks 7-19):

```prisma
enum ReregistrationStatus { preparing first_instance second_instance closing closed }
enum PresentationStatus   { pending submitted observed validated rejected withdrawn }
enum PresentationChannel  { web in_person }
enum BoardNoticeKind      { first_instance second_instance withdrawal other }

model ReregistrationProcess {
  id                  Int      @id @default(autoincrement())
  bookId              Int      @map("book_id")
  book                Book     @relation(fields: [bookId], references: [id])
  status              ReregistrationStatus
  calledAt            DateTime @map("called_at")
  firstEndsAt         DateTime @map("first_ends_at")
  secondEndsAt        DateTime? @map("second_ends_at")
  igjApprovedAt       DateTime? @map("igj_approved_at")
  estimatedElectionAt DateTime? @map("estimated_election_at")
  callMinuteId        Int      @map("call_minute_id")
  callMinute          Minute   @relation("ProcessCallMinute", fields: [callMinuteId], references: [id])
  closeMinuteId       Int?     @map("close_minute_id")
  closeMinute         Minute?  @relation("ProcessCloseMinute", fields: [closeMinuteId], references: [id])
  presentations       Presentation[]
  boardNotices        BoardNotice[]
  createdAt           DateTime @default(now()) @map("created_at")
  @@map("reregistration_processes")
}

model Presentation {
  id            Int      @id @default(autoincrement())
  processId     Int      @map("process_id")
  process       ReregistrationProcess @relation(fields: [processId], references: [id])
  memberId      Int      @map("member_id")
  member        Member   @relation(fields: [memberId], references: [id])
  status        PresentationStatus @default(pending)
  channel       PresentationChannel?
  birthDate     DateTime? @map("birth_date")
  civilStatus   String?  @map("civil_status") @db.VarChar(40)
  nationality   String?  @db.VarChar(60)
  occupation    String?  @db.VarChar(80)
  streetId      Int?     @map("street_id")
  street        Street?  @relation(fields: [streetId], references: [id])
  streetText    String?  @map("street_text") @db.VarChar(120)
  streetNumber  String?  @map("street_number") @db.VarChar(10)
  neighborhood  String?  @db.VarChar(60)
  phone         String?  @db.VarChar(40)
  email         String?  @db.VarChar(191)
  resumeTokenHash String? @unique @map("resume_token_hash") @db.Char(64)
  submittedAt   DateTime? @map("submitted_at")
  validatedById Int?     @map("validated_by_id")
  validatedBy   User?    @relation(fields: [validatedById], references: [id], onDelete: SetNull)
  validatedAt   DateTime? @map("validated_at")
  observation   String?  @db.VarChar(500)
  withdrawalNotifiedAt DateTime? @map("withdrawal_notified_at")
  appealUntil   DateTime? @map("appeal_until")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@unique([processId, memberId])
  @@index([processId, status])
  @@map("presentations")
}

model Holiday {
  id    Int      @id @default(autoincrement())
  date  DateTime @unique
  label String   @db.VarChar(80)
  @@map("holidays")
}

model BoardNotice {
  id        Int      @id @default(autoincrement())
  processId Int      @map("process_id")
  process   ReregistrationProcess @relation(fields: [processId], references: [id])
  kind      BoardNoticeKind
  postedAt  DateTime? @map("posted_at")
  dueAt     DateTime? @map("due_at")
  notifications Notification[]
  createdAt DateTime @default(now()) @map("created_at")
  @@map("board_notices")
}
```

Retoques: `Notification` gana `boardNoticeId Int? @map("board_notice_id")` (FK `SetNull`) y el enum `NotificationType` gana `presentation_received` y `presentation_observed` (los `reregistration_first`/`reregistration_second`/`withdrawal_declared` YA existen — verificar en `schema.prisma:96-196` antes de duplicar). `Membership` gana `statusAtClose MemberStatus? @map("status_at_close")` y `categoryAtClose MemberCategory? @map("category_at_close")`. `Member` y `Minute` y `Street` ganan las relaciones inversas que Prisma exija. `CONFIG_KEYS` suma `reempadronamiento_proceso_id` (el nombre en castellano sigue el precedente de `asociate_activo`/`elecciones_en_curso` — las claves de config son datos, no código).

- [ ] **Step 1: Escribir el schema y correr** `npx prisma migrate dev --name reregistration-process`. Revisar el SQL generado (los `ON DELETE` de las FKs nuevas: `Presentation.memberId` RESTRICT — una presentación no debe evaporarse si alguien borra la ficha; `BoardNotice.processId` RESTRICT).
- [ ] **Step 2: Labels.** En `labels.ts` (o un `src/lib/reregistration/labels.ts` nuevo si el archivo se pasa de foco): `PRESENTATION_STATUS_LABELS` (`pending: "Sin presentar"`, `submitted: "Presentada"`, `observed: "Observada"`, `validated: "Validada"`, `rejected: "Rechazada"`, `withdrawn: "Baja declarada"`), `PROCESS_STATUS_LABELS`, `BOARD_NOTICE_KIND_LABELS`. Test chico: cada valor del enum tiene label (calcar el estilo de los tests de labels si existen; si no, `Object.keys` contra los arrays de Prisma).
- [ ] **Step 3: `scripts/seed-holidays.ts`.** Con el molde de cabecera de `scripts/import-deuda.ts:26-28` (`import "dotenv/config"` primero). Feriados nacionales argentinos fijos e irrenunciables 2026 y 2027 (cargar la lista oficial conocida: 01/01, 24/02-25/02 (carnaval 2026: 16-17/02; 2027: 08-09/02 — VERIFICAR contra el calendario oficial y dejar la fuente en el comentario), 24/03, 02/04, 01/05, 25/05, 20/06, 09/07, 17/08 (trasladable), 12/10 (trasladable), 20/11 (trasladable), 08/12, 25/12). Guardar al **mediodía UTC del día civil argentino** (el criterio de `fee_values` — `civilDayOf` en `src/lib/treasury/periods.ts`; importar la fecha-helper, no copiarla). Idempotente por `date` unique (`skipDuplicates`). Los trasladables cambian por decreto: el ABM admin (Task 13) existe justamente para corregirlos.
- [ ] **Step 4: Suite + lint + build; Commit** `feat(m6b): reregistration schema — process, presentations, holidays, board notices`

---

### Task 7: Dominio puro — plazos, cohorte, identificación, transiciones y días hábiles

**Files:**
- Create: `src/lib/reregistration/rules.ts`, `src/lib/board/business-days.ts`
- Test: `tests/reregistration-rules.test.ts`, `tests/board-business-days.test.ts`

**Interfaces:**
- Consumes: nada con Prisma — TODO puro. `civilDayOf`/helpers de fechas: mirar `src/lib/treasury/periods.ts` y `src/lib/dates.ts` y reutilizar lo que ya exporte (verificar nombres reales).
- Produces:

```ts
// src/lib/reregistration/rules.ts
export const FIRST_INSTANCE_DAYS = 30;   // corridos (decisión 2)
export const SECOND_INSTANCE_DAYS = 10;
export const APPEAL_DAYS = 30;
export function firstEndsAt(calledAt: Date): Date;       // +30 días corridos
export function secondEndsAt(startedAt: Date): Date;     // +10
export function appealUntil(notifiedAt: Date): Date;     // +30

/** Cohorte del proceso: adherentes vigentes al activar (decisión 12: los
 *  suspendidos participan). */
export function isCohortMember(m: { category: MemberCategory; status: MemberStatus }): boolean;

/** Paso 1 del wizard. El caller busca por DNI y pasa lo hallado (o null). */
export type LookupVerdict =
  | { kind: "eligible"; memberId: number; maskedName: string }
  | { kind: "not_found" };   // un solo veredicto negativo: el cartel es genérico a propósito
export function lookupVerdict(input: {
  member: { id: number; fullName: string; category: MemberCategory; status: MemberStatus } | null;
  presentation: { status: PresentationStatus } | null;  // la fila de cohorte, si existe
}): LookupVerdict | { kind: "already_submitted" };
// eligible ⟺ hay ficha + es cohortado vigente + hay fila de cohorte con status
// pending u observed. submitted/validated → already_submitted (pantalla de
// estado). rejected/withdrawn, no cohortado, baja, DNI inexistente → not_found.

/** "Castillo Nestor" (formato del padrón: Apellido Nombre) → "N***** C." */
export function maskedName(fullName: string): string;

export function canStartSecond(p: { status: ReregistrationStatus }): boolean;   // first_instance
export function canPrepareClose(p: { status: ReregistrationStatus; secondEndsAt: Date | null }): boolean; // second_instance
export function wizardOpen(p: { status: ReregistrationStatus } | null): boolean; // first_instance | second_instance
```

```ts
// src/lib/board/business-days.ts
/** Fin del plazo de cartelera: n días HÁBILES (lun-vie menos feriados)
 *  contados desde el día siguiente a la fijación. Puro; los feriados se
 *  inyectan como fechas civiles (mediodía UTC, criterio fee_values). */
export const BOARD_BUSINESS_DAYS = 20;
export function businessDayEnd(postedAt: Date, days: number, holidays: Date[]): Date;
```

- [ ] **Step 1: Tests tabla, TODO primero.** `firstEndsAt`/`appealUntil` (cruce de mes y de año); `maskedName` ("Castillo Nestor" → "N***** C."; "Perez Gomez Maria Ana" → primera palabra = apellido: "M**** A** P." — decidir y FIJAR en el test: nombres = todas las palabras menos la primera, cada nombre conserva su inicial y enmascara el resto, apellido = inicial de la primera palabra + "."; nombre de una sola palabra → "C." solo); `lookupVerdict` (las 8 filas: eligible pending, eligible observed, submitted, validated, rejected, withdrawn-presentation, no ficha, ficha no cohortada); `businessDayEnd` (fijación viernes → arranca lunes; feriado en el medio corre el fin; 20 hábiles con 2 feriados = 30 corridos aprox — casos con fechas concretas de 2026). → FAIL → implementar → PASS.
- [ ] **Step 2: Commit** `feat(m6b): pure reregistration rules and business-day arithmetic`

---

### Task 8: Servicio del proceso — activar, 2ª instancia, contadores

**Files:**
- Create: `src/lib/reregistration/service.ts`
- Modify: `src/lib/email/templates.ts` (dos plantillas al final)
- Test: `tests/reregistration-service.test.ts`

**Interfaces:**
- Consumes: `rules.ts` (Task 7); `mailer.sendToMember` — firma real `{ memberId, to, type, message, summary, period? }` (`src/lib/email/index.ts:83-92`); `makeMailBudget`/`MAIL_BATCH_CAP` (`src/lib/email/batch-cap.ts` — verificar los exports reales); `configReader` + `revalidateTag`/`revalidatePath` (mirar cómo invalida `getAsociateActive` — grep `revalidateTag` en `src/lib/config.ts` y calcar); `resolveMinuteId`/`discardUnusedMinute` (`src/lib/members/minute-form.ts`) — los usa la ACTION, no el servicio (patrón `runAction`).
- Produces `makeReregistration(deps)` + singleton `reregistration` con `deps = { db, mailer, now? }`:

```ts
activate(input: { bookId: number; calledAt: Date; minuteId: number;
  igjApprovedAt: Date | null; estimatedElectionAt: Date | null; actorId: number }):
  Promise<{ ok: true; processId: number; cohortSize: number; emailed: number; boardCount: number }
        | { ok: false; error: string }>
// Transacción: (1) guarda: ningún proceso preparing/first/second/closing vivo;
// (2) process create (status first_instance, firstEndsAt = rules);
// (3) cohorte: member.findMany({ category: "adherent", status: { in: ["active","suspended"] } })
//     → presentation.createMany (pending);
// (4) configuration upsert reempadronamiento_proceso_id.
// POST-COMMIT (nunca adentro): emails de convocatoria a cohortados con email
// utilizable (email && emailStatus !== "bounced"), con MailBudget; y UN
// BoardNotice kind first_instance + notification.createMany (via: "board",
// type: "reregistration_first", boardNoticeId, status: "posted_board" NO —
// ver Task 13: las filas board nacen SIN boardFrom/boardTo y el estado
// "posted_board" se escribe recién al asentar la fijación; hasta entonces la
// fila registra el deber de notificar. Revisar los valores reales del enum
// NotificationStatus y elegir el neutro que exista ("sent" NO es: usar la fila
// sin status válido es imposible — crear las filas board recién AL ASENTAR la
// fijación, y hasta entonces el aviso lista sus destinatarios desde la cohorte:
// ES LA OPCIÓN CORRECTA y la que implementa la Task 13).
// Por lo tanto acá: solo el BoardNotice (sin postedAt) — sin filas Notification.

startSecond(input: { processId: number; actorId: number; force: boolean }): Promise<...>
// Guarda canStartSecond + (vencida || force). Fija status second_instance y
// secondEndsAt. Post-commit: emails reregistration_second a cohortados SIN
// presentación submitted/validated que tengan email utilizable + BoardNotice
// kind second_instance para los demás.

counters(processId: number): Promise<{ byStatus: Record<PresentationStatus, number>;
  cohortSize: number; daysLeft: number | null }>
```

Plantillas nuevas en `templates.ts` (mismo estilo `layout()`/`button()`/`esc()`): `reregistrationCallEmail({ url, firstEndsAt })` ("La vecinal convocó el re-empadronamiento de socios adherentes… tenés tiempo hasta el {fecha}"), `reregistrationSecondEmail({ url, secondEndsAt })` (el texto del apercibimiento: "…bajo apercibimiento de baja (Art. 9° bis del estatuto)"). Ambas con el link a `/reempadronate`.

- [ ] **Step 1: Tests con deps fakes** (patrón de inyección de los servicios existentes — mirar `tests/reregistration-*` no existe: calcar el andamiaje de `tests/member-debit.test.ts`): `activate` con proceso vivo → error sin escribir; cohorte = solo adherentes active/suspended (un activo y un withdrawn en el fake NO entran); los emails salen solo a casillas utilizables y el `BoardNotice` nace sin `postedAt`; `startSecond` sin vencer y sin force → error; con force → ok; los correos de 2ª van SOLO a los no presentados. → FAIL → implementar → PASS.
- [ ] **Step 2: Commit** `feat(m6b): reregistration service — activation, cohort, second instance`

---

### Task 9: Sección `/admin/reempadronamiento` — nav, convocatoria y tablero

**Files:**
- Modify: `src/lib/admin/nav.ts` (+ítem en Gestión), `src/lib/admin/dashboard-cards.ts` (+tarjeta), `src/components/admin/admin-nav-list.tsx` (+ícono al mapa)
- Create: `src/app/admin/reempadronamiento/page.tsx`, `src/app/admin/reempadronamiento/convocar/page.tsx`, `src/app/admin/reempadronamiento/convocar/actions.ts`, `src/app/admin/reempadronamiento/process-stepper.tsx`
- Test: los existentes `tests/admin-nav.test.ts` y `tests/dashboard-cards.test.ts` OBLIGAN la sincronía (correrlos y ajustar lo que pidan); `tests/reregistration-actions.test.ts` (nuevo)

**Interfaces:**
- Consumes: `AdminNavIcon` es una union de strings (`nav.ts:6-8`) — sumar `"clipboard-check"` y mapearlo a `ClipboardCheck` en `admin-nav-list.tsx:14-25`; `requireSuperadmin` (`src/lib/auth/require-admin.ts` — verificar el export real); `MinutePicker`/`minuteSelectionSchema`/`resolveMinuteId`/`discardUnusedMinute` (el patrón acta-huérfana completo está en `src/app/admin/socios/[id]/actions.ts:6-26` y `89-172` — leerlo antes); `reregistration.activate` (Task 8); `HealthVerdict`/`Section` de `src/app/admin/salud/health-panels.tsx:53-120` como referencia visual del tablero.
- Produces: la ruta con sus tres estados (sin proceso / activo / historial) y `ProcessStepper({ process, counters })` (client, presentacional puro — recibe todo por props para que el test de pantalla lo renderice con `renderToStaticMarkup`, precedente `tests/admin-health-screen.test.ts`).

- [ ] **Step 1: Nav + tarjeta.** `ADMIN_NAV` grupo Gestión, entre Solicitudes y Socios: `{ href: "/admin/reempadronamiento", label: "Reempadronamiento", icon: "clipboard-check" }` (NO `superadminOnly`: validar es de admin; las actions de convocar/cerrar cortan solas). `DASHBOARD_GROUPS`: tarjeta con descripción "Proceso de depuración de adherentes y cierre de libro (Art. 9° bis)". Correr los dos tests de sincronía y dejarlos verdes.
- [ ] **Step 2: Página principal.** `requireAdmin()` propio (muestra nombres). Tres ramas: **(a) sin proceso vivo**: `PageHeader title="Reempadronamiento"`, `EmptyState size="list"` "No hay ningún proceso en curso. La convocatoria abre la depuración de adherentes del libro vigente." con action "Convocar proceso" (link visible solo si el actor es superadmin — display; la ruta corta igual) + debajo, si hay procesos `closed`, una Card "Procesos anteriores" (número de libro, fechas, resultado en una línea). **(b) proceso vivo**: el tablero — `ProcessStepper` (los 5 estados con fechas: convocado {calledAt} → 1ª instancia hasta {firstEndsAt} → 2ª hasta {secondEndsAt} → cierre → cerrado; el vigente resaltado con `text-primary font-semibold`, los días restantes en `font-mono tabular-nums`; en móvil el stepper apila vertical), chips de contadores por estado (link a la cola de la Task 11 con `?estado=`), la fila de avisos de cartelera (la monta la Task 13 — dejar el hueco con un comentario TODO-de-task, no de código), y las acciones de fase: "Iniciar 2ª instancia" (form → action de la Task 9 Step 4; deshabilitada antes de `firstEndsAt` salvo confirm de force — un checkbox "Iniciar antes de tiempo" que exige tilde explícito), "Preparar cierre" (link a la 6C; deshabilitado hasta `canPrepareClose`).
- [ ] **Step 3: Convocatoria.** `/admin/reempadronamiento/convocar`: `requireSuperadmin` en página Y action. Form (`max-w-2xl`, molde `socios/nuevo/page.tsx`): fecha de convocatoria (default hoy), `MinutePicker` (acta de convocatoria), fecha de oficialización IGJ (opcional, con ayuda "para la cuenta regresiva de 90 días del Art. 40"), fecha estimada de elecciones (opcional, ayuda "solo informativa"). Aviso previo `FormMessage kind="warning" box` con el conteo vivo de solicitudes de alta abiertas (`application.count({ where: { status: { in: LIVE_APPLICATION_STATUSES } } })` — import de `src/lib/applications/service.ts`): "Hay {n} solicitudes de alta en curso. ASOCIATE queda suspendido al convocar; rechazalas a mano desde Solicitudes (docs/05 §2)."
- [ ] **Step 4: Actions.** `callProcessAction`: `requireSuperadmin` → `parseForm` + `minuteSelectionSchema` aparte (es union — precedente `actions.ts:120-124`) → `resolveMinuteId` → `reregistration.activate(...)` → si falla, `discardUnusedMinute` → `audit({ action: "reregistration_call", entity: "reregistration_process", entityId, detail: { bookId, cohortSize, emailed, boardCount, minuteId } })` → `revalidatePath("/admin/reempadronamiento")` + invalidar el caché de la home/ASOCIATE (el tag que use `getAsociateActive` — grep en `src/lib/config.ts`) → redirect al tablero. `startSecondAction`: `requireSuperadmin` → zod `{ force: z.coerce.boolean() }` → `reregistration.startSecond` → audit `reregistration_second` → revalidate.
- [ ] **Step 5: Tests de actions** (mock de `requireSuperadmin` y del servicio): actor admin-no-super no llega al servicio; el acta huérfana se descarta si `activate` falla; el detail del asiento no lleva nombres. Test de pantalla del stepper (`renderToStaticMarkup`: proceso en 1ª muestra los días restantes y el paso activo).
- [ ] **Step 6: Suite + lint + build + navegador** (convocar en local con un acta nueva: cohorte 124, tablero con stepper). **Commit** `feat(m6b): reempadronamiento section — nav, call screen and process board`

---

### Task 10: Wizard REEMPADRONATE — identificación y esqueleto

**Files:**
- Create: `src/app/(public)/reempadronate/page.tsx`, `src/app/(public)/reempadronate/reempadronate-wizard.tsx`, `src/app/(public)/reempadronate/actions.ts` (la de lookup en esta task; las demás en la 11), `src/app/(public)/reempadronate/wizard-shared.ts`
- Modify: `src/lib/auth/rate-limiter.ts` (dos singletons nuevos al final)
- Test: `tests/reempadronate-lookup.test.ts`

**Interfaces:**
- Consumes: TODO el andamiaje de ASOCIATE como molde — leer antes: `asociate/page.tsx` (carga de calles + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`), `asociate-wizard.tsx` (stepper, foco, `AnsweredTrail`, `history.replaceState`), `wizard-ui.tsx` (`CONTROL_HEIGHT`, `FOCUS_RING`), `blocked-panel.tsx` (pantalla que reemplaza al wizard), el orden de guardas de `createApplicationAction` (`asociate/actions.ts:118-…`: interruptor → rate limit en dos fases `allows`/`record` → Turnstile → zod); `verifyTurnstile` (`src/lib/turnstile.ts`); `lookupVerdict`/`maskedName`/`wizardOpen` (Task 7); `configReader` para `reempadronamiento_proceso_id`.
- Produces: `reregistrationLookupLimiter` (5 / 15 min por IP) y `reregistrationResendLimiter` (3 / h por DNI) en `rate-limiter.ts` (mismo estilo de los singletons existentes, `rate-limiter.ts` los define todos juntos); `lookupAction(prev, formData)`:

```ts
type LookupState =
  | { kind: "idle" }
  | { kind: "eligible"; maskedName: string; presentationToken: string /* ver Task 11 */ }
  | { kind: "already_submitted"; canResend: boolean }
  | { kind: "not_found" }        // el cartel genérico: "Tu DNI no figura…"
  | { kind: "error"; error: string };
```

- [ ] **Step 1: Página y wizard-shell.** `page.tsx`: `dynamic = "force-dynamic"` (depende del proceso vivo), metadata "Re-empadronamiento — Vecinal Ciudadela"; si `!wizardOpen(proceso)` → pantalla estática "No hay un proceso de re-empadronamiento en curso." con link a la home (el botón de la home tampoco se muestra — Task 14). Si está abierto: el wizard con paso 1 solamente (los pasos 2-4 los suma la Task 11): campo DNI (numérico, 7-9 dígitos), Turnstile, botón "Buscar mi ficha" `min-h-12`.
- [ ] **Step 2: `lookupAction`.** Orden de guardas EXACTO del wizard: (1) proceso abierto (`configReader` directo — sin caché, es guarda); (2) `reregistrationLookupLimiter.allows(ip)` sin gastar; (3) `verifyTurnstile`; (4) zod del DNI; (5) `record(ip)`; (6) buscar `member.findUnique({ where: { dni } })` + su `presentation` del proceso → `lookupVerdict`. `eligible` responde `maskedName` + el token de presentación (Task 11 lo acuña; en ESTA task devolver `presentationToken: ""` con un comentario que la 11 lo reemplaza — el paso 2 aún no existe). El asiento `audit({ action: "presentation_lookup" — NO: un lookup anónimo NO se audita (enumeración y ruido; el precedente es que el GET público no audita). Sin auditoría acá.
- [ ] **Step 3: Confirmación enmascarada.** El estado `eligible` renderiza "¿Sos {maskedName}?" con "Sí, soy yo" (avanza al paso 2 — en esta task, un placeholder visible "El formulario se habilita en la próxima tarea" NO: dejar el avance cableado a un paso 2 vacío que la Task 11 llena; el wizard compila y el paso 2 muestra "En construcción" solo si se navega en esta task intermedia — aceptable porque la fase se mergea entera) y "No" (vuelve al DNI). `not_found` → el cartel genérico con la dirección/horarios de la sede (usar `contact_phone`/`contact_email` de config como hace el sitio público — grep quién los lee).
- [ ] **Step 4: Tests** de `lookupAction` con mocks (Turnstile ok/fail, limiter agotado corta ANTES de Turnstile — no: el orden es allows→turnstile→record, verificar contra `asociate/actions.ts` y calcar EXACTO —, DNI de un activo → `not_found`, DNI cohortado pending → `eligible` con el nombre enmascarado y NUNCA el `fullName` completo en la respuesta).
- [ ] **Step 5: Suite + lint + build. Commit** `feat(m6b): reempadronate wizard — dni lookup with masked-name confirmation`

---

### Task 11: Wizard REEMPADRONATE — datos, documentos, jurada, retorno y subsanación

**Files:**
- Modify: `src/app/(public)/reempadronate/actions.ts`, `src/app/(public)/reempadronate/reempadronate-wizard.tsx`
- Create: `src/app/(public)/reempadronate/step-data.tsx`, `src/app/(public)/reempadronate/step-documents.tsx`, `src/app/(public)/reempadronate/step-oath.tsx`, `src/app/(public)/reempadronate/retomar/[token]/page.tsx`, `src/lib/reregistration/presentation.ts`
- Modify: `src/lib/documents/storage.ts` (agregado: `savePresentationDocument`), `src/lib/email/templates.ts` (constancia + observación)
- Test: `tests/reregistration-presentation.test.ts`

**Interfaces:**
- Consumes: `asociate/step-personal.tsx` y `step-documents.tsx` como molde (cada ranura de documento con su PROPIO `useActionState` — el porqué documentado: compartirlo se tragaba clics); `StreetPicker` + `searchStreets`; `saveApplicationDocument` como molde del agregado (`src/lib/documents/storage.ts` — mismos magic bytes, `MAX_DOCUMENT_BYTES`, destino `UPLOADS_DIR/presentations/<id>/`, reemplazo salvo `annex`); el patrón de token de retome de Application: `mintResumeToken`/`commitResumeToken` (`src/lib/applications/service.ts` — acuñar → enviar → persistir, NUNCA al revés) y `hashToken` (`src/lib/tokens.ts`); `mailer.sendToMember` (la constancia va a la casilla DECLARADA en la presentación aunque la ficha no la tenga — `sendToMember` acepta `to` explícito: verificar la firma en `email/index.ts:83-92`); `requiredDocsComplete` NO sirve tal cual (es por categoría de alta): definir la regla propia en `presentation.ts`.
- Produces (`src/lib/reregistration/presentation.ts`, db inyectada):

```ts
export const PRESENTATION_MAX_ANNEXES = 2;
export function presentationDocsComplete(docs: Array<{ type: string }>): boolean; // dni_front && dni_back

makePresentations(deps) → presentations:
  claim(input: { presentationId: number }): Promise<{ raw: string }>
  // Rota el resumeTokenHash (mint→…→commit lo maneja el flujo del caller para
  // el email; para la URL del wizard el token se devuelve crudo y se persiste
  // ya — acá el "buzón" es la sesión del navegador que acaba de pasar el DNI:
  // el riesgo aceptado y documentado de la decisión 8).
  saveData(input: { token: string; data: PresentationData }): Promise<ok|error>
  // token → hash → fila con status pending|observed; valida zod afuera (action).
  submit(input: { token: string }): Promise<{ ok: true; memberId: number } | { ok: false; error: string }>
  // Exige datos completos + presentationDocsComplete + email presente.
  // status → submitted, submittedAt = now. Idempotente ante doble clic
  // (updateMany con status in [pending, observed]).
  findByToken(token: string): Promise<PresentationView | null>   // para /retomar
```

- [ ] **Step 1: Tests del módulo puro** (fake db): `claim` rota el hash (dos claims → hashes distintos, el viejo deja de encontrar); `submit` sin docs → error; `submit` sin email → error; doble `submit` → el segundo devuelve ok idempotente sin pisar `submittedAt`; `saveData` sobre `validated` → error. → FAIL → implementar → PASS.
- [ ] **Step 2: `savePresentationDocument`.** En `storage.ts`, junto a `saveApplicationDocument` y con su misma forma (sniff por magic bytes, límite, reemplazo salvo `annex`, `ownerType: "presentation"`). Tipos de documento: `dni_front`, `dni_back`, `annex` (verificar los literales que usa Application en el schema/`documents-rules.ts` y REUSAR los mismos strings).
- [ ] **Step 3: Los pasos del wizard.** `step-data.tsx`: los campos de la spec §5.2 (nacimiento, estado civil — select con las opciones que use el alta admin (`carga-form.tsx`), nacionalidad, ocupación, `StreetPicker` + altura + barrio, teléfono, email con ayuda "Va a ser tu domicilio electrónico: la vecinal te notifica ahí"). **Precarga: SOLO el email si la ficha lo tenía** (viaja en el estado del lookup — agregarlo al `LookupState.eligible`). `step-documents.tsx`: tres ranuras (frente, dorso, anexos hasta 2) con la ayuda del criterio del Art. 5.3: "factura de servicios **a tu nombre** o certificado policial de domicilio". `step-oath.tsx`: declaración jurada (checkbox con el texto + resumen de lo cargado) → enviar. **NINGÚN paso de pago** (constraint global). Actions: `savePresentationDataAction` (Turnstile NO — el token de presentación ES la barrera, precedente `/acceso/[token]` en CLAUDE.md; rate limit `publicTokenLimiter` en los POST con token), `uploadPresentationDocumentAction`, `submitPresentationAction` (constancia post-commit: `presentation_received` con el link `/reempadronate/retomar/{token}` — mint→enviar→commit para ROTAR el token que viajó por URL durante la sesión, así el link del correo es el único vivo).
- [ ] **Step 4: `/reempadronate/retomar/[token]`.** `dynamic = "force-dynamic"`, `robots: noindex,nofollow` (+ entrada en `robots.txt` si ASOCIATE la tiene — grep `retomar` en `src/app/robots.ts` o donde viva). GET sin efectos (`findByToken`): `submitted` → pantalla de estado; `observed` → el wizard rehidratado CON los datos propios (con token sí se precarga — spec §5.4) y la nota de observación visible en un `FormMessage kind="warning" box`; `validated` → "Tu re-empadronamiento quedó validado el {fecha}."; token muerto → cartel genérico con reenvío (ver Step 5). Con el proceso fuera de 1ª/2ª → solo lectura del estado (el wizard no edita).
- [ ] **Step 5: Reenvío del enlace.** En la pantalla `already_submitted` del paso 1 (y en el token muerto): form con Turnstile + `reregistrationResendLimiter` por DNI → rota el token (mint→enviar→commit) al email DE LA PRESENTACIÓN (nunca mostrado entero: "te lo mandamos a m•••@•••"). Molde: `resendResumeLinkAction` de ASOCIATE.
- [ ] **Step 6: Plantillas.** `presentationReceivedEmail({ url })` (constancia con fecha y hora — es la prueba del plazo del socio) y `presentationObservedEmail({ url, observation })`.
- [ ] **Step 7: QA navegador local completo**: DNI de un adherente de prueba → confirmar nombre → cargar datos → subir DNI (imagen de prueba) → jurada → constancia en consola (transporte consola en dev) → reabrir por el link → estado. Un DNI de un socio activo → cartel genérico. 375px sin desborde. Suite + lint + build.
- [ ] **Step 8: Commit** `feat(m6b): reempadronate wizard — data, documents, oath, resume and amend`

---

### Task 12: Validación admin — cola, visor con auditoría, presencial

**Files:**
- Create: `src/app/admin/reempadronamiento/presentaciones/page.tsx`, `src/app/admin/reempadronamiento/presentaciones/[id]/page.tsx`, `src/app/admin/reempadronamiento/presentaciones/[id]/actions.ts`, `src/app/admin/reempadronamiento/presencial/page.tsx`, `src/app/admin/reempadronamiento/presencial/actions.ts`, `src/app/api/admin/reempadronamiento/presentaciones/[id]/documentos/[docId]/route.ts`
- Modify: `src/lib/reregistration/presentation.ts` (decisiones), `src/lib/members/write.ts` NO se modifica (solo se consume)
- Test: `tests/presentation-decisions.test.ts`

**Interfaces:**
- Consumes: la cola de `/admin/solicitudes/socios` como molde de pantalla (`page.tsx:117-257`: segmentos, cards, `EmptyState`); el visor y la ruta de documentos de solicitudes como molde EXACTO (`src/app/admin/solicitudes/[id]/document-viewer.tsx` y `src/app/api/admin/solicitudes/[id]/documentos/[docId]/route.ts:104-114` — `requireAdmin`, filtro por owner, `inline`, `no-store, private`, `nosniff`, CSP `default-src 'none'; sandbox`, asiento por vista); `memberWriter.updateMember` (`src/lib/members/write.ts` — devuelve `{ member, revokedTokens, accountEmailMove, accountEmailUpdated }` y lanza `MemberEmailConflictError`); el disparo de verificación de email: mirar cómo lo hace el modo carga (`src/app/admin/socios/carga/[numero]/actions.ts` + `verificationTarget` de `card-edit.ts`) y calcar; `member-search` de tesorería como molde del buscador presencial (`src/lib/treasury/member-search.ts` — NO modificarlo: escribir la variante cohortada en `presentation.ts`).
- Produces (agregados a `presentations`):

```ts
validate(input: { presentationId: number; actorId: number }): Promise<
  | { ok: true; memberId: number; applied: string[] /* campos que cambiaron */ }
  | { ok: false; error: string }>
// Transacción: presentation updateMany (status submitted → validated, cerrojo
// contra dos admins) + memberWriter.updateMember con los datos declarados
// (streetId/streetText, streetNumber, neighborhood, phone, email, birthDate,
// civilStatus, nationality, occupation). El email nuevo dispara verificación
// REG-08 post-commit (best-effort). MemberEmailConflictError → error operable:
// "Ese email ya es el acceso de otra cuenta: resolvelo desde la ficha."
observe(input: { presentationId: number; actorId: number; note: string }): Promise<ok|error>
// submitted → observed + observation. Post-commit: email de observación con el
// link (rota token: mint→enviar→commit).
reject(input: { presentationId: number; actorId: number; note?: string }): Promise<ok|error>
unreject(input: { presentationId: number; actorId: number }): Promise<ok|error>  // rejected → observed
registerInPerson(input: { memberId: number; actorId: number; data: PresentationData;
  /* docs suben con las mismas actions de upload, autenticadas por admin */ }): Promise<ok|error>
// pending|observed → submitted con channel in_person. Email obligatorio (zod).
```

- [ ] **Step 1: Tests de decisiones** (fake db + fake writer): `validate` aplica a la ficha exactamente los campos declarados y ninguno más (el nombre NUNCA viaja); el cerrojo `updateMany` con `count: 0` → error "otro admin ya decidió"; `observe` sin nota → error; `registerInPerson` sin email → error. → FAIL → implementar → PASS.
- [ ] **Step 2: Cola.** `?estado=` chips (Pendientes = `submitted` default | Sin presentar = `pending` | Observadas | Resueltas = `validated|rejected|withdrawn`), cards con: nombre (link al detalle), N° de socio del libro en depuración, canal (`Globe` web / `Building` presencial — íconos con sr-only), `submittedAt`, badge de estado. Orden: `submittedAt asc` (cola). La vista "Sin presentar" lista la cohorte pendiente con su estado de notificación (email enviado / en aviso de cartelera) — es la lista de trabajo para el teléfono.
- [ ] **Step 3: Detalle.** `PageHeader` con el NOMBRE en el `<h1>` (convención: la entidad al título) y miga "Presentación". Dos columnas `md:grid-cols-2`: Card "Datos declarados" (los campos de la presentación) y Card "Ficha actual" (los mismos campos según `Member` HOY, para comparar de un vistazo — los que difieren con `font-semibold`); Card "Documentos" `md:col-span-2` con el visor embebido; Card "Decisión": Validar (primario), Observar (`<details>` con `TextareaField` máx 500), Rechazar (`<details>`, `variant="destructive"`), y en `rejected`: "Volver a observada". Las actions auditan: `presentation_validate` (detail `{ presentationId, memberId, applied }`), `_observe`, `_reject`, `_unreject` — nunca la nota ni datos personales.
- [ ] **Step 4: Ruta de documentos + visor.** Calcados de solicitudes; asiento `presentation_document_view` por cada vista.
- [ ] **Step 5: Presencial.** `/admin/reempadronamiento/presencial`: buscador de cohortados (nombre/DNI/N° — variante propia en `presentation.ts` que filtra por el proceso), al elegir → el mismo form de datos (reusar `synced-fields`: `TextField`/`SelectField` — deuda conocida del panel, acá se nace bien) + ranuras de documentos + "Registrar presentación". Audita `presentation_submit` con `channel: "in_person"`.
- [ ] **Step 6: QA navegador**: presentar por web (Task 11) → validar → la ficha quedó actualizada y el email disparó verificación; observar → el socio reabre por el link y ve la nota; presencial completo. Suite + lint + build.
- [ ] **Step 7: Commit** `feat(m6b): presentation review queue, audited document viewer and in-person intake`

---

### Task 13: Cartelera — avisos por lotes, PDF, feriados ABM

**Files:**
- Create: `src/app/admin/reempadronamiento/avisos/actions.ts`, `src/app/admin/reempadronamiento/avisos/board-notice-card.tsx`, `src/app/api/admin/reempadronamiento/avisos/[id]/pdf/route.ts`, `src/lib/board/notice.ts`
- Modify: `src/app/admin/reempadronamiento/page.tsx` (la fila de avisos del tablero), `src/app/admin/configuracion/page.tsx` + actions (sección Feriados)
- Test: `tests/board-notice.test.ts`

**Interfaces:**
- Consumes: `businessDayEnd`/`BOARD_BUSINESS_DAYS` (Task 7); pdf-lib con el molde del PDF de recibos (`grep -l "pdf-lib" src/lib` → leer el generador de recibos para fuentes/layout y calcar el estilo institucional); la sección de configuración existente (`src/app/admin/configuracion/` — leer cómo organiza sus forms por bloque y sumar "Feriados" como un bloque más, superadmin como el resto de la pantalla).
- Produces (`src/lib/board/notice.ts`, db inyectada):

```ts
/** Destinatarios de un aviso: cohortados alcanzados por `kind` SIN casilla
 *  utilizable (sin email o bounced) al momento de armarlo. */
listRecipients(input: { processId: number; kind: BoardNoticeKind }): Promise<Array<{ memberId: number; memberNumber: number | null; fullName: string }>>
post(input: { noticeId: number; postedAt: Date; actorId: number; holidays: Date[] }): Promise<
  | { ok: true; dueAt: Date; stamped: number }
  | { ok: false; error: string }>
// Transacción: notice.updateMany({ id, postedAt: null } → postedAt, dueAt =
// businessDayEnd(postedAt, 20, holidays)) — cerrojo contra doble asentado — y
// notification.createMany: UNA fila por destinatario { memberId, type (según
// kind), via: "board", status: "posted_board", boardNoticeId, boardFrom:
// postedAt, boardTo: dueAt }. Las filas nacen ACÁ, al fijar: antes del
// asentado el aviso lista destinatarios calculados en vivo, no filas.
```

- [ ] **Step 1: Tests** (fake db): `post` dos veces → la segunda falla por el cerrojo; `dueAt` sale de `businessDayEnd` con los feriados inyectados; las filas creadas llevan el tipo correcto por kind (`first_instance → reregistration_first`, `second → reregistration_second`, `withdrawal → withdrawal_declared`). → FAIL → implementar → PASS.
- [ ] **Step 2: Tarjeta del aviso en el tablero.** Por cada `BoardNotice` del proceso: sin `postedAt` → "Aviso de {kind} · {n} destinatarios · [Imprimir PDF] · [Asentar fijación]" (el asentado con date input default hoy + confirm); con `postedAt` → "fijado {fecha} · fehaciente el {dueAt}" y el derivado `now >= dueAt` → badge success "Cumplido" (derivado en pantalla, sin cron — spec §8). El PDF SIEMPRE disponible.
- [ ] **Step 3: PDF.** Route `GET .../avisos/[id]/pdf`: `requireAdmin`, pdf-lib: membrete (nombre de la asociación, "Aviso de cartelera — {label del kind}"), el texto estatutario del aviso (por kind: convocatoria / apercibimiento / baja declarada con mención del recurso), la tabla de destinatarios (N° y nombre — SIN DNI: va a estar pegado en una cartelera pública), pie con "Fijado el ____ / Retirado el ____" para completar a mano. `Content-Disposition: inline`, `no-store`.
- [ ] **Step 4: Feriados.** Bloque en `/admin/configuracion` (superadmin, como el resto): lista de feriados futuros con borrar, y form de alta (fecha + etiqueta). Server actions con `requireSuperadmin` + audit `holiday_create`/`holiday_delete`.
- [ ] **Step 5: El caso del rebote posterior.** En la cola "Sin presentar" (Task 12 Step 2), un cohortado cuyo email pasó a `bounced` DESPUÉS del envío masivo muestra el chip "pasar a cartelera" → action que lo suma a un `BoardNotice kind: "other"` abierto del proceso (o lo crea). Test del flujo en el módulo (`listRecipients` para `other` = los marcados).
- [ ] **Step 6: QA navegador**: convocar en local → el aviso de 1ª lista ~100 destinatarios → PDF imprimible → asentar fijación → fehaciente el {fecha con hábiles}. Suite + lint + build.
- [ ] **Step 7: Commit** `feat(m6b): board notices in batches — printable pdf, business-day terms, holidays admin`

---

### Task 14: Sitio público y `/mi` — botón, suspensión de ASOCIATE, banner; cierre de fase 6B

**Files:**
- Modify: `src/app/(public)/page.tsx` (el botón REEMPADRONATE — el comentario placeholder está en la línea ~114), `src/app/(public)/asociate/page.tsx` + `asociate/actions.ts` (guarda 0), `src/app/mi/page.tsx` (banner), `docs/07-plan-de-etapas.md`
- Test: los que cubran la home/asociate si existen (grep); `tests/reempadronate-lookup.test.ts` gana el caso "ASOCIATE suspendido"

**Interfaces:**
- Consumes: la guarda 0 de `createApplicationAction` (`asociate/actions.ts:118-126` — su comentario anticipa EXACTAMENTE esto: "es el que suspende ASOCIATE durante el re-empadronamiento (M6)"); `wizardOpen` (Task 7); el caché de la home (`revalidate = 3600` en `asociate/page.tsx` — el proceso se activa con revalidación explícita, Task 9 Step 4 ya la hizo: verificar acá que llega).

- [ ] **Step 1: Home.** El botón REEMPADRONATE aparece con proceso en 1ª/2ª (link a `/reempadronate`, mismo protagonismo visual que ASOCIATE); ASOCIATE se muestra deshabilitado con el banner "Las asociaciones están suspendidas temporalmente durante el proceso de re-empadronamiento (hasta el {secondEndsAt ?? firstEndsAt})". La home es cacheada: leer el proceso con el mismo mecanismo cacheado-por-tag de `getAsociateActive` (sumar un `getActiveReregistration()` en `src/lib/config.ts` con su tag, invalidado por las actions de la Task 9 y la 17).
- [ ] **Step 2: ASOCIATE.** `asociate/page.tsx` muestra el mismo bloqueo (pantalla completa, molde del interruptor apagado que ya tiene); la guarda 0 de `createApplicationAction` suma el corte por `reempadronamiento_proceso_id` (lectura directa sin caché — es guarda).
- [ ] **Step 3: `/mi`.** En `mi/page.tsx`: si el socio logueado es cohortado con presentación `pending` u `observed`, una Card destacada "Re-empadronate" (ícono `ClipboardCheck`, texto con la fecha límite vigente, link CTA al wizard público). Consulta liviana (`presentation.findFirst` del proceso vivo).
- [ ] **Step 4: QA de la fase entera en navegador** (el CA parcial 6B): convocar → home cambia → wizard completo por web → validar → observar/subsanar → presencial → 2ª instancia (con force) → avisos de cartelera fijados. Suite + lint + build.
- [ ] **Step 5: Docs.** `docs/07`: fase 6B con lo entregado. Ledger.
- [ ] **Step 6: Commit** `feat(m6b): public entry points and asociate suspension; phase 6B closed`

---

# FASE 6C — Cierre de libro

### Task 15: Dominio del cierre — plan de renumeración y precondiciones (puro)

**Files:**
- Create: `src/lib/reregistration/close.ts`
- Test: `tests/reregistration-close.test.ts`

**Interfaces:**
- Consumes: nada de Prisma — puro.
- Produces:

```ts
/** REG-28: renumeración densa 1..N por antigüedad. */
export function planMigration(members: Array<{
  memberId: number; joinedAt: Date; oldNumber: number;
  status: MemberStatus; category: MemberCategory;
}>): Array<{ memberId: number; oldNumber: number; newNumber: number }>;
// Orden: joinedAt asc; empate → oldNumber asc. Entran los que el CALLER ya
// filtró (vigentes). newNumber = índice+1: denso, sin huecos.

export type ClosePrecondition =
  | { kind: "unresolved_presentations"; count: number }   // submitted|observed vivas → BLOQUEA
  | { kind: "cohort_not_terminal"; count: number }        // adherentes vigentes de la cohorte sin validated → BLOQUEA (falta declarar bajas)
  | { kind: "arrears_candidates"; count: number }         // cesanteables por mora HOY → ADVIERTE (decisión 1)
  | { kind: "board_in_progress"; count: number };         // avisos sin cumplir → contexto
export function closeBlockers(pre: ClosePrecondition[]): ClosePrecondition[];  // solo los que bloquean
```

- [ ] **Step 1: Tests tabla** de `planMigration`: orden por antigüedad; empate resuelto por número viejo; densidad 1..N; lista vacía → vacía; el socio 306 con `joinedAt` reciente cae al final. `closeBlockers`: solo los dos primeros kinds bloquean. → FAIL → implementar → PASS.
- [ ] **Step 2: Commit** `feat(m6c): pure migration plan and close preconditions`

---

### Task 16: Etapa A + Etapa B — checklist, borrador de acta y bajas en lotes

**Files:**
- Create: `src/app/admin/reempadronamiento/cierre/page.tsx` (checklist + bajas), `src/app/admin/reempadronamiento/cierre/actions.ts`, `src/lib/reregistration/withdrawals.ts`
- Modify: `src/lib/email/templates.ts` (email de baja), `src/lib/board/notice.ts` (kind `withdrawal` ya soportado — verificar)
- Test: `tests/reregistration-withdrawals.test.ts`

**Interfaces:**
- Consumes: `canPrepareClose` (Task 7); `closeBlockers` (Task 15); el lote REG-34 entero como molde de UX y de límites (`src/app/admin/tesoreria/deudores/actions.ts:75-262` — leerlo: dedupe, tope ANTES del acta, confirmación en dos pasos con huella, per-socio en serie, tres baldes de resultado, `discardUnusedMinute` si `declared === 0`, sin redirect con fallos parciales) y su token de confirmación (`src/lib/treasury/arrears-confirm.ts:32-38` — calcar la técnica en un `reregistration-confirm.ts` propio, NO importar el de tesorería: es de otro dominio); `withdrawWithDebits` (`src/lib/members/withdraw-with-debits.ts` — consumido tal cual, con `reason: "not_reregistered"`); `ARREARS_THRESHOLD` y el conteo de cesanteables: NO importar de treasury — el checklist consulta `fee.count` por socio activo/colaborador vigente con `>= 4` pendientes en una consulta agrupada propia en `withdrawals.ts` (el número 4 se define como constante local `ARREARS_THRESHOLD_MIRROR = 4` con comentario que cita REG-15 y el original en `treasury/rules.ts` — dos dominios, la constante es estatutaria, no de tesorería); `appealUntil` (Task 7); `listRecipients`/`post` (Task 13).
- Produces (`withdrawals.ts`, db inyectada):

```ts
listPendingWithdrawals(processId): Promise<Array<{ presentationId; memberId; fullName;
  memberNumber; status: PresentationStatus;   // pending | observed | rejected
  notices: Array<{ type: string; via: string; at: Date | null }> }>>
// Cohortados AÚN adherentes vigentes sin validated. Los que dejaron de ser
// adherentes vigentes por otro camino salen solos de la lista (spec §3).

declareBatch(input: { processId; presentationIds: number[]; minuteId; actorId }):
  Promise<{ declared: number[]; failures: Array<{ id; error }>; debitFailures: Array<...> }>
// ≤25 por corrida (constante propia, comentario citando el presupuesto Nginx).
// Por socio EN SERIE: withdrawWithDebits.withdraw({ reason: "not_reregistered",
// minuteId, sparedRequestId: undefined }) → presentation update (→ withdrawn)
// → audit reregistration_withdrawal. Los tres baldes del molde REG-34.

notifyWithdrawal(input: { presentationId }): Promise<"email" | "board" | "skipped">
// Email utilizable en la FICHA → withdrawal_declared por email; al éxito:
// withdrawalNotifiedAt = now, appealUntil = rules.appealUntil(now).
// Sin casilla → queda para el BoardNotice kind withdrawal (el post del aviso
// estampa withdrawalNotifiedAt = dueAt y appealUntil = dueAt + 30 en TODAS
// las presentations del lote — agregar ese barrido a notice.post cuando
// kind === "withdrawal", con test).
```

- [ ] **Step 1: Tests** (fake db + fake withdrawWithDebits): el lote corta en 25 ANTES de tocar el acta; un fallo de `withdraw` va a `failures` y no frena a los demás; `debitFailures` es balde propio; la presentación queda `withdrawn` solo si la baja salió; `notice.post` con kind `withdrawal` estampa `appealUntil = dueAt + 30 días` en las presentations vinculadas. → FAIL → implementar → PASS.
- [ ] **Step 2: Pantalla de cierre — checklist (Etapa A).** `/admin/reempadronamiento/cierre` (`requireSuperadmin` en página y actions): el veredicto arriba (molde `HealthVerdict`): bloqueantes en rojo con link que los resuelve (presentaciones sin resolver → la cola; cohorte no terminal → la lista de bajas de abajo), la advertencia de morosos ("{n} activos en condición de cesantía por mora — decidilo en Deudores antes de cerrar si corresponde", link a `/admin/tesoreria/deudores`), y los avisos en curso como contexto.
- [ ] **Step 3: Borrador del acta de bajas (Etapa B).** La lista de `listPendingWithdrawals` como cards con checkbox (molde barra sticky de `application-cards.tsx:155-175`, copiada tal cual con su `sticky bottom-0` y el porqué), cada una mostrando las notificaciones cursadas (1ª: email 02/09 · 2ª: cartelera fijada 05/10, fehaciente 02/11) — ESO es el contenido del anexo del acta que exige REG-23. Botón "Declarar bajas seleccionadas" → confirmación en dos pasos (pantalla intermedia con el resumen + token de huella) → `declareBatch` → resultado con los tres baldes, fallos linkeados por nombre. Al terminar los lotes: botón "Generar aviso de cartelera de bajas" (crea el `BoardNotice kind: "withdrawal"` con los sin-email) y los emails de baja salen por `notifyWithdrawal` post-lote (MailBudget).
- [ ] **Step 4: Email de baja.** `withdrawalDeclaredEmail({ appealUntil })`: la resolución fundada, el motivo estatutario (Art. 9° bis c), y la ventana de recurso "podés recurrir ante la primera asamblea ordinaria hasta el {fecha}" (REG-24). La ficha del socio y el Histórico muestran la ventana vigente (`appealUntil > now` → `FormMessage kind="neutral"` en la ficha: "Baja recurrible hasta el {fecha}").
- [ ] **Step 5: QA navegador** (con fechas simuladas por SQL: `UPDATE reregistration_processes SET second_ends_at = '...'`): checklist bloquea con una observada viva → resolverla → declarar bajas en lote → aviso de cartelera de bajas con PDF → asentar → `appealUntil` correcto en la ficha. Suite + lint + build.
- [ ] **Step 6: Commit** `feat(m6c): close checklist and batched withdrawals with appeal window`

---

### Task 17: Etapa C — vista previa, transacción de cierre y export del padrón nuevo

**Files:**
- Create: `src/app/admin/reempadronamiento/cierre/confirmar/page.tsx`, `src/app/admin/reempadronamiento/cierre/confirmar/actions.ts`, `src/lib/reregistration/close-book.ts`
- Test: `tests/reregistration-close-book.test.ts` (+ verificación de concurrencia si el andamiaje de `tests/integration/` lo permite — mirar `tests/integration/unique-violation.test.ts` como precedente de test contra MariaDB real)

**Interfaces:**
- Consumes: `planMigration`/`closeBlockers` (Task 15); `auditStrict` (`src/lib/audit.ts:45-49` — el asiento ES la señal ante la IGJ); `requireOpenBook` (`src/lib/members/service.ts:35-45` — NO se usa adentro: la transacción cierra y abre en el mismo commit, así que la invariante "exactamente un libro abierto" se sostiene por construcción; dejar el comentario); el export de la Task 3 (el padrón nuevo se exporta con `/api/admin/libros/{n+1}/export` ya existente).
- Produces (`close-book.ts`, db inyectada):

```ts
preview(processId): Promise<{
  blockers: ClosePrecondition[];
  migrants: Array<{ memberId; fullName; oldNumber; newNumber; category; status }>;
  withdrawnCount: number; newBookNumber: number }>
closeBook(input: { processId: number; minuteId: number; actorId: number }): Promise<
  | { ok: true; newBookId: number; migrated: number }
  | { ok: false; error: string }>
// UNA $transaction, CERO red:
// 1. Re-validar closeBlockers ADENTRO (la vista previa pudo envejecer).
// 2. Foto: membership.updateMany por lotes NO — update por fila con los
//    vivos de cada Member del libro (traer members+memberships en una consulta
//    y updatear en serie dentro de la tx; 278 filas entran holgadas en 5 s).
// 3. book viejo → closed, closedAt, closingMinuteId = minuteId.
// 4. book create { number: old + 1, status: "open", openedAt, openingMinuteId: minuteId }.
// 5. planMigration(vigentes del libro) → membership.createMany (bookId nuevo,
//    memberNumber = newNumber).
// 6. movement.createMany { type: "book_migration", date: minute.date, minuteId } por migrado.
// 7. process → closed, closeMinuteId; configuration reempadronamiento_proceso_id → borrar.
// Post-commit: auditStrict({ action: "book_close", entity: "book", detail:
// { oldBookId, newBookId, migrated, withdrawnCount, minuteId } }) — si el
// asiento falla, el operador VE el error (patrón auditAfterCommit del modo
// carga, src/app/admin/socios/carga/[numero]/actions.ts:61-67); revalidar
// el tag de la home (getActiveReregistration) y /admin.
```

- [ ] **Step 1: Tests** (fake db): la transacción re-valida y aborta con una cohortada no terminal aparecida a último momento; los números nuevos son los del plan; el libro nuevo es `number + 1` del que cierra (con un fake de libro 2 abierto→cerrando, el nuevo es 3 — la REUTILIZACIÓN probada); la foto se escribe para TODAS las membresías del libro viejo (bajas históricas incluidas); la config queda limpia. → FAIL → implementar → PASS.
- [ ] **Step 2: Vista previa.** `/admin/reempadronamiento/cierre/confirmar` (`requireSuperadmin`): el mapeo completo en tabla desktop/cards móvil — `N° viejo → N° nuevo · nombre · categoría` ordenado por número nuevo (`font-mono tabular-nums`), el total de bajas del proceso, el número del libro nuevo, y el aviso en `FormMessage kind="warning" box`: "Este paso cierra el Libro {n} y abre el Libro {n+1}. **Solo se revierte restaurando un backup.**" `MinutePicker` para el acta de cierre + botón final con confirm.
- [ ] **Step 3: Action + pantalla de resultado.** `closeBookAction`: `requireSuperadmin` → acta (patrón huérfana) → `closeBook` → redirect a una pantalla de resumen: "Libro {n} cerrado · Libro {n+1} abierto con {migrated} socios" + links "Ver Libro {n+1}", "Exportar padrón nuevo", "Ver Libro {n} (foto)".
- [ ] **Step 4: QA navegador** (el momento de la verdad, en local): cerrar → la pestaña Libros muestra los dos; el Libro 1 cerrado con su foto; el Padrón (Task 2) ahora lista el Libro 2 solo (el `where` por libro abierto de `query.ts` lo hace gratis); la ficha de un migrado muestra "Libro 1 · N° 12 · cerrado" y "Libro 2 · N° 4"; el padrón electoral sigue andando; un recibo de un migrado sale con el número nuevo. Suite + lint + build.
- [ ] **Step 5: Commit** `feat(m6c): book closure — preview, single-transaction migration and renumbering`

---

### Task 18: Simulacro CA completo + docs y cierre del módulo

**Files:** docs (`docs/02`, `docs/05`, `docs/07`, `prisma/schema.prisma` comentarios, `CLAUDE.md`, spec §3) + ledger. Sin código nuevo salvo fixes de QA.

- [ ] **Step 1: El CA de docs/07, entero, en local** (Docker MariaDB, datos reales sembrados — enmienda: decía staging): activar proceso de prueba (acta nueva) → presentar 3 adherentes: uno validado, uno observado que subsana y queda validado, uno sin respuesta → vencer plazos con fechas simuladas por SQL → 2ª instancia → preparar cierre → declarar la baja del sin-respuesta → cerrar libro → verificar: Libro 2 = vigentes no adherentes + 2 validados, renumerados por antigüedad; el sin-respuesta `withdrawn` con `not_reregistered` y `appealUntil` correcto; Libro 1 cerrado, consultable y exportable; `padron-export` del libro nuevo consistente. → **Restaurar el backup local y verificar que el simulacro se revirtió entero** (el procedimiento de restore de `docs/10` adaptado a local).
- [ ] **Step 2: El diff de la fase contra `main`**: `git diff main..HEAD -- src/lib/treasury src/lib/mp src/components/admin/account-section.tsx src/lib/admin/digest.ts tests/integration` → **vacío** (constraint global verificada mecánicamente).
- [ ] **Step 3: Correcciones documentales** (spec §3): las tres citas "Art. 5° quater" → "Art. 5° ter" (`docs/02:~44` + los dos comentarios de `Notification` en `schema.prisma`); `docs/05` §8 actualizado (DNI solo, ficha completa, sin paso de pago); `docs/07`: Módulo 6 cerrado con sus CA y la lista de lo entregado, estilo de los módulos previos.
- [ ] **Step 4: `CLAUDE.md`**: bloque "Patrones que estrenó el Módulo 6" (cohorte fija con presentación que no toca la ficha hasta validar; el aviso de cartelera como lote con días hábiles; el cierre por etapas con transacción solo-DB; la foto en `Membership`; la renumeración pura testeada) + "Prioridad actual" → lo que siga (el crontab del devengo antes del 01/10 sigue vigente como pendiente de despliegue). Actualizar `MEMORY.md`/memoria del proyecto si corresponde.
- [ ] **Step 5: Suite + lint + build finales. Commit** `docs(m6): module 6 closed — reregistration, board circuit and book migration` y ofrecer el merge con `superpowers:finishing-a-development-branch`.

---

## Self-Review (aplicado)

- **Cobertura de spec**: §1-§2 decisiones (constraints + tasks), §3 lecturas y correcciones (T18), §4 modelo (T6; `member_requests` en T5; foto en T6+T17), §5 wizard (T10-T11, sin pago como constraint global), §6 presencial (T12), §7 sección admin (T9, T12), §8 cartelera por lotes (T13, T16), §9 cierre en tres etapas (T15-T17), §10 Socios reorganizado (T1-T4), §11 público (T14), §12 autorización/auditoría (repartida por task + constraint), §13 invariantes de pagos (constraint + T18 Step 2 lo verifica mecánicamente), §14 verificación (tests por task + T18), §15 fuera de alcance (respetado: sin entidad Recurso — la ventana vive en `Presentation` y el reingreso existente resuelve el acogido; sin validaciones de calendario; sin cron nuevo).
- **Sin placeholders**: cada paso que depende de un archivo vivo nombra el archivo y el patrón exacto a calcar, con la regla de la casa: si la forma real difiere, gana la del archivo. Las firmas de todo lo nuevo están escritas.
- **Consistencia de tipos**: `lookupVerdict`/`maskedName`/`wizardOpen` (T7) los consumen T10/T11/T14; `presentations.claim/saveData/submit` (T11) los consumen T11/T12; `businessDayEnd` (T7) lo consumen T13/T16; `planMigration`/`closeBlockers` (T15) los consumen T16/T17; `listRecipients`/`post` (T13) los consume T16 (con el barrido de `appealUntil` agregado en T16 Step 1); `statusAtClose`/`categoryAtClose` (T6) los consume `fetchBookRows` (T3, con fallback documentado) y los escribe T17.
- **Riesgos señalados**: el orden real de guardas del wizard se verifica contra `asociate/actions.ts` antes de calcar (T10); `markAccepted` vs. la cancelación nueva de solicitudes se resuelve con `sparedRequestId` (T5); las filas `Notification` de cartelera nacen AL FIJAR el aviso, nunca antes (T8/T13 — evita inventar un estado "pendiente de cartelera" que el enum no tiene); la transacción de cierre re-valida adentro y no llama a la red; la constante 4 de mora se espeja con cita en vez de importar de treasury (dominios separados, T16).
