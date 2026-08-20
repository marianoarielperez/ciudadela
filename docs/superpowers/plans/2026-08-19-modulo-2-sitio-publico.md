# Módulo 2 — Sitio público, noticias y actividades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el placeholder público en el sitio institucional real: home con hero y botones con estado, cartelera de noticias con ABM (editor visual + imagen de portada), calendario de actividades de los dos salones, página Ubicación con OpenStreetMap, pantalla de configuración (superadmin), SEO, CSP completa y caché por tags.

**Architecture:** Se sigue el patrón del Módulo 1: lógica pura testeable en `src/lib/<dominio>/` (factories que reciben un Prisma "pick"), server actions en `actions.ts` junto a cada página que se autorizan a sí mismas (`requireAdmin`/`requireSuperadmin`), auditoría con `audit()`, formularios cliente con `useActionState` + campos controlados. Las páginas públicas estrenan caché: las consultas van envueltas en `unstable_cache` con tags (`news`, `activities`, `config`) y las actions invalidan con `updateTag` (Next 16.3: `revalidateTag` exige un segundo argumento de perfil; `updateTag` es la forma de server action, con read-your-own-writes). Las funciones cacheadas devuelven **DTOs serializables** (fechas como string ISO) porque `unstable_cache` serializa a JSON y un `Date` volvería como string en el segundo hit.

**Tech Stack:** Next.js 16.3.1 (App Router, `proxy.ts`, `searchParams` como Promise), React 19.2.8, Prisma 7 + MariaDB, Auth.js v5, Tailwind v4 + shadcn, vitest. Nuevas dependencias: `@tiptap/react@^3.30.2`, `@tiptap/starter-kit@^3.30.2`, `@tiptap/pm@^3.30.2`, `sanitize-html@^2.17.7` (+ `@types/sanitize-html` dev, `sharp` dev para el script de assets).

**Spec:** `docs/superpowers/specs/2026-08-19-modulo-2-sitio-publico-design.md` — leer antes de arrancar.

## Global Constraints

- UI en español es-AR ("vos", fechas DD/MM/AAAA); código, tablas, commits en inglés.
- Mensajes de error de zod SIEMPRE en es-AR: se muestran tal cual en pantalla.
- Toda action que escribe: `requireAdmin()`/`requireSuperadmin()` propio + `parseForm` + `audit()` + `redirect()` FUERA del try.
- En módulos `"use server"` no exportar nada que no sea función async.
- IP del cliente: solo header `x-real-ip`.
- Migraciones con `prisma migrate dev` (necesita `SHADOW_DATABASE_URL` en `.env`; Docker Desktop debe estar corriendo), nunca `db push`.
- Archivos subidos: `UPLOADS_DIR` (dev `./uploads`), NUNCA en `public/` ni el repo.
- Color de marca `#2E9BDF` solo para superficies decorativas/texto grande; interactivo usa el token `--primary` (`#0079BC`). No hardcodear celestes nuevos.
- Auditoría de acciones: snake_case `verbo_sustantivo` invertido estilo existente (`news_create`, `config_update`).
- Tests: vitest, lógica pura sin base (factories con fakes). Correr con `npm test`.
- Commits frecuentes, mensajes en inglés estilo `feat(scope): ...`, con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Fechas civiles del repo van a mediodía UTC — pero los horarios de `Activity` son "HH:MM" de pared, SIN conversión (excepción documentada en la spec §2).

---

### Task 1: Dependencias y migración (News, Activity)

**Files:**
- Modify: `package.json` (vía npm install)
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_module_2_news_activities/migration.sql` (generada)

**Interfaces:**
- Produces: modelos Prisma `News` (tabla `news`) y `Activity` (tabla `activities`), enums `NewsStatus { draft published }` y `Room { historic glass }`, relación `User.newsAuthored`.

- [ ] **Step 1: Instalar dependencias**

```bash
npm install @tiptap/react@^3.30.2 @tiptap/starter-kit@^3.30.2 @tiptap/pm@^3.30.2 sanitize-html@^2.17.7
npm install -D @types/sanitize-html@^2.16.1 sharp
```

Expected: exit 0, `postinstall` corre `prisma generate` sin errores.

- [ ] **Step 2: Agregar modelos al schema**

En `prisma/schema.prisma`, al final del archivo, agregar (respetando el estilo: comentarios en español que explican el porqué):

```prisma
// ---------------------------------------------------------------------------
// Módulo 2 — sitio público
// ---------------------------------------------------------------------------

enum NewsStatus {
  draft
  published
}

// Noticias de la cartelera digital del sitio público (docs/04, "Noticia").
// OJO: no confundir con la cartelera FÍSICA de notificaciones (NotificationVia.board).
model News {
  id    Int    @id @default(autoincrement())
  title String @db.VarChar(160)
  // Editable incluso después de publicar: si cambia, la URL vieja da 404
  // (aceptado en la spec §2: sitio chico, sin SEO heredado que preservar).
  slug String @unique @db.VarChar(180)
  // HTML YA sanitizado en el servidor (src/lib/news/sanitize.ts). Nunca se
  // persiste HTML crudo del cliente.
  body           String     @db.Text
  coverImagePath String?    @map("cover_image_path") @db.VarChar(255)
  status         NewsStatus @default(draft)
  // Se fija la PRIMERA vez que se publica y no se pisa al republicar: es la
  // fecha que ve el vecino y ordena la cartelera.
  publishedAt DateTime? @map("published_at")
  authorId    Int?      @map("author_id")
  author      User?     @relation(fields: [authorId], references: [id], onDelete: SetNull)
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([status, publishedAt])
  @@map("news")
}

// Los dos salones de la sede son fijos: enum, no tabla (YAGNI, spec §2).
enum Room {
  historic // Salón Histórico
  glass // Salón Vidriado
}

// Actividad sistemática semanal de un salón ("Gimnasia mujeres", "Taekwondo
// niños"), con vigencia anual. Solo consulta pública: no hay reservas.
model Activity {
  id   Int    @id @default(autoincrement())
  name String @db.VarChar(120)
  room Room
  // Array JSON de enteros 1–7 (lunes=1). Validado por zod en el alta.
  weekdays Json
  // "HH:MM" hora de PARED local, sin conversión a UTC: es un horario
  // recurrente, no un instante (excepción documentada, spec §2).
  startTime String   @map("start_time") @db.VarChar(5)
  endTime   String   @map("end_time") @db.VarChar(5)
  year      Int      @db.SmallInt
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([year, room])
  @@map("activities")
}
```

Y en el modelo `User` existente, agregar la back-relation junto a las otras (`minutesCreated`, etc.):

```prisma
  newsAuthored     News[]
```

- [ ] **Step 3: Generar la migración**

```bash
npx prisma migrate dev --name add_module_2_news_activities
```

Expected: migración creada y aplicada, `prisma generate` regenerado. Si falla por shadow DB, verificar que Docker Desktop y MariaDB estén corriendo y que `.env` tenga `SHADOW_DATABASE_URL`.

- [ ] **Step 4: Verificar build de tipos**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add News and Activity models for module 2"
```

---

### Task 2: Constantes institucionales y lector tipado de configuración

**Files:**
- Create: `src/lib/site.ts`
- Create: `src/lib/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `SITE` (objeto de constantes institucionales), `CONFIG_KEYS`, `makeConfigReader(db)` con `getBool(key): Promise<boolean>` y `getString(key): Promise<string | null>`, singleton `configReader`.

- [ ] **Step 1: Escribir `src/lib/site.ts`**

Datos estáticos institucionales (cambian una vez por década: se versionan, no van a la tabla de configuración — spec §2). Datos provistos por Mariano en la entrevista del 19/08/2026.

```ts
// Datos institucionales estáticos de la Asociación. Lo que puede cambiar
// (teléfono, email de contacto) vive en la tabla `configuration` y se edita
// desde /admin/configuracion; esto es lo que no cambia.
export const SITE = {
  name: "Asociación Vecinal del Barrio Ciudadela",
  shortName: "Vecinal Ciudadela",
  city: "Comodoro Rivadavia, Chubut",
  address: "Cerro Catedral N° 286, Barrio Ciudadela",
  // Coordenadas de la sede (provistas por la Comisión).
  lat: -45.79713687,
  lng: -67.494067,
  founded: "4 de agosto de 1964",
  legallyFounded: "27 de febrero de 2015",
  legalStatus: "Personería jurídica 4139 — Resolución 184/15",
  rooms: { historic: "Salón Histórico", glass: "Salón Vidriado" },
} as const;

// URL base absoluta para metadata/sitemap. AUTH_URL ya apunta al dominio del
// entorno (staging o producción); en dev cae a localhost.
export function siteBaseUrl(): URL {
  return new URL(process.env.AUTH_URL ?? "http://localhost:3000");
}
```

- [ ] **Step 2: Escribir el test que falla**

`tests/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONFIG_KEYS, makeConfigReader } from "@/lib/config";

type Row = { key: string; value: unknown } | null;

function fakeDb(rows: Record<string, unknown>) {
  return {
    configuration: {
      findUnique: async ({ where }: { where: { key: string } }): Promise<Row> =>
        where.key in rows ? { key: where.key, value: rows[where.key] } : null,
    },
  } as never;
}

describe("makeConfigReader", () => {
  it("getBool: true solo con el JSON true estricto", async () => {
    const reader = makeConfigReader(fakeDb({ a: true, b: "true", c: 1, d: false }));
    expect(await reader.getBool("a")).toBe(true);
    expect(await reader.getBool("b")).toBe(false);
    expect(await reader.getBool("c")).toBe(false);
    expect(await reader.getBool("d")).toBe(false);
    expect(await reader.getBool("missing")).toBe(false);
  });

  it("getString: null si falta, no es string o es vacío", async () => {
    const reader = makeConfigReader(fakeDb({ tel: " 297-1234 ", vacio: "  ", num: 42 }));
    expect(await reader.getString("tel")).toBe("297-1234");
    expect(await reader.getString("vacio")).toBeNull();
    expect(await reader.getString("num")).toBeNull();
    expect(await reader.getString("missing")).toBeNull();
  });

  it("expone las claves del módulo 2", () => {
    expect(CONFIG_KEYS.asociateActivo).toBe("asociate_activo");
    expect(CONFIG_KEYS.contactPhone).toBe("contact_phone");
    expect(CONFIG_KEYS.contactEmail).toBe("contact_email");
  });
});
```

- [ ] **Step 3: Correr el test — debe fallar**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/config'`.

- [ ] **Step 4: Escribir `src/lib/config.ts`**

```ts
// Lector tipado de la tabla clave/valor `configuration`. Reemplaza el patrón
// inline de src/lib/members/service.ts:21 de acá en adelante (aquel no se
// migra en este módulo para no ampliar el diff).
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const CONFIG_KEYS = {
  asociateActivo: "asociate_activo",
  contactPhone: "contact_phone",
  contactEmail: "contact_email",
} as const;

type Db = Pick<PrismaClient, "configuration">;

export function makeConfigReader(db: Db) {
  return {
    // Comparación estricta contra el Json: cualquier cosa que no sea `true`
    // (string "true", 1, null) es false. Mismo criterio que electionsOngoing.
    async getBool(key: string): Promise<boolean> {
      const row = await db.configuration.findUnique({ where: { key } });
      return row?.value === true;
    },
    async getString(key: string): Promise<string | null> {
      const row = await db.configuration.findUnique({ where: { key } });
      if (typeof row?.value !== "string") return null;
      const trimmed = row.value.trim();
      return trimmed === "" ? null : trimmed;
    },
  };
}

export const configReader = makeConfigReader(prisma);
```

- [ ] **Step 5: Correr el test — debe pasar**

```bash
npx vitest run tests/config.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/site.ts src/lib/config.ts tests/config.test.ts
git commit -m "feat(config): typed configuration reader and static site constants"
```

---

### Task 3: `isSuperadmin` y `requireSuperadmin`

**Files:**
- Modify: `src/lib/auth/roles.ts`
- Modify: `src/lib/auth/require-admin.ts`
- Test: `tests/require-superadmin.test.ts`

**Interfaces:**
- Consumes: `makeRequireAdmin` existente (se refactoriza a una factory interna parametrizada, sin cambiar su firma pública).
- Produces: `isSuperadmin(roles)` en roles.ts; `makeRequireSuperadmin(getSession, findAccount)` y `requireSuperadmin(): Promise<AdminActor>` en require-admin.ts. El tipo de retorno es el mismo `AdminActor` existente.

- [ ] **Step 1: Escribir el test que falla**

`tests/require-superadmin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSuperadmin } from "@/lib/auth/roles";
import { makeRequireSuperadmin } from "@/lib/auth/require-admin";

const account = (roles: string[]) => async () => ({
  active: true,
  roles,
  passwordChangedAt: null,
});
const session = (roles: string[]) => async () => ({
  user: { id: "7", roles, authAt: Date.now() },
});

describe("isSuperadmin", () => {
  it("solo superadmin pasa", () => {
    expect(isSuperadmin(["superadmin"])).toBe(true);
    expect(isSuperadmin(["admin"])).toBe(false);
    expect(isSuperadmin(["admin", "socio"])).toBe(false);
    expect(isSuperadmin(null)).toBe(false);
  });
});

describe("makeRequireSuperadmin", () => {
  it("acepta superadmin con fila viva superadmin", async () => {
    const guard = makeRequireSuperadmin(session(["superadmin", "admin"]), account(["superadmin", "admin"]));
    const r = await guard();
    expect(r).toEqual({ ok: true, actorId: 7 });
  });

  it("rechaza a un admin común aunque el token lo diga", async () => {
    const guard = makeRequireSuperadmin(session(["admin"]), account(["admin"]));
    const r = await guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_admin");
  });

  it("el token puede quitar pero nunca dar: fila viva superadmin con token admin se rechaza sin tocar la base", async () => {
    let dbCalled = false;
    const lookup = async () => {
      dbCalled = true;
      return { active: true, roles: ["superadmin"], passwordChangedAt: null };
    };
    const guard = makeRequireSuperadmin(session(["admin"]), lookup);
    const r = await guard();
    expect(r.ok).toBe(false);
    expect(dbCalled).toBe(false);
  });

  it("rechaza si la fila viva ya no es superadmin (revocación)", async () => {
    const guard = makeRequireSuperadmin(session(["superadmin"]), account(["admin"]));
    const r = await guard();
    expect(r.ok).toBe(false);
  });

  it("rechaza cuenta deshabilitada", async () => {
    const guard = makeRequireSuperadmin(session(["superadmin"]), async () => ({
      active: false,
      roles: ["superadmin"],
      passwordChangedAt: null,
    }));
    const r = await guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar**

```bash
npx vitest run tests/require-superadmin.test.ts
```

Expected: FAIL — `isSuperadmin`/`makeRequireSuperadmin` no existen.

- [ ] **Step 3: Agregar `isSuperadmin` a `src/lib/auth/roles.ts`**

Debajo de `isAdmin`:

```ts
// La pantalla de Configuración es solo superadmin (docs/05:129): cambiar
// asociate_activo abre/cierra el alta de socios de cara al público.
export function isSuperadmin(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((r) => r === "superadmin");
}
```

- [ ] **Step 4: Refactorizar `require-admin.ts` con factory parametrizada**

En `src/lib/auth/require-admin.ts`: importar `isSuperadmin` junto a `isAdmin`, y reemplazar el cuerpo de `makeRequireAdmin` por una factory interna que recibe el predicado de rol y el mensaje de rechazo. **No cambia ninguna firma exportada existente.**

```ts
// Factory común: la única diferencia entre requireAdmin y requireSuperadmin
// es QUÉ rol exige. Toda la lógica (token barato primero, fila viva después,
// frescura de sesión) queda en un solo lugar.
function makeRequireRole(
  getSession: GetSession,
  findAccount: AdminAccountLookup,
  hasRole: (roles: readonly string[] | null | undefined) => boolean,
  notAllowed: string,
) {
  return async function requireRole(): Promise<AdminActor> {
    const session = await getSession();
    const id = session?.user?.id;
    if (!id) return { ok: false, reason: "anonymous", error: ADMIN_BLOCKED.anonymous };
    if (!hasRole(session?.user?.roles)) {
      return { ok: false, reason: "not_admin", error: notAllowed };
    }
    const actorId = Number(id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      return { ok: false, reason: "anonymous", error: ADMIN_BLOCKED.anonymous };
    }
    const account = await findAccount(actorId);
    if (!account) return { ok: false, reason: "not_admin", error: notAllowed };
    if (!account.active) return { ok: false, reason: "disabled", error: ADMIN_BLOCKED.disabled };
    if (!hasRole(account.roles)) {
      return { ok: false, reason: "not_admin", error: notAllowed };
    }
    if (sessionPredatesPasswordChange(session?.user?.authAt, account.passwordChangedAt)) {
      return { ok: false, reason: "stale_session", error: ADMIN_BLOCKED.stale_session };
    }
    if (sessionExceededMaxLifetime(session?.user?.authAt)) {
      return { ok: false, reason: "expired_session", error: ADMIN_BLOCKED.expired_session };
    }
    return { ok: true, actorId };
  };
}

