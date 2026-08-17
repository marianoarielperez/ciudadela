# Módulo 0 — Base: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold de SIGeV (Next.js 15 + Prisma + MariaDB + Auth.js) con login por roles funcionando en `sigev.redaccion.ar`, VPS endurecido y backup nocturno cifrado a Google Drive verificado.

**Architecture:** Monolito Next.js 15 (App Router, TS, `src/`) en la raíz del repo. Prisma sobre MariaDB (Docker 10.11 en dev, instancia del VPS en staging). Auth.js v5 con Credentials + JWT y middleware edge-safe (config partida). Deploy git-based con bloques copiables para Mariano (Claude NO se conecta por SSH al VPS).

**Tech Stack:** Next.js 15+, TypeScript, Tailwind CSS v4 + shadcn/ui, Prisma (`mysql`), Auth.js v5 (`next-auth@beta`), bcryptjs (cost 12), Zod, Vitest, PM2, Nginx 1.18, rclone + GPG.

## Global Constraints

- **Next.js 15+ (App Router, TypeScript)** — un solo proyecto: sitio público + panel + API.
- **MariaDB vía Prisma (provider `mysql`)**. Migraciones siempre con `prisma migrate` — **nunca `db push` en producción**.
- **Auth.js v5** con provider Credentials (bcrypt **cost 12**, política mínimo 8 caracteres, rate limit 5 intentos/15 min por cuenta e IP). Roles `superadmin` | `admin` | `socio`, **acumulables** (tabla N:N).
- **UI en español es-AR** ("vos", fechas `DD/MM/AAAA`, moneda `$ 1.234,56`). Código, tablas y commits en **inglés**.
- Zona horaria `America/Argentina/Buenos_Aires` (UTC-3); **guardar UTC en DB**.
- Color primario `#2E9BDF`.
- PM2 en producción, puerto **3006**, detrás de Nginx + Cloudflare.
- Nginx **1.18**: usar `listen 443 ssl http2;` — **NO existe** la directiva `http2 on;`. Siempre `nginx -t` + `systemctl reload nginx`, **nunca `restart`**.
- **`X-Forwarded-Proto https` obligatorio** en el proxy: sin eso Auth.js rompe cookies.
- `sir` (3002), `cbinfra` (3004), `hydro` (3005), `atenea810` (3007) están en producción: **no tocarlos**.
- Claude Code **NO se conecta por SSH al VPS**: toda tarea de servidor se entrega como bloque copiable que ejecuta Mariano (SSH puerto 2222, root).
- Toda acción sensible se registra en auditoría.
- Secretos solo en `.env` (600); nunca en el repo.

## Decisiones confirmadas por Mariano (17/08/2026)

1. Dev DB: **Docker MariaDB 10.11** (misma versión que el VPS), compose en el repo.
2. Schema Prisma: **solo entidades del Módulo 0** (User/Role/UserRole/Configuration/AuditLog); cada módulo agrega las suyas por migración.
3. UI: **Tailwind v4 + shadcn/ui**.
4. Tests: **Vitest, TDD en lógica de negocio**; pantallas a mano + integración puntual.
5. Superadmin seed: **marianoaperez@yahoo.com.ar** (password vía `SEED_SUPERADMIN_PASSWORD`).
6. Backup: Mariano **tiene acceso** a av.ciudadela@gmail.com → rclone completo en este módulo.
7. **Deploy temprano**: primer deploy con el scaffold apenas builde; el resto se redespliega con `deploy.sh`.
8. Acceso del VPS al repo: **deploy key SSH** read-only.

## Estructura de archivos del módulo

```
docker-compose.yml               # MariaDB 10.11 dev
.env.example                     # todas las vars documentadas
deploy.sh                        # pull → ci → migrate → build → pm2 restart
scripts/backup.sh                # dump 3 DBs + tar uploads + GPG + rclone
prisma/schema.prisma             # User, Role, UserRole, Configuration, AuditLog
prisma/seed.ts                   # roles, superadmin, usuarios de prueba, config
src/auth.config.ts               # config edge-safe (callbacks, pages, authorized)
src/auth.ts                      # NextAuth + Credentials + events
src/middleware.ts                # protege /admin y /mi
src/types/next-auth.d.ts         # augmenta Session/JWT con roles
src/lib/prisma.ts                # singleton PrismaClient
src/lib/format.ts                # formatDateAR, formatARS
src/lib/auth/password.ts         # política de contraseñas
src/lib/auth/verify-credentials.ts
src/lib/auth/rate-limiter.ts
src/lib/audit.ts                 # helper de auditoría
src/app/(public)/layout.tsx      # shell público (header/footer)
src/app/(public)/page.tsx        # home placeholder
src/app/(public)/ingresar/page.tsx + login-form.tsx + actions.ts
src/app/redirigir/page.tsx       # post-login: manda a /admin o /mi según rol
src/app/admin/layout.tsx + page.tsx
src/app/mi/layout.tsx + page.tsx
src/app/api/auth/[...nextauth]/route.ts
tests/format.test.ts
tests/password.test.ts
tests/verify-credentials.test.ts
tests/rate-limiter.test.ts
tests/audit.test.ts
vitest.config.ts
```

---

# FASE A — Local (Claude Code)

### Task 1: Scaffold Next.js + Tailwind + shadcn/ui

**Files:**
- Create: proyecto Next completo en la raíz del repo (`package.json`, `src/app/*`, `tsconfig.json`, etc.)
- Modify: `.gitignore` (merge del existente con el generado)

`create-next-app` no acepta directorios con `CLAUDE.md`/`assets`/`datos`, así que se scaffoldea en carpeta temporal y se mueve.