export function makeRequireAdmin(getSession: GetSession, findAccount: AdminAccountLookup) {
  return makeRequireRole(getSession, findAccount, isAdmin, ADMIN_BLOCKED.not_admin);
}

export const SUPERADMIN_BLOCKED_MESSAGE = "Solo el superadmin puede cambiar la configuración.";

export function makeRequireSuperadmin(getSession: GetSession, findAccount: AdminAccountLookup) {
  return makeRequireRole(getSession, findAccount, isSuperadmin, SUPERADMIN_BLOCKED_MESSAGE);
}
```

Y al final, junto a `requireAdmin()`, la versión ligada (misma consulta de cuenta — extraerla a una función local `liveAccountLookup` para no duplicarla):

```ts
async function liveAccount(): Promise<AdminAccountLookup> {
  const { prisma } = await import("@/lib/prisma");
  return async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        active: true,
        passwordChangedAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) return null;
    return {
      active: user.active,
      passwordChangedAt: user.passwordChangedAt,
      roles: user.roles.map((r) => r.role.name),
    };
  };
}

export async function requireAdmin(): Promise<AdminActor> {
  const { auth } = await import("@/auth");
  return makeRequireAdmin(auth, await liveAccount())();
}

export async function requireSuperadmin(): Promise<AdminActor> {
  const { auth } = await import("@/auth");
  return makeRequireSuperadmin(auth, await liveAccount())();
}
```

(La función `requireAdmin` existente se reemplaza por esta versión; el comportamiento es idéntico.)

- [ ] **Step 5: Correr TODOS los tests — deben pasar (el refactor no puede romper los existentes)**

```bash
npm test
```

Expected: PASS completo, incluyendo los tests previos de require-admin del Módulo 1.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/roles.ts src/lib/auth/require-admin.ts tests/require-superadmin.test.ts
git commit -m "feat(auth): isSuperadmin helper and requireSuperadmin guard"
```

---

### Task 4: Dominio de noticias — slug, sanitización y extracto

**Files:**
- Create: `src/lib/news/slug.ts`
- Create: `src/lib/news/sanitize.ts`
- Test: `tests/news-slug.test.ts`
- Test: `tests/news-sanitize.test.ts`

**Interfaces:**
- Produces: `slugify(title: string): string` (máx. 180 chars, nunca vacío: fallback `"noticia"`); `sanitizeNewsBody(html: string): string`; `newsBodyIsEmpty(html: string): boolean`; `newsPlainText(html: string, maxLength?: number): string` (para meta description y tarjetas).

- [ ] **Step 1: Escribir tests que fallan**

`tests/news-slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/news/slug";

describe("slugify", () => {
  it("baja a minúsculas, saca tildes y reemplaza no-alfanuméricos por guiones", () => {
    expect(slugify("Asamblea General Ordinaria 2026")).toBe("asamblea-general-ordinaria-2026");
    expect(slugify("¡Inscripción al Taekwondo — Niños!")).toBe("inscripcion-al-taekwondo-ninos");
  });
  it("colapsa guiones y recorta extremos", () => {
    expect(slugify("  hola   --- mundo  ")).toBe("hola-mundo");
  });
  it("nunca devuelve vacío", () => {
    expect(slugify("¡¡¡···!!!")).toBe("noticia");
    expect(slugify("")).toBe("noticia");
  });
  it("respeta el máximo de 180 sin cortar en guion colgante", () => {
    const s = slugify("a".repeat(300));
    expect(s.length).toBeLessThanOrEqual(180);
    expect(s.endsWith("-")).toBe(false);
  });
});
```

`tests/news-sanitize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newsBodyIsEmpty, newsPlainText, sanitizeNewsBody } from "@/lib/news/sanitize";

describe("sanitizeNewsBody", () => {
  it("deja pasar la allowlist del editor", () => {
    const html = "<h2>Título</h2><p><strong>Hola</strong> <em>vecinos</em> <u>todos</u></p><ul><li>uno</li></ul>";
    expect(sanitizeNewsBody(html)).toBe(html);
  });
  it("elimina scripts, estilos y handlers", () => {
    expect(sanitizeNewsBody('<p onclick="x()">hola</p><script>alert(1)</script>')).toBe("<p>hola</p>");
    expect(sanitizeNewsBody('<p style="color:red">hola</p>')).toBe("<p>hola</p>");
  });
  it("solo links http/https y les fuerza rel", () => {
    expect(sanitizeNewsBody('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
    expect(sanitizeNewsBody('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">x</a>',
    );
  });
  it("degrada tags fuera de la allowlist conservando el texto", () => {
    expect(sanitizeNewsBody("<h1>grande</h1><table><tr><td>celda</td></tr></table>")).toBe("grandecelda");
  });
});

describe("newsBodyIsEmpty", () => {
  it("detecta el HTML sin texto real", () => {
    expect(newsBodyIsEmpty("<p></p><p>  </p>")).toBe(true);
    expect(newsBodyIsEmpty("<p>hola</p>")).toBe(false);
    expect(newsBodyIsEmpty("")).toBe(true);
  });
});

describe("newsPlainText", () => {
  it("extrae texto plano y corta con elipsis", () => {
    expect(newsPlainText("<p>Hola <strong>vecinos</strong> del barrio</p>")).toBe("Hola vecinos del barrio");
    expect(newsPlainText(`<p>${"a".repeat(200)}</p>`, 50).length).toBeLessThanOrEqual(51);
    expect(newsPlainText(`<p>${"a".repeat(200)}</p>`, 50).endsWith("…")).toBe(true);
  });
});
```

- [ ] **Step 2: Correr — deben fallar**

```bash
npx vitest run tests/news-slug.test.ts tests/news-sanitize.test.ts
```

Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/lib/news/slug.ts`**

```ts
// Slug de la URL pública /noticias/[slug]. Determinístico y sin estado: la
// unicidad la garantiza el UNIQUE de la base (P2002 → mensaje en castellano).
export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tildes y diéresis fuera
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180)
    .replace(/-+$/g, "");
  return slug === "" ? "noticia" : slug;
}
```

- [ ] **Step 4: Implementar `src/lib/news/sanitize.ts`**

```ts
// Sanitización del cuerpo de la noticia. El editor (Tiptap) corre en el
// cliente y su HTML es input hostil por definición: acá se decide qué entra
// a la base. El render público usa dangerouslySetInnerHTML CONFIANDO en que
// todo lo persistido pasó por esta allowlist.
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "a", "ul", "ol", "li", "h2", "h3"],
  allowedAttributes: { a: ["href", "rel"] },
  allowedSchemes: ["http", "https"],
  // rel fijo: las noticias pueden linkear afuera y no queremos window.opener.
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
};

export function sanitizeNewsBody(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

const TEXT_ONLY: sanitizeHtml.IOptions = { allowedTags: [], allowedAttributes: {} };

export function newsBodyIsEmpty(html: string): boolean {
  return sanitizeHtml(html, TEXT_ONLY).replace(/&nbsp;/g, " ").trim() === "";
}

// Texto plano para meta description y tarjetas. maxLength por defecto 160
// (límite práctico de description en resultados de búsqueda).
export function newsPlainText(html: string, maxLength = 160): string {
  const text = sanitizeHtml(html, TEXT_ONLY).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
```

Nota: `sanitize-html` escapea entidades en el texto; si algún assert de los tests difiere por entidades (`&amp;`), ajustar el *test* al output real observado, no la allowlist.

- [ ] **Step 5: Correr — deben pasar**

```bash
npx vitest run tests/news-slug.test.ts tests/news-sanitize.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/news tests/news-slug.test.ts tests/news-sanitize.test.ts
git commit -m "feat(news): slug generation and server-side HTML sanitization"
```

---

### Task 5: Dominio de noticias — queries cacheadas (DTOs serializables)

**Files:**
- Create: `src/lib/news/query.ts`
- Test: `tests/news-query.test.ts`

**Interfaces:**
- Consumes: `newsPlainText` de Task 4.
- Produces (todas devuelven DTOs planos, fechas como ISO string — obligatorio porque `unstable_cache` serializa a JSON):
  - `NEWS_PAGE_SIZE = 10`
  - `type PublicNewsCard = { id: number; title: string; slug: string; excerpt: string; coverImagePath: string | null; publishedAtIso: string }`
  - `type PublicNewsDetail = PublicNewsCard & { body: string }`
  - `makeNewsQueries(db)` con: `latest(count: number): Promise<PublicNewsCard[]>`, `publishedPage(page: number): Promise<{ items: PublicNewsCard[]; total: number; page: number; pages: number }>`, `bySlug(slug: string): Promise<PublicNewsDetail | null>`, `allForAdmin(): Promise<AdminNewsRow[]>` donde `AdminNewsRow = { id: number; title: string; slug: string; status: "draft" | "published"; publishedAtIso: string | null; authorName: string | null }`
  - Singletons cacheados: `getLatestNews`, `getPublishedNewsPage`, `getNewsBySlug` (envueltos en `unstable_cache` con tag `"news"`)
  - `export const CACHE_TAGS = { news: "news", activities: "activities", config: "config" } as const` (vive acá y lo importan las actions)

- [ ] **Step 1: Escribir el test que falla**

`tests/news-query.test.ts` — prueba la factory con un fake que registra los argumentos:

```ts
import { describe, expect, it } from "vitest";
import { makeNewsQueries, NEWS_PAGE_SIZE } from "@/lib/news/query";

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: "Asamblea",
  slug: "asamblea",
  body: "<p>Se convoca a todos los socios del barrio</p>",
  coverImagePath: null,
  status: "published",
  publishedAt: new Date("2026-08-10T15:00:00Z"),
  author: { name: "Mariano" },
  ...over,
});

function fakeDb(rows: ReturnType<typeof row>[], total = rows.length) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    news: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push(args);
        return rows;
      },
      count: async () => total,
      findFirst: async (args: Record<string, unknown>) => {
        calls.push(args);
        return rows[0] ?? null;
      },
    },
  } as never;
  return { db, calls };
}

describe("makeNewsQueries", () => {
  it("latest: solo publicadas, orden desc, fechas como ISO string", async () => {
    const { db, calls } = fakeDb([row()]);
    const q = makeNewsQueries(db);
    const items = await q.latest(3);
    expect(items[0].publishedAtIso).toBe("2026-08-10T15:00:00.000Z");
    expect(items[0].excerpt).toContain("Se convoca");
    expect((items[0] as Record<string, unknown>).body).toBeUndefined();
    const where = (calls[0] as { where: { status: string } }).where;
    expect(where.status).toBe("published");
  });

  it("publishedPage: pagina y clampa fuera de rango", async () => {
    const { db } = fakeDb([row()], 25);
    const q = makeNewsQueries(db);
    const page = await q.publishedPage(99);
    expect(page.pages).toBe(Math.ceil(25 / NEWS_PAGE_SIZE));
    expect(page.page).toBe(page.pages);
  });

  it("bySlug: null para borradores o inexistentes", async () => {
    const { db, calls } = fakeDb([]);
    const q = makeNewsQueries(db);
    expect(await q.bySlug("nada")).toBeNull();
    const where = (calls[0] as { where: { status: string; slug: string } }).where;
    expect(where).toEqual({ slug: "nada", status: "published" });
  });

  it("allForAdmin: incluye borradores y el nombre del autor", async () => {
    const { db } = fakeDb([row({ status: "draft", publishedAt: null })]);
    const q = makeNewsQueries(db);
    const rows = await q.allForAdmin();
    expect(rows[0].status).toBe("draft");
    expect(rows[0].publishedAtIso).toBeNull();
    expect(rows[0].authorName).toBe("Mariano");
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

```bash
npx vitest run tests/news-query.test.ts
```

Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/lib/news/query.ts`**

```ts
// Consultas de noticias. Devuelven DTOs PLANOS con fechas ISO string: los
// singletons de abajo van envueltos en unstable_cache, que serializa a JSON
// — un Date volvería como string en el segundo hit y el tipo mentiría.
import { unstable_cache } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { newsPlainText } from "@/lib/news/sanitize";

export const NEWS_PAGE_SIZE = 10;

// Tags de caché del sitio público. Las actions del ABM invalidan con
// updateTag(CACHE_TAGS.news) etc.
export const CACHE_TAGS = { news: "news", activities: "activities", config: "config" } as const;

export type PublicNewsCard = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  coverImagePath: string | null;
  publishedAtIso: string;
};

export type PublicNewsDetail = PublicNewsCard & { body: string };

export type AdminNewsRow = {
  id: number;
  title: string;
  slug: string;
  status: "draft" | "published";
  publishedAtIso: string | null;
  authorName: string | null;
};

type Db = Pick<PrismaClient, "news">;

type NewsRow = {
  id: number;
  title: string;
  slug: string;
  body: string;
  coverImagePath: string | null;
  status: string;
  publishedAt: Date | null;
  author: { name: string | null } | null;
};

function toCard(n: NewsRow): PublicNewsCard {
  return {
    id: n.id,
    title: n.title,
    slug: n.slug,
    excerpt: newsPlainText(n.body),
    coverImagePath: n.coverImagePath,
    publishedAtIso: n.publishedAt?.toISOString() ?? "",
  };
}

export function makeNewsQueries(db: Db) {
  const publishedInclude = { author: { select: { name: true } } };
  return {
    async latest(count: number): Promise<PublicNewsCard[]> {
      const rows = await db.news.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        take: count,
        include: publishedInclude,
      });
      return (rows as NewsRow[]).map(toCard);
    },

    async publishedPage(page: number) {
      const total = await db.news.count({ where: { status: "published" } });
      const pages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));
      const current = Math.min(Math.max(1, page), pages);
      const rows = await db.news.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        skip: (current - 1) * NEWS_PAGE_SIZE,
        take: NEWS_PAGE_SIZE,
        include: publishedInclude,
      });
      return { items: (rows as NewsRow[]).map(toCard), total, page: current, pages };
    },

    async bySlug(slug: string): Promise<PublicNewsDetail | null> {
      const n = (await db.news.findFirst({
        where: { slug, status: "published" },
        include: publishedInclude,
      })) as NewsRow | null;
      if (!n) return null;
      return { ...toCard(n), body: n.body };
    },

    async allForAdmin(): Promise<AdminNewsRow[]> {
      const rows = (await db.news.findMany({
        orderBy: { createdAt: "desc" },
        include: publishedInclude,
      })) as (NewsRow & { createdAt?: Date })[];
      return rows.map((n) => ({
        id: n.id,
        title: n.title,
        slug: n.slug,
        status: n.status as "draft" | "published",
        publishedAtIso: n.publishedAt?.toISOString() ?? null,
        authorName: n.author?.name ?? null,
      }));
    },
  };
}