- [ ] **Step 1: Scaffold en carpeta temporal y mover a la raíz**

```powershell
npx create-next-app@latest C:\git\ciudadela-tmp --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --use-npm --turbopack
# Mover todo (menos .git) a la raíz del repo
robocopy C:\git\ciudadela-tmp C:\git\ciudadela /E /XD .git node_modules /XF README.md
Remove-Item -Recurse -Force C:\git\ciudadela-tmp
```

Luego, en `C:\git\ciudadela`: fusionar el `.gitignore` generado con el existente (conservar ambas listas; agregar `uploads/`, `.env*` salvo `.env.example`), y `npm install`.

- [ ] **Step 2: Puerto 3006 en el start script**

En `package.json`:

```json
"scripts": {
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start -p 3006",
  "lint": "eslint"
}
```

- [ ] **Step 3: shadcn/ui init + color de marca**

```powershell
npx shadcn@latest init -y
npx shadcn@latest add button card input label
```

En `src/app/globals.css`, fijar el primario de marca (celeste `#2E9BDF`) en los tokens de shadcn (`--primary` en `:root`, con foreground blanco). Verificar contraste del texto sobre celeste.

- [ ] **Step 4: Verificar que arranca**

Run: `npm run dev` → abrir http://localhost:3000, debe renderizar la página default sin errores. Luego `npm run build` debe pasar.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "chore: scaffold Next.js 15 app with Tailwind and shadcn/ui"
```

### Task 2: MariaDB dev (Docker) + Prisma + schema Módulo 0

**Files:**
- Create: `docker-compose.yml`, `prisma/schema.prisma`, `src/lib/prisma.ts`, `.env`, `.env.example`

**Interfaces:**
- Produces: `prisma` singleton (`import { prisma } from "@/lib/prisma"`), modelos `User`, `Role`, `UserRole`, `Configuration`, `AuditLog`.

- [ ] **Step 1: docker-compose.yml**

```yaml
services:
  db:
    image: mariadb:10.11
    container_name: sigev-db
    ports:
      - "3306:3306"
    environment:
      MARIADB_ROOT_PASSWORD: devroot
      MARIADB_DATABASE: sigev
      MARIADB_USER: sigev
      MARIADB_PASSWORD: sigev_dev
    volumes:
      - sigev_db:/var/lib/mysql
volumes:
  sigev_db:
```

Run: `docker compose up -d` (requiere Docker Desktop abierto) y verificar con `docker compose ps` (estado `running`).

- [ ] **Step 2: Prisma init + .env**

```powershell
npm install @prisma/client
npm install -D prisma tsx
npx prisma init --datasource-provider mysql
```

`.env` (dev, gitignored):

```
DATABASE_URL="mysql://sigev:sigev_dev@localhost:3306/sigev"
# El usuario sigev del contenedor no puede crear la shadow DB de migrate dev:
SHADOW_DATABASE_URL="mysql://root:devroot@localhost:3306/sigev_shadow"
AUTH_SECRET="dev-secret-cambiar"
AUTH_URL="http://localhost:3000"
SEED_SUPERADMIN_PASSWORD="cambiame-ya-8+"
SEED_TEST_USERS="true"
SEED_TEST_PASSWORD="prueba-sigev-8+"
```

`.env.example`: mismas claves + todas las de CLAUDE.md (MP, Brevo, Turnstile, `UPLOADS_DIR`, `CRON_SECRET`) con valores `***` y comentarios de a qué módulo pertenecen.

- [ ] **Step 3: Schema Módulo 0**

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider          = "mysql"
  url               = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
}

model User {
  id           Int        @id @default(autoincrement())
  email        String     @unique @db.VarChar(191)
  passwordHash String     @map("password_hash") @db.VarChar(60)
  name         String?    @db.VarChar(120)
  active       Boolean    @default(true)
  lastLoginAt  DateTime?  @map("last_login_at")
  createdAt    DateTime   @default(now()) @map("created_at")
  updatedAt    DateTime   @updatedAt @map("updated_at")
  roles        UserRole[]
  auditLogs    AuditLog[]

  @@map("users")
}

model Role {
  id    Int        @id @default(autoincrement())
  name  String     @unique @db.VarChar(32) // superadmin | admin | socio
  users UserRole[]

  @@map("roles")
}

model UserRole {
  userId Int  @map("user_id")
  roleId Int  @map("role_id")
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   Role @relation(fields: [roleId], references: [id])

  @@id([userId, roleId])
  @@map("user_roles")
}

model Configuration {
  key       String   @id @db.VarChar(64)
  value     Json
  updatedBy Int?     @map("updated_by")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("configuration")
}

model AuditLog {
  id        BigInt   @id @default(autoincrement())
  userId    Int?     @map("user_id")
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action    String   @db.VarChar(64)
  entity    String?  @db.VarChar(64)
  entityId  String?  @map("entity_id") @db.VarChar(64)
  detail    Json?
  ip        String?  @db.VarChar(45)
  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([entity, entityId])
  @@map("audit_log")
}
```

- [ ] **Step 4: Migración inicial**

Run: `npx prisma migrate dev --name init-module-0`
Expected: migración creada en `prisma/migrations/`, tablas visibles con `npx prisma studio`.

- [ ] **Step 5: Singleton de Prisma**

`src/lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
```

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: add Prisma schema for users, roles, configuration and audit log"
```

### Task 3: Vitest + formatters es-AR (TDD)

**Files:**
- Create: `vitest.config.ts`, `tests/format.test.ts`, `src/lib/format.ts`

**Interfaces:**
- Produces: `formatDateAR(date: Date): string` (DD/MM/AAAA en TZ argentina), `formatARS(amount: number): string` (`$ 1.234,56`).

- [ ] **Step 1: Instalar y configurar Vitest**

```powershell
npm install -D vitest
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
})
```

En `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 2: Test que falla**

`tests/format.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { formatDateAR, formatARS } from "@/lib/format"

describe("formatDateAR", () => {
  it("formats a UTC date in Argentina timezone as DD/MM/AAAA", () => {
    // 2026-08-17T02:30Z = 16/08 23:30 en Argentina (UTC-3)
    expect(formatDateAR(new Date("2026-08-17T02:30:00Z"))).toBe("16/08/2026")
  })
  it("formats midday dates plainly", () => {
    expect(formatDateAR(new Date("2026-01-05T15:00:00Z"))).toBe("05/01/2026")
  })
})

describe("formatARS", () => {
  it("formats with dot thousands and comma decimals", () => {
    expect(formatARS(1234.56)).toBe("$ 1.234,56")
  })
  it("always shows two decimals", () => {
    expect(formatARS(6000)).toBe("$ 6.000,00")
  })
})
```

Run: `npm test` → Expected: FAIL (module not found).

- [ ] **Step 3: Implementación**

`src/lib/format.ts`:

```ts
const TZ = "America/Argentina/Buenos_Aires"

export function formatDateAR(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

export function formatARS(amount: number): string {
  const s = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(amount)
  // Intl usa espacio no separable tras "$"; normalizamos a espacio común
  return s.replace(/\u00A0/g, " ")
}
```

- [ ] **Step 4: Verificar verde y commitear**

Run: `npm test` → Expected: PASS (4 tests).

```powershell
git add -A
git commit -m "feat: add es-AR date and currency formatters"
```

### Task 4: Política de contraseñas + verificación de credenciales (TDD)

**Files:**
- Create: `tests/password.test.ts`, `src/lib/auth/password.ts`, `tests/verify-credentials.test.ts`, `src/lib/auth/verify-credentials.ts`

**Interfaces:**
- Produces: `validatePassword(pw: string): { ok: true } | { ok: false; error: string }`;
  `makeVerifyCredentials(db): (email: unknown, password: unknown) => Promise<AuthUser | null>` con `AuthUser = { id: string; email: string; name: string | null; roles: string[] }`. `BCRYPT_COST = 12` exportado (lo consume el seed y, a futuro, el alta de usuarios).

- [ ] **Step 1: Instalar bcryptjs y zod**

```powershell
npm install bcryptjs zod
```

(bcryptjs y no bcrypt nativo: evita node-gyp en Windows y en el VPS; misma salida `$2b$`, cost 12 igual.)

- [ ] **Step 2: Tests de política (fallan)**

`tests/password.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { validatePassword } from "@/lib/auth/password"

describe("validatePassword", () => {
  it("rejects passwords shorter than 8 chars", () => {
    expect(validatePassword("corta12").ok).toBe(false)
  })
  it("accepts 8+ chars", () => {
    expect(validatePassword("unaClave8").ok).toBe(true)
  })
})
```

- [ ] **Step 3: Implementar política**

`src/lib/auth/password.ts`:

```ts
export const BCRYPT_COST = 12
export const MIN_PASSWORD_LENGTH = 8

export function validatePassword(pw: string): { ok: true } | { ok: false; error: string } {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }
  }
  return { ok: true }
}
```

Run: `npm test` → PASS.

- [ ] **Step 4: Tests de verifyCredentials (fallan)**

`tests/verify-credentials.test.ts` — usa un fake del modelo `user` de Prisma:

```ts
import { describe, it, expect } from "vitest"
import bcrypt from "bcryptjs"
import { makeVerifyCredentials } from "@/lib/auth/verify-credentials"

const hash = bcrypt.hashSync("clave-correcta", 4) // cost bajo solo para tests

function fakeDb(user: object | null) {
  return { user: { findUnique: async () => user } } as never
}

const baseUser = {
  id: 7,
  email: "socio@test.com",
  passwordHash: hash,
  name: "Socia Prueba",
  active: true,
  roles: [{ role: { name: "socio" } }],
}

describe("verifyCredentials", () => {
  it("returns AuthUser with flattened roles on valid credentials", async () => {
    const verify = makeVerifyCredentials(fakeDb(baseUser))
    const result = await verify("socio@test.com", "clave-correcta")
    expect(result).toEqual({ id: "7", email: "socio@test.com", name: "Socia Prueba", roles: ["socio"] })
  })
  it("returns null on wrong password", async () => {
    const verify = makeVerifyCredentials(fakeDb(baseUser))
    expect(await verify("socio@test.com", "clave-incorrecta")).toBeNull()
  })
  it("returns null for unknown email", async () => {
    const verify = makeVerifyCredentials(fakeDb(null))
    expect(await verify("nadie@test.com", "clave-correcta")).toBeNull()
  })
  it("returns null for inactive user even with right password", async () => {
    const verify = makeVerifyCredentials(fakeDb({ ...baseUser, active: false }))
    expect(await verify("socio@test.com", "clave-correcta")).toBeNull()
  })
  it("returns null on malformed input", async () => {
    const verify = makeVerifyCredentials(fakeDb(baseUser))
    expect(await verify(undefined, undefined)).toBeNull()
    expect(await verify("no-es-email", "clave-correcta")).toBeNull()
  })
})
```

- [ ] **Step 5: Implementar verifyCredentials**

`src/lib/auth/verify-credentials.ts`:

```ts
import bcrypt from "bcryptjs"
import { z } from "zod"
import type { PrismaClient } from "@prisma/client"

export type AuthUser = { id: string; email: string; name: string | null; roles: string[] }

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

type Db = Pick<PrismaClient, "user">

export function makeVerifyCredentials(db: Db) {
  return async function verifyCredentials(email: unknown, password: unknown): Promise<AuthUser | null> {
    const parsed = credentialsSchema.safeParse({ email, password })
    if (!parsed.success) return null

    const user = await db.user.findUnique({
      where: { email: parsed.data.email.toLowerCase().trim() },
      include: { roles: { include: { role: true } } },
    })
    if (!user || !user.active) return null

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!ok) return null

    return {
      id: String(user.id),
      email: user.email,
      name: user.name,
      roles: user.roles.map((r) => r.role.name),
    }
  }
}
```

Run: `npm test` → PASS (todos).

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: add password policy and credential verification"
```

### Task 5: Rate limiter de login (TDD)

**Files:**
- Create: `tests/rate-limiter.test.ts`, `src/lib/auth/rate-limiter.ts`

**Interfaces:**
- Produces: `createRateLimiter(opts?) => { check(key: string): boolean; reset(key: string): void }` y singleton `loginLimiter` (5 intentos / 15 min). In-memory: válido porque PM2 corre UN solo proceso; si algún día se clusteriza, migrar a DB/Redis (dejar este comentario en el código).

- [ ] **Step 1: Tests (fallan)**

`tests/rate-limiter.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createRateLimiter } from "@/lib/auth/rate-limiter"

function clockAt(start: number) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe("createRateLimiter", () => {
  it("allows up to limit attempts within the window", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 5, windowMs: 900_000, now: clock.now })
    for (let i = 0; i < 5; i++) expect(rl.check("a@b.c|1.2.3.4")).toBe(true)
    expect(rl.check("a@b.c|1.2.3.4")).toBe(false)
  })
  it("frees attempts after the window slides", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: clock.now })
    rl.check("k"); rl.check("k")
    expect(rl.check("k")).toBe(false)
    clock.advance(1001)
    expect(rl.check("k")).toBe(true)
  })
  it("tracks keys independently", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now })
    expect(rl.check("uno")).toBe(true)
    expect(rl.check("dos")).toBe(true)
    expect(rl.check("uno")).toBe(false)
  })
  it("reset clears a key", () => {
    const clock = clockAt(0)
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now })
    rl.check("k")
    rl.reset("k")
    expect(rl.check("k")).toBe(true)
  })
})
```

- [ ] **Step 2: Implementación**

`src/lib/auth/rate-limiter.ts`:

```ts
type Options = { limit?: number; windowMs?: number; now?: () => number }

export function createRateLimiter({ limit = 5, windowMs = 15 * 60_000, now = Date.now }: Options = {}) {
  const hits = new Map<string, number[]>()
  return {
    /** true = intento permitido (y registrado); false = bloqueado */
    check(key: string): boolean {
      const t = now()
      const recent = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(t)
      hits.set(key, recent)
      return true
    },
    reset(key: string) {
      hits.delete(key)
    },
  }
}

// In-memory alcanza: PM2 corre un único proceso (escala ~300 socios).
// Si se clusteriza, migrar a almacenamiento compartido.
export const loginLimiter = createRateLimiter()
```

Run: `npm test` → PASS.

- [ ] **Step 3: Commit**

```powershell
git add -A
git commit -m "feat: add in-memory login rate limiter"
```

### Task 6: Helper de auditoría (TDD)

**Files:**
- Create: `tests/audit.test.ts`, `src/lib/audit.ts`

**Interfaces:**
- Produces: `audit(entry: AuditEntry): Promise<void>` (usa el singleton) y `makeAudit(db)` para tests. `AuditEntry = { userId?: number | null; action: string; entity?: string; entityId?: string | number; detail?: unknown; ip?: string | null }`. **Nunca lanza**: un fallo de auditoría no debe romper el flujo principal (se loguea por consola).

- [ ] **Step 1: Tests (fallan)**

`tests/audit.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { makeAudit } from "@/lib/audit"

describe("audit", () => {
  it("persists action with user, entity and stringified entityId", async () => {
    const create = vi.fn(async () => ({}))
    const audit = makeAudit({ auditLog: { create } } as never)
    await audit({ userId: 3, action: "login", entity: "user", entityId: 3, ip: "10.0.0.1" })
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 3,
        action: "login",
        entity: "user",
        entityId: "3",
        detail: undefined,
        ip: "10.0.0.1",
      },
    })
  })
  it("swallows database errors and logs them", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const create = vi.fn(async () => { throw new Error("db down") })
    const audit = makeAudit({ auditLog: { create } } as never)
    await expect(audit({ action: "login_failed" })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
```

- [ ] **Step 2: Implementación**

`src/lib/audit.ts`:

```ts
import type { Prisma, PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export type AuditEntry = {
  userId?: number | null
  action: string
  entity?: string
  entityId?: string | number
  detail?: unknown
  ip?: string | null
}

type Db = Pick<PrismaClient, "auditLog">

export function makeAudit(db: Db) {
  return async function audit(entry: AuditEntry): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId === undefined ? undefined : String(entry.entityId),
          detail: entry.detail as Prisma.InputJsonValue | undefined,
          ip: entry.ip ?? undefined,
        },
      })
    } catch (err) {
      // La auditoría nunca rompe el flujo principal
      console.error("[audit] failed to persist entry", entry.action, err)
    }
  }
}