const queries = makeNewsQueries(prisma);

// Versiones cacheadas para las páginas públicas. El panel admin NO las usa:
// lee directo (force-dynamic) para ver siempre el estado real.
export const getLatestNews = unstable_cache((count: number) => queries.latest(count), ["news-latest"], {
  tags: [CACHE_TAGS.news],
});
export const getPublishedNewsPage = unstable_cache(
  (page: number) => queries.publishedPage(page),
  ["news-page"],
  { tags: [CACHE_TAGS.news] },
);
export const getNewsBySlug = unstable_cache((slug: string) => queries.bySlug(slug), ["news-by-slug"], {
  tags: [CACHE_TAGS.news],
});
export const newsQueries = queries;
```

- [ ] **Step 4: Correr — debe pasar; `tsc` limpio**

```bash
npx vitest run tests/news-query.test.ts
npx tsc --noEmit
```

Expected: PASS y exit 0. Si vitest fallara EN EL IMPORT del módulo (por
`unstable_cache` de `next/cache` fuera del runtime de Next), agregar al tope
del test: `vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, updateTag: vi.fn() }));`
— el test usa la factory, no los singletons cacheados.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/query.ts tests/news-query.test.ts
git commit -m "feat(news): cached public queries with serializable DTOs"
```

---

### Task 6: Imagen de portada — almacenamiento y route handler público

**Files:**
- Create: `src/lib/news/image-url.ts` (puro, importable desde client components)
- Create: `src/lib/news/images.ts` (I/O de disco — SOLO server: importa `node:fs`)
- Create: `src/app/api/imagenes/noticias/[name]/route.ts`
- Test: `tests/news-images.test.ts`

**Interfaces:**
- Produces en `image-url.ts` (sin imports de node — lo consumen client components como `news-form.tsx`): `newsImageUrl(fileName: string): string` (devuelve `/api/imagenes/noticias/<fileName>`) y `isValidNewsImageName(name: string): boolean`.
- Produces en `images.ts` (server only): `sniffImageExt(bytes: Uint8Array): "jpg" | "png" | "webp" | null`; `MAX_COVER_BYTES = 5 * 1024 * 1024`; `saveNewsCover(file: File): Promise<{ ok: true; fileName: string } | { ok: false; error: string }>`; `deleteNewsCover(fileName: string): Promise<void>`; re-exporta lo de `image-url.ts`.
- Route handler GET público con `Cache-Control: public, max-age=31536000, immutable`.

- [ ] **Step 1: Escribir el test que falla**

`tests/news-images.test.ts` (solo lógica pura: validación de nombre y sniffing — el I/O de disco no se testea):

```ts
import { describe, expect, it } from "vitest";
import { isValidNewsImageName, newsImageUrl, sniffImageExt } from "@/lib/news/images";

describe("isValidNewsImageName", () => {
  it("acepta uuid.ext de la allowlist", () => {
    expect(isValidNewsImageName("123e4567-e89b-42d3-a456-426614174000.jpg")).toBe(true);
    expect(isValidNewsImageName("123e4567-e89b-42d3-a456-426614174000.webp")).toBe(true);
  });
  it("rechaza path traversal y extensiones fuera de la allowlist", () => {
    expect(isValidNewsImageName("../secret.jpg")).toBe(false);
    expect(isValidNewsImageName("..%2Fsecret.jpg")).toBe(false);
    expect(isValidNewsImageName("123e4567-e89b-42d3-a456-426614174000.svg")).toBe(false);
    expect(isValidNewsImageName("foo.jpg")).toBe(false);
    expect(isValidNewsImageName("")).toBe(false);
  });
});

describe("sniffImageExt", () => {
  it("detecta por magic bytes, no por extensión", () => {
    expect(sniffImageExt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpg");
    expect(sniffImageExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe("png");
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    expect(sniffImageExt(webp)).toBe("webp");
    expect(sniffImageExt(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe("newsImageUrl", () => {
  it("arma la URL del route handler", () => {
    expect(newsImageUrl("a.jpg")).toBe("/api/imagenes/noticias/a.jpg");
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

```bash
npx vitest run tests/news-images.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/news/image-url.ts` y `src/lib/news/images.ts`**

`src/lib/news/image-url.ts` — SIN imports de node, para que los client
components (`news-form.tsx`) puedan importarlo sin arrastrar `fs` al bundle:

```ts
// URL pública y validación de nombre de las portadas. Separado de images.ts
// (que importa node:fs) para que sea importable desde client components.
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isValidNewsImageName(name: string): boolean {
  return NAME_RE.test(name);
}

export function newsImageUrl(fileName: string): string {
  return `/api/imagenes/noticias/${fileName}`;
}
```

`src/lib/news/images.ts`:

```ts
// Portadas de noticias. Viven en UPLOADS_DIR/news (fuera de public/ y del
// repo: sobreviven deploys y no se versionan), pero a diferencia de los
// documentos personales del M3 se sirven SIN autenticación: una portada de
// noticia es contenido público por definición (excepción documentada en
// CLAUDE.md, spec §5). El nombre UUID hace al contenido inmutable → el route
// handler puede cachear a un año.
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidNewsImageName } from "@/lib/news/image-url";

export { isValidNewsImageName, newsImageUrl } from "@/lib/news/image-url";

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? "./uploads";
}

export function newsImagesDir(): string {
  return path.join(uploadsDir(), "news");
}

// Magic bytes, no extensión ni Content-Type del cliente: los dos los elige
// el atacante.
export function sniffImageExt(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  return null;
}

export async function saveNewsCover(
  file: File,
): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: "El archivo de imagen llegó vacío." };
  if (file.size > MAX_COVER_BYTES) {
    return { ok: false, error: "La imagen no puede superar los 5 MB." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImageExt(bytes);
  if (!ext) return { ok: false, error: "Formato no soportado: subí una imagen JPG, PNG o WebP." };
  const fileName = `${crypto.randomUUID()}.${ext}`;
  await mkdir(newsImagesDir(), { recursive: true });
  await writeFile(path.join(newsImagesDir(), fileName), bytes);
  return { ok: true, fileName };
}

// Borra la portada al reemplazarla o eliminar la noticia. ENOENT no es error:
// si el archivo ya no está, el estado final es el buscado.
export async function deleteNewsCover(fileName: string): Promise<void> {
  if (!isValidNewsImageName(fileName)) return;
  try {
    await unlink(path.join(newsImagesDir(), fileName));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
```

- [ ] **Step 4: Implementar el route handler**

`src/app/api/imagenes/noticias/[name]/route.ts`:

```ts
// Sirve las portadas de noticias. PÚBLICO a propósito (ver images.ts). La
// validación estricta del nombre es la defensa contra path traversal: nada
// que no sea `uuid.ext` de la allowlist toca el filesystem.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isValidNewsImageName, newsImagesDir } from "@/lib/news/images";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(_req: Request, ctx: RouteContext<"/api/imagenes/noticias/[name]">) {
  const { name } = await ctx.params;
  if (!isValidNewsImageName(name)) {
    return new Response("Not found", { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(newsImagesDir(), name));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      // El nombre es un UUID: el contenido de una URL dada no cambia nunca.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

Nota Next 16: el tipo `RouteContext<...>` es global (generado por `next dev`/`next build` en `.next/types`). Si `tsc` no lo encuentra al primer intento, correr `npm run dev` unos segundos o `npx next typegen` para regenerar tipos, y si sigue sin existir usar la forma explícita `{ params: Promise<{ name: string }> }`.

- [ ] **Step 5: Correr — debe pasar**

```bash
npx vitest run tests/news-images.test.ts
npx tsc --noEmit
```

Expected: PASS y exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/news/image-url.ts src/lib/news/images.ts src/app/api/imagenes tests/news-images.test.ts
git commit -m "feat(news): cover image storage and public immutable image route"
```

---

### Task 7: ABM de noticias — server actions

**Files:**
- Create: `src/app/admin/noticias/actions.ts`
- Create: `src/lib/news/schema.ts`
- Test: `tests/news-schema.test.ts`
- Test: `tests/news-actions-auth.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `parseForm`, `audit`, `slugify`, `sanitizeNewsBody`, `newsBodyIsEmpty`, `saveNewsCover`, `deleteNewsCover`, `CACHE_TAGS`.
- Produces: `createNewsAction`, `updateNewsAction`, `publishNewsAction`, `unpublishNewsAction`, `deleteNewsAction` — todas con firma `(prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>`; `newsFormSchema` en `src/lib/news/schema.ts`.

- [ ] **Step 1: Escribir `src/lib/news/schema.ts` con su test**

`src/lib/news/schema.ts`:

```ts
import { z } from "zod";

// El cuerpo llega como hidden input con el HTML del editor; acá solo se
// valida presencia/longitud — la sanitización es de sanitize.ts y corre en
// la action ANTES de persistir.
export const newsFormSchema = z.object({
  title: z.string().min(1, "Ingresá el título.").max(160, "El título no puede superar los 160 caracteres."),
  slug: z
    .string()
    .max(180, "La URL no puede superar los 180 caracteres.")
    .regex(/^[a-z0-9-]*$/, "La URL solo puede tener minúsculas, números y guiones.")
    .optional(),
  body: z.string().min(1, "Escribí el contenido de la noticia."),
  // checkbox "eliminar portada actual" del formulario de edición
  removeCover: z.literal("on").optional(),
});
```

`tests/news-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newsFormSchema } from "@/lib/news/schema";

describe("newsFormSchema", () => {
  it("acepta el mínimo válido", () => {
    const r = newsFormSchema.safeParse({ title: "Hola", body: "<p>x</p>" });
    expect(r.success).toBe(true);
  });
  it("rechaza slug con mayúsculas o espacios, con mensaje es-AR", () => {
    const r = newsFormSchema.safeParse({ title: "Hola", body: "<p>x</p>", slug: "Con Espacios" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("minúsculas");
  });
  it("exige título con mensaje es-AR", () => {
    const r = newsFormSchema.safeParse({ title: "", body: "<p>x</p>" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Ingresá el título.");
  });
});
```

Correr `npx vitest run tests/news-schema.test.ts` → FAIL → implementar → PASS.

- [ ] **Step 2: Implementar `src/app/admin/noticias/actions.ts`**

```ts
"use server";
import { headers } from "next/headers";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { newsFormSchema } from "@/lib/news/schema";
import { slugify } from "@/lib/news/slug";
import { newsBodyIsEmpty, sanitizeNewsBody } from "@/lib/news/sanitize";
import { deleteNewsCover, saveNewsCover } from "@/lib/news/images";
import { CACHE_TAGS } from "@/lib/news/query";

async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el resto del panel.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

const idSchema = z.object({ id: z.coerce.number().int().positive("Noticia inválida.") });

// El File NO pasa por parseForm (descarta no-strings a propósito): se lee
// directo del FormData. Devuelve undefined si el input vino vacío.
function coverFrom(formData: FormData): File | undefined {
  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) return undefined;
  return file;
}

type ActionState = { error?: string };

export async function createNewsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(newsFormSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const body = sanitizeNewsBody(parsed.data.body);
  if (newsBodyIsEmpty(body)) return { error: "Escribí el contenido de la noticia." };
  const slug = parsed.data.slug && parsed.data.slug !== "" ? parsed.data.slug : slugify(parsed.data.title);

  let coverImagePath: string | null = null;
  const cover = coverFrom(formData);
  if (cover) {
    const saved = await saveNewsCover(cover);
    if (!saved.ok) return { error: saved.error };
    coverImagePath = saved.fileName;
  }

  const ip = await clientIp();
  let newsId: number;
  try {
    const news = await prisma.news.create({
      data: { title: parsed.data.title, slug, body, coverImagePath, authorId: actor.actorId },
    });
    newsId = news.id;
    await audit({
      userId: actor.actorId, action: "news_create", entity: "news", entityId: news.id,
      detail: { title: parsed.data.title, slug }, ip,
    });
  } catch (e) {
    // La portada ya está en disco: si el INSERT falló, no dejar el huérfano.
    if (coverImagePath) await deleteNewsCover(coverImagePath);
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: "Ya existe una noticia con esa URL. Cambiá el campo URL." };
    }
    throw e;
  }
  updateTag(CACHE_TAGS.news);
  redirect(`/admin/noticias/${newsId}`);
}

export async function updateNewsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsedId = parseForm(idSchema, formData);
  if (!parsedId.ok) return { error: parsedId.error };
  const parsed = parseForm(newsFormSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const body = sanitizeNewsBody(parsed.data.body);
  if (newsBodyIsEmpty(body)) return { error: "Escribí el contenido de la noticia." };

  const existing = await prisma.news.findUnique({ where: { id: parsedId.data.id } });
  if (!existing) return { error: "La noticia no existe." };

  const slug = parsed.data.slug && parsed.data.slug !== "" ? parsed.data.slug : slugify(parsed.data.title);

  // Portada: nueva imagen reemplaza; checkbox removeCover borra; si no, queda.
  let coverImagePath = existing.coverImagePath;
  let newCover: string | null = null;
  const cover = coverFrom(formData);
  if (cover) {
    const saved = await saveNewsCover(cover);
    if (!saved.ok) return { error: saved.error };
    newCover = saved.fileName;
    coverImagePath = saved.fileName;
  } else if (parsed.data.removeCover === "on") {
    coverImagePath = null;
  }

  try {
    await prisma.news.update({
      where: { id: existing.id },
      data: { title: parsed.data.title, slug, body, coverImagePath },
    });
    await audit({
      userId: actor.actorId, action: "news_update", entity: "news", entityId: existing.id,
      detail: { title: parsed.data.title, slug }, ip: await clientIp(),
    });
  } catch (e) {
    if (newCover) await deleteNewsCover(newCover);
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: "Ya existe una noticia con esa URL. Cambiá el campo URL." };
    }
    throw e;
  }
  // Recién acá, con la fila ya actualizada, se borra la portada anterior.
  if (existing.coverImagePath && existing.coverImagePath !== coverImagePath) {
    await deleteNewsCover(existing.coverImagePath);
  }
  updateTag(CACHE_TAGS.news);
  redirect(`/admin/noticias/${existing.id}`);
}

export async function publishNewsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.news.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: "La noticia no existe." };
  if (existing.status === "published") return { error: "La noticia ya está publicada." };
  await prisma.news.update({
    where: { id: existing.id },
    // publishedAt se fija la PRIMERA vez y no se pisa al re-publicar.
    data: { status: "published", publishedAt: existing.publishedAt ?? new Date() },
  });
  await audit({
    userId: actor.actorId, action: "news_publish", entity: "news", entityId: existing.id,
    detail: { slug: existing.slug }, ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.news);
  redirect(`/admin/noticias/${existing.id}`);
}

export async function unpublishNewsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.news.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: "La noticia no existe." };
  if (existing.status !== "published") return { error: "La noticia no está publicada." };
  await prisma.news.update({ where: { id: existing.id }, data: { status: "draft" } });
  await audit({
    userId: actor.actorId, action: "news_unpublish", entity: "news", entityId: existing.id,
    detail: { slug: existing.slug }, ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.news);
  redirect(`/admin/noticias/${existing.id}`);
}

export async function deleteNewsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.news.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: "La noticia no existe." };
  await prisma.news.delete({ where: { id: existing.id } });
  if (existing.coverImagePath) await deleteNewsCover(existing.coverImagePath);
  await audit({
    userId: actor.actorId, action: "news_delete", entity: "news", entityId: existing.id,
    detail: { title: existing.title, slug: existing.slug, status: existing.status },
    ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.news);
  redirect("/admin/noticias");
}
```

Nota Next 16.3.1 (VERIFICADA contra `node_modules/next/.../revalidate.d.ts`): `revalidateTag(tag, profile)` exige un segundo argumento y NO sirve acá. Desde una server action corresponde **`updateTag(tag)`** (un solo argumento, semántica read-your-own-writes: el admin ve su propio cambio al instante). Usar `updateTag` en TODAS las actions de noticias, actividades y configuración.

- [ ] **Step 3: Test de autorización (cierra el gap señalado en la revisión del M1)**

`tests/news-actions-auth.test.ts` — con `vi.mock` de todos los módulos con efectos:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  news: {
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: false, reason: "anonymous", error: "Sesión inválida." })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  createNewsAction, deleteNewsAction, publishNewsAction, unpublishNewsAction, updateNewsAction,
} from "@/app/admin/noticias/actions";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

describe("autorización de las actions de noticias", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<[string, (p: { error?: string }, f: FormData) => Promise<{ error?: string }>, FormData]> = [
    ["create", createNewsAction, form({ title: "x", body: "<p>x</p>" })],
    ["update", updateNewsAction, form({ id: "1", title: "x", body: "<p>x</p>" })],
    ["publish", publishNewsAction, form({ id: "1" })],
    ["unpublish", unpublishNewsAction, form({ id: "1" })],
    ["delete", deleteNewsAction, form({ id: "1" })],
  ];

  for (const [name, action, fd] of cases) {
    it(`${name}: sin sesión devuelve error y no toca la base`, async () => {
      const result = await action({}, fd);
      expect(result.error).toBe("Sesión inválida.");
      expect(prismaMock.news.create).not.toHaveBeenCalled();
      expect(prismaMock.news.update).not.toHaveBeenCalled();
      expect(prismaMock.news.delete).not.toHaveBeenCalled();
    });
  }
});
```

- [ ] **Step 4: Correr — debe pasar**

```bash
npx vitest run tests/news-actions-auth.test.ts tests/news-schema.test.ts
npx tsc --noEmit
```

Expected: PASS (si `vi.mock` de `next/cache` choca con el import real dentro de `@/lib/news/query`, el mock de arriba ya lo cubre porque reemplaza el módulo entero).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/noticias/actions.ts src/lib/news/schema.ts tests/news-schema.test.ts tests/news-actions-auth.test.ts
git commit -m "feat(news): admin CRUD server actions with audit and cache invalidation"
```

---

### Task 8: ABM de noticias — UI (editor Tiptap, listado, formularios)

**Files:**
- Create: `src/components/admin/news-editor.tsx`
- Create: `src/app/admin/noticias/page.tsx`
- Create: `src/app/admin/noticias/nueva/page.tsx`
- Create: `src/app/admin/noticias/news-form.tsx`
- Create: `src/app/admin/noticias/[id]/page.tsx`
- Modify: `src/app/admin/page.tsx` (activar la Card "Noticias")

**Interfaces:**
- Consumes: actions de Task 7, `newsQueries.allForAdmin()`, `newsImageUrl`, `formatDateAR`, componentes shadcn (`Button`, `Table`, `Badge`, `Input`, `Label`).
- Produces: `NewsEditor` (client component: `{ name: string; initialHtml: string }` — escribe el HTML serializado en un hidden input `name`); `NewsForm` (client: `{ mode: "create" } | { mode: "edit"; news: { id: number; title: string; slug: string; body: string; coverImagePath: string | null; status: "draft" | "published" } }`).

- [ ] **Step 1: Implementar `src/components/admin/news-editor.tsx`**

```tsx
"use client";
// Editor visual de noticias (Tiptap v3, alcance BÁSICO decidido en la
// entrevista: negrita, cursiva, subrayado, H2/H3, listas, links). El HTML
// viaja en un hidden input y se sanitiza SIEMPRE en el servidor: esta
// toolbar es UX, no seguridad.
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const BTN = "h-8 min-w-8 px-2 text-xs";

export function NewsEditor({ name, initialHtml }: { name: string; initialHtml: string }) {
  const [html, setHtml] = useState(initialHtml);
  const editor = useEditor({
    // Requerido en App Router: sin esto Tiptap intenta renderizar en SSR y
    // rompe la hidratación.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Fuera lo que la allowlist del server no acepta:
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
    ],
    content: initialHtml,
    onUpdate: ({ editor }) => setHtml(editor.getHTML()),
  });

  if (!editor) {
    return <div className="min-h-40 rounded-md border p-3 text-sm text-muted-foreground">Cargando editor…</div>;
  }

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL del enlace (https://…)", prev ?? "https://");
    if (url === null) return;
    if (url === "" || url === "https://") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  };

  const mark = (active: boolean) => (active ? "default" : "outline") as "default" | "outline";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Formato del texto">
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Negrita"><strong>B</strong></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Cursiva"><em>I</em></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Subrayado"><u>S</u></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("heading", { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("heading", { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Lista">• Lista</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("orderedList"))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Lista numerada">1. Lista</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("link"))}
          onClick={setLink} aria-label="Enlace">Link</Button>
      </div>
      <EditorContent
        editor={editor}
        className="prose-news min-h-40 rounded-md border p-3 text-sm [&_.tiptap]:outline-none"
      />
      <input type="hidden" name={name} value={html} />
    </div>
  );
}
```

Nota: en Tiptap v3 el StarterKit ya incluye `Link` y `Underline`; si la versión instalada no los trae (error `underline is not a mark`), instalar `@tiptap/extension-link` y `@tiptap/extension-underline` y agregarlos al array `extensions`.

- [ ] **Step 2: Estilos del contenido**

En `src/app/globals.css`, al final, estilos mínimos para el HTML de noticia (editor y página pública comparten clase):

```css
/* Cuerpo de noticias: el mismo HTML se ve en el editor del panel y en la
   página pública. Sin plugin de tipografía: solo lo que la allowlist permite. */
.prose-news h2 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; }
.prose-news h3 { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
.prose-news p { margin: 0.5rem 0; line-height: 1.6; }
.prose-news ul { list-style: disc; padding-left: 1.5rem; margin: 0.5rem 0; }
.prose-news ol { list-style: decimal; padding-left: 1.5rem; margin: 0.5rem 0; }
.prose-news a { color: var(--primary); text-decoration: underline; }
```

- [ ] **Step 3: Implementar `src/app/admin/noticias/news-form.tsx`**

```tsx
"use client";
import Image from "next/image";
import { useActionState } from "react";
import { createNewsAction, deleteNewsAction, publishNewsAction, unpublishNewsAction, updateNewsAction } from "./actions";
import { NewsEditor } from "@/components/admin/news-editor";
import { useSyncedForm, TextField } from "@/components/admin/synced-fields";
// image-url, NO images: este es un client component y images.ts importa node:fs.
import { newsImageUrl } from "@/lib/news/image-url";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type EditableNews = {
  id: number; title: string; slug: string; body: string;
  coverImagePath: string | null; status: "draft" | "published";
};

export function NewsForm(props: { mode: "create" } | { mode: "edit"; news: EditableNews }) {
  const editing = props.mode === "edit" ? props.news : null;
  const [state, formAction, pending] = useActionState(
    editing ? updateNewsAction : createNewsAction, {},
  );
  const { formRef, field } = useSyncedForm({
    title: editing?.title ?? "",
    slug: editing?.slug ?? "",
  });

  return (
    <form ref={formRef} action={formAction} className="max-w-2xl space-y-4">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <TextField label="Título" field={field("title")} maxLength={160} autoFocus />
      <TextField
        label="URL (opcional)"
        field={field("slug", (raw) => raw.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
        maxLength={180}
        hint="Se genera sola desde el título si la dejás vacía. Cambiarla rompe el enlace anterior."
      />
      <div className="space-y-1">
        <Label htmlFor="cover">Imagen de portada (JPG, PNG o WebP, máx. 5 MB)</Label>
        <input
          id="cover" name="cover" type="file" accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5"
        />
        {editing?.coverImagePath && (
          <div className="flex items-center gap-3 pt-1">
            <Image src={newsImageUrl(editing.coverImagePath)} alt="Portada actual" width={120} height={80}
              className="h-20 w-auto rounded border object-cover" unoptimized />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="removeCover" /> Quitar la portada actual
            </label>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <Label>Contenido</Label>
        <NewsEditor name="body" initialHtml={editing?.body ?? ""} />
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear noticia"}
        </Button>
      </div>
    </form>
  );
}

// Botonera de estado: publicar / despublicar / eliminar. Forms separados
// porque cada action es un endpoint distinto.
export function NewsStateButtons({ news }: { news: EditableNews }) {
  const [pubState, publish, pubPending] = useActionState(publishNewsAction, {});
  const [unpubState, unpublish, unpubPending] = useActionState(unpublishNewsAction, {});
  const [delState, del, delPending] = useActionState(deleteNewsAction, {});
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {news.status === "draft" ? (
          <form action={publish}>
            <input type="hidden" name="id" value={news.id} />
            <Button type="submit" disabled={pubPending}>{pubPending ? "Publicando…" : "Publicar"}</Button>
          </form>
        ) : (
          <form action={unpublish}>
            <input type="hidden" name="id" value={news.id} />
            <Button type="submit" variant="secondary" disabled={unpubPending}>
              {unpubPending ? "Despublicando…" : "Volver a borrador"}
            </Button>
          </form>
        )}
        <form
          action={del}
          onSubmit={(e) => {
            if (!window.confirm("¿Eliminar esta noticia? Esta acción no se puede deshacer.")) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={news.id} />
          <Button type="submit" variant="destructive" disabled={delPending}>
            {delPending ? "Eliminando…" : "Eliminar"}
          </Button>
        </form>
      </div>
      {(pubState.error || unpubState.error || delState.error) && (
        <p role="alert" className="text-sm text-destructive">
          {pubState.error ?? unpubState.error ?? delState.error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implementar el listado `src/app/admin/noticias/page.tsx`**

```tsx
import Link from "next/link";
import { newsQueries } from "@/lib/news/query";
import { formatDateAR } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Noticias — SIGeV" };

const STATUS_LABELS = { draft: "Borrador", published: "Publicada" } as const;

export default async function AdminNewsPage() {
  const rows = await newsQueries.allForAdmin();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Noticias</h1>
        <Button asChild><Link href="/admin/noticias/nueva">Nueva noticia</Link></Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay noticias. Las publicadas aparecen en la portada del sitio y en /noticias.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead><TableHead>Estado</TableHead>
              <TableHead>Publicada</TableHead><TableHead>Autor/a</TableHead>
              <TableHead><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((n) => (
              <TableRow key={n.id}>
                <TableCell>
                  <Link className="text-primary hover:underline" href={`/admin/noticias/${n.id}`}>{n.title}</Link>
                </TableCell>
                <TableCell>
                  <Badge variant={n.status === "published" ? "default" : "secondary"}>{STATUS_LABELS[n.status]}</Badge>
                </TableCell>
                <TableCell>{n.publishedAtIso ? formatDateAR(new Date(n.publishedAtIso)) : "—"}</TableCell>
                <TableCell>{n.authorName ?? "—"}</TableCell>
                <TableCell>
                  <Link className="text-sm text-primary hover:underline" href={`/admin/noticias/${n.id}`}>Editar</Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implementar alta y edición**

`src/app/admin/noticias/nueva/page.tsx`:

```tsx
import { NewsForm } from "../news-form";

export const metadata = { title: "Nueva noticia — SIGeV" };

export default function NewNewsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nueva noticia</h1>
      <NewsForm mode="create" />
    </div>
  );
}
```

`src/app/admin/noticias/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { NewsForm, NewsStateButtons } from "../news-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar noticia — SIGeV" };

export default async function EditNewsPage({ params }: PageProps<"/admin/noticias/[id]">) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  const news = await prisma.news.findUnique({ where: { id: numericId } });
  if (!news) notFound();
  const editable = {
    id: news.id, title: news.title, slug: news.slug, body: news.body,
    coverImagePath: news.coverImagePath, status: news.status as "draft" | "published",
  };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Editar noticia</h1>
        {news.status === "published" && (
          <Link className="text-sm text-primary hover:underline" href={`/noticias/${news.slug}`}>
            Ver en el sitio
          </Link>
        )}
      </div>
      <NewsStateButtons news={editable} />
      <NewsForm mode="edit" news={editable} />
    </div>
  );
}
```

Nota Next 16: `PageProps<"...">` es un tipo global generado; si no existe aún, usar `{ params: Promise<{ id: string }> }`.

- [ ] **Step 6: Activar la Card en `src/app/admin/page.tsx`**

Reemplazar la línea 18:

```ts
  { title: "Noticias", description: "Novedades y comunicados del sitio público.", href: "/admin/noticias", cta: "Gestionar noticias" },
```

- [ ] **Step 7: Verificación manual con el dev server**

Correr el dev server y verificar en el browser: crear una noticia con portada, ver que el error de validación NO borra lo tipeado, publicarla, verla listada con Badge "Publicada", eliminarla y comprobar que el archivo desaparece de `./uploads/news/`.

```bash
npx tsc --noEmit && npm run lint
```

Expected: exit 0 en ambos.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/news-editor.tsx src/app/admin/noticias src/app/admin/page.tsx src/app/globals.css
git commit -m "feat(news): admin news management UI with Tiptap editor"
```

---

### Task 9: Dominio de actividades — reglas, grilla y queries

**Files:**
- Create: `src/lib/activities/rules.ts`
- Create: `src/lib/activities/query.ts`
- Test: `tests/activities-rules.test.ts`

**Interfaces:**
- Consumes: `CACHE_TAGS` de `src/lib/news/query.ts`.
- Produces:
  - `WEEKDAYS: Array<[number, string]>` = `[[1,"Lunes"],[2,"Martes"],[3,"Miércoles"],[4,"Jueves"],[5,"Viernes"],[6,"Sábado"],[7,"Domingo"]]`
  - `ROOM_LABELS: Record<"historic" | "glass", string>` (desde `SITE.rooms`)
  - `parseWeekdays(raw: string[]): { ok: true; value: number[] } | { ok: false; error: string }`
  - `timeToMinutes(hhmm: string): number | null` (null si no matchea `/^([01]\d|2[0-3]):[0-5]\d$/`)
  - `type ActivitySlot = { id: number; name: string; room: "historic" | "glass"; weekdays: number[]; startTime: string; endTime: string; year: number; active: boolean }`
  - `findOverlap(candidate: Omit<ActivitySlot, "id"> & { id?: number }, existing: ActivitySlot[]): ActivitySlot | null` — ignora inactivas, otras salas, otros años y el propio `id` en edición
  - `buildWeeklyGrid(activities: ActivitySlot[]): Record<"historic" | "glass", Record<number, Array<{ id: number; name: string; startTime: string; endTime: string }>>>` — solo activas, ordenadas por `startTime` dentro de cada día
  - En `query.ts`: `getActivitiesForYear(year: number)` cacheada con tag `activities` (DTO plano, sin Dates) y `activityYears(): Promise<number[]>` (años distintos con actividades activas, desc) también cacheada; `activitiesQueries.allForAdmin(year?: number)` sin caché.

- [ ] **Step 1: Escribir el test que falla**

`tests/activities-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildWeeklyGrid, findOverlap, parseWeekdays, timeToMinutes } from "@/lib/activities/rules";

const slot = (over: Record<string, unknown> = {}) => ({
  id: 1, name: "Gimnasia mujeres", room: "historic" as const,
  weekdays: [1, 3], startTime: "18:00", endTime: "19:30", year: 2026, active: true,
  ...over,
});

describe("parseWeekdays", () => {
  it("acepta días válidos y los ordena sin duplicados", () => {
    expect(parseWeekdays(["3", "1", "3"])).toEqual({ ok: true, value: [1, 3] });
  });
  it("rechaza vacío y valores fuera de 1-7 con mensaje es-AR", () => {
    expect(parseWeekdays([]).ok).toBe(false);
    expect(parseWeekdays(["0"]).ok).toBe(false);
    expect(parseWeekdays(["8"]).ok).toBe(false);
    expect(parseWeekdays(["x"]).ok).toBe(false);
  });
});

describe("timeToMinutes", () => {
  it("convierte y valida", () => {
    expect(timeToMinutes("18:30")).toBe(1110);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("9:00")).toBeNull();
  });
});

describe("findOverlap", () => {
  it("detecta solape parcial en mismo salón, año y día", () => {
    const hit = findOverlap(slot({ id: undefined, startTime: "19:00", endTime: "20:00" }), [slot()]);
    expect(hit?.name).toBe("Gimnasia mujeres");
  });
  it("borde exacto NO es solape (19:30 empieza cuando 19:30 termina)", () => {
    expect(findOverlap(slot({ id: undefined, startTime: "19:30", endTime: "20:30" }), [slot()])).toBeNull();
  });
  it("otro salón, otro año, día sin intersección o inactiva: no chocan", () => {
    expect(findOverlap(slot({ id: undefined, room: "glass" }), [slot()])).toBeNull();
    expect(findOverlap(slot({ id: undefined, year: 2027 }), [slot()])).toBeNull();
    expect(findOverlap(slot({ id: undefined, weekdays: [2, 4] }), [slot()])).toBeNull();
    expect(findOverlap(slot({ id: undefined }), [slot({ active: false })])).toBeNull();
  });
  it("en edición se ignora a sí misma", () => {
    expect(findOverlap(slot({ id: 1 }), [slot()])).toBeNull();
  });
});

describe("buildWeeklyGrid", () => {
  it("agrupa por salón y día, ordena por hora y excluye inactivas", () => {
    const grid = buildWeeklyGrid([
      slot({ id: 2, name: "Taekwondo niños", room: "glass", weekdays: [2], startTime: "10:00", endTime: "11:00" }),
      slot({ id: 3, name: "Yoga", room: "glass", weekdays: [2], startTime: "08:00", endTime: "09:00" }),
      slot({ id: 4, name: "Apagada", room: "glass", weekdays: [2], active: false }),
    ]);
    expect(grid.glass[2].map((a) => a.name)).toEqual(["Yoga", "Taekwondo niños"]);
    expect(grid.historic[1].map((a) => a.name)).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr — debe fallar**

```bash
npx vitest run tests/activities-rules.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/activities/rules.ts`**

```ts
// Reglas del calendario de salones. Los dos salones son un espacio físico:
// dos actividades activas del mismo salón y año no pueden pisarse en día y
// horario — el alta que choca se rechaza nombrando a la actividad existente.
import { SITE } from "@/lib/site";

export const WEEKDAYS: Array<[number, string]> = [
  [1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"],
  [5, "Viernes"], [6, "Sábado"], [7, "Domingo"],
];

export const ROOM_LABELS: Record<"historic" | "glass", string> = SITE.rooms;

export type ActivitySlot = {
  id: number;
  name: string;
  room: "historic" | "glass";
  weekdays: number[];
  startTime: string;
  endTime: string;
  year: number;
  active: boolean;
};

export function parseWeekdays(raw: string[]): { ok: true; value: number[] } | { ok: false; error: string } {
  if (raw.length === 0) return { ok: false, error: "Elegí al menos un día de la semana." };
  const days = [...new Set(raw.map((r) => Number(r)))].sort((a, b) => a - b);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return { ok: false, error: "Día de la semana inválido." };
  }
  return { ok: true, value: days };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function timeToMinutes(hhmm: string): number | null {
  if (!TIME_RE.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function findOverlap(
  candidate: Omit<ActivitySlot, "id"> & { id?: number },
  existing: ActivitySlot[],
): ActivitySlot | null {
  const start = timeToMinutes(candidate.startTime);
  const end = timeToMinutes(candidate.endTime);
  if (start === null || end === null) return null;
  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (!other.active || !candidate.active) continue;
    if (other.room !== candidate.room || other.year !== candidate.year) continue;
    if (!other.weekdays.some((d) => candidate.weekdays.includes(d))) continue;
    const oStart = timeToMinutes(other.startTime);
    const oEnd = timeToMinutes(other.endTime);
    if (oStart === null || oEnd === null) continue;
    // Solape estricto: compartir el borde exacto (una termina 19:30, la otra
    // empieza 19:30) es válido.
    if (start < oEnd && oStart < end) return other;
  }
  return null;
}

export function buildWeeklyGrid(activities: ActivitySlot[]) {
  const empty = () => Object.fromEntries(WEEKDAYS.map(([d]) => [d, []])) as Record<
    number,
    Array<{ id: number; name: string; startTime: string; endTime: string }>
  >;
  const grid = { historic: empty(), glass: empty() };
  for (const a of activities) {
    if (!a.active) continue;
    for (const d of a.weekdays) {
      grid[a.room][d]?.push({ id: a.id, name: a.name, startTime: a.startTime, endTime: a.endTime });
    }
  }
  for (const room of ["historic", "glass"] as const) {
    for (const [d] of WEEKDAYS) {
      grid[room][d].sort((x, y) => (timeToMinutes(x.startTime) ?? 0) - (timeToMinutes(y.startTime) ?? 0));
    }
  }
  return grid;
}
```

- [ ] **Step 4: Implementar `src/lib/activities/query.ts`**

```ts
// Consultas del calendario. Igual que las de noticias: DTOs planos (acá no
// hay Dates de todos modos) y singletons cacheados con tag para el público.
import { unstable_cache } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CACHE_TAGS } from "@/lib/news/query";
import type { ActivitySlot } from "@/lib/activities/rules";

type Db = Pick<PrismaClient, "activity">;

function toSlot(a: {
  id: number; name: string; room: string; weekdays: unknown;
  startTime: string; endTime: string; year: number; active: boolean;
}): ActivitySlot {
  return {
    id: a.id,
    name: a.name,
    room: a.room as "historic" | "glass",
    weekdays: Array.isArray(a.weekdays) ? (a.weekdays as number[]) : [],
    startTime: a.startTime,
    endTime: a.endTime,
    year: a.year,
    active: a.active,
  };
}

export function makeActivityQueries(db: Db) {
  return {
    async forYear(year: number): Promise<ActivitySlot[]> {
      const rows = await db.activity.findMany({ where: { year, active: true }, orderBy: { name: "asc" } });
      return rows.map(toSlot);
    },
    async years(): Promise<number[]> {
      const rows = await db.activity.findMany({
        where: { active: true },
        select: { year: true },
        distinct: ["year"],
        orderBy: { year: "desc" },
      });
      return rows.map((r) => r.year);
    },
    async allForAdmin(year?: number): Promise<ActivitySlot[]> {
      const rows = await db.activity.findMany({
        where: year ? { year } : undefined,
        orderBy: [{ year: "desc" }, { room: "asc" }, { startTime: "asc" }],
      });
      return rows.map(toSlot);
    },
  };
}

export const activitiesQueries = makeActivityQueries(prisma);

export const getActivitiesForYear = unstable_cache(
  (year: number) => activitiesQueries.forYear(year),
  ["activities-for-year"],
  { tags: [CACHE_TAGS.activities] },
);
export const getActivityYears = unstable_cache(() => activitiesQueries.years(), ["activity-years"], {
  tags: [CACHE_TAGS.activities],
});
```

- [ ] **Step 5: Correr — debe pasar**

```bash
npx vitest run tests/activities-rules.test.ts
npx tsc --noEmit
```

Expected: PASS y exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/activities tests/activities-rules.test.ts
git commit -m "feat(activities): overlap rules, weekly grid and cached queries"
```

---

### Task 10: ABM de actividades — actions y UI

**Files:**
- Create: `src/app/admin/actividades/actions.ts`
- Create: `src/app/admin/actividades/page.tsx`
- Create: `src/app/admin/actividades/nueva/page.tsx`
- Create: `src/app/admin/actividades/[id]/page.tsx`
- Create: `src/app/admin/actividades/activity-form.tsx`
- Modify: `src/app/admin/page.tsx` (agregar Card "Actividades")
- Test: `tests/activities-actions-auth.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `parseForm`, `audit`, `parseWeekdays`, `timeToMinutes`, `findOverlap`, `ROOM_LABELS`, `WEEKDAYS`, `activitiesQueries`, `CACHE_TAGS`.
- Produces: `createActivityAction`, `updateActivityAction`, `deleteActivityAction` (misma firma `(prev, formData)` de siempre); `ActivityForm` client component.

- [ ] **Step 1: Implementar `src/app/admin/actividades/actions.ts`**

```ts
"use server";
import { headers } from "next/headers";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { findOverlap, parseWeekdays, timeToMinutes } from "@/lib/activities/rules";
import { activitiesQueries } from "@/lib/activities/query";
import { CACHE_TAGS } from "@/lib/news/query";

async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

const activitySchema = z.object({
  name: z.string().min(1, "Ingresá el nombre de la actividad.").max(120, "El nombre no puede superar los 120 caracteres."),
  room: z.enum(["historic", "glass"], { error: "Elegí el salón." }),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora de inicio inválida."),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora de fin inválida."),
  year: z.coerce.number().int().min(2024, "Año inválido.").max(2100, "Año inválido."),
  active: z.literal("on").optional(),
});

const idSchema = z.object({ id: z.coerce.number().int().positive("Actividad inválida.") });

type ActionState = { error?: string };

// Valida el formulario completo (campos + weekdays fuera de parseForm porque
// son checkboxes múltiples) y la regla de solapamiento. Devuelve los datos
// listos para escribir o el error redactado.
async function validateActivity(formData: FormData, selfId?: number) {
  const parsed = parseForm(activitySchema, formData);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  const weekdays = parseWeekdays(formData.getAll("weekdays").map(String));
  if (!weekdays.ok) return { ok: false as const, error: weekdays.error };
  const start = timeToMinutes(parsed.data.startTime);
  const end = timeToMinutes(parsed.data.endTime);
  if (start === null || end === null || start >= end) {
    return { ok: false as const, error: "La hora de fin tiene que ser posterior a la de inicio." };
  }
  const candidate = {
    id: selfId,
    name: parsed.data.name,
    room: parsed.data.room,
    weekdays: weekdays.value,
    startTime: parsed.data.startTime,
    endTime: parsed.data.endTime,
    year: parsed.data.year,
    active: parsed.data.active === "on",
  };
  if (candidate.active) {
    const existing = await activitiesQueries.allForAdmin(candidate.year);
    const clash = findOverlap(candidate, existing);
    if (clash) {
      return {
        ok: false as const,
        error: `Se superpone con "${clash.name}" (${clash.startTime}–${clash.endTime}) en el mismo salón. Ajustá el horario o los días.`,
      };
    }
  }
  return { ok: true as const, data: candidate };
}

export async function createActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const validated = await validateActivity(formData);
  if (!validated.ok) return { error: validated.error };
  const { id: _ignored, ...data } = validated.data;
  const activity = await prisma.activity.create({ data });
  await audit({
    userId: actor.actorId, action: "activity_create", entity: "activity", entityId: activity.id,
    detail: { name: data.name, room: data.room, year: data.year }, ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.activities);
  redirect("/admin/actividades");
}

export async function updateActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsedId = parseForm(idSchema, formData);
  if (!parsedId.ok) return { error: parsedId.error };
  const existing = await prisma.activity.findUnique({ where: { id: parsedId.data.id } });
  if (!existing) return { error: "La actividad no existe." };
  const validated = await validateActivity(formData, existing.id);
  if (!validated.ok) return { error: validated.error };
  const { id: _ignored, ...data } = validated.data;
  await prisma.activity.update({ where: { id: existing.id }, data });
  await audit({
    userId: actor.actorId, action: "activity_update", entity: "activity", entityId: existing.id,
    detail: { name: data.name, room: data.room, year: data.year }, ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.activities);
  redirect("/admin/actividades");
}

export async function deleteActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.activity.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: "La actividad no existe." };
  await prisma.activity.delete({ where: { id: existing.id } });
  await audit({
    userId: actor.actorId, action: "activity_delete", entity: "activity", entityId: existing.id,
    detail: { name: existing.name, room: existing.room, year: existing.year }, ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.activities);
  redirect("/admin/actividades");
}
```

- [ ] **Step 2: Test de autorización**

`tests/activities-actions-auth.test.ts` — mismo esquema que el de noticias:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = { activity: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() } };
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: false, reason: "anonymous", error: "Sesión inválida." })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { createActivityAction, deleteActivityAction, updateActivityAction } from "@/app/admin/actividades/actions";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

describe("autorización de las actions de actividades", () => {
  beforeEach(() => vi.clearAllMocks());
  const cases = [
    ["create", createActivityAction, form({ name: "x", room: "glass", startTime: "10:00", endTime: "11:00", year: "2026" })],
    ["update", updateActivityAction, form({ id: "1", name: "x", room: "glass", startTime: "10:00", endTime: "11:00", year: "2026" })],
    ["delete", deleteActivityAction, form({ id: "1" })],
  ] as const;
  for (const [name, action, fd] of cases) {
    it(`${name}: sin sesión devuelve error y no toca la base`, async () => {
      const result = await action({}, fd);
      expect(result.error).toBe("Sesión inválida.");
      expect(prismaMock.activity.create).not.toHaveBeenCalled();
      expect(prismaMock.activity.update).not.toHaveBeenCalled();
      expect(prismaMock.activity.delete).not.toHaveBeenCalled();
    });
  }
});
```

Correr `npx vitest run tests/activities-actions-auth.test.ts` → PASS.

- [ ] **Step 3: Implementar `src/app/admin/actividades/activity-form.tsx`**

```tsx
"use client";
import { useActionState } from "react";
import { createActivityAction, deleteActivityAction, updateActivityAction } from "./actions";
import { useSyncedForm, SelectField, TextField } from "@/components/admin/synced-fields";
import { ROOM_LABELS, WEEKDAYS, type ActivitySlot } from "@/lib/activities/rules";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function ActivityForm(props: { mode: "create" } | { mode: "edit"; activity: ActivitySlot }) {
  const editing = props.mode === "edit" ? props.activity : null;
  const [state, formAction, pending] = useActionState(
    editing ? updateActivityAction : createActivityAction, {},
  );
  const { values, setValue, formRef, field } = useSyncedForm({
    name: editing?.name ?? "",
    room: editing?.room ?? "historic",
    startTime: editing?.startTime ?? "",
    endTime: editing?.endTime ?? "",
    year: String(editing?.year ?? new Date().getFullYear()),
    // weekdays y active se manejan aparte (checkboxes)
    weekdaysCsv: (editing?.weekdays ?? []).join(","),
    active: editing ? (editing.active ? "on" : "") : "on",
  });
  const selectedDays = values.weekdaysCsv === "" ? [] : values.weekdaysCsv.split(",").map(Number);
  const toggleDay = (d: number) => {
    const next = selectedDays.includes(d) ? selectedDays.filter((x) => x !== d) : [...selectedDays, d].sort((a, b) => a - b);
    setValue("weekdaysCsv", next.join(","));
  };

  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-4">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <TextField label="Nombre de la actividad" field={field("name")} maxLength={120} autoFocus
        placeholder="Ej.: Gimnasia mujeres" />
      <SelectField label="Salón" field={field("room")}
        options={[["historic", ROOM_LABELS.historic], ["glass", ROOM_LABELS.glass]]} />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Días de la semana</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map(([d, label]) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="weekdays" value={d}
                checked={selectedDays.includes(d)} onChange={() => toggleDay(d)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Desde" field={field("startTime")} type="text" placeholder="18:00" maxLength={5}
          hint="Formato 24 hs, HH:MM" />
        <TextField label="Hasta" field={field("endTime")} type="text" placeholder="19:30" maxLength={5} />
      </div>
      <TextField label="Año de vigencia" field={field("year", (r) => r.replace(/\D/g, ""))} inputMode="numeric" maxLength={4} />
      <div className="space-y-1">
        <Label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" checked={values.active === "on"}
            onChange={(e) => setValue("active", e.target.checked ? "on" : "")} />
          Visible en el sitio público
        </Label>
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear actividad"}
      </Button>
    </form>
  );
}

export function DeleteActivityButton({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(deleteActivityAction, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("¿Eliminar esta actividad del calendario?")) e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {pending ? "Eliminando…" : "Eliminar"}
      </Button>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
```

Nota: los checkboxes de `weekdays` están controlados vía el estado `weekdaysCsv` (string, porque `useSyncedForm` maneja `Record<string, string>`), así un rechazo de la action no borra la selección.

- [ ] **Step 4: Implementar listado y páginas**

`src/app/admin/actividades/page.tsx`:

```tsx
import Link from "next/link";
import { activitiesQueries } from "@/lib/activities/query";
import { ROOM_LABELS, WEEKDAYS } from "@/lib/activities/rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteActivityButton } from "./activity-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Actividades — SIGeV" };

const DAY_SHORT = new Map(WEEKDAYS.map(([d, l]) => [d, l.slice(0, 3)]));

export default async function AdminActivitiesPage({ searchParams }: PageProps<"/admin/actividades">) {
  const sp = await searchParams;
  const yearRaw = typeof sp.year === "string" ? Number(sp.year) : undefined;
  const year = yearRaw && Number.isInteger(yearRaw) ? yearRaw : undefined;
  const rows = await activitiesQueries.allForAdmin(year);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Actividades de los salones</h1>
        <Button asChild><Link href="/admin/actividades/nueva">Nueva actividad</Link></Button>
      </div>
      <form method="get" className="flex items-end gap-2">
        <div>
          <label htmlFor="year" className="block text-sm font-medium">Año</label>
          <input id="year" name="year" type="number" defaultValue={year ?? ""} placeholder="Todos"
            className="h-9 w-28 rounded-md border px-2 text-sm" />
        </div>
        <Button type="submit" variant="outline">Filtrar</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay actividades cargadas{year ? ` para ${year}` : ""}. Las activas se muestran en la
          página pública /actividades.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Actividad</TableHead><TableHead>Salón</TableHead><TableHead>Días</TableHead>
              <TableHead>Horario</TableHead><TableHead>Año</TableHead><TableHead>Estado</TableHead>
              <TableHead><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link className="text-primary hover:underline" href={`/admin/actividades/${a.id}`}>{a.name}</Link>
                </TableCell>
                <TableCell>{ROOM_LABELS[a.room]}</TableCell>
                <TableCell>{a.weekdays.map((d) => DAY_SHORT.get(d)).join(", ")}</TableCell>
                <TableCell>{a.startTime}–{a.endTime}</TableCell>
                <TableCell>{a.year}</TableCell>
                <TableCell>
                  <Badge variant={a.active ? "default" : "secondary"}>{a.active ? "Activa" : "Oculta"}</Badge>
                </TableCell>
                <TableCell><DeleteActivityButton id={a.id} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

`src/app/admin/actividades/nueva/page.tsx`:

```tsx
import { ActivityForm } from "../activity-form";

export const metadata = { title: "Nueva actividad — SIGeV" };

export default function NewActivityPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nueva actividad</h1>
      <ActivityForm mode="create" />
    </div>
  );
}
```

`src/app/admin/actividades/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ActivityForm } from "../activity-form";
import type { ActivitySlot } from "@/lib/activities/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar actividad — SIGeV" };

export default async function EditActivityPage({ params }: PageProps<"/admin/actividades/[id]">) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  const a = await prisma.activity.findUnique({ where: { id: numericId } });
  if (!a) notFound();
  const activity: ActivitySlot = {
    id: a.id, name: a.name, room: a.room as "historic" | "glass",
    weekdays: Array.isArray(a.weekdays) ? (a.weekdays as number[]) : [],
    startTime: a.startTime, endTime: a.endTime, year: a.year, active: a.active,
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Editar actividad</h1>
      <ActivityForm mode="edit" activity={activity} />
    </div>
  );
}
```

En `src/app/admin/page.tsx`, agregar a `sections` (después de "Actas"):

```ts
  {
    title: "Actividades",
    description: "Calendario de los salones Histórico y Vidriado.",
    href: "/admin/actividades",
    cta: "Ver el calendario",
  },
```

- [ ] **Step 5: Verificar**

```bash
npx vitest run tests/activities-actions-auth.test.ts && npx tsc --noEmit && npm run lint
```

Expected: todo verde. Verificación manual en el dev server: crear "Gimnasia mujeres — Salón Histórico — lunes y miércoles 18:00–19:30 — 2026"; intentar crear otra pisada en el horario → debe rechazar nombrando a la primera.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/actividades src/app/admin/page.tsx tests/activities-actions-auth.test.ts
git commit -m "feat(activities): admin CRUD with overlap validation"
```

---

### Task 11: Pantalla de configuración (superadmin)

**Files:**
- Create: `src/app/admin/configuracion/actions.ts`
- Create: `src/app/admin/configuracion/page.tsx`
- Create: `src/app/admin/configuracion/config-form.tsx`
- Modify: `src/app/admin/page.tsx` (activar Card "Configuración")
- Test: `tests/config-actions-auth.test.ts`

**Interfaces:**
- Consumes: `requireSuperadmin`, `CONFIG_KEYS`, `configReader`, `audit`, `CACHE_TAGS`, `parseForm`.
- Produces: `updateConfigAction(prev, formData)`; page muestra el formulario solo si `requireSuperadmin()` pasa.

- [ ] **Step 1: Implementar `src/app/admin/configuracion/actions.ts`**

```ts
"use server";
import { headers } from "next/headers";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { CONFIG_KEYS } from "@/lib/config";
import { CACHE_TAGS } from "@/lib/news/query";

const schema = z.object({
  asociateActivo: z.literal("on").optional(),
  contactPhone: z.string().max(40, "El teléfono no puede superar los 40 caracteres.").optional(),
  contactEmail: z.email("El email de contacto no es válido.").max(191).optional(),
});

export async function updateConfigAction(
  _prev: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // SIEMPRE valores JSON simples: boolean para el flag, string para el
  // contacto ("" = sin valor; configReader.getString ya devuelve null para
  // ""). Así se evita el borde de `Json null` de Prisma.
  const entries: Array<[string, boolean | string]> = [
    [CONFIG_KEYS.asociateActivo, parsed.data.asociateActivo === "on"],
    [CONFIG_KEYS.contactPhone, parsed.data.contactPhone ?? ""],
    [CONFIG_KEYS.contactEmail, parsed.data.contactEmail ?? ""],
  ];
  const ip = await headers().then((h) => h.get("x-real-ip") ?? "unknown");

  for (const [key, value] of entries) {
    const prev = await prisma.configuration.findUnique({ where: { key } });
    if (prev !== null && prev.value === value) continue; // sin cambio, sin asiento
    await prisma.configuration.upsert({
      where: { key },
      update: { value, updatedBy: actor.actorId },
      create: { key, value, updatedBy: actor.actorId },
    });
    await audit({
      userId: actor.actorId, action: "config_update", entity: "configuration", entityId: key,
      detail: { from: prev?.value ?? null, to: value }, ip,
    });
  }
  updateTag(CACHE_TAGS.config);
  redirect("/admin/configuracion?guardado=1");
}
```

- [ ] **Step 2: Test de autorización**

`tests/config-actions-auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const prismaMock = { configuration: { findUnique: vi.fn(), upsert: vi.fn() } };
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadmin: vi.fn(async () => ({
    ok: false, reason: "not_admin", error: "Solo el superadmin puede cambiar la configuración.",
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { updateConfigAction } from "@/app/admin/configuracion/actions";

it("un admin común no puede tocar la configuración", async () => {
  const result = await updateConfigAction({}, new FormData());
  expect(result.error).toBe("Solo el superadmin puede cambiar la configuración.");
  expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
});
```

Correr → PASS.

- [ ] **Step 3: Implementar página y formulario**

`src/app/admin/configuracion/page.tsx`:

```tsx
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { ConfigForm } from "./config-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuración — SIGeV" };

export default async function ConfigPage({ searchParams }: PageProps<"/admin/configuracion">) {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    // Mismo patrón que el layout admin: pantalla de bloqueo, no redirect
    // (evita el rebote con /ingresar cuando hay sesión de admin común).
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p role="alert" className="text-sm text-destructive">{actor.error}</p>
      </div>
    );
  }
  const sp = await searchParams;
  const [asociateActivo, contactPhone, contactEmail] = await Promise.all([
    configReader.getBool(CONFIG_KEYS.asociateActivo),
    configReader.getString(CONFIG_KEYS.contactPhone),
    configReader.getString(CONFIG_KEYS.contactEmail),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Configuración</h1>
      {sp.guardado === "1" && (
        <p className="rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm">
          Configuración guardada.
        </p>
      )}
      <ConfigForm initial={{ asociateActivo, contactPhone: contactPhone ?? "", contactEmail: contactEmail ?? "" }} />
    </div>
  );
}
```

`src/app/admin/configuracion/config-form.tsx`:

```tsx
"use client";
import { useActionState } from "react";
import { updateConfigAction } from "./actions";
import { useSyncedForm, TextField } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";

export function ConfigForm({ initial }: {
  initial: { asociateActivo: boolean; contactPhone: string; contactEmail: string };
}) {
  const [state, formAction, pending] = useActionState(updateConfigAction, {});
  const { values, setValue, formRef, field } = useSyncedForm({
    asociateActivo: initial.asociateActivo ? "on" : "",
    contactPhone: initial.contactPhone,
    contactEmail: initial.contactEmail,
  });
  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="asociateActivo" checked={values.asociateActivo === "on"}
          onChange={(e) => setValue("asociateActivo", e.target.checked ? "on" : "")} />
        Botón ASOCIATE habilitado en el sitio público
      </label>
      <p className="text-xs text-muted-foreground">
        Apagado, el sitio muestra el aviso de asociaciones suspendidas. Se prende recién con el
        wizard del Módulo 3 funcionando.
      </p>
      <TextField label="Teléfono de contacto" field={field("contactPhone")} type="tel" maxLength={40}
        hint="Se muestra en la página Ubicación. Dejalo vacío para ocultarlo." />
      <TextField label="Email de contacto" field={field("contactEmail")} type="email" maxLength={191}
        hint="Se muestra en la página Ubicación. Dejalo vacío para ocultarlo." />
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
    </form>
  );
}
```

En `src/app/admin/page.tsx`, activar la Card "Configuración":

```ts
  { title: "Configuración", description: "Parámetros del sistema (solo superadmin).", href: "/admin/configuracion", cta: "Abrir" },
```

- [ ] **Step 4: Verificar y commit**

```bash
npx vitest run tests/config-actions-auth.test.ts && npx tsc --noEmit && npm run lint
```

Expected: verde. Manual: entrar con el superadmin, togglear el flag, ver `?guardado=1`; verificar en la tabla `audit_log` el asiento `config_update` con `updated_by` seteado.

```bash
git add src/app/admin/configuracion src/app/admin/page.tsx tests/config-actions-auth.test.ts
git commit -m "feat(config): superadmin configuration screen with audit"
```

---

### Task 12: Sitio público — layout con nav, home real, /asociate placeholder, not-found y error

**Files:**
- Modify: `src/app/(public)/layout.tsx`
- Modify: `src/app/(public)/page.tsx`
- Create: `src/app/(public)/asociate/page.tsx`
- Create: `src/components/public/site-nav.tsx`
- Create: `src/components/public/news-card.tsx`
- Create: `src/app/not-found.tsx`
- Create: `src/app/error.tsx`

**Interfaces:**
- Consumes: `configReader`+`CONFIG_KEYS` (vía wrapper cacheado nuevo), `getLatestNews`, `newsImageUrl`, `SITE`, `formatDateAR`, `unstable_cache`, `CACHE_TAGS`.
- Produces: `SiteNav` (client, menú mobile), `NewsCard` ({ news: PublicNewsCard }), `getAsociateActive(): Promise<boolean>` cacheado con tag `config` (exportado desde `src/lib/config.ts`).

- [ ] **Step 1: Agregar el lector cacheado a `src/lib/config.ts`**

Los `import` van ARRIBA del archivo junto a los existentes; las funciones al
final:

```ts
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/news/query";

// Lecturas cacheadas para las páginas públicas (la home es estática y se
// invalida cuando el superadmin guarda la configuración).
export const getAsociateActive = unstable_cache(
  () => configReader.getBool(CONFIG_KEYS.asociateActivo),
  ["config-asociate"],
  { tags: [CACHE_TAGS.config] },
);
export const getContactInfo = unstable_cache(
  async () => ({
    phone: await configReader.getString(CONFIG_KEYS.contactPhone),
    email: await configReader.getString(CONFIG_KEYS.contactEmail),
  }),
  ["config-contact"],
  { tags: [CACHE_TAGS.config] },
);
```

(Si esto crea un ciclo de imports con `news/query.ts`, mover `CACHE_TAGS` a un archivo propio `src/lib/cache-tags.ts` y actualizar los imports en ambos.)

- [ ] **Step 2: Implementar `src/components/public/site-nav.tsx`**

```tsx
"use client";
// Nav pública con menú colapsable en mobile. Sin dependencias nuevas: un
// botón que togglea, aria-expanded para lectores de pantalla.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  ["/", "Inicio"],
  ["/noticias", "Noticias"],
  ["/actividades", "Actividades"],
  ["/ubicacion", "Ubicación"],
] as const;

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del sitio">
      <button
        type="button"
        className="rounded-md border px-3 py-1.5 text-sm sm:hidden"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((o) => !o)}
      >
        Menú
      </button>
      <ul
        id="site-menu"
        className={`${open ? "flex" : "hidden"} absolute inset-x-0 top-full z-10 flex-col gap-1 border-b bg-background p-4 shadow-sm sm:static sm:flex sm:flex-row sm:gap-6 sm:border-0 sm:p-0 sm:shadow-none`}
      >
        {LINKS.map(([href, label]) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`block py-1 text-sm font-medium hover:text-primary ${pathname === href ? "text-primary" : ""}`}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          </li>
        ))}
        <li className="sm:hidden">
          <Link href="/ingresar" className="block py-1 text-sm font-medium text-primary underline"
            onClick={() => setOpen(false)}>
            Ingresar
          </Link>
        </li>
      </ul>
    </nav>
  );
}
```

- [ ] **Step 3: Reescribir `src/app/(public)/layout.tsx`**

```tsx
import Image from "next/image";
import Link from "next/link";
import { SiteNav } from "@/components/public/site-nav";
import { SITE } from "@/lib/site";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt={`Logo de la ${SITE.name}`}
              width={674}
              height={669}
              className="h-10 w-auto"
              priority
            />
            <span className="font-semibold leading-tight">
              Asociación Vecinal
              <br />
              del Barrio Ciudadela
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <SiteNav />
            <Link href="/ingresar" className="hidden text-sm font-medium text-primary underline sm:inline">
              Ingresar
            </Link>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl space-y-1 px-4 py-6 text-sm text-muted-foreground">
          <p>{SITE.name} — {SITE.city}</p>
          <p>{SITE.address}</p>
          <p>{SITE.legalStatus} · Fundada el {SITE.founded}</p>
          <p>
            Sistema SIGeV ·{" "}
            <Link href="/ingresar" className="underline hover:text-primary">Acceso de socios y administración</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Reescribir la home `src/app/(public)/page.tsx`**

```tsx
import Image from "next/image";
import Link from "next/link";
import heroImg from "../../../assets/hero.jpg";
import { getAsociateActive } from "@/lib/config";
import { getLatestNews } from "@/lib/news/query";
import { NewsCard } from "@/components/public/news-card";
import { SITE } from "@/lib/site";

export const metadata = { description: `Sitio oficial de la ${SITE.name} — noticias, actividades y asociación.` };

export default async function HomePage() {
  const [asociateActive, latest] = await Promise.all([getAsociateActive(), getLatestNews(3)]);
  return (
    <div>
      {/* Hero: static import → next/image genera variantes responsive y blur.
          Overlay en el tercio inferior para legibilidad (docs/05:5). */}
      <section className="relative">
        <Image
          src={heroImg}
          alt="Vista aérea del Barrio Ciudadela"
          placeholder="blur"
          priority
          sizes="100vw"
          className="h-[45vh] min-h-72 w-full object-cover sm:h-[55vh]"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent px-4 pb-8 text-center text-white">
          <h1 className="text-2xl font-bold drop-shadow sm:text-4xl">{SITE.name}</h1>
          <p className="mt-1 text-sm drop-shadow sm:text-base">{SITE.city}</p>
          <div className="mt-4 flex flex-col items-center gap-2">
            {asociateActive ? (
              <Link
                href="/asociate"
                className="rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow hover:opacity-90"
              >
                ASOCIATE
              </Link>
            ) : (
              <>
                <span
                  aria-disabled="true"
                  className="cursor-not-allowed rounded-md bg-muted px-6 py-3 text-base font-semibold text-muted-foreground"
                >
                  ASOCIATE
                </span>
                <p className="max-w-md rounded-md bg-black/60 px-3 py-2 text-xs sm:text-sm">
                  Las asociaciones están suspendidas temporalmente. Para más información acercate a
                  la sede vecinal.
                </p>
              </>
            )}
            {/* REEMPADRONATE: oculto hasta que exista un proceso (Módulo 6). */}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Noticias</h2>
          {latest.length > 0 && (
            <Link href="/noticias" className="text-sm text-primary underline">Ver todas</Link>
          )}
        </div>
        {latest.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Todavía no hay noticias publicadas.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {latest.map((n) => <NewsCard key={n.id} news={n} />)}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Implementar `src/components/public/news-card.tsx`**

```tsx
import Image from "next/image";
import Link from "next/link";
import { formatDateAR } from "@/lib/format";
import { newsImageUrl } from "@/lib/news/images";
import type { PublicNewsCard } from "@/lib/news/query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function NewsCard({ news }: { news: PublicNewsCard }) {
  return (
    <Link href={`/noticias/${news.slug}`} className="group block">
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
        {news.coverImagePath && (
          <Image
            src={newsImageUrl(news.coverImagePath)}
            alt=""
            width={640}
            height={360}
            className="aspect-video w-full object-cover"
            unoptimized
          />
        )}
        <CardHeader>
          <CardTitle className="group-hover:text-primary">{news.title}</CardTitle>
          <CardDescription>{formatDateAR(new Date(news.publishedAtIso))}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{news.excerpt}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
```

Nota: `unoptimized` en las portadas porque vienen del route handler propio (ya cacheado inmutable); pasar por el optimizador de Next duplicaría el trabajo con URLs no estáticas.

- [ ] **Step 6: `/asociate` placeholder + not-found + error**

`src/app/(public)/asociate/page.tsx`:

```tsx
import Link from "next/link";

export const metadata = { title: "Asociate — Vecinal Ciudadela" };

// Placeholder: el wizard de asociación llega con el Módulo 3. Existe para
// que el botón ASOCIATE habilitado no termine en un 404 (spec §3).
export default function AsociatePage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Asociate a la Vecinal</h1>
      <p className="mt-3 text-muted-foreground">
        El formulario de asociación en línea estará disponible próximamente. Mientras tanto,
        acercate a la sede para asociarte.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm text-primary underline">Volver al inicio</Link>
    </div>
  );
}
```

`src/app/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-2xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold">Página no encontrada</h1>
      <p className="mt-2 text-muted-foreground">La dirección que buscás no existe o fue movida.</p>
      <Link href="/" className="mt-6 text-sm text-primary underline">Ir al inicio</Link>
    </div>
  );
}
```

`src/app/error.tsx`:

```tsx
"use client";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-2xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold">Algo salió mal</h1>
      <p className="mt-2 text-muted-foreground">Ocurrió un error inesperado. Probá de nuevo en un momento.</p>
      <button type="button" onClick={reset} className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Reintentar
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Verificar**