export const audit = makeAudit(prisma)
```

Run: `npm test` → PASS.

- [ ] **Step 3: Commit**

```powershell
git add -A
git commit -m "feat: add audit log helper"
```

### Task 7: Auth.js v5 — config, middleware, login y logout

**Files:**
- Create: `src/auth.config.ts`, `src/auth.ts`, `src/middleware.ts`, `src/types/next-auth.d.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/(public)/ingresar/page.tsx`, `src/app/(public)/ingresar/login-form.tsx`, `src/app/(public)/ingresar/actions.ts`, `src/app/redirigir/page.tsx`

**Interfaces:**
- Consumes: `makeVerifyCredentials`, `loginLimiter`, `audit`, `prisma`.
- Produces: `auth()`, `signIn`, `signOut`, `handlers`; sesión con `session.user.roles: string[]` y `session.user.id: string`.

- [ ] **Step 1: Instalar Auth.js**

```powershell
npm install next-auth@beta
```

- [ ] **Step 2: Config edge-safe**

`src/auth.config.ts` (SIN imports de Prisma/bcrypt — lo usa el middleware):

```ts
import type { NextAuthConfig } from "next-auth"

export const authConfig = {
  pages: { signIn: "/ingresar" },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  trustHost: true, // detrás de Nginx/Cloudflare; X-Forwarded-* los fija el proxy
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.roles = (user as { roles?: string[] }).roles ?? []
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.roles = (token.roles as string[]) ?? []
      return session
    },
    authorized({ auth, request }) {
      const roles = auth?.user?.roles ?? []
      const path = request.nextUrl.pathname
      if (path.startsWith("/admin")) return roles.includes("admin") || roles.includes("superadmin")
      if (path.startsWith("/mi")) return roles.includes("socio")
      return true
    },
  },
  providers: [], // se completan en auth.ts (server only)
} satisfies NextAuthConfig
```

`src/types/next-auth.d.ts`:

```ts
import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: { id: string; roles: string[] } & DefaultSession["user"]
  }
  interface User {
    roles?: string[]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string
    roles?: string[]
  }
}
```

- [ ] **Step 3: NextAuth server + events de auditoría**

`src/auth.ts`:

```ts
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { authConfig } from "@/auth.config"
import { prisma } from "@/lib/prisma"
import { audit } from "@/lib/audit"
import { makeVerifyCredentials } from "@/lib/auth/verify-credentials"

const verifyCredentials = makeVerifyCredentials(prisma)

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        return verifyCredentials(credentials?.email, credentials?.password)
      },
    }),
  ],
  events: {
    async signIn({ user }) {
      const userId = Number(user.id)
      await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
      await audit({ userId, action: "login", entity: "user", entityId: userId })
    },
  },
})
```

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth"

export const { GET, POST } = handlers
```

`src/middleware.ts`:

```ts
import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

export default NextAuth(authConfig).auth

export const config = { matcher: ["/admin/:path*", "/mi/:path*"] }
```

- [ ] **Step 4: Server action de login con rate limit y auditoría de fallos**

`src/app/(public)/ingresar/actions.ts`:

```ts
"use server"

import { AuthError } from "next-auth"
import { headers } from "next/headers"
import { signIn } from "@/auth"
import { audit } from "@/lib/audit"
import { loginLimiter } from "@/lib/auth/rate-limiter"

export type LoginState = { error?: string }

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim()
  const password = String(formData.get("password") ?? "")
  const ip = (await headers()).get("x-real-ip") ?? "unknown"

  // 5 intentos / 15 min por cuenta e IP (docs/08)
  if (!loginLimiter.check(`${email}|${ip}`)) {
    return { error: "Demasiados intentos. Esperá 15 minutos y probá de nuevo." }
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/redirigir" })
    return {}
  } catch (err) {
    if (err instanceof AuthError) {
      await audit({ action: "login_failed", detail: { email }, ip })
      return { error: "Email o contraseña incorrectos." }
    }
    throw err // NEXT_REDIRECT debe propagarse
  }
}
```

- [ ] **Step 5: Página y formulario de login (es-AR, "vos")**

`src/app/(public)/ingresar/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { LoginForm } from "./login-form"

export const metadata = { title: "Ingresar — Vecinal Ciudadela" }

export default async function IngresarPage() {
  const session = await auth()
  if (session) redirect("/redirigir")
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-bold">Ingresá a tu cuenta</h1>
      <LoginForm />
    </main>
  )
}
```

`src/app/(public)/ingresar/login-form.tsx`:

```tsx
"use client"

import { useActionState } from "react"
import { loginAction, type LoginState } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {})
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 6: Redirección post-login por rol**

`src/app/redirigir/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"