```bash
npx tsc --noEmit && npm run lint && npm test
```

Expected: verde. Manual en el dev server (mobile 375px y desktop): home con hero y blur, banner de ASOCIATE (flag en false), menú mobile abre/cierra, footer con personería, `/ruta-inexistente` muestra el 404 propio.

- [ ] **Step 8: Commit**

```bash
git add src/app/(public) src/components/public src/app/not-found.tsx src/app/error.tsx src/lib/config.ts
git commit -m "feat(public): real home with hero and gated ASOCIATE, site nav, error pages"
```

---

### Task 13: Sitio público — /noticias y /noticias/[slug]

**Files:**
- Create: `src/app/(public)/noticias/page.tsx`
- Create: `src/app/(public)/noticias/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getPublishedNewsPage`, `getNewsBySlug`, `NewsCard`, `newsImageUrl`, `formatDateAR`, `newsPlainText`, `siteBaseUrl`.

- [ ] **Step 1: Implementar `src/app/(public)/noticias/page.tsx`**

```tsx
import Link from "next/link";
import { getPublishedNewsPage } from "@/lib/news/query";
import { NewsCard } from "@/components/public/news-card";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Noticias — Vecinal Ciudadela",
  description: "Novedades y comunicados de la Asociación Vecinal del Barrio Ciudadela.",
};

export default async function NoticiasPage({ searchParams }: PageProps<"/noticias">) {
  const sp = await searchParams;
  const pageRaw = typeof sp.pagina === "string" ? Number(sp.pagina) : 1;
  const requested = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const { items, page, pages, total } = await getPublishedNewsPage(requested);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Noticias</h1>
      {total === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Todavía no hay noticias publicadas.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((n) => <NewsCard key={n.id} news={n} />)}
          </div>
          {pages > 1 && (
            <nav aria-label="Paginación de noticias" className="mt-8 flex items-center justify-center gap-3">
              <Button asChild variant="outline" disabled={page <= 1}>
                <Link href={`/noticias?pagina=${page - 1}`} aria-disabled={page <= 1}>Anterior</Link>
              </Button>
              <span className="text-sm text-muted-foreground">Página {page} de {pages}</span>
              <Button asChild variant="outline" disabled={page >= pages}>
                <Link href={`/noticias?pagina=${page + 1}`} aria-disabled={page >= pages}>Siguiente</Link>
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
```