export default async function RedirigirPage() {
  const session = await auth()
  if (!session) redirect("/ingresar")
  const roles = session.user.roles
  if (roles.includes("superadmin") || roles.includes("admin")) redirect("/admin")
  if (roles.includes("socio")) redirect("/mi")
  redirect("/")
}
```

- [ ] **Step 7: Verificación manual + commit**

Run: `npm run dev` → `/ingresar` renderiza; login con credenciales inexistentes muestra "Email o contraseña incorrectos." (el seed llega en Task 9; la verificación completa del circuito es el Step 4 de Task 9). `npm test` sigue verde. `npm run build` pasa.

```powershell
git add -A
git commit -m "feat: wire Auth.js credentials login with role-based middleware"
```

### Task 8: Layouts público / admin / socio

**Files:**
- Create: `src/app/(public)/layout.tsx`, reemplazar `src/app/page.tsx` → `src/app/(public)/page.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/mi/layout.tsx`, `src/app/mi/page.tsx`
- Modify: `src/app/layout.tsx` (lang="es", metadata institucional)

**Interfaces:**
- Consumes: `auth()`, `signOut` de `@/auth`; logo `assets/logo.png` (copiarlo a `public/logo.png` — el logo es público, no es un upload sensible).

- [ ] **Step 1: Root layout es-AR**

`src/app/layout.tsx`: `<html lang="es">`, metadata `title: "Asociación Vecinal Barrio Ciudadela"`, fuente del scaffold. Copiar `assets/logo.png` → `public/logo.png`.

- [ ] **Step 2: Shell público**

`src/app/(public)/layout.tsx`: header con logo + nombre y link "Ingresar" (`/ingresar`); footer con "Asociación Vecinal del Barrio Ciudadela — Comodoro Rivadavia, Chubut" y "Sistema SIGeV". `src/app/(public)/page.tsx`: placeholder institucional mínimo (el home real es Módulo 2): nombre, logo, texto "Sitio en construcción".

- [ ] **Step 3: Shell admin con guard server-side**

`src/app/admin/layout.tsx` (defensa en profundidad además del middleware):

```tsx
import { redirect } from "next/navigation"
import { auth, signOut } from "@/auth"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const roles = session?.user.roles ?? []
  if (!roles.includes("admin") && !roles.includes("superadmin")) redirect("/ingresar")
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
        <span className="font-bold">SIGeV — Panel de administración</span>
        <form action={async () => { "use server"; await signOut({ redirectTo: "/" }) }}>
          <button className="text-sm underline">Cerrar sesión</button>
        </form>
      </header>
      <main className="p-4">{children}</main>
    </div>
  )
}
```

`src/app/admin/page.tsx`: bienvenida con nombre del usuario y placeholders de las secciones futuras (Solicitudes, Socios, Tesorería, Noticias, Configuración) deshabilitadas con "Próximamente".

- [ ] **Step 4: Shell socio**

`src/app/mi/layout.tsx`: igual patrón con guard `roles.includes("socio")`, header "Mi cuenta — Vecinal Ciudadela" y cerrar sesión. `src/app/mi/page.tsx`: bienvenida + placeholders (Mis datos, Mi cuenta, Pagar) "Próximamente".

Los dos paneles deben ser **visiblemente distintos** (título y secciones diferentes): lo exige el CA del módulo.

- [ ] **Step 5: Build + commit**

Run: `npm run build` → pasa sin errores de tipos.

```powershell
git add -A
git commit -m "feat: add public, admin and member layout shells"
```

### Task 9: Seed — roles, superadmin, usuarios de prueba, configuración

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (bloque `"prisma"`)

**Interfaces:**
- Consumes: `BCRYPT_COST` de `@/lib/auth/password` (import relativo `../src/lib/auth/password`).
- Produces: usuarios `marianoaperez@yahoo.com.ar` (superadmin+admin), `admin.prueba@sigev.local` (admin), `socio.prueba@sigev.local` (socio); claves de Configuration `asociate_activo=false`, `elecciones_en_curso=false`.

- [ ] **Step 1: Seed idempotente**

`prisma/seed.ts`:

```ts
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { BCRYPT_COST } from "../src/lib/auth/password"

const prisma = new PrismaClient()

async function upsertUser(email: string, name: string, password: string, roleNames: string[]) {
  const roles = await prisma.role.findMany({ where: { name: { in: roleNames } } })
  const existing = await prisma.user.findUnique({ where: { email } })
  // Nunca pisar la contraseña de un usuario existente
  const user = existing
    ? existing
    : await prisma.user.create({
        data: { email, name, passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
      })
  for (const role of roles) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    })
  }
  return user
}

async function main() {
  for (const name of ["superadmin", "admin", "socio"]) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } })
  }

  const superPass = process.env.SEED_SUPERADMIN_PASSWORD
  if (!superPass) throw new Error("SEED_SUPERADMIN_PASSWORD no está definida")
  await upsertUser("marianoaperez@yahoo.com.ar", "Mariano Perez", superPass, ["superadmin", "admin"])

  if (process.env.SEED_TEST_USERS === "true") {
    const testPass = process.env.SEED_TEST_PASSWORD
    if (!testPass) throw new Error("SEED_TEST_USERS=true pero falta SEED_TEST_PASSWORD")
    await upsertUser("admin.prueba@sigev.local", "Admin de Prueba", testPass, ["admin"])
    await upsertUser("socio.prueba@sigev.local", "Socio de Prueba", testPass, ["socio"])
  }

  const defaults: Record<string, unknown> = { asociate_activo: false, elecciones_en_curso: false }
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.configuration.upsert({
      where: { key },
      update: {},
      create: { key, value: value as never },
    })
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
```

`package.json`:

```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

- [ ] **Step 2: Ejecutar y verificar idempotencia**

Run: `npx prisma db seed` dos veces → segunda corrida sin errores ni duplicados. Con `npx prisma studio`: 3 roles, 3 usuarios con sus roles, 2 claves de configuración.

- [ ] **Step 3: Verificación manual del circuito completo de login**

Con `npm run dev`:
1. `admin.prueba@sigev.local` → entra y ve **Panel de administración**; `/mi` le rebota.
2. `socio.prueba@sigev.local` → entra y ve **Mi cuenta**; `/admin` le rebota.
3. Password errónea → mensaje de error + fila `login_failed` en `audit_log`.
4. Login OK → fila `login` en `audit_log` y `last_login_at` actualizado.
5. 6 intentos fallidos seguidos → mensaje de demasiados intentos.

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "feat: add database seed with superadmin and test users"
```

### Task 10: deploy.sh, backup.sh y push

**Files:**
- Create: `deploy.sh`, `scripts/backup.sh`

- [ ] **Step 1: deploy.sh**

```bash
#!/usr/bin/env bash
# Deploy de SIGeV en el VPS. Uso: bash deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sigev}"
cd "$APP_DIR"

git pull --ff-only
npm ci
npx prisma migrate deploy
npm run build
pm2 restart sigev --update-env
pm2 save