Nota: si `Button disabled` + `asChild` + `Link` no bloquea el click (asChild delega al Link), renderizar un `<span>` deshabilitado en los extremos igual que hace `src/app/admin/socios/page.tsx` — copiar ese patrón exacto.

- [ ] **Step 2: Implementar `src/app/(public)/noticias/[slug]/page.tsx`**

```tsx
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getNewsBySlug } from "@/lib/news/query";
import { newsImageUrl } from "@/lib/news/images";
import { formatDateAR } from "@/lib/format";
import { siteBaseUrl } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/noticias/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const news = await getNewsBySlug(slug);
  if (!news) return { title: "Noticia no encontrada — Vecinal Ciudadela" };
  return {
    title: `${news.title} — Vecinal Ciudadela`,
    description: news.excerpt,
    alternates: { canonical: new URL(`/noticias/${news.slug}`, siteBaseUrl()).toString() },
    openGraph: {
      title: news.title,
      description: news.excerpt,
      type: "article",
      publishedTime: news.publishedAtIso,
      ...(news.coverImagePath ? { images: [{ url: newsImageUrl(news.coverImagePath) }] } : {}),
    },
  };
}

export default async function NoticiaPage({ params }: PageProps<"/noticias/[slug]">) {
  const { slug } = await params;
  const news = await getNewsBySlug(slug);
  if (!news) notFound();
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{news.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <time dateTime={news.publishedAtIso}>{formatDateAR(new Date(news.publishedAtIso))}</time>
      </p>
      {news.coverImagePath && (
        <Image
          src={newsImageUrl(news.coverImagePath)}
          alt=""
          width={1280}
          height={720}
          className="mt-6 w-full rounded-lg object-cover"
          unoptimized
          priority
        />
      )}
      {/* El body se sanitizó en el servidor al guardarse (allowlist estricta,
          src/lib/news/sanitize.ts): acá se renderiza confiando en la base. */}
      <div className="prose-news mt-6" dangerouslySetInnerHTML={{ __html: news.body }} />
    </article>
  );
}
```

- [ ] **Step 3: Verificar**

```bash
npx tsc --noEmit && npm run lint
```

Manual: publicar 2 noticias desde el panel, verlas en `/noticias`, entrar al detalle, verificar que un slug inexistente da el 404 propio y que el `<time>` muestra DD/MM/AAAA.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(public)/noticias"
git commit -m "feat(public): news listing and detail pages with metadata"
```

---

### Task 14: Sitio público — /actividades y /ubicacion

**Files:**
- Create: `src/app/(public)/actividades/page.tsx`
- Create: `src/app/(public)/ubicacion/page.tsx`

**Interfaces:**
- Consumes: `getActivitiesForYear`, `getActivityYears`, `buildWeeklyGrid`, `WEEKDAYS`, `ROOM_LABELS`, `getContactInfo`, `SITE`.

- [ ] **Step 1: Implementar `src/app/(public)/actividades/page.tsx`**

```tsx
import Link from "next/link";
import { getActivitiesForYear, getActivityYears } from "@/lib/activities/query";
import { buildWeeklyGrid, ROOM_LABELS, WEEKDAYS } from "@/lib/activities/rules";
import { SITE } from "@/lib/site";

export const metadata = {
  title: "Actividades — Vecinal Ciudadela",
  description: `Calendario semanal de actividades del ${SITE.rooms.historic} y el ${SITE.rooms.glass}.`,
};

// Año "actual" en hora argentina, no UTC del server.
function currentYearAR(): number {
  return Number(
    new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric" }).format(new Date()),
  );
}