echo "Deploy OK: $(git rev-parse --short HEAD)"
```

- [ ] **Step 2: scripts/backup.sh**

```bash
#!/usr/bin/env bash
# Backup nocturno: dumps de MariaDB + uploads, cifrado GPG, subida a Drive.
# Cron: 0 4 * * * (root). Respalda TAMBIÉN cbinfra y sir_database (doc 09:
# el VPS no tiene ningún otro backup de DB).
set -euo pipefail

STAMP=$(date +%F)
WORK=/var/sigev/backups
PASS_FILE=/root/.sigev_backup_pass
REMOTE=gdrive:sigev-backups
RETENTION_DAYS=30

mkdir -p "$WORK"

for db in sigev cbinfra sir_database; do
  mysqldump --single-transaction --routines "$db" | gzip > "$WORK/$db-$STAMP.sql.gz"
done

tar -czf "$WORK/files-$STAMP.tar.gz" -C /var/sigev uploads recibos

for f in "$WORK"/sigev-"$STAMP".sql.gz "$WORK"/cbinfra-"$STAMP".sql.gz \
         "$WORK"/sir_database-"$STAMP".sql.gz "$WORK"/files-"$STAMP".tar.gz; do
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$PASS_FILE" "$f"
  rm "$f"
done

rclone copy "$WORK" "$REMOTE" --include "*-$STAMP*.gpg"

find "$WORK" -name '*.gpg' -mtime +"$RETENTION_DAYS" -delete
rclone delete "$REMOTE" --min-age "${RETENTION_DAYS}d"

echo "[backup] OK $STAMP"
```

- [ ] **Step 3: Commit + push**

```powershell
git add -A
git commit -m "chore: add deploy and encrypted backup scripts"
git push origin main
```

---

# FASE B — VPS (bloques copiables: los ejecuta Mariano por SSH)

> Regla dura: nada de esto puede tocar `sir`, `cbinfra`, `hydro` ni `atenea810`.
> El primer deploy (T11–T15) puede hacerse apenas Fase A esté pusheada — decisión
> "deploy temprano": si se hace antes de terminar Fase A, repetir `bash deploy.sh`
> tras cada push.

### Task 11: Hardening — ufw + pm2-logrotate

- [ ] **Step 1: ufw** — ⚠️ mantené esta sesión SSH abierta y probá con una segunda ANTES de cerrar:

```bash
ufw allow 2222/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable && ufw status verbose
```

- [ ] **Step 2: Verificar desde tu Windows** (segunda terminal, sin cerrar la primera):

```bash
ssh -p 2222 root@167.86.71.102 "echo SSH OK"
```

y abrir en el navegador `atenea.redaccion.ar`, `hydrocalculus.ar` y `cbinfraestructura.ar` → todos deben seguir respondiendo (CA: servicios existentes intactos).

- [ ] **Step 3: pm2-logrotate** (beneficia a todas las apps):

```bash
pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 7 && pm2 set pm2-logrotate:compress true
```

### Task 12: Base de datos y directorios

- [ ] **Step 1: DB + usuario dedicado** (guardá la contraseña que imprime, va al `.env`):

```bash
DBPASS=$(openssl rand -base64 24 | tr -d '=+/'); echo "PASSWORD DB sigev: $DBPASS"; mysql -e "CREATE DATABASE sigev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" && mysql -e "CREATE USER 'sigev'@'localhost' IDENTIFIED BY '$DBPASS';" && mysql -e "GRANT ALL PRIVILEGES ON sigev.* TO 'sigev'@'localhost'; FLUSH PRIVILEGES;"
```

- [ ] **Step 2: Directorios de datos** (fuera del webroot y del repo):

```bash
mkdir -p /var/sigev/uploads /var/sigev/recibos /var/sigev/backups && chmod 750 /var/sigev /var/sigev/uploads /var/sigev/recibos /var/sigev/backups
```

### Task 13: Deploy key + clone + .env

- [ ] **Step 1: Generar deploy key**:

```bash
ssh-keygen -t ed25519 -C "sigev-deploy" -f ~/.ssh/sigev_deploy -N "" && cat ~/.ssh/sigev_deploy.pub
```

- [ ] **Step 2 (en el navegador):** GitHub → repo `ciudadela` → Settings → Deploy keys → "Add deploy key" → pegar la clave pública, **SIN** write access.

- [ ] **Step 3: Config SSH + clone**:

```bash
printf "Host github.com-sigev\n  HostName github.com\n  IdentityFile ~/.ssh/sigev_deploy\n  IdentitiesOnly yes\n" >> ~/.ssh/config && git clone git@github.com-sigev:marianoarielperez/ciudadela.git /opt/sigev
```

- [ ] **Step 4: Crear `.env` del servidor** (reemplazá `<DBPASS>` por la contraseña del Task 12 y elegí contraseñas reales de 8+ para los seeds):

```bash
cat > /opt/sigev/.env <<'EOF'
DATABASE_URL="mysql://sigev:<DBPASS>@localhost:3306/sigev"
AUTH_SECRET="<openssl rand -base64 32>"
AUTH_URL=https://sigev.redaccion.ar
SEED_SUPERADMIN_PASSWORD="<elegir>"
SEED_TEST_USERS="true"
SEED_TEST_PASSWORD="<elegir>"
UPLOADS_DIR=/var/sigev/uploads
EOF
chmod 600 /opt/sigev/.env
```

Generá el secret con `openssl rand -base64 32` y pegalo. (MP/Brevo/Turnstile se agregan en los módulos 2-3; `prisma migrate deploy` no necesita `SHADOW_DATABASE_URL`.)

### Task 14: Primer deploy + PM2

- [ ] **Step 1: Build y arranque**:

```bash
cd /opt/sigev && npm ci && npx prisma migrate deploy && npx prisma db seed && npm run build && pm2 start npm --name sigev -- start && pm2 save
```

- [ ] **Step 2: Verificar**:

```bash
pm2 status sigev && curl -sI http://127.0.0.1:3006 | head -5
```

Expected: proceso `online`, respuesta `HTTP/1.1 200 OK`.

### Task 15: Nginx + DNS + verificación HTTPS

- [ ] **Step 1: Server block** (patrón de `atenea.redaccion.ar`, cert wildcard ya instalado — doc 09 lo dejó listo):

```bash
cat > /etc/nginx/sites-available/sigev.redaccion.ar <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name sigev.redaccion.ar;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name sigev.redaccion.ar;

    ssl_certificate     /etc/ssl/cloudflare/redaccion.ar.pem;
    ssl_certificate_key /etc/ssl/cloudflare/redaccion.ar.key;

    # Staging: no indexar. QUITAR en producción (vecinalciudadela.com.ar)
    add_header X-Robots-Tag "noindex, nofollow" always;

    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF
ln -s /etc/nginx/sites-available/sigev.redaccion.ar /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
```

(`nginx -t` primero SIEMPRE; jamás `restart`. `X-Forwarded-Proto https` es obligatorio para las cookies de Auth.js.)

- [ ] **Step 2: DNS** — en Cloudflare, verificar que `sigev.redaccion.ar` resuelva (hay wildcard); si no, crear registro A → `167.86.71.102` con proxy naranja.

- [ ] **Step 3: Verificación HTTPS + login real**:

Desde tu Windows: abrir `https://sigev.redaccion.ar` → home placeholder con candado; `/ingresar` → login con `admin.prueba@sigev.local` ve el panel admin, `socio.prueba@sigev.local` ve "Mi cuenta". **Esto cierra el CA principal del módulo.**

### Task 16: Backup — rclone + passphrase + cron

- [ ] **Step 1: Instalar rclone** (script oficial):

```bash
curl -fsSL https://rclone.org/install.sh | bash && rclone version
```

- [ ] **Step 2: Passphrase GPG** (guardala TAMBIÉN fuera del VPS — gestor de contraseñas — sin ella los backups son irrecuperables):

```bash
openssl rand -base64 32 > /root/.sigev_backup_pass && chmod 600 /root/.sigev_backup_pass && cat /root/.sigev_backup_pass
```

- [ ] **Step 3: Configurar remote de Drive** — `rclone config` en el VPS: `n` (new) → nombre `gdrive` → storage `drive` → client_id/secret vacíos → scope `drive.file` (mínimo privilegio: solo ve lo que él sube) → auto config **No** (headless). Te va a dar un comando `rclone authorize "drive" ...`: lo corrés en tu Windows (instalá rclone ahí con `winget install Rclone.Rclone`), autorizás en el navegador **con av.ciudadela@gmail.com**, y pegás el token resultante en la terminal del VPS.

- [ ] **Step 4: Probar remote**:

```bash
rclone mkdir gdrive:sigev-backups && echo "prueba $(date)" > /tmp/rclone-test.txt && rclone copy /tmp/rclone-test.txt gdrive:sigev-backups && rclone ls gdrive:sigev-backups && rclone delete gdrive:sigev-backups/rclone-test.txt && rm /tmp/rclone-test.txt
```

- [ ] **Step 5: Primera corrida manual + cron**:

```bash
chmod +x /opt/sigev/scripts/backup.sh && /opt/sigev/scripts/backup.sh && rclone ls gdrive:sigev-backups
```

Expected: 4 archivos `.gpg` (sigev, cbinfra, sir_database, files) locales y en Drive.

```bash
( crontab -l 2>/dev/null; echo "0 4 * * * /opt/sigev/scripts/backup.sh >> /var/log/sigev-backup.log 2>&1" ) | crontab - && crontab -l
```

### Task 17: Verificación de restore (CA del módulo)

- [ ] **Step 1: Restaurar el dump de sigev en una DB de prueba**:

```bash
LATEST=$(ls -t /var/sigev/backups/sigev-*.sql.gz.gpg | head -1) && gpg --batch --passphrase-file /root/.sigev_backup_pass -d "$LATEST" | gunzip > /tmp/restore_test.sql && mysql -e "CREATE DATABASE sigev_restore_test;" && mysql sigev_restore_test < /tmp/restore_test.sql && mysql -e "SHOW TABLES IN sigev_restore_test; SELECT COUNT(*) AS users FROM sigev_restore_test.users;"
```

Expected: las 5 tablas + `_prisma_migrations`, y `users = 3`.

- [ ] **Step 2: Limpiar**:

```bash
mysql -e "DROP DATABASE sigev_restore_test;" && rm /tmp/restore_test.sql
```

---

# Task 18: Cierre — criterios de aceptación del Módulo 0

- [ ] **CA-1**: Login funciona en `https://sigev.redaccion.ar` con HTTPS (Task 15 Step 3).
- [ ] **CA-2**: `admin.prueba` y `socio.prueba` ven paneles distintos, y cada uno rebota en el panel ajeno (Task 9 Step 3 en local, Task 15 Step 3 en staging).
- [ ] **CA-3**: `ufw` activo sin cortar servicios: `ufw status` = active y `sir`/`cbinfra`/`hydro`/`atenea` responden (Task 11 Step 2).
- [ ] **CA-4**: Backup nocturno verificado restaurando un dump (Task 17) + cron instalado (Task 16 Step 5).
- [ ] Extra: `npm test` verde, `audit_log` registra login y login_failed, `pm2 save` persistido (reboot-safe).

Al cerrar: commit final de cualquier ajuste, push, y recién ahí arranca el Módulo 1 (padrón).