export default async function ActividadesPage({ searchParams }: PageProps<"/actividades">) {
  const sp = await searchParams;
  const years = await getActivityYears();
  const requested = typeof sp.anio === "string" ? Number(sp.anio) : NaN;
  const year = Number.isInteger(requested) && years.includes(requested) ? requested : (years[0] ?? currentYearAR());
  const activities = await getActivitiesForYear(year);
  const grid = buildWeeklyGrid(activities);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Actividades {year}</h1>
        {years.length > 1 && (
          <nav aria-label="Elegir año" className="flex gap-2">
            {years.map((y) => (
              <Link key={y} href={`/actividades?anio=${y}`}
                aria-current={y === year ? "page" : undefined}
                className={`rounded-md border px-3 py-1 text-sm ${y === year ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {y}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {activities.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Todavía no hay actividades cargadas para este año. Consultá en la sede vecinal.
        </p>
      ) : (
        <div className="mt-6 space-y-10">
          {(["historic", "glass"] as const).map((room) => (
            <section key={room}>
              <h2 className="text-xl font-semibold">{ROOM_LABELS[room]}</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
                {WEEKDAYS.map(([d, label]) => (
                  <div key={d} className="rounded-lg border p-3">
                    <h3 className="text-sm font-semibold">{label}</h3>
                    {grid[room][d].length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">—</p>
                    ) : (
                      <ul className="mt-1 space-y-2">
                        {grid[room][d].map((a) => (
                          <li key={`${a.id}-${d}`} className="text-sm">
                            <span className="block font-medium">{a.name}</span>
                            <span className="text-xs text-muted-foreground">{a.startTime} a {a.endTime}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implementar `src/app/(public)/ubicacion/page.tsx`**

```tsx
import { getContactInfo } from "@/lib/config";
import { SITE } from "@/lib/site";

export const metadata = {
  title: "Ubicación — Vecinal Ciudadela",
  description: `Dónde queda la sede de la ${SITE.name} y cómo contactarnos.`,
};

// Bounding box chico alrededor de la sede para el embed de OpenStreetMap.
const D = 0.004;
const OSM_EMBED =
  `https://www.openstreetmap.org/export/embed.html?bbox=${SITE.lng - D}%2C${SITE.lat - D}%2C${SITE.lng + D}%2C${SITE.lat + D}` +
  `&layer=mapnik&marker=${SITE.lat}%2C${SITE.lng}`;
const OSM_LINK = `https://www.openstreetmap.org/?mlat=${SITE.lat}&mlon=${SITE.lng}#map=17/${SITE.lat}/${SITE.lng}`;

export default async function UbicacionPage() {
  const contact = await getContactInfo();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Ubicación y contacto</h1>
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <p className="text-base font-medium">{SITE.name}</p>
          <p>{SITE.address}</p>
          <p>{SITE.city}</p>
          {contact.phone && <p>Teléfono: <a className="text-primary underline" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a></p>}
          {contact.email && <p>Email: <a className="text-primary underline" href={`mailto:${contact.email}`}>{contact.email}</a></p>}
          <p className="pt-2 text-muted-foreground">{SITE.legalStatus}</p>
          <p className="text-muted-foreground">Fundada el {SITE.founded} · Fundación legal: {SITE.legallyFounded}</p>
          <p>
            <a className="text-primary underline" href={OSM_LINK} target="_blank" rel="noopener noreferrer">
              Ver el mapa completo en OpenStreetMap
            </a>
          </p>
        </div>
        <iframe
          src={OSM_EMBED}
          title={`Mapa de la sede: ${SITE.address}`}
          className="h-80 w-full rounded-lg border"
          loading="lazy"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar**

```bash
npx tsc --noEmit && npm run lint && npm test
```

Manual: `/actividades` muestra la grilla con la actividad de prueba de la Task 10 y el selector de años; `/ubicacion` muestra el mapa con el marcador en Cerro Catedral 286 y, sin contacto cargado, no muestra las líneas de teléfono/email.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(public)/actividades" "src/app/(public)/ubicacion"
git commit -m "feat(public): activities weekly grid and location page with OSM embed"
```

---

### Task 15: SEO y assets — metadata base, robots, sitemap, JSON-LD, favicons, logo optimizado

**Files:**
- Create: `scripts/generate-assets.ts`
- Create: `src/app/robots.ts`
- Create: `src/app/sitemap.ts`
- Modify: `src/app/layout.tsx` (metadataBase + title template)
- Modify: `src/app/(public)/page.tsx` (JSON-LD Organization)
- Create (generados por el script): `public/logo-header.png`, `src/app/icon.png`, `src/app/apple-icon.png`, `src/app/opengraph-image.png`

**Interfaces:**
- Consumes: `siteBaseUrl`, `SITE`, `newsQueries` (para el sitemap, sin caché: se regenera on-demand).

- [ ] **Step 1: Script de assets `scripts/generate-assets.ts`**

```ts
// Genera los derivados de assets/logo.png y assets/hero.jpg. Se corre UNA
// vez (npx tsx scripts/generate-assets.ts) y los resultados se commitean:
// no es parte del build.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

async function main() {
  await mkdir("public", { recursive: true });
  // Logo del header: se renderiza a 40px de alto; 160px de fuente alcanza
  // para pantallas 4x. De 363 KB a unos pocos KB.
  await sharp("assets/logo.png").resize({ height: 160 }).png({ compressionLevel: 9 }).toFile("public/logo-header.png");
  // Favicons PNG (Next los sirve por convención de nombre en src/app/).
  await sharp("assets/logo.png")
    .resize(512, 512, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile("src/app/icon.png");
  await sharp("assets/logo.png")
    .resize(180, 180, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile("src/app/apple-icon.png");
  // Open Graph por defecto: el hero recortado a 1200x630.
  await sharp("assets/hero.jpg").resize(1200, 630, { fit: "cover" }).jpeg({ quality: 80 }).toFile("src/app/opengraph-image.png");
  console.log("assets generados");
}

main();
```

Correr:

```bash
npx tsx scripts/generate-assets.ts
```

Expected: 4 archivos generados; `public/logo-header.png` < 40 KB. Después del script, actualizar los DOS usos de `/logo.png` (`src/app/(public)/layout.tsx`) a `/logo-header.png` con `width={160} height={159}` (mantener `className="h-10 w-auto"`). El `public/logo.png` original se elimina del repo (`git rm public/logo.png`) — el fuente sigue en `assets/`.

Nota: `opengraph-image.png` en `src/app/` aplica a todo el sitio por convención de Next; las noticias con portada lo pisan vía `generateMetadata` (Task 13).

- [ ] **Step 2: `src/app/robots.ts`**

```ts
import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/mi", "/api", "/ingresar", "/verificar", "/acceso", "/redirigir"],
    },
    sitemap: new URL("/sitemap.xml", siteBaseUrl()).toString(),
  };
}
```

- [ ] **Step 3: `src/app/sitemap.ts`**

```ts
import type { MetadataRoute } from "next";
import { newsQueries } from "@/lib/news/query";
import { siteBaseUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteBaseUrl();
  const abs = (path: string) => new URL(path, base).toString();
  const fixed: MetadataRoute.Sitemap = [
    { url: abs("/"), changeFrequency: "weekly", priority: 1 },
    { url: abs("/noticias"), changeFrequency: "weekly", priority: 0.8 },
    { url: abs("/actividades"), changeFrequency: "monthly", priority: 0.7 },
    { url: abs("/ubicacion"), changeFrequency: "yearly", priority: 0.5 },
  ];
  // Directo, sin unstable_cache: el sitemap se pide poco y conviene fresco.
  const news = await newsQueries.allForAdmin();
  const published = news
    .filter((n) => n.status === "published" && n.publishedAtIso)
    .map((n) => ({
      url: abs(`/noticias/${n.slug}`),
      lastModified: new Date(n.publishedAtIso as string),
      changeFrequency: "yearly" as const,
      priority: 0.6,
    }));
  return [...fixed, ...published];
}
```

- [ ] **Step 4: metadata del root layout**

En `src/app/layout.tsx`, reemplazar el `export const metadata` por:

```ts
export const metadata: Metadata = {
  metadataBase: siteBaseUrl(),
  title: {
    default: "Asociación Vecinal del Barrio Ciudadela",
    template: "%s", // las páginas ya traen su sufijo propio ("X — Vecinal Ciudadela" / "X — SIGeV")
  },
  description:
    "Sitio institucional y sistema de gestión de socios de la Asociación Vecinal del Barrio Ciudadela — Comodoro Rivadavia, Chubut.",
  openGraph: {
    siteName: "Vecinal Ciudadela",
    locale: "es_AR",
    type: "website",
  },
};
```

con `import { siteBaseUrl } from "@/lib/site";` arriba. (Se mantiene el patrón existente de sufijos manuales en cada página en vez de `template: "%s — …"`, porque el admin usa otro sufijo.)

- [ ] **Step 5: JSON-LD Organization en la home**

En `src/app/(public)/page.tsx`, dentro del JSX (primer hijo del `<div>`):

```tsx
      <script
        type="application/ld+json"
        // JSON-LD estático generado desde constantes propias (SITE): no hay
        // input de usuario acá, el dangerouslySetInnerHTML es seguro.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: SITE.name,
            address: {
              "@type": "PostalAddress",
              streetAddress: SITE.address,
              addressLocality: "Comodoro Rivadavia",
              addressRegion: "Chubut",
              addressCountry: "AR",
            },
            foundingDate: "1964-08-04",
            url: siteBaseUrl().toString(),
            logo: new URL("/logo-header.png", siteBaseUrl()).toString(),
          }),
        }}
      />
```

con `import { siteBaseUrl } from "@/lib/site";` agregado al import existente de SITE.

- [ ] **Step 6: Verificar**

```bash
npx tsc --noEmit && npm run lint
npm run build
```

Expected: build OK. Con el server de producción local (`npm start`): `curl http://localhost:3006/robots.txt` muestra los disallow; `curl http://localhost:3006/sitemap.xml` lista las páginas y noticias publicadas; el `<head>` de la home trae `og:image`.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-assets.ts src/app/robots.ts src/app/sitemap.ts src/app/layout.tsx "src/app/(public)" src/app/icon.png src/app/apple-icon.png src/app/opengraph-image.png public/logo-header.png package.json package-lock.json
git rm public/logo.png
git commit -m "feat(seo): metadata base, robots, sitemap, JSON-LD and optimized assets"
```

---

### Task 16: CSP completa y Permissions-Policy

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Reescribir `next.config.ts`**

```ts
import type { NextConfig } from "next";

// CSP del sitio. Notas:
// - 'unsafe-inline' en script-src: Next 16 emite scripts inline de
//   hidratación; la alternativa (nonces) obliga a servir TODO dinámico y
//   este módulo estrena caché estática. Decisión documentada en la spec §7.
// - 'unsafe-inline' en style-src: styled-jsx/next inline styles.
// - frame-src: SOLO el embed de OpenStreetMap (/ubicacion).
// - Módulo 3 (Mercado Pago + Turnstile): descomentar los orígenes marcados.
const MP = ""; // M3: " https://sdk.mercadopago.com https://http2.mlstatic.com"
const TURNSTILE = ""; // M3: " https://challenges.cloudflare.com"

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${MP}${TURNSTILE}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${MP}`,
  `frame-src https://www.openstreetmap.org${TURNSTILE}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  experimental: {
    // El default de Next son 1 MB y la portada de una noticia puede pesar
    // hasta MAX_COVER_BYTES (5 MB): sin esto el body parser corta ANTES de
    // que saveNewsCover pueda devolver su mensaje en castellano. Agregado en
    // la Task 6; NO quitar al tocar este archivo.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
```

IMPORTANTE: el bloque `experimental.serverActions` ya existe en el archivo desde
la Task 6. Al reescribir `next.config.ts` acá, **conservalo tal cual** — quitarlo
rompe la subida de portadas de más de 1 MB.

- [ ] **Step 2: Verificar contra el build real**

```bash
npm run build
npm start
```

Con el server corriendo, en el browser: recorrer TODAS las páginas públicas y el panel con la consola abierta — no debe haber NINGÚN error `Refused to ...` de CSP. Puntos calientes: el iframe de `/ubicacion` (frame-src), las fuentes de next/font (se sirven self-hosted, `font-src 'self'` alcanza), el editor Tiptap en el panel, las imágenes blur del hero (`data:`). Si algo se bloquea, ampliar la directiva puntual y ANOTAR el porqué en el comentario del config.

- [ ] **Step 3: Verificación HSTS (comando para Mariano, NO ejecutar contra prod desde acá)**

Preparar en el mensaje final de la task este bloque para que Mariano lo corra:

```bash
curl -sI https://sigev.redaccion.ar | grep -i strict-transport-security
```

Si no devuelve nada, activar HSTS en Cloudflare (SSL/TLS → Edge Certificates → HSTS) en lugar de emitirla desde Next.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git commit -m "feat(security): full CSP and Permissions-Policy headers"
```

---

### Task 17: Actualización de documentación

**Files:**
- Modify: `docs/04-modelo-de-datos.md`
- Modify: `docs/05-flujos-funcionales.md`
- Modify: `docs/07-plan-de-etapas.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `docs/04-modelo-de-datos.md`**

En la sección de Noticia, reemplazar la descripción prevista por la implementada (campos reales: `title`, `slug` único, `body` HTML sanitizado, `cover_image_path`, `status draft|published`, `published_at`, `author_id`; tabla `news`). Agregar a continuación una sección nueva:

```markdown
### Actividad (`activities`) — Módulo 2

Actividad sistemática semanal de un salón de la sede ("Gimnasia mujeres",
"Taekwondo niños"), con vigencia anual. Solo consulta pública; no hay reservas.

- `name` (varchar 120), `room` (enum `historic` = Salón Histórico, `glass` =
  Salón Vidriado — salones fijos, sin tabla), `weekdays` (JSON, array de
  enteros 1–7, lunes=1), `start_time`/`end_time` (varchar "HH:MM", hora de
  pared local SIN conversión a UTC: es un horario recurrente, no un instante),
  `year` (smallint), `active` (bool).
- Regla: dos actividades activas del mismo salón y año no pueden solaparse
  en día y horario (validada en `src/lib/activities/rules.ts`).
```

En la lista de claves de `Configuracion`, agregar `contact_phone` y `contact_email` (string, editables desde `/admin/configuracion`, solo superadmin).

- [ ] **Step 2: `docs/05-flujos-funcionales.md`**

1. En la sección de la home: anotar que el estatuto NO tiene página pública — se difiere al panel del socio (Módulo 5) por decisión del 19/08/2026; la nav pública es Inicio · Noticias · Actividades · Ubicación.
2. Agregar tras la sección de Ubicación:

```markdown
### Actividades (`/actividades`) — Módulo 2

Grilla semanal por salón (Salón Histórico y Salón Vidriado) con selector de
año. Cada actividad muestra nombre y horario. Carga desde `/admin/actividades`
(nombre, salón, días de la semana, horario, año, visible sí/no). El alta que
se superpone con otra actividad del mismo salón se rechaza.
```

3. En la sección del panel admin, agregar "Actividades: ABM del calendario de salones" y "Configuración (solo superadmin): interruptor de ASOCIATE y datos de contacto".

- [ ] **Step 3: `docs/07-plan-de-etapas.md`**

Reemplazar la sección del Módulo 2 por:

```markdown
## Módulo 2 — Sitio público
Home (hero + botones con estados), cartelera de noticias + ABM admin (editor
visual básico + imagen de portada), calendario de actividades de los salones
(Salón Histórico y Salón Vidriado, grilla semanal por año) + ABM admin,
página Ubicación (OpenStreetMap), pantalla Configuración (superadmin:
`asociate_activo`, contacto), footer con datos legales, SEO básico (robots,
sitemap, OG), CSP completa, responsive.

El Estatuto se movió al Módulo 5 (panel del socio, como PDF autenticado):
decisión del 19/08/2026 — no va en el sitio público.

CA: publicar una noticia con imagen desde el panel y verla en la home desde un
celular; Lighthouse accesibilidad ≥90 en home/noticias/actividades; ASOCIATE
deshabilitado muestra el banner correcto cuando `asociate_activo=false` y
habilitarlo desde /admin/configuracion lo refleja sin redeploy; cargar
"Taekwondo niños — Salón Vidriado — martes y jueves 18:00–19:30 — 2026" y
verla en /actividades; una actividad solapada en el mismo salón es rechazada;
robots.txt bloquea /admin y /mi y el sitemap lista las noticias publicadas.
```

En el Módulo 5, agregar a las ideas incorporadas: "publicar el estatuto como PDF dentro del panel del socio (movido desde el Módulo 2 el 19/08/2026; fuente: `datos/estatuto.docx`)".

- [ ] **Step 4: `CLAUDE.md`**

1. Línea del stack: "Next.js 15+" → "Next.js 16+ (App Router, TypeScript; `proxy.ts` en lugar de middleware, `params`/`searchParams` como Promise)".
2. Línea del color: agregar tras el color primario: "Ojo accesibilidad: `#2E9BDF` solo llega a 3.06:1 sobre blanco — para botones/links se usa el token `--primary` `#0079BC` (4.71:1). Ver `src/app/globals.css`."
3. Línea de hero.jpg: "1868px" → "1980×788".
4. En la sección de uploads, agregar: "Excepción: las imágenes de portada de noticias viven en `UPLOADS_DIR/news/` pero se sirven por route handler público SIN autenticación (`/api/imagenes/noticias/[name]`) con caché inmutable — son contenido público. La regla de API autenticada aplica a documentos personales (DNIs, facturas)."

- [ ] **Step 5: Commit**

```bash
git add docs/04-modelo-de-datos.md docs/05-flujos-funcionales.md docs/07-plan-de-etapas.md CLAUDE.md
git commit -m "docs: sync data model, flows and roadmap with module 2 as built"
```

---

### Task 18: Verificación final del módulo

**Files:** ninguno nuevo (correcciones que surjan).

- [ ] **Step 1: Suite completa**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

Expected: todo verde, cero warnings nuevos de build.

- [ ] **Step 2: Caché por tags — prueba end-to-end (spec §8)**

Con el build de producción local (`npm start`, puerto 3006):

1. `curl -s http://localhost:3006/ | grep -o "suspendidas temporalmente"` → aparece (flag en false).
2. Encender `asociate_activo` desde `/admin/configuracion` en el browser.
3. Repetir el curl → el banner desaparece y aparece el link ASOCIATE **sin reiniciar el server**.
4. Publicar una noticia nueva → aparece en `/` y `/noticias` sin reinicio.

Si el paso 3/4 NO refresca (limitación real de `unstable_cache`+`updateTag` en Next 16.3), aplicar el fallback aprobado en la spec §8: `export const dynamic = "force-dynamic"` en las páginas públicas, quitar los wrappers `unstable_cache` (dejar las queries directas) y anotar la decisión en la spec. NO inventar un tercer mecanismo.

- [ ] **Step 3: Criterios de aceptación (spec §11), uno por uno**

Con el browser (mobile 375px y desktop):

1. Publicar noticia con imagen desde el panel → verla en la home mobile. ✔/✘
2. Lighthouse mobile en `/`, `/noticias`, `/actividades` — accesibilidad ≥ 90:

```bash
npx lighthouse http://localhost:3006/ --only-categories=accessibility --form-factor=mobile --screenEmulation.mobile --chrome-flags="--headless" --output=json --output-path=./lighthouse-home.json
```

y leer `.categories.accessibility.score` (≥ 0.9). Repetir para las otras dos rutas. Los JSON no se commitean.
3. Flag apagado → banner; encendido → botón activo (ya probado en Step 2).
4. Actividad "Taekwondo niños" visible en `/actividades`; alta solapada rechazada con mensaje.
5. `/ubicacion` con mapa y consola sin errores CSP.
6. `robots.txt` y `sitemap.xml` correctos.
7. Revisar `audit_log`: deben existir asientos `news_create`, `news_publish`, `activity_create`, `config_update`.

- [ ] **Step 4: Limpieza y estado del árbol**

```bash
git status
```

Expected: árbol limpio (sin archivos sueltos tipo `lighthouse-*.json`, sin `uploads/` trackeado).

- [ ] **Step 5: Commit final si hubo correcciones**

```bash
git add -A && git commit -m "fix: module 2 final verification adjustments"
```

(Solo si hubo cambios; no commitear vacío.)

---

## Notas para el ejecutor

- **Orden estricto**: las tasks 4–6 (dominio) van antes que 7–8 (ABM); 9 antes que 10; 12 requiere 5 y el lector cacheado de config.
- **`.env` local**: debe tener `UPLOADS_DIR=./uploads` (ya gitignoreado) además de las variables del M0/M1. Docker Desktop corriendo para MariaDB.
- **No tocar**: `scripts/import-padron.ts` (el padrón está al día — confirmado por Mariano el 19/08/2026), el flujo de emails, nada de `/mi`, nada de Turnstile.
- **Los datos institucionales de `src/lib/site.ts` son exactos** (entrevista 19/08/2026): no "mejorarlos" ni inventar teléfono/email — esos van vacíos y los carga el superadmin.
- La invalidación de caché desde server actions es `updateTag(tag)` de `next/cache` (verificado en Next 16.3.1; `revalidateTag` exige un segundo argumento de perfil y no aplica acá).

