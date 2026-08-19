# Módulo 1 — Padrón interno (Libro 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Digitalizar el Libro N° 1: importar el padrón definitivo (283 socios), panel admin de socios con modo carga de fichas, actas y movimientos societarios, verificación de email + invitación de acceso, recupero de contraseña y export Excel.

**Architecture:** Se agregan 8 modelos Prisma sobre la base del Módulo 0. Toda la lógica testeable vive en `src/lib/**` como funciones puras o factories con DB inyectada (patrón `makeAudit`). Las pantallas son RSC + server actions; API routes solo para el export de Excel. Emails vía nodemailer/Brevo con transporte inyectable.

**Tech Stack:** Next.js 16 (App Router, `src/app`), Prisma 7 (cliente generado en `@/generated/prisma/client` — **NUNCA `@prisma/client`**), MariaDB (Docker en dev), Auth.js v5, zod v4, vitest 4, shadcn/ui + Tailwind v4, exceljs, nodemailer.

**Spec:** `docs/superpowers/specs/2026-08-18-modulo-1-padron-design.md` — leerla antes de cada task.

## Global Constraints

- UI en español rioplatense (voseo: "Ingresá", "Guardá"); código, identificadores y commits en inglés.
- Fechas civiles se guardan como UTC 12:00 (`civilDateUtc`); mostrar siempre con `formatDateAR` (`src/lib/format.ts`).
- Import de Prisma: `import { ... } from "@/generated/prisma/client"`. El cliente singleton: `import { prisma } from "@/lib/prisma"`.
- Toda acción sensible llama a `audit({ userId, action, entity, entityId, detail, ip? })` de `src/lib/audit.ts` (nunca lanza).
- Migraciones SOLO con `npx prisma migrate dev --name <nombre>` (necesita Docker MariaDB corriendo: `docker compose up -d`).
- Tests: `npm test` (vitest, `tests/**/*.test.ts`, env node, TZ=UTC). Nada de DB real en tests: factories con fakes.
- Todo formulario usa el patrón `useActionState` + server action `(prevState, formData)` de `src/app/(public)/ingresar/` (login-form.tsx / actions.ts) como referencia.
- Guard de rutas admin ya existe (proxy + layout). No tocar `src/proxy.ts` ni los layouts.
- `Member.joinedAt` es INMUTABLE una vez creado: ninguna edición lo toca (solo el import y el alta lo setean).
- Números de socio del Libro 1: 1–305 con 22 huecos (21, 71, 72, 73, 93, 94, 95, 97, 125, 132, 147, 199, 208, 214, 221, 222, 223, 224, 238, 245, 254, 263). Altas nuevas: siguiente al máximo (306+).
- Commits frecuentes, mensaje `feat:`/`test:`/`docs:` en inglés, con el trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Map (qué crea/toca cada task)

| Task | Archivos principales |
|---|---|
| 1 | `prisma/schema.prisma`, migración `add_module_1_padron` |
| 2 | `src/lib/streets/normalize.ts`, `src/lib/streets/parse-csv.ts`, `scripts/import-calles.ts` |
| 3 | `src/lib/dates.ts`, `src/lib/padron/mapping.ts` |
| 4 | `scripts/import-padron.ts` |
| 5 | `src/lib/forms.ts` |
| 6 | `src/lib/tokens.ts` |
| 7 | `src/lib/email/{transport,templates,index}.ts` |
| 8 | `src/lib/members/{rules,service}.ts` (+ tests de ambos) |
| 9 | `src/app/admin/socios/page.tsx` (+ shadcn components) |
| 10 | `src/app/admin/socios/[id]/page.tsx` |
| 11 | `src/app/admin/actas/**`, `src/components/admin/minute-picker.tsx` |
| 12 | `src/app/admin/socios/nuevo/**`, `src/app/admin/socios/[id]/actions.ts`, `src/app/admin/socios/[id]/[accion]/page.tsx` |
| 13 | `src/app/admin/socios/carga/[numero]/**`, `src/components/admin/street-autocomplete.tsx` |
| 14 | `src/app/(public)/verificar/[token]/`, `src/app/(public)/acceso/[token]/` |
| 15 | `src/app/(public)/ingresar/recuperar/`, `src/app/(public)/ingresar/restablecer/[token]/` |
| 16 | `src/app/api/admin/padron-export/route.ts` |
| 17 | `docs/02`, `docs/04`, `docs/07`, `CLAUDE.md` |
| 18 | verificación final |

---

### Task 1: Schema Prisma + migración `add_module_1_padron`

**Files:**
- Modify: `prisma/schema.prisma` (agregar al final; NO tocar los modelos existentes salvo `User`)
- Creates (generada): `prisma/migrations/<timestamp>_add_module_1_padron/migration.sql`

**Interfaces:**
- Consumes: modelos M0 (`User`, `AuditLog`) ya existentes.
- Produces: modelos `Member`, `Book`, `Membership`, `Minute`, `Movement`, `Street`, `Notification`, `ActionToken` + enums, disponibles vía `@/generated/prisma/client`. `User` gana la relación inversa `member Member?`.

- [ ] **Step 1: Agregar enums y modelos al schema**

En `prisma/schema.prisma`, agregar al modelo `User` (dentro del bloque existente, junto a `auditLogs`):

```prisma
  member       Member?
```

Y agregar al final del archivo:

```prisma
// ── Módulo 1: padrón (Libro 1) ────────────────────────────────

enum MemberCategory {
  active
  adherent
  collaborator
  cadet
  honorary
  lifetime
}

enum MemberStatus {
  active
  suspended
  withdrawn
}

enum EmailStatus {
  none
  declared
  verified
  bounced
}

enum WithdrawalReason {
  death
  resignation
  arrears
  moved_away
  not_reregistered
  expulsion
  duplicate_annulment
  other
}

enum MovementType {
  admission
  withdrawal
  category_change
  readmission
  suspension
  suspension_end
  book_migration
}

enum MinuteType {
  board
  assembly
}

enum BookStatus {
  open
  closed
}

enum TokenPurpose {
  email_verification
  password_invitation
  password_reset
}

enum NotificationType {
  email_verification
  password_invitation
  application_result
  reregistration_first
  reregistration_second
  withdrawal_declared
  fee_reminder
  arrears_alert
  receipt
  generic
}

enum NotificationVia {
  email
  board
}

enum NotificationStatus {
  sent
  delivered
  bounced
  posted_board
  completed_board
}

model Member {
  id               Int               @id @default(autoincrement())
  fullName         String            @map("full_name") @db.VarChar(160)
  dni              String?           @unique @db.VarChar(12)
  birthDate        DateTime?         @map("birth_date")
  civilStatus      String?           @map("civil_status") @db.VarChar(40)
  nationality      String?           @db.VarChar(60)
  occupation       String?           @db.VarChar(80)
  phone            String?           @db.VarChar(40)
  streetId         Int?              @map("street_id")
  street           Street?           @relation(fields: [streetId], references: [id])
  streetText       String?           @map("street_text") @db.VarChar(120)
  streetNumber     String?           @map("street_number") @db.VarChar(10)
  neighborhood     String?           @db.VarChar(60)
  email            String?           @db.VarChar(191)
  emailStatus      EmailStatus       @default(none) @map("email_status")
  emailVerifiedAt  DateTime?         @map("email_verified_at")
  category         MemberCategory
  status           MemberStatus
  withdrawalReason WithdrawalReason? @map("withdrawal_reason")
  joinedAt         DateTime          @map("joined_at")
  leftAt           DateTime?         @map("left_at")
  debtAtWithdrawal Boolean           @default(false) @map("debt_at_withdrawal")
  autoDebit        Boolean           @default(false) @map("auto_debit")
  reentryBlocked   Boolean           @default(false) @map("reentry_blocked")
  rejectedUntil    DateTime?         @map("rejected_until")
  suspendedFrom    DateTime?         @map("suspended_from")
  suspendedTo      DateTime?         @map("suspended_to")
  userId           Int?              @unique @map("user_id")
  user             User?             @relation(fields: [userId], references: [id], onDelete: SetNull)
  createdAt        DateTime          @default(now()) @map("created_at")
  updatedAt        DateTime          @updatedAt @map("updated_at")
  memberships      Membership[]
  movements        Movement[]
  notifications    Notification[]
  tokens           ActionToken[]

  @@index([fullName])
  @@index([status, category])
  @@map("members")
}

model Book {
  id              Int          @id @default(autoincrement())
  number          Int          @unique
  status          BookStatus
  openedAt        DateTime     @map("opened_at")
  closedAt        DateTime?    @map("closed_at")
  openingMinuteId Int?         @map("opening_minute_id")
  closingMinuteId Int?         @map("closing_minute_id")
  memberships     Membership[]

  @@map("books")
}

model Membership {
  id           Int    @id @default(autoincrement())
  memberId     Int    @map("member_id")
  member       Member @relation(fields: [memberId], references: [id])
  bookId       Int    @map("book_id")
  book         Book   @relation(fields: [bookId], references: [id])
  memberNumber Int    @map("member_number")

  @@unique([bookId, memberNumber])
  @@unique([memberId, bookId])
  @@map("memberships")
}

model Minute {
  id          Int        @id @default(autoincrement())
  type        MinuteType
  number      Int
  date        DateTime
  description String?    @db.VarChar(500)
  createdById Int?       @map("created_by_id")
  createdAt   DateTime   @default(now()) @map("created_at")
  movements   Movement[]

  @@unique([type, number])
  @@map("minutes")
}

model Movement {
  id               Int             @id @default(autoincrement())
  memberId         Int             @map("member_id")
  member           Member          @relation(fields: [memberId], references: [id])
  type             MovementType
  date             DateTime
  minuteId         Int?            @map("minute_id")
  minute           Minute?         @relation(fields: [minuteId], references: [id])
  previousCategory MemberCategory? @map("previous_category")
  newCategory      MemberCategory? @map("new_category")
  reason           WithdrawalReason?
  detail           String?         @db.VarChar(300)
  createdById      Int?            @map("created_by_id")
  createdAt        DateTime        @default(now()) @map("created_at")

  @@index([memberId])
  @@map("movements")
}

model Street {
  id             Int      @id
  loadOrder      Int      @map("load_order")
  name           String   @db.VarChar(80)
  normalizedName String   @map("normalized_name") @db.VarChar(80)
  members        Member[]

  @@index([normalizedName])
  @@index([loadOrder])
  @@map("streets")
}

model Notification {
  id             BigInt             @id @default(autoincrement())
  memberId       Int?               @map("member_id")
  member         Member?            @relation(fields: [memberId], references: [id])
  type           NotificationType
  via            NotificationVia
  status         NotificationStatus
  sentAt         DateTime           @default(now()) @map("sent_at")
  brevoMessageId String?            @map("brevo_message_id") @db.VarChar(128)
  boardFrom      DateTime?          @map("board_from")
  boardTo        DateTime?          @map("board_to")
  payloadSummary String?            @map("payload_summary") @db.VarChar(300)

  @@index([memberId])
  @@map("notifications")
}

model ActionToken {
  id        Int          @id @default(autoincrement())
  purpose   TokenPurpose
  tokenHash String       @unique @map("token_hash") @db.Char(64)
  memberId  Int?         @map("member_id")
  member    Member?      @relation(fields: [memberId], references: [id])
  userId    Int?         @map("user_id")
  expiresAt DateTime     @map("expires_at")
  usedAt    DateTime?    @map("used_at")
  createdAt DateTime     @default(now()) @map("created_at")

  @@map("action_tokens")
}
```

- [ ] **Step 2: Generar la migración**

Con Docker MariaDB corriendo (`docker compose up -d`):

Run: `npx prisma migrate dev --name add_module_1_padron`
Expected: `Your database is now in sync with your schema.` y carpeta nueva en `prisma/migrations/`. El cliente se regenera solo.

- [ ] **Step 3: Verificar typecheck y tests existentes**

Run: `npx tsc --noEmit && npm test`
Expected: 0 errores TS, 29 tests PASS (nada existente se rompe).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add module 1 schema (member registry, books, minutes, movements)"
```

---

### Task 2: Normalización de calles + import de `calles_inicial.csv`

**Files:**
- Create: `src/lib/streets/normalize.ts`, `src/lib/streets/parse-csv.ts`, `scripts/import-calles.ts`
- Test: `tests/streets.test.ts`

**Interfaces:**
- Produces: `normalizeStreetName(name: string): string` · `parseCsv(content: string): string[][]` (maneja BOM, comillas y comas internas) · script idempotente `npx tsx scripts/import-calles.ts`.

- [ ] **Step 1: Tests que fallan**

```ts
// tests/streets.test.ts
import { describe, expect, it } from "vitest";
import { normalizeStreetName } from "@/lib/streets/normalize";
import { parseCsv } from "@/lib/streets/parse-csv";

describe("normalizeStreetName", () => {
  it("lowercases and strips accents", () => {
    expect(normalizeStreetName("Hernández")).toBe("hernandez");
  });
  it("normalizes spaced commas and double spaces", () => {
    expect(normalizeStreetName("Pizarro , Francisco")).toBe("pizarro, francisco");
  });
  it("keeps ordinal markers", () => {
    expect(normalizeStreetName("1º de Mayo")).toBe("1º de mayo");
  });
  it("trims", () => {
    expect(normalizeStreetName("  Los  Andes ")).toBe("los andes");
  });
});

describe("parseCsv", () => {
  it("strips BOM and parses quoted fields with commas", () => {
    const content = '\uFEFFid_calle,orden_carga,nombre_calle\r\n1,1901,"Pizarro , Francisco"\r\n14,1914,1º de Mayo\r\n';
    expect(parseCsv(content)).toEqual([
      ["id_calle", "orden_carga", "nombre_calle"],
      ["1", "1901", "Pizarro , Francisco"],
      ["14", "1914", "1º de Mayo"],
    ]);
  });
  it("ignores trailing empty lines", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
```

- [ ] **Step 2: Run para verificar que falla**

Run: `npx vitest run tests/streets.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementación**

```ts
// src/lib/streets/normalize.ts
// Lowercase, accent-stripped form used for autocomplete matching.
export function normalizeStreetName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}
```

```ts
// src/lib/streets/parse-csv.ts
// Minimal CSV parser: BOM, CRLF, double-quoted fields with embedded commas.
export function parseCsv(content: string): string[][] {
  const clean = content.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  for (const line of clean.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { fields.push(field); field = ""; }
      else field += ch;
    }
    fields.push(field);
    rows.push(fields.map((f) => f.trim()));
  }
  return rows;
}
```

```ts
// scripts/import-calles.ts
// Idempotent street catalog import. Run: npx tsx scripts/import-calles.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { parseCsv } from "../src/lib/streets/parse-csv";
import { normalizeStreetName } from "../src/lib/streets/normalize";

async function main() {
  const content = readFileSync(join(process.cwd(), "datos", "calles_inicial.csv"), "utf8");
  const [header, ...rows] = parseCsv(content);
  if (header.join(",") !== "id_calle,orden_carga,nombre_calle") {
    throw new Error(`Unexpected header: ${header.join(",")}`);
  }
  let upserted = 0;
  for (const [idRaw, orderRaw, name] of rows) {
    const id = Number(idRaw);
    const loadOrder = Number(orderRaw);
    if (!Number.isInteger(id) || !Number.isInteger(loadOrder) || !name) {
      console.warn(`skipping malformed row: ${[idRaw, orderRaw, name].join(",")}`);
      continue;
    }
    await prisma.street.upsert({
      where: { id },
      create: { id, loadOrder, name, normalizedName: normalizeStreetName(name) },
      update: { loadOrder, name, normalizedName: normalizeStreetName(name) },
    });
    upserted++;
  }
  console.log(`streets upserted: ${upserted}`);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 4: Tests en verde**

Run: `npx vitest run tests/streets.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Correr el import real y verificar**

Run: `npx tsx scripts/import-calles.ts`
Expected: `streets upserted: 40`. Re-ejecutar: mismo resultado, sin duplicados.
Run: `npx tsx -e "import {prisma} from './src/lib/prisma'; prisma.street.count().then(c => { console.log(c); return prisma.$disconnect(); })"`
Expected: `40`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/streets tests/streets.test.ts scripts/import-calles.ts
git commit -m "feat: street catalog import with normalized names"
```

---

### Task 3: Fechas civiles + mapeo puro de filas del padrón

**Files:**
- Create: `src/lib/dates.ts`, `src/lib/padron/mapping.ts`
- Test: `tests/padron-mapping.test.ts`

**Interfaces:**
- Produces: `civilDateUtc(year, month, day): Date` (UTC 12:00) · `excelDateToCivilUtc(d: Date): Date` · `mapWithdrawalReason(raw): { reason: WithdrawalReason | null; warning?: string }` · `mapPadronRow(row: RawPadronRow): MappedRow` con `MappedRow = { memberNumber: number; warnings: string[]; member: MemberImportData }`.
- Consumes: enums de Task 1.

- [ ] **Step 1: Tests que fallan**

```ts
// tests/padron-mapping.test.ts
import { describe, expect, it } from "vitest";
import { civilDateUtc, excelDateToCivilUtc } from "@/lib/dates";
import { mapPadronRow, mapWithdrawalReason, type RawPadronRow } from "@/lib/padron/mapping";

const base: RawPadronRow = {
  numero_socio: 14, apellido_nombre: "Perez Mariano", dni: 30111222,
  calle: "Los Andes", altura: 26, barrio: "Ciudadela", nacionalidad: null,
  fecha_nacimiento: new Date(Date.UTC(1983, 11, 10)), estado_civil: "Soltero",
  ocupacion: "Periodista", telefono: null, email: "m@yahoo.com.ar",
  debito_automatico: "Si", fecha_ingreso: new Date(Date.UTC(2019, 8, 1)),
  categoria_socio: "Activo", activo: "Si", deuda_tesoreria: null,
  fecha_egreso: null, motivo_baja: "-",
};

describe("dates", () => {
  it("civilDateUtc is noon UTC", () => {
    expect(civilDateUtc(2019, 9, 1).toISOString()).toBe("2019-09-01T12:00:00.000Z");
  });
  it("excelDateToCivilUtc keeps the civil day", () => {
    expect(excelDateToCivilUtc(new Date(Date.UTC(2019, 8, 1))).toISOString()).toBe("2019-09-01T12:00:00.000Z");
  });
});

describe("mapWithdrawalReason", () => {
  it("maps the known catalog", () => {
    expect(mapWithdrawalReason("Mora").reason).toBe("arrears");
    expect(mapWithdrawalReason("Fallecido").reason).toBe("death");
    expect(mapWithdrawalReason("Fallecida").reason).toBe("death");
    expect(mapWithdrawalReason("Domiciliada en Gasoducto").reason).toBe("moved_away");
    expect(mapWithdrawalReason("Anulada por domicilio El Bolsón.").reason).toBe("moved_away");
    expect(mapWithdrawalReason("-").reason).toBeNull();
    expect(mapWithdrawalReason(null).reason).toBeNull();
  });
  it("falls back to other with warning", () => {
    const r = mapWithdrawalReason("texto raro");
    expect(r.reason).toBe("other");
    expect(r.warning).toContain("texto raro");
  });
});

describe("mapPadronRow", () => {
  it("maps a vigente with email and auto debit", () => {
    const m = mapPadronRow(base);
    expect(m.memberNumber).toBe(14);
    expect(m.member.status).toBe("active");
    expect(m.member.category).toBe("active");
    expect(m.member.dni).toBe("30111222");
    expect(m.member.emailStatus).toBe("declared");
    expect(m.member.autoDebit).toBe(true);
    expect(m.member.joinedAt.toISOString()).toBe("2019-09-01T12:00:00.000Z");
    expect(m.member.streetText).toBe("Los Andes");
    expect(m.member.streetNumber).toBe("26");
    expect(m.warnings).toEqual([]);
  });
  it("maps a baja por mora con deuda", () => {
    const m = mapPadronRow({ ...base, activo: "No", deuda_tesoreria: "Si",
      motivo_baja: "Mora", fecha_egreso: new Date(Date.UTC(2025, 7, 31)),
      email: null, debito_automatico: "No", categoria_socio: "Adherente" });
    expect(m.member.status).toBe("withdrawn");
    expect(m.member.category).toBe("adherent");
    expect(m.member.withdrawalReason).toBe("arrears");
    expect(m.member.debtAtWithdrawal).toBe(true);
    expect(m.member.leftAt?.toISOString()).toBe("2025-08-31T12:00:00.000Z");
    expect(m.member.emailStatus).toBe("none");
  });
  it("warns on missing dni and on baja without fecha_egreso", () => {
    const m = mapPadronRow({ ...base, dni: null, activo: "No", motivo_baja: "Fallecido", fecha_egreso: null });
    expect(m.member.dni).toBeNull();
    expect(m.member.leftAt).toBeNull();
    expect(m.warnings.some((w) => w.includes("sin DNI"))).toBe(true);
    expect(m.warnings.some((w) => w.includes("sin fecha_egreso"))).toBe(true);
  });
  it("throws on unknown category or activo flag", () => {
    expect(() => mapPadronRow({ ...base, categoria_socio: "Vitalicio" })).toThrow();
    expect(() => mapPadronRow({ ...base, activo: "quizas" })).toThrow();
  });
});
```

- [ ] **Step 2: Run para verificar que falla**

Run: `npx vitest run tests/padron-mapping.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementación**

```ts
// src/lib/dates.ts
// Civil dates (no meaningful time-of-day) are stored as UTC noon so that
// rendering in UTC-3 can never shift the day.
export function civilDateUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

// ExcelJS yields date cells as JS Dates at UTC midnight.
export function excelDateToCivilUtc(d: Date): Date {
  return civilDateUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
```

```ts
// src/lib/padron/mapping.ts
// Pure mapping from a padron_socios.xlsx row to Member data. No DB access.
import type { EmailStatus, MemberCategory, MemberStatus, WithdrawalReason } from "@/generated/prisma/client";
import { excelDateToCivilUtc } from "@/lib/dates";

export type RawPadronRow = {
  numero_socio: number;
  apellido_nombre: string;
  dni: number | string | null;
  calle: string | null;
  altura: number | string | null;
  barrio: string | null;
  nacionalidad: string | null;
  fecha_nacimiento: Date | null;
  estado_civil: string | null;
  ocupacion: string | null;
  telefono: string | null;
  email: string | null;
  debito_automatico: string | null;
  fecha_ingreso: Date;
  categoria_socio: string;
  activo: string;
  deuda_tesoreria: string | null;
  fecha_egreso: Date | null;
  motivo_baja: string | null;
};

export type MemberImportData = {
  fullName: string;
  dni: string | null;
  birthDate: Date | null;
  civilStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  phone: string | null;
  streetText: string | null;
  streetNumber: string | null;
  neighborhood: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  category: MemberCategory;
  status: MemberStatus;
  withdrawalReason: WithdrawalReason | null;
  joinedAt: Date;
  leftAt: Date | null;
  debtAtWithdrawal: boolean;
  autoDebit: boolean;
};

export type MappedRow = { memberNumber: number; warnings: string[]; member: MemberImportData };

const yes = (v: string | null | undefined) => (v ?? "").trim().toLowerCase() === "si";
const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" || s === "-" ? null : s;
};

export function mapWithdrawalReason(raw: string | null | undefined): { reason: WithdrawalReason | null; warning?: string } {
  const v = (raw ?? "").trim();
  if (v === "" || v === "-") return { reason: null };
  if (/^mora$/i.test(v)) return { reason: "arrears" };
  if (/^fallecid[oa]$/i.test(v)) return { reason: "death" };
  if (/domicili|gasoducto|standard|bols/i.test(v)) return { reason: "moved_away" };
  return { reason: "other", warning: `motivo_baja no mapeado: "${v}" (queda como "other")` };
}

const CATEGORY: Record<string, MemberCategory> = { activo: "active", adherente: "adherent" };

export function mapPadronRow(row: RawPadronRow): MappedRow {
  const warnings: string[] = [];
  const n = row.numero_socio;

  const category = CATEGORY[row.categoria_socio.trim().toLowerCase()];
  if (!category) throw new Error(`socio ${n}: categoria_socio desconocida "${row.categoria_socio}"`);

  const activo = row.activo.trim().toLowerCase();
  if (activo !== "si" && activo !== "no") throw new Error(`socio ${n}: activo debe ser Si/No, vino "${row.activo}"`);
  const status: MemberStatus = activo === "si" ? "active" : "withdrawn";

  const { reason, warning } = mapWithdrawalReason(row.motivo_baja);
  if (warning) warnings.push(`socio ${n}: ${warning}`);

  const dni = text(row.dni);
  if (!dni) warnings.push(`socio ${n}: sin DNI${status === "active" ? " (requerido antes del Módulo 6)" : ""}`);

  if (status === "withdrawn" && !row.fecha_egreso) warnings.push(`socio ${n}: baja sin fecha_egreso`);

  const email = text(row.email)?.toLowerCase() ?? null;

  return {
    memberNumber: n,
    warnings,
    member: {
      fullName: row.apellido_nombre.trim(),
      dni,
      birthDate: row.fecha_nacimiento ? excelDateToCivilUtc(row.fecha_nacimiento) : null,
      civilStatus: text(row.estado_civil),
      nationality: text(row.nacionalidad),
      occupation: text(row.ocupacion),
      phone: text(row.telefono),
      streetText: text(row.calle),
      streetNumber: text(row.altura),
      neighborhood: text(row.barrio),
      email,
      emailStatus: email ? "declared" : "none",
      category,
      status,
      withdrawalReason: status === "withdrawn" ? reason : null,
      joinedAt: excelDateToCivilUtc(row.fecha_ingreso),
      leftAt: row.fecha_egreso ? excelDateToCivilUtc(row.fecha_egreso) : null,
      debtAtWithdrawal: yes(row.deuda_tesoreria),
      autoDebit: yes(row.debito_automatico),
    },
  };
}
```

- [ ] **Step 4: Tests en verde**

Run: `npx vitest run tests/padron-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/padron tests/padron-mapping.test.ts
git commit -m "feat: civil date helpers and pure padron row mapping"
```

---

### Task 4: Script de importación del padrón

**Files:**
- Create: `scripts/import-padron.ts`
- Modify: `package.json` (dependencia `exceljs`), `.gitignore` (agregar `padron-import-report.txt`)

**Interfaces:**
- Consumes: `mapPadronRow` (Task 3), `prisma`, `audit`.
- Produces: comando idempotente `npx tsx scripts/import-padron.ts`; Book 1 abierto + 283 Members + Memberships + Movements sintéticos; reporte en consola y `padron-import-report.txt` (gitignored).

- [ ] **Step 1: Instalar exceljs**

Run: `npm install exceljs`
Expected: agregado a dependencies sin errores.

- [ ] **Step 2: Escribir el script**

```ts
// scripts/import-padron.ts
// Idempotent import of datos/padron_socios.xlsx into Book 1.
// Run: npx tsx scripts/import-padron.ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { audit } from "../src/lib/audit";
import { mapPadronRow, type RawPadronRow } from "../src/lib/padron/mapping";

const FILE = join(process.cwd(), "datos", "padron_socios.xlsx");
const LOCK = join(process.cwd(), "datos", "~$padron_socios.xlsx");
const EXPECTED_HEADERS = [
  "numero_socio", "apellido_nombre", "dni", "calle", "altura", "barrio",
  "nacionalidad", "fecha_nacimiento", "estado_civil", "ocupacion", "telefono",
  "email", "debito_automatico", "fecha_ingreso", "categoria_socio", "activo",
  "deuda_tesoreria", "fecha_egreso", "motivo_baja",
];

// ExcelJS cell values can be strings, numbers, Dates, or objects
// (hyperlinks {text,hyperlink}, rich text {richText:[...]}).
function cellValue(v: ExcelJS.CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || v instanceof Date) return v;
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
  }
  return String(v);
}
const asStr = (v: ReturnType<typeof cellValue>): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);
const asDate = (v: ReturnType<typeof cellValue>): Date | null => (v instanceof Date ? v : null);

async function main() {
  if (existsSync(LOCK)) {
    throw new Error("padron_socios.xlsx está abierto en Excel (lock ~$). Cerralo y reintentá.");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  const headers = EXPECTED_HEADERS.map((_, i) => asStr(cellValue(ws.getRow(1).getCell(i + 1).value)));
  if (headers.join(",") !== EXPECTED_HEADERS.join(",")) {
    throw new Error(`Headers inesperados: ${headers.join(",")}`);
  }

  const rows: RawPadronRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const c = (i: number) => cellValue(row.getCell(i).value);
    if (c(1) === null) return; // fila vacía
    const ingreso = asDate(c(14));
    if (!ingreso) throw new Error(`fila ${rowNumber}: fecha_ingreso inválida`);
    rows.push({
      numero_socio: Number(c(1)),
      apellido_nombre: asStr(c(2)) ?? "",
      dni: asStr(c(3)),
      calle: asStr(c(4)),
      altura: asStr(c(5)),
      barrio: asStr(c(6)),
      nacionalidad: asStr(c(7)),
      fecha_nacimiento: asDate(c(8)),
      estado_civil: asStr(c(9)),
      ocupacion: asStr(c(10)),
      telefono: asStr(c(11)),
      email: asStr(c(12)),
      debito_automatico: asStr(c(13)),
      fecha_ingreso: ingreso,
      categoria_socio: asStr(c(15)) ?? "",
      activo: asStr(c(16)) ?? "",
      deuda_tesoreria: asStr(c(17)),
      fecha_egreso: asDate(c(18)),
      motivo_baja: asStr(c(19)),
    });
  });

  const mapped = rows.map(mapPadronRow);
  const warnings = mapped.flatMap((m) => m.warnings);

  const minJoined = mapped.reduce((min, m) => (m.member.joinedAt < min ? m.member.joinedAt : min), mapped[0].member.joinedAt);
  const book = await prisma.book.upsert({
    where: { number: 1 },
    create: { number: 1, status: "open", openedAt: minJoined },
    update: {},
  });

  let created = 0;
  let updated = 0;
  for (const m of mapped) {
    const existing = await prisma.membership.findUnique({
      where: { bookId_memberNumber: { bookId: book.id, memberNumber: m.memberNumber } },
    });
    if (existing) {
      await prisma.member.update({ where: { id: existing.memberId }, data: m.member });
      updated++;
    } else {
      const member = await prisma.member.create({ data: m.member });
      await prisma.membership.create({
        data: { memberId: member.id, bookId: book.id, memberNumber: m.memberNumber },
      });
      await prisma.movement.create({
        data: {
          memberId: member.id, type: "admission", date: m.member.joinedAt,
          newCategory: m.member.category, detail: "import Libro 1 (acta física no digitalizada)",
        },
      });
      created++;
    }
  }

  const total = mapped.length;
  const vigentes = mapped.filter((m) => m.member.status === "active").length;
  const bajas = total - vigentes;
  const numbers = new Set(mapped.map((m) => m.memberNumber));
  const maxN = Math.max(...numbers);
  const gaps: number[] = [];
  for (let i = 1; i <= maxN; i++) if (!numbers.has(i)) gaps.push(i);

  const lines = [
    `Padron import — ${new Date().toISOString()}`,
    `filas: ${total} (esperado 283) | vigentes: ${vigentes} (esperado 160) | bajas: ${bajas} (esperado 123)`,
    `numeracion: 1..${maxN} | huecos (${gaps.length}, esperado 22): ${gaps.join(", ")}`,
    `creados: ${created} | actualizados: ${updated}`,
    `avisos (${warnings.length}):`,
    ...warnings.map((w) => `  - ${w}`),
  ];
  if (total !== 283 || vigentes !== 160 || gaps.length !== 22) {
    lines.push("ATENCION: TOTALES DISTINTOS DE LOS ESPERADOS — revisar antes de continuar");
  }
  const report = lines.join("\n");
  console.log(report);
  writeFileSync(join(process.cwd(), "padron-import-report.txt"), report + "\n", "utf8");

  await audit({
    action: "padron_import", entity: "book", entityId: book.id,
    detail: { total, vigentes, bajas, created, updated, warnings: warnings.length },
  });
}

main().finally(() => prisma.$disconnect());
```

Agregar a `.gitignore` (línea nueva al final):

```
padron-import-report.txt
```

- [ ] **Step 3: Correr el import y verificar totales**

Run: `npx tsx scripts/import-padron.ts`
Expected en el reporte: `filas: 283 ... vigentes: 160 ... bajas: 123`, `huecos (22, esperado 22): 21, 71, 72, 73, 93, 94, 95, 97, 125, 132, 147, 199, 208, 214, 221, 222, 223, 224, 238, 245, 254, 263`, `creados: 283 | actualizados: 0`, y el aviso del socio 287 sin DNI.

- [ ] **Step 4: Verificar idempotencia**

Run: `npx tsx scripts/import-padron.ts` (segunda vez)
Expected: `creados: 0 | actualizados: 283`. Luego verificar conteos:
Run: `npx tsx -e "import {prisma} from './src/lib/prisma'; Promise.all([prisma.member.count(), prisma.membership.count(), prisma.movement.count()]).then(r => { console.log(r); return prisma.$disconnect(); })"`
Expected: `[ 283, 283, 283 ]`.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-padron.ts package.json package-lock.json .gitignore
git commit -m "feat: idempotent padron import into book 1 with report"
```

---

### Task 5: Helper genérico FormData → zod

**Files:**
- Create: `src/lib/forms.ts`
- Test: `tests/forms.test.ts`

**Interfaces:**
- Produces: `type FormResult<T> = { ok: true; data: T } | { ok: false; error: string }` · `parseForm<S extends z.ZodType>(schema: S, formData: FormData): FormResult<z.infer<S>>`. Campos string vacíos se convierten a `undefined` (para que `.optional()` funcione).

- [ ] **Step 1: Tests que fallan**

```ts
// tests/forms.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseForm } from "@/lib/forms";

const schema = z.object({
  fullName: z.string().min(1, "Ingresá el nombre"),
  email: z.string().email("Email inválido").optional(),
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe("parseForm", () => {
  it("parses valid data and trims", () => {
    const r = parseForm(schema, fd({ fullName: "  Perez Ana ", email: "a@b.com" }));
    expect(r).toEqual({ ok: true, data: { fullName: "Perez Ana", email: "a@b.com" } });
  });
  it("treats empty strings as missing", () => {
    const r = parseForm(schema, fd({ fullName: "Perez Ana", email: "" }));
    expect(r).toEqual({ ok: true, data: { fullName: "Perez Ana" } });
  });
  it("returns the first error message", () => {
    const r = parseForm(schema, fd({ fullName: "", email: "nope" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Ingresá el nombre");
  });
});
```

- [ ] **Step 2: Run para verificar que falla**

Run: `npx vitest run tests/forms.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementación**

```ts
// src/lib/forms.ts
// FormData → zod bridge shared by all server actions.
import type { z } from "zod";

export type FormResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): FormResult<z.infer<S>> {
  const raw: Record<string, string | undefined> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue; // files are handled elsewhere (M3)
    const trimmed = value.trim();
    raw[key] = trimmed === "" ? undefined : trimmed;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Datos inválidos" };
  }
  return { ok: true, data: parsed.data };
}
```

- [ ] **Step 4: Tests en verde**

Run: `npx vitest run tests/forms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forms.ts tests/forms.test.ts
git commit -m "feat: shared FormData-to-zod parsing helper"
```

---

### Task 6: Servicio de tokens de un solo uso

**Files:**
- Create: `src/lib/tokens.ts`
- Test: `tests/tokens.test.ts`

**Interfaces:**
- Produces: `hashToken(raw: string): string` (sha256 hex) · `TOKEN_TTL = { email_verification: 604800000, password_invitation: 604800000, password_reset: 1800000 }` · `makeTokens(db)` con:
  - `issue(input: { purpose: TokenPurpose; memberId?: number; userId?: number; now?: Date }): Promise<string>` — devuelve el token EN CLARO (solo se persiste el hash), TTL según `TOKEN_TTL[purpose]`.
  - `peek(raw: string, purpose: TokenPurpose, now?: Date): Promise<ActionToken | null>` — valida sin consumir (para renderizar formularios en GET).
  - `consume(raw: string, purpose: TokenPurpose, now?: Date): Promise<ActionToken | null>` — valida y marca `usedAt` (un solo uso).
- Singleton: `export const tokens = makeTokens(prisma)`.
- Consumes: modelo `ActionToken` (Task 1).

- [ ] **Step 1: Tests que fallan**

```ts
// tests/tokens.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { hashToken, makeTokens, TOKEN_TTL } from "@/lib/tokens";

type Row = {
  id: number; purpose: string; tokenHash: string; memberId: number | null;
  userId: number | null; expiresAt: Date; usedAt: Date | null;
};

function makeFakeDb() {
  const rows: Row[] = [];
  let nextId = 1;
  return {
    rows,
    actionToken: {
      create: async ({ data }: { data: Omit<Row, "id" | "usedAt"> }) => {
        const row: Row = { id: nextId++, usedAt: null, memberId: null, userId: null, ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
      update: async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  };
}

describe("tokens", () => {
  let db: ReturnType<typeof makeFakeDb>;
  let svc: ReturnType<typeof makeTokens>;
  const now = new Date("2026-08-18T12:00:00Z");

  beforeEach(() => {
    db = makeFakeDb();
    svc = makeTokens(db as never);
  });

  it("issues a raw token and stores only its hash", async () => {
    const raw = await svc.issue({ purpose: "email_verification", memberId: 7, now });
    expect(raw.length).toBeGreaterThan(30);
    expect(db.rows[0].tokenHash).toBe(hashToken(raw));
    expect(db.rows[0].tokenHash).not.toContain(raw);
    expect(db.rows[0].expiresAt.getTime()).toBe(now.getTime() + TOKEN_TTL.email_verification);
  });

  it("consume succeeds once and only once", async () => {
    const raw = await svc.issue({ purpose: "password_reset", userId: 3, now });
    const first = await svc.consume(raw, "password_reset", now);
    expect(first?.userId).toBe(3);
    const second = await svc.consume(raw, "password_reset", now);
    expect(second).toBeNull();
  });

  it("rejects wrong purpose and expired tokens", async () => {
    const raw = await svc.issue({ purpose: "password_reset", userId: 3, now });
    expect(await svc.consume(raw, "email_verification", now)).toBeNull();
    const later = new Date(now.getTime() + TOKEN_TTL.password_reset + 1);
    expect(await svc.consume(raw, "password_reset", later)).toBeNull();
  });

  it("peek validates without consuming", async () => {
    const raw = await svc.issue({ purpose: "password_invitation", memberId: 1, now });
    expect(await svc.peek(raw, "password_invitation", now)).not.toBeNull();
    expect(await svc.consume(raw, "password_invitation", now)).not.toBeNull();
    expect(await svc.peek(raw, "password_invitation", now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run para verificar que falla**

Run: `npx vitest run tests/tokens.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementación**

```ts
// src/lib/tokens.ts
// Single-use action tokens (email verification, password invitation/reset).
// Only the sha256 hash is stored; the raw token travels once, inside the email link.
import { createHash, randomBytes } from "node:crypto";
import type { ActionToken, PrismaClient, TokenPurpose } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const TOKEN_TTL: Record<TokenPurpose, number> = {
  email_verification: 7 * 24 * 60 * 60 * 1000,
  password_invitation: 7 * 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
};

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type TokenDb = Pick<PrismaClient, "actionToken">;

export function makeTokens(db: TokenDb) {
  async function find(raw: string, purpose: TokenPurpose, now: Date): Promise<ActionToken | null> {
    const t = await db.actionToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!t || t.purpose !== purpose || t.usedAt !== null || t.expiresAt < now) return null;
    return t;
  }
  return {
    async issue(input: { purpose: TokenPurpose; memberId?: number; userId?: number; now?: Date }): Promise<string> {
      const raw = randomBytes(32).toString("base64url");
      const now = input.now ?? new Date();
      await db.actionToken.create({
        data: {
          purpose: input.purpose,
          tokenHash: hashToken(raw),
          memberId: input.memberId ?? null,
          userId: input.userId ?? null,
          expiresAt: new Date(now.getTime() + TOKEN_TTL[input.purpose]),
        },
      });
      return raw;
    },
    peek(raw: string, purpose: TokenPurpose, now = new Date()): Promise<ActionToken | null> {
      return find(raw, purpose, now);
    },
    async consume(raw: string, purpose: TokenPurpose, now = new Date()): Promise<ActionToken | null> {
      const t = await find(raw, purpose, now);
      if (!t) return null;
      await db.actionToken.update({ where: { id: t.id }, data: { usedAt: now } });
      return t;
    },
  };
}

export const tokens = makeTokens(prisma);
```

- [ ] **Step 4: Tests en verde**

Run: `npx vitest run tests/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tokens.ts tests/tokens.test.ts
git commit -m "feat: single-use action token service"
```

---

### Task 7: Capa de email (Brevo SMTP + templates + registro de Notification)

**Files:**
- Create: `src/lib/email/transport.ts`, `src/lib/email/templates.ts`, `src/lib/email/index.ts`
- Modify: `package.json` (`nodemailer`, `@types/nodemailer`)
- Test: `tests/email.test.ts`

**Interfaces:**
- Produces:
  - `type MailMessage = { to: string; subject: string; text: string; html: string }` · `type MailTransport = { send(msg: MailMessage): Promise<{ messageId: string | null }> }`.
  - `getTransport(): MailTransport` — Brevo si hay envs `BREVO_*`/`MAIL_FROM`, si no consola (dev no se bloquea).
  - Templates (devuelven `{ subject, text, html }`): `verificationEmail({ name, url })`, `invitationEmail({ name, url })`, `passwordResetEmail({ url })`.
  - `makeMailer({ transport, db })` con `sendToMember(input: { memberId: number | null; to: string; type: NotificationType; message: { subject; text; html }; summary: string }): Promise<{ messageId: string | null }>` — envía Y crea la fila `Notification` (via `email`, status `sent`).
  - Singleton `export const mailer = makeMailer({ transport: getTransport(), db: prisma })`.

- [ ] **Step 1: Instalar nodemailer**

Run: `npm install nodemailer && npm install -D @types/nodemailer`
Expected: sin errores.

- [ ] **Step 2: Tests que fallan**

```ts
// tests/email.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeMailer } from "@/lib/email";
import { invitationEmail, passwordResetEmail, verificationEmail } from "@/lib/email/templates";
import type { MailMessage } from "@/lib/email/transport";

describe("templates", () => {
  it("verification email includes name and url in text and html", () => {
    const m = verificationEmail({ name: "Ana Perez", url: "https://x/verificar/abc" });
    expect(m.subject).toContain("Verificá");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("Ana Perez");
      expect(body).toContain("https://x/verificar/abc");
    }
  });
  it("invitation and reset include their urls", () => {
    expect(invitationEmail({ name: "Ana", url: "https://x/acceso/t" }).text).toContain("https://x/acceso/t");
    expect(passwordResetEmail({ url: "https://x/restablecer/t" }).text).toContain("https://x/restablecer/t");
  });
});

describe("makeMailer", () => {
  it("sends through the transport and records a Notification", async () => {
    const sent: MailMessage[] = [];
    const created: unknown[] = [];
    const mailer = makeMailer({
      transport: { send: async (msg) => { sent.push(msg); return { messageId: "mid-1" }; } },
      db: { notification: { create: async ({ data }: { data: unknown }) => { created.push(data); return data; } } } as never,
    });
    await mailer.sendToMember({
      memberId: 5, to: "a@b.com", type: "email_verification",
      message: verificationEmail({ name: "Ana", url: "https://x/v/t" }),
      summary: "verificación de email",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("a@b.com");
    expect(created[0]).toMatchObject({
      memberId: 5, type: "email_verification", via: "email", status: "sent",
      brevoMessageId: "mid-1", payloadSummary: "verificación de email",
    });
  });
});
```

- [ ] **Step 3: Run para verificar que falla**

Run: `npx vitest run tests/email.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementación**

```ts
// src/lib/email/transport.ts
import nodemailer from "nodemailer";

export type MailMessage = { to: string; subject: string; text: string; html: string };
export type MailTransport = { send(msg: MailMessage): Promise<{ messageId: string | null }> };

function makeBrevoTransport(): MailTransport | null {
  const { BREVO_SMTP_HOST, BREVO_SMTP_PORT, BREVO_SMTP_USER, BREVO_SMTP_KEY, MAIL_FROM } = process.env;
  if (!BREVO_SMTP_HOST || !BREVO_SMTP_USER || !BREVO_SMTP_KEY || !MAIL_FROM) return null;
  const transporter = nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: Number(BREVO_SMTP_PORT ?? 587),
    secure: false,
    auth: { user: BREVO_SMTP_USER, pass: BREVO_SMTP_KEY },
  });
  return {
    async send(msg) {
      const info = await transporter.sendMail({ from: MAIL_FROM, ...msg });
      return { messageId: info.messageId ?? null };
    },
  };
}

function makeConsoleTransport(): MailTransport {
  return {
    async send(msg) {
      console.log(`[mail:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      return { messageId: null };
    },
  };
}

export function getTransport(): MailTransport {
  return makeBrevoTransport() ?? makeConsoleTransport();
}
```

```ts
// src/lib/email/templates.ts
// es-AR transactional email copy. Keep text and html in sync.
type Rendered = { subject: string; text: string; html: string };

function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:16px">
<h2 style="color:#0079BC">${title}</h2>
${bodyHtml}
<p style="color:#666;font-size:12px;margin-top:24px">Asociación Vecinal del Barrio Ciudadela — Comodoro Rivadavia</p>
</div>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${url}" style="background:#0079BC;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${label}</a></p>
<p style="font-size:12px;color:#666">Si el botón no funciona, copiá este enlace: ${url}</p>`;
}

export function verificationEmail(opts: { name: string; url: string }): Rendered {
  return {
    subject: "Verificá tu email — Vecinal Ciudadela",
    text: `Hola ${opts.name}:\n\nLa Vecinal Ciudadela registró este email como tu domicilio electrónico. Para confirmarlo, abrí este enlace:\n\n${opts.url}\n\nEl enlace vence en 7 días. Si no esperabas este correo, ignoralo.`,
    html: layout("Verificá tu email", `<p>Hola <strong>${opts.name}</strong>:</p>
<p>La Vecinal Ciudadela registró este email como tu domicilio electrónico. Para confirmarlo, hacé clic:</p>
${button(opts.url, "Verificar mi email")}
<p>El enlace vence en 7 días. Si no esperabas este correo, ignoralo.</p>`),
  };
}

export function invitationEmail(opts: { name: string; url: string }): Rendered {
  return {
    subject: "Creá tu contraseña — Vecinal Ciudadela",
    text: `Hola ${opts.name}:\n\nYa podés crear tu contraseña para acceder al panel de socios de la Vecinal Ciudadela:\n\n${opts.url}\n\nEl enlace vence en 7 días.`,
    html: layout("Creá tu contraseña", `<p>Hola <strong>${opts.name}</strong>:</p>
<p>Ya podés crear tu contraseña para acceder al panel de socios:</p>
${button(opts.url, "Crear mi contraseña")}
<p>El enlace vence en 7 días.</p>`),
  };
}

export function passwordResetEmail(opts: { url: string }): Rendered {
  return {
    subject: "Restablecé tu contraseña — Vecinal Ciudadela",
    text: `Recibimos un pedido para restablecer tu contraseña. Abrí este enlace (vence en 30 minutos):\n\n${opts.url}\n\nSi no fuiste vos, ignorá este correo: tu contraseña no cambia.`,
    html: layout("Restablecé tu contraseña", `<p>Recibimos un pedido para restablecer tu contraseña. El enlace vence en 30 minutos:</p>
${button(opts.url, "Restablecer contraseña")}
<p>Si no fuiste vos, ignorá este correo: tu contraseña no cambia.</p>`),
  };
}
```

```ts
// src/lib/email/index.ts
// Mailer: sends and records the statutory Notification row in one call.
import type { NotificationType, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getTransport, type MailTransport } from "./transport";

type MailerDeps = { transport: MailTransport; db: Pick<PrismaClient, "notification"> };

export function makeMailer(deps: MailerDeps) {
  return {
    async sendToMember(input: {
      memberId: number | null;
      to: string;
      type: NotificationType;
      message: { subject: string; text: string; html: string };
      summary: string;
    }): Promise<{ messageId: string | null }> {
      const { messageId } = await deps.transport.send({ to: input.to, ...input.message });
      await deps.db.notification.create({
        data: {
          memberId: input.memberId,
          type: input.type,
          via: "email",
          status: "sent",
          brevoMessageId: messageId,
          payloadSummary: input.summary,
        },
      });
      return { messageId };
    },
  };
}

export const mailer = makeMailer({ transport: getTransport(), db: prisma });
```

- [ ] **Step 5: Tests en verde + typecheck**

Run: `npx vitest run tests/email.test.ts && npx tsc --noEmit`
Expected: PASS, 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email tests/email.test.ts package.json package-lock.json
git commit -m "feat: brevo email layer with templates and notification log"
```

---

### Task 8: Reglas y servicio de movimientos societarios

**Files:**
- Create: `src/lib/members/rules.ts`, `src/lib/members/service.ts`
- Test: `tests/member-rules.test.ts`

**Interfaces:**
- Produces (rules, puras): `type RuleResult = { ok: true } | { ok: false; error: string }` ·
  `canWithdraw(m: { status: MemberStatus }): RuleResult` ·
  `canChangeCategory(m: { status: MemberStatus; category: MemberCategory }, newCategory: MemberCategory, electionsOngoing: boolean): RuleResult` ·
  `canSuspend(m: { status: MemberStatus }): RuleResult` ·
  `canReadmit(m: { status: MemberStatus; reentryBlocked: boolean }): RuleResult` ·
  `hasArrearsDebt(m: { withdrawalReason: WithdrawalReason | null; debtAtWithdrawal: boolean }): boolean`.
- Produces (service): `makeMemberService(db: PrismaClient)` con métodos que corren en `$transaction` y devuelven el `Member` actualizado (lanzan `Error` con mensaje es-AR si una regla falla):
  - `admit(input: { fullName: string; category: MemberCategory; minuteId: number; actorId: number; dni?: string; email?: string; birthDate?: Date; civilStatus?: string; nationality?: string; occupation?: string; phone?: string; streetId?: number; streetText?: string; streetNumber?: string; neighborhood?: string })`
  - `withdraw(input: { memberId: number; reason: WithdrawalReason; minuteId: number; actorId: number; detail?: string })`
  - `changeCategory(input: { memberId: number; newCategory: MemberCategory; minuteId: number; actorId: number })`
  - `suspend(input: { memberId: number; from: Date; to: Date; minuteId: number; actorId: number; detail?: string })`
  - `endSuspension(input: { memberId: number; minuteId: number; actorId: number })`
  - `readmit(input: { memberId: number; category: MemberCategory; minuteId: number; actorId: number })`
- Singleton `export const memberService = makeMemberService(prisma)`.
- Consumes: modelos Task 1, `Configuration` key `elecciones_en_curso` (Json boolean, seed M0).

- [ ] **Step 1: Tests de reglas que fallan**

```ts
// tests/member-rules.test.ts
import { describe, expect, it } from "vitest";
import { canChangeCategory, canReadmit, canSuspend, canWithdraw, hasArrearsDebt } from "@/lib/members/rules";

describe("member rules", () => {
  it("cannot withdraw an already withdrawn member", () => {
    expect(canWithdraw({ status: "withdrawn" }).ok).toBe(false);
    expect(canWithdraw({ status: "active" }).ok).toBe(true);
  });

  it("category change requires active status, a different category and no ongoing election (REG-07)", () => {
    expect(canChangeCategory({ status: "active", category: "adherent" }, "active", false).ok).toBe(true);
    expect(canChangeCategory({ status: "active", category: "adherent" }, "adherent", false).ok).toBe(false);
    expect(canChangeCategory({ status: "withdrawn", category: "adherent" }, "active", false).ok).toBe(false);
    const blocked = canChangeCategory({ status: "active", category: "adherent" }, "active", true);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("elecciones");
  });

  it("suspension requires active status", () => {
    expect(canSuspend({ status: "active" }).ok).toBe(true);
    expect(canSuspend({ status: "suspended" }).ok).toBe(false);
  });

  it("readmission blocked for expelled members (REG-04) and non-withdrawn", () => {
    expect(canReadmit({ status: "withdrawn", reentryBlocked: false }).ok).toBe(true);
    const expelled = canReadmit({ status: "withdrawn", reentryBlocked: true });
    expect(expelled.ok).toBe(false);
    if (!expelled.ok) expect(expelled.error).toContain("expulsión");
    expect(canReadmit({ status: "active", reentryBlocked: false }).ok).toBe(false);
  });

  it("arrears debt flag (REG-16 placeholder)", () => {
    expect(hasArrearsDebt({ withdrawalReason: "arrears", debtAtWithdrawal: true })).toBe(true);
    expect(hasArrearsDebt({ withdrawalReason: "death", debtAtWithdrawal: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run para verificar que falla**

Run: `npx vitest run tests/member-rules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar rules**

```ts
// src/lib/members/rules.ts
// Pure statutory guards. Error messages are user-facing (es-AR).
import type { MemberCategory, MemberStatus, WithdrawalReason } from "@/generated/prisma/client";

export type RuleResult = { ok: true } | { ok: false; error: string };

export function canWithdraw(m: { status: MemberStatus }): RuleResult {
  if (m.status === "withdrawn") return { ok: false, error: "El socio ya está dado de baja." };
  return { ok: true };
}

export function canChangeCategory(
  m: { status: MemberStatus; category: MemberCategory },
  newCategory: MemberCategory,
  electionsOngoing: boolean,
): RuleResult {
  if (m.status !== "active") return { ok: false, error: "Solo un socio vigente puede cambiar de categoría." };
  if (m.category === newCategory) return { ok: false, error: "El socio ya tiene esa categoría." };
  if (electionsOngoing) {
    return { ok: false, error: "Hay elecciones en curso: los cambios de categoría están bloqueados (Art. 5° ter)." };
  }
  return { ok: true };
}

export function canSuspend(m: { status: MemberStatus }): RuleResult {
  if (m.status !== "active") return { ok: false, error: "Solo un socio vigente puede ser suspendido." };
  return { ok: true };
}

export function canReadmit(m: { status: MemberStatus; reentryBlocked: boolean }): RuleResult {
  if (m.status !== "withdrawn") return { ok: false, error: "Solo un socio dado de baja puede reingresar." };
  if (m.reentryBlocked) {
    return { ok: false, error: "Baja por expulsión: el reingreso está prohibido por estatuto (Art. 5 inc. 2)." };
  }
  return { ok: true };
}

export function hasArrearsDebt(m: { withdrawalReason: WithdrawalReason | null; debtAtWithdrawal: boolean }): boolean {
  return m.withdrawalReason === "arrears" && m.debtAtWithdrawal;
}
```

- [ ] **Step 4: Tests de reglas en verde**

Run: `npx vitest run tests/member-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar el service**

```ts
// src/lib/members/service.ts
// Statutory actions: every one runs in a transaction, requires a Minute and
// writes a Movement. Audit rows are written by the calling server action
// (it knows actor IP); this service records actor ids on movements.
import type { MemberCategory, PrismaClient, WithdrawalReason } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canChangeCategory, canReadmit, canSuspend, canWithdraw } from "./rules";

async function electionsOngoing(db: PrismaClient): Promise<boolean> {
  const row = await db.configuration.findUnique({ where: { key: "elecciones_en_curso" } });
  return row?.value === true;
}

export function makeMemberService(db: PrismaClient) {
  return {
    async admit(input: {
      fullName: string; category: MemberCategory; minuteId: number; actorId: number;
      dni?: string; email?: string; birthDate?: Date; civilStatus?: string; nationality?: string;
      occupation?: string; phone?: string; streetId?: number; streetText?: string;
      streetNumber?: string; neighborhood?: string;
    }) {
      return db.$transaction(async (tx) => {
        const book = await tx.book.findFirst({ where: { status: "open" } });
        if (!book) throw new Error("No hay libro abierto.");
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const max = await tx.membership.aggregate({ where: { bookId: book.id }, _max: { memberNumber: true } });
        const member = await tx.member.create({
          data: {
            fullName: input.fullName, category: input.category, status: "active",
            dni: input.dni ?? null, email: input.email ?? null,
            emailStatus: input.email ? "declared" : "none",
            birthDate: input.birthDate ?? null, civilStatus: input.civilStatus ?? null,
            nationality: input.nationality ?? null, occupation: input.occupation ?? null,
            phone: input.phone ?? null, streetId: input.streetId ?? null,
            streetText: input.streetText ?? null, streetNumber: input.streetNumber ?? null,
            neighborhood: input.neighborhood ?? null,
            joinedAt: minute.date, // REG-11: fecha de ingreso = fecha del acta
          },
        });
        await tx.membership.create({
          data: { memberId: member.id, bookId: book.id, memberNumber: (max._max.memberNumber ?? 0) + 1 },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "admission", date: minute.date, minuteId: minute.id,
            newCategory: input.category, createdById: input.actorId,
          },
        });
        return member;
      });
    },

    async withdraw(input: { memberId: number; reason: WithdrawalReason; minuteId: number; actorId: number; detail?: string }) {
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        const check = canWithdraw(member);
        if (!check.ok) throw new Error(check.error);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: {
            status: "withdrawn", withdrawalReason: input.reason, leftAt: minute.date,
            reentryBlocked: input.reason === "expulsion" ? true : member.reentryBlocked,
            suspendedFrom: null, suspendedTo: null,
          },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "withdrawal", date: minute.date, minuteId: minute.id,
            reason: input.reason, detail: input.detail ?? null, createdById: input.actorId,
          },
        });
        return updated;
      });
    },

    async changeCategory(input: { memberId: number; newCategory: MemberCategory; minuteId: number; actorId: number }) {
      const ongoing = await electionsOngoing(db);
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        const check = canChangeCategory(member, input.newCategory, ongoing);
        if (!check.ok) throw new Error(check.error);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: { category: input.newCategory }, // joinedAt NO se toca (REG-07: no interrumpe antigüedad)
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "category_change", date: minute.date, minuteId: minute.id,
            previousCategory: member.category, newCategory: input.newCategory, createdById: input.actorId,
          },
        });
        return updated;
      });
    },

    async suspend(input: { memberId: number; from: Date; to: Date; minuteId: number; actorId: number; detail?: string }) {
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        const check = canSuspend(member);
        if (!check.ok) throw new Error(check.error);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: { status: "suspended", suspendedFrom: input.from, suspendedTo: input.to },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "suspension", date: minute.date, minuteId: minute.id,
            detail: input.detail ?? null, createdById: input.actorId,
          },
        });
        return updated;
      });
    },

    async endSuspension(input: { memberId: number; minuteId: number; actorId: number }) {
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        if (member.status !== "suspended") throw new Error("El socio no está suspendido.");
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: { status: "active", suspendedFrom: null, suspendedTo: null },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "suspension_end", date: minute.date, minuteId: minute.id,
            createdById: input.actorId,
          },
        });
        return updated;
      });
    },

    async readmit(input: { memberId: number; category: MemberCategory; minuteId: number; actorId: number }) {
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        const check = canReadmit(member);
        if (!check.ok) throw new Error(check.error);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: {
            status: "active", category: input.category, withdrawalReason: null, leftAt: null,
            // debtAtWithdrawal se conserva: M4 lo usa para calcular la deuda a saldar (REG-16)
          },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "readmission", date: minute.date, minuteId: minute.id,
            newCategory: input.category, createdById: input.actorId,
          },
        });
        return updated;
      });
    },
  };
}

export const memberService = makeMemberService(prisma);
```

- [ ] **Step 6: Tests del service con fake de Prisma**

Escribir `tests/member-service.test.ts`. El fake implementa `$transaction(cb)` ejecutando el callback contra el mismo objeto (sin transacción real), lo que alcanza para verificar QUÉ escribe cada acción.

```ts
// tests/member-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeMemberService } from "@/lib/members/service";

const MINUTE = { id: 10, type: "board", number: 3, date: new Date("2026-08-20T12:00:00Z") };

function makeFakeDb(member: Record<string, unknown>, config: { elections?: boolean } = {}) {
  const state = {
    member: { id: 1, status: "active", category: "adherent", reentryBlocked: false,
      debtAtWithdrawal: false, withdrawalReason: null, joinedAt: new Date("2019-09-01T12:00:00Z"), ...member },
    movements: [] as Record<string, unknown>[],
    memberships: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  };
  const db = {
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
    configuration: { findUnique: async () => ({ value: config.elections ?? false }) },
    book: { findFirst: async () => ({ id: 1, status: "open" }) },
    minute: { findUniqueOrThrow: async () => MINUTE },
    membership: {
      aggregate: async () => ({ _max: { memberNumber: 305 } }),
      create: async ({ data }: { data: Record<string, unknown> }) => { state.memberships.push(data); return data; },
    },
    movement: { create: async ({ data }: { data: Record<string, unknown> }) => { state.movements.push(data); return data; } },
    member: {
      findUniqueOrThrow: async () => state.member,
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 99, ...data }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        Object.assign(state.member, data);
        return state.member;
      },
    },
  };
  return { db, state };
}

describe("memberService.admit", () => {
  it("assigns the next member number and uses the minute date as joinedAt (REG-11)", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    const member = await svc.admit({ fullName: "Perez Ana", category: "active", minuteId: 10, actorId: 2 });
    expect(member.joinedAt).toEqual(MINUTE.date);
    expect(state.memberships[0]).toMatchObject({ memberNumber: 306 });
    expect(state.movements[0]).toMatchObject({ type: "admission", minuteId: 10, newCategory: "active", createdById: 2 });
  });
});

describe("memberService.withdraw", () => {
  it("records the reason, the minute date as leftAt and a movement", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "arrears", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ status: "withdrawn", withdrawalReason: "arrears", leftAt: MINUTE.date });
    expect(state.movements[0]).toMatchObject({ type: "withdrawal", reason: "arrears", minuteId: 10 });
  });

  it("expulsion blocks any future reentry (REG-04)", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.withdraw({ memberId: 1, reason: "expulsion", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ reentryBlocked: true });
  });

  it("refuses to withdraw an already withdrawn member", async () => {
    const { db } = makeFakeDb({ status: "withdrawn" });
    const svc = makeMemberService(db as never);
    await expect(svc.withdraw({ memberId: 1, reason: "death", minuteId: 10, actorId: 2 })).rejects.toThrow(/ya está dado de baja/);
  });
});

describe("memberService.changeCategory", () => {
  it("changes category without touching joinedAt (REG-07)", async () => {
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toEqual({ category: "active" });
    expect(state.updates[0]).not.toHaveProperty("joinedAt");
    expect(state.movements[0]).toMatchObject({ type: "category_change", previousCategory: "adherent", newCategory: "active" });
  });

  it("is blocked while an election is ongoing (REG-07)", async () => {
    const { db } = makeFakeDb({}, { elections: true });
    const svc = makeMemberService(db as never);
    await expect(svc.changeCategory({ memberId: 1, newCategory: "active", minuteId: 10, actorId: 2 })).rejects.toThrow(/elecciones/);
  });
});

describe("memberService.suspend / endSuspension", () => {
  it("stores the suspension window and clears it when lifted", async () => {
    const from = new Date("2026-09-01T12:00:00Z");
    const to = new Date("2026-10-01T12:00:00Z");
    const { db, state } = makeFakeDb({});
    const svc = makeMemberService(db as never);
    await svc.suspend({ memberId: 1, from, to, minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ status: "suspended", suspendedFrom: from, suspendedTo: to });
    await svc.endSuspension({ memberId: 1, minuteId: 10, actorId: 2 });
    expect(state.updates[1]).toMatchObject({ status: "active", suspendedFrom: null, suspendedTo: null });
    expect(state.movements.map((m) => m.type)).toEqual(["suspension", "suspension_end"]);
  });
});

describe("memberService.readmit", () => {
  it("reactivates and keeps the debt flag for the M4 calculation (REG-16)", async () => {
    const { db, state } = makeFakeDb({ status: "withdrawn", withdrawalReason: "arrears", debtAtWithdrawal: true });
    const svc = makeMemberService(db as never);
    await svc.readmit({ memberId: 1, category: "active", minuteId: 10, actorId: 2 });
    expect(state.updates[0]).toMatchObject({ status: "active", category: "active", withdrawalReason: null, leftAt: null });
    expect(state.updates[0]).not.toHaveProperty("debtAtWithdrawal");
    expect(state.movements[0]).toMatchObject({ type: "readmission" });
  });

  it("refuses to readmit an expelled member (REG-04)", async () => {
    const { db } = makeFakeDb({ status: "withdrawn", reentryBlocked: true });
    const svc = makeMemberService(db as never);
    await expect(svc.readmit({ memberId: 1, category: "active", minuteId: 10, actorId: 2 })).rejects.toThrow(/expulsión/);
  });
});
```

Run: `npx vitest run tests/member-service.test.ts`
Expected: PASS (10 tests). Si alguno falla, el bug está en el service, no en el test.

- [ ] **Step 7: Typecheck + suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: 0 errores; toda la suite PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/members tests/member-rules.test.ts tests/member-service.test.ts
git commit -m "feat: statutory member rules and transactional movement service"
```

---

### Task 9: Componentes shadcn + listado del padrón `/admin/socios`

**Files:**
- Create: `src/lib/members/labels.ts`, `src/lib/members/query.ts`, `src/app/admin/socios/page.tsx`
- Modify: `src/app/admin/page.tsx` (la tarjeta "Socios" pasa de "Próximamente" a link `/admin/socios`)
- Test: `tests/members-query.test.ts`

**Interfaces:**
- Produces:
  - `labels.ts`: `CATEGORY_LABELS`, `STATUS_LABELS`, `EMAIL_STATUS_LABELS`, `REASON_LABELS`, `MOVEMENT_LABELS`, `MINUTE_TYPE_LABELS` — todos `Record<enum, string>` es-AR.
  - `query.ts`: `type PadronFilters = { q?: string; category?: MemberCategory; status?: MemberStatus; email?: "con" | "sin" | "verificado"; dni?: "con" | "sin" }` · `parsePadronFilters(sp: Record<string, string | string[] | undefined>): PadronFilters` · `padronWhere(f: PadronFilters): Prisma.MembershipWhereInput` (siempre sobre el libro abierto: `book: { status: "open" }`) · `fetchPadron(db, f): Promise<Array<{ memberNumber: number; member: Member }>>` ordenado por `memberNumber`.
- Consumes: Task 1 (modelos), datos importados (Task 4).

- [ ] **Step 1: Instalar componentes shadcn**

Run: `npx shadcn@latest add table select badge dialog tabs sonner checkbox textarea`
Expected: archivos nuevos en `src/components/ui/`. Commit aparte:

```bash
git add src/components/ui package.json package-lock.json
git commit -m "chore: add shadcn table/select/badge/dialog/tabs/sonner/checkbox/textarea"
```

- [ ] **Step 2: Test del builder de filtros (falla)**

```ts
// tests/members-query.test.ts
import { describe, expect, it } from "vitest";
import { padronWhere, parsePadronFilters } from "@/lib/members/query";

describe("parsePadronFilters", () => {
  it("keeps only known values", () => {
    expect(parsePadronFilters({ q: "perez", category: "adherent", status: "nope", email: "sin", dni: "con" }))
      .toEqual({ q: "perez", category: "adherent", email: "sin", dni: "con" });
  });
});

describe("padronWhere", () => {
  it("always scopes to the open book", () => {
    expect(padronWhere({})).toMatchObject({ book: { status: "open" } });
  });
  it("searches by name, dni or member number", () => {
    const w = padronWhere({ q: "123" });
    expect(JSON.stringify(w)).toContain("123");
    expect(JSON.stringify(w)).toContain("memberNumber");
  });
  it("maps email filter", () => {
    expect(JSON.stringify(padronWhere({ email: "verificado" }))).toContain("verified");
    expect(JSON.stringify(padronWhere({ email: "sin" }))).toContain("none");
  });
});
```

Run: `npx vitest run tests/members-query.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implementar labels y query**

```ts
// src/lib/members/labels.ts
import type {
  EmailStatus, MemberCategory, MemberStatus, MinuteType, MovementType, WithdrawalReason,
} from "@/generated/prisma/client";

export const CATEGORY_LABELS: Record<MemberCategory, string> = {
  active: "Activo", adherent: "Adherente", collaborator: "Colaborador",
  cadet: "Cadete", honorary: "Honorario", lifetime: "Vitalicio",
};
export const STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Vigente", suspended: "Suspendido", withdrawn: "Baja",
};
export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  none: "Sin email", declared: "Sin verificar", verified: "Verificado", bounced: "Rebotado",
};
export const REASON_LABELS: Record<WithdrawalReason, string> = {
  death: "Fallecimiento", resignation: "Renuncia", arrears: "Cesantía por mora",
  moved_away: "Cesantía por mudanza", not_reregistered: "No re-empadronado",
  expulsion: "Expulsión", duplicate_annulment: "Anulación por duplicado", other: "Otro",
};
export const MOVEMENT_LABELS: Record<MovementType, string> = {
  admission: "Alta", withdrawal: "Baja", category_change: "Cambio de categoría",
  readmission: "Reingreso", suspension: "Suspensión", suspension_end: "Fin de suspensión",
  book_migration: "Migración de libro",
};
export const MINUTE_TYPE_LABELS: Record<MinuteType, string> = {
  board: "Comisión Directiva", assembly: "Asamblea",
};
```

```ts
// src/lib/members/query.ts
// Shared padron query: listing page and Excel export use the same filters.
import type { Member, MemberCategory, MemberStatus, Prisma, PrismaClient } from "@/generated/prisma/client";

export type PadronFilters = {
  q?: string;
  category?: MemberCategory;
  status?: MemberStatus;
  email?: "con" | "sin" | "verificado";
  dni?: "con" | "sin";
};

const CATEGORIES = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"];
const STATUSES = ["active", "suspended", "withdrawn"];

export function parsePadronFilters(sp: Record<string, string | string[] | undefined>): PadronFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: PadronFilters = {};
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  const category = one(sp.category);
  if (category && CATEGORIES.includes(category)) f.category = category as MemberCategory;
  const status = one(sp.status);
  if (status && STATUSES.includes(status)) f.status = status as MemberStatus;
  const email = one(sp.email);
  if (email === "con" || email === "sin" || email === "verificado") f.email = email;
  const dni = one(sp.dni);
  if (dni === "con" || dni === "sin") f.dni = dni;
  return f;
}

export function padronWhere(f: PadronFilters): Prisma.MembershipWhereInput {
  const member: Prisma.MemberWhereInput = {};
  if (f.category) member.category = f.category;
  if (f.status) member.status = f.status;
  if (f.email === "con") member.email = { not: null };
  if (f.email === "sin") member.emailStatus = "none";
  if (f.email === "verificado") member.emailStatus = "verified";
  if (f.dni === "con") member.dni = { not: null };
  if (f.dni === "sin") member.dni = null;

  const where: Prisma.MembershipWhereInput = { book: { status: "open" }, member };
  if (f.q) {
    const or: Prisma.MembershipWhereInput[] = [
      { member: { ...member, fullName: { contains: f.q } } },
      { member: { ...member, dni: { contains: f.q } } },
    ];
    const asNumber = Number(f.q);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      or.push({ member, memberNumber: asNumber });
    }
    return { book: { status: "open" }, OR: or };
  }
  return where;
}

export async function fetchPadron(db: PrismaClient, f: PadronFilters) {
  const rows = await db.membership.findMany({
    where: padronWhere(f),
    include: { member: true },
    orderBy: { memberNumber: "asc" },
  });
  return rows.map((r) => ({ memberNumber: r.memberNumber, member: r.member as Member }));
}
```

Run: `npx vitest run tests/members-query.test.ts` → Expected: PASS.

- [ ] **Step 4: Página de listado**

```tsx
// src/app/admin/socios/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fetchPadron, parsePadronFilters } from "@/lib/members/query";
import { CATEGORY_LABELS, EMAIL_STATUS_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function SociosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const filters = parsePadronFilters(sp);
  const rows = await fetchPadron(prisma, filters);
  const exportQs = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, String(v)]),
  ).toString();

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Socios — Libro 1</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href={`/api/admin/padron-export?${exportQs}`}>Exportar Excel</a>
          </Button>
          <Button asChild><Link href="/admin/socios/nuevo">Alta manual</Link></Button>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" placeholder="Nombre, DNI o número" defaultValue={filters.q ?? ""} className="w-56" />
        <select name="category" defaultValue={filters.category ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Categoría (todas)</option>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Estado (todos)</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="email" defaultValue={filters.email ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Email (todos)</option>
          <option value="con">Con email</option>
          <option value="sin">Sin email</option>
          <option value="verificado">Verificado</option>
        </select>
        <select name="dni" defaultValue={filters.dni ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">DNI (todos)</option>
          <option value="con">Con DNI</option>
          <option value="sin">Sin DNI</option>
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      <p className="text-sm text-muted-foreground">{rows.length} socios</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>N°</TableHead><TableHead>Apellido y nombre</TableHead>
            <TableHead>DNI</TableHead><TableHead>Categoría</TableHead>
            <TableHead>Estado</TableHead><TableHead>Email</TableHead>
            <TableHead>Débito</TableHead><TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ memberNumber, member }) => (
            <TableRow key={member.id}>
              <TableCell>{memberNumber}</TableCell>
              <TableCell>
                <Link className="hover:underline" href={`/admin/socios/${member.id}`}>{member.fullName}</Link>
              </TableCell>
              <TableCell>{member.dni ?? "—"}</TableCell>
              <TableCell>{CATEGORY_LABELS[member.category]}</TableCell>
              <TableCell>
                <Badge variant={member.status === "active" ? "default" : member.status === "suspended" ? "secondary" : "outline"}>
                  {STATUS_LABELS[member.status]}
                </Badge>
                {member.status === "withdrawn" && member.debtAtWithdrawal && (
                  <Badge variant="destructive" className="ml-1">Deuda</Badge>
                )}
              </TableCell>
              <TableCell>
                {member.email ? `${member.email} · ${EMAIL_STATUS_LABELS[member.emailStatus]}` : "—"}
              </TableCell>
              <TableCell>{member.autoDebit ? "Sí" : "No"}</TableCell>
              <TableCell>
                <Link className="text-sm text-primary hover:underline" href={`/admin/socios/carga/${memberNumber}`}>
                  Cargar ficha
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

En `src/app/admin/page.tsx`, cambiar la entrada `Socios` del array `sections` para que linkee a `/admin/socios` (mantener el patrón visual existente de tarjetas; solo esa tarjeta deja de decir "Próximamente").

- [ ] **Step 5: Verificar en el navegador**

Run: `npm run dev` y abrir `http://localhost:3000/admin/socios` logueado como admin.
Expected: tabla con 283 socios ordenados por número, filtros funcionando (ej. `?status=active` → 160 filas). El link "Exportar Excel" devolverá 404 hasta la Task 16 — esperado.

- [ ] **Step 6: Commit**

```bash
git add src/lib/members/labels.ts src/lib/members/query.ts src/app/admin/socios/page.tsx src/app/admin/page.tsx tests/members-query.test.ts
git commit -m "feat: padron listing with filters and search"
```

---

### Task 10: Ficha de socio `/admin/socios/[id]`

**Files:**
- Create: `src/app/admin/socios/[id]/page.tsx`

**Interfaces:**
- Consumes: labels (Task 9), `formatDateAR` (`src/lib/format.ts`), modelos Task 1.
- Produces: ficha con datos completos, historial de movimientos (con acta), notificaciones, botonera hacia `/admin/socios/[id]/{baja,categoria,suspension,reingreso}` (Task 12) y `/admin/socios/carga/[numero]` (Task 13).

- [ ] **Step 1: Implementar la página**

```tsx
// src/app/admin/socios/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import {
  CATEGORY_LABELS, EMAIL_STATUS_LABELS, MINUTE_TYPE_LABELS, MOVEMENT_LABELS, REASON_LABELS, STATUS_LABELS,
} from "@/lib/members/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}

export default async function SocioPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const member = await prisma.member.findUnique({
    where: { id: Number(id) },
    include: {
      street: true,
      memberships: { include: { book: true } },
      movements: { include: { minute: true }, orderBy: { date: "desc" } },
      notifications: { orderBy: { sentAt: "desc" }, take: 20 },
    },
  });
  if (!member) notFound();

  const openMembership = member.memberships.find((m) => m.book.status === "open");
  const address = member.street
    ? `${member.street.name} ${member.streetNumber ?? ""}`.trim()
    : [member.streetText, member.streetNumber].filter(Boolean).join(" ");

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/socios" className="hover:underline">Socios</Link> / N° {openMembership?.memberNumber ?? "—"}
          </p>
          <h1 className="text-2xl font-semibold">{member.fullName}</h1>
          <div className="mt-1 flex gap-2">
            <Badge>{CATEGORY_LABELS[member.category]}</Badge>
            <Badge variant={member.status === "active" ? "default" : "outline"}>{STATUS_LABELS[member.status]}</Badge>
            {member.status === "withdrawn" && member.debtAtWithdrawal && <Badge variant="destructive">Deuda de tesorería</Badge>}
            {member.reentryBlocked && <Badge variant="destructive">Reingreso bloqueado</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {openMembership && (
            <Button asChild variant="outline">
              <Link href={`/admin/socios/carga/${openMembership.memberNumber}`}>Cargar ficha</Link>
            </Button>
          )}
          {member.status !== "withdrawn" && (
            <>
              <Button asChild variant="outline"><Link href={`/admin/socios/${member.id}/categoria`}>Cambiar categoría</Link></Button>
              {member.status === "active" && (
                <Button asChild variant="outline"><Link href={`/admin/socios/${member.id}/suspension`}>Suspender</Link></Button>
              )}
              <Button asChild variant="destructive"><Link href={`/admin/socios/${member.id}/baja`}>Dar de baja</Link></Button>
            </>
          )}
          {member.status === "suspended" && (
            <Button asChild variant="outline"><Link href={`/admin/socios/${member.id}/suspension`}>Levantar suspensión</Link></Button>
          )}
          {member.status === "withdrawn" && !member.reentryBlocked && (
            <Button asChild><Link href={`/admin/socios/${member.id}/reingreso`}>Reingreso</Link></Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Datos personales</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="DNI" value={member.dni} />
              <Field label="Fecha de nacimiento" value={member.birthDate ? formatDateAR(member.birthDate) : null} />
              <Field label="Estado civil" value={member.civilStatus} />
              <Field label="Nacionalidad" value={member.nationality} />
              <Field label="Ocupación" value={member.occupation} />
              <Field label="Teléfono" value={member.phone} />
              <Field label="Domicilio" value={address || null} />
              <Field label="Barrio" value={member.neighborhood} />
              <Field label="Email" value={member.email ? `${member.email} (${EMAIL_STATUS_LABELS[member.emailStatus]})` : null} />
              <Field label="Débito automático" value={member.autoDebit ? "Sí" : "No"} />
              <Field label="Fecha de ingreso" value={formatDateAR(member.joinedAt)} />
              <Field label="Fecha de egreso" value={member.leftAt ? formatDateAR(member.leftAt) : null} />
              {member.withdrawalReason && <Field label="Motivo de baja" value={REASON_LABELS[member.withdrawalReason]} />}
              {member.status === "suspended" && (
                <Field label="Suspendido" value={`${member.suspendedFrom ? formatDateAR(member.suspendedFrom) : "?"} — ${member.suspendedTo ? formatDateAR(member.suspendedTo) : "?"}`} />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Historial de movimientos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {member.movements.length === 0 && <p className="text-sm text-muted-foreground">Sin movimientos.</p>}
            {member.movements.map((mv) => (
              <div key={mv.id} className="border-b pb-2 text-sm last:border-0">
                <span className="font-medium">{MOVEMENT_LABELS[mv.type]}</span> — {formatDateAR(mv.date)}
                {mv.previousCategory && mv.newCategory && (
                  <> · {CATEGORY_LABELS[mv.previousCategory]} → {CATEGORY_LABELS[mv.newCategory]}</>
                )}
                {mv.reason && <> · {REASON_LABELS[mv.reason]}</>}
                {mv.minute ? (
                  <> · <Link className="text-primary hover:underline" href={`/admin/actas/${mv.minute.id}`}>
                    Acta {MINUTE_TYPE_LABELS[mv.minute.type]} N° {mv.minute.number}
                  </Link></>
                ) : (
                  <> · sin acta digitalizada</>
                )}
                {mv.detail && <p className="text-muted-foreground">{mv.detail}</p>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notificaciones</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {member.notifications.length === 0 && <p className="text-sm text-muted-foreground">Sin notificaciones.</p>}
            {member.notifications.map((n) => (
              <p key={String(n.id)} className="text-sm">
                {formatDateAR(n.sentAt)} — {n.payloadSummary ?? n.type} ({n.status})
              </p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Documentos y cuenta corriente</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Documentos: disponible con el Módulo 3. Cuenta corriente: disponible con el Módulo 4.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar en el navegador**

Abrir un socio desde el listado. Expected: ficha completa; el movimiento de import figura como "Alta … sin acta digitalizada". Los botones de acciones dan 404 hasta la Task 12 — esperado.

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/socios/[id]/page.tsx"
git commit -m "feat: member detail page with movement history"
```

---

### Task 11: ABM de actas + selector de acta reutilizable

**Files:**
- Create: `src/app/admin/actas/page.tsx`, `src/app/admin/actas/nueva/page.tsx`, `src/app/admin/actas/nueva/minute-form.tsx`, `src/app/admin/actas/actions.ts`, `src/app/admin/actas/[id]/page.tsx`, `src/components/admin/minute-picker.tsx`, `src/lib/members/minute-form.ts`
- Modify: `src/app/admin/page.tsx` (si hay tarjeta de actas; si no, agregar link "Actas" junto a Socios)
- Test: `tests/minute-form.test.ts`

**Interfaces:**
- Produces:
  - `src/lib/members/minute-form.ts`: `minuteSelectionSchema` (zod) que acepta `minuteId` (número) O `minuteNew="1"` + `minuteType` (`board|assembly`) + `minuteNumber` + `minuteDate` (YYYY-MM-DD del `<input type="date">`) + `minuteDescription?` · `resolveMinuteId(db, sel, actorId): Promise<number>` — devuelve el id existente o crea el acta (fecha → `civilDateUtc`); si UNIQUE(type,number) choca, lanza `Error("Ya existe el acta ... N° ...")`.
  - `MinutePicker` (client): props `{ minutes: Array<{ id: number; type: string; number: number; date: string; label: string }> }`; renderiza radio "acta existente" (select) / "acta nueva" (campos), emitiendo los names que espera `minuteSelectionSchema`.
  - Server action `createMinuteAction` en `actions.ts` para el ABM directo.
- Consumes: `parseForm` (Task 5), `civilDateUtc` (Task 3), labels (Task 9), `audit`.

- [ ] **Step 1: Test del schema + resolve (falla)**

```ts
// tests/minute-form.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { minuteSelectionSchema, resolveMinuteId } from "@/lib/members/minute-form";

describe("minuteSelectionSchema", () => {
  it("accepts an existing minute id", () => {
    const r = minuteSelectionSchema.safeParse({ minuteId: "7" });
    expect(r.success).toBe(true);
    if (r.success && "minuteId" in r.data) expect(r.data.minuteId).toBe(7);
  });
  it("accepts a new minute", () => {
    const r = minuteSelectionSchema.safeParse({
      minuteNew: "1", minuteType: "board", minuteNumber: "12", minuteDate: "2026-08-20",
    });
    expect(r.success).toBe(true);
  });
  it("rejects when neither is given", () => {
    expect(minuteSelectionSchema.safeParse({}).success).toBe(false);
  });
});

describe("resolveMinuteId", () => {
  it("creates the minute at civil noon UTC", async () => {
    const created: Record<string, unknown>[] = [];
    const db = {
      minute: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 99, ...data }; } },
    };
    const id = await resolveMinuteId(db as never, {
      minuteNew: "1" as const, minuteType: "board" as const, minuteNumber: 12,
      minuteDate: "2026-08-20", minuteDescription: undefined,
    }, 1);
    expect(id).toBe(99);
    expect((created[0].date as Date).toISOString()).toBe("2026-08-20T12:00:00.000Z");
  });
  it("passes through an existing id without touching the db", async () => {
    expect(await resolveMinuteId({} as never, { minuteId: 7 }, 1)).toBe(7);
  });
});
```

Run: `npx vitest run tests/minute-form.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implementar `minute-form.ts`**

```ts
// src/lib/members/minute-form.ts
// Shared "pick or create a Minute" used by every statutory action form.
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { civilDateUtc } from "@/lib/dates";

export const minuteSelectionSchema = z.union([
  z.object({ minuteId: z.coerce.number().int().positive() }),
  z.object({
    minuteNew: z.literal("1"),
    minuteType: z.enum(["board", "assembly"]),
    minuteNumber: z.coerce.number().int().positive(),
    minuteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de acta inválida"),
    minuteDescription: z.string().max(500).optional(),
  }),
]);
export type MinuteSelection = z.infer<typeof minuteSelectionSchema>;

export async function resolveMinuteId(
  db: Pick<PrismaClient, "minute">,
  sel: MinuteSelection,
  actorId: number,
): Promise<number> {
  if ("minuteId" in sel) return sel.minuteId;
  const [y, m, d] = sel.minuteDate.split("-").map(Number);
  try {
    const minute = await db.minute.create({
      data: {
        type: sel.minuteType, number: sel.minuteNumber, date: civilDateUtc(y, m, d),
        description: sel.minuteDescription ?? null, createdById: actorId,
      },
    });
    return minute.id;
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      throw new Error(`Ya existe el acta N° ${sel.minuteNumber} de ese tipo.`);
    }
    throw e;
  }
}
```

Run: `npx vitest run tests/minute-form.test.ts` → Expected: PASS.

- [ ] **Step 3: Server action de ABM + páginas**

```ts
// src/app/admin/actas/actions.ts
"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { civilDateUtc } from "@/lib/dates";

const schema = z.object({
  type: z.enum(["board", "assembly"]),
  number: z.coerce.number().int().positive("Número de acta inválido"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  description: z.string().max(500).optional(),
});

export async function createMinuteAction(
  _prev: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sesión inválida." };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { type, number, date, description } = parsed.data;
  const [y, m, d] = date.split("-").map(Number);
  try {
    const minute = await prisma.minute.create({
      data: { type, number, date: civilDateUtc(y, m, d), description: description ?? null, createdById: Number(session.user.id) },
    });
    await audit({ userId: Number(session.user.id), action: "minute_create", entity: "minute", entityId: minute.id });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: `Ya existe el acta N° ${number} de ese tipo.` };
    }
    throw e;
  }
  redirect("/admin/actas");
}
```

```tsx
// src/app/admin/actas/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ActasPage() {
  const minutes = await prisma.minute.findMany({
    orderBy: [{ date: "desc" }, { number: "desc" }],
    include: { _count: { select: { movements: true } } },
  });
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Actas</h1>
        <Button asChild><Link href="/admin/actas/nueva">Nueva acta</Link></Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead><TableHead>N°</TableHead><TableHead>Fecha</TableHead>
            <TableHead>Descripción</TableHead><TableHead>Movimientos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {minutes.map((m) => (
            <TableRow key={m.id}>
              <TableCell>{MINUTE_TYPE_LABELS[m.type]}</TableCell>
              <TableCell><Link className="text-primary hover:underline" href={`/admin/actas/${m.id}`}>{m.number}</Link></TableCell>
              <TableCell>{formatDateAR(m.date)}</TableCell>
              <TableCell>{m.description ?? "—"}</TableCell>
              <TableCell>{m._count.movements}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

```tsx
// src/app/admin/actas/nueva/minute-form.tsx
"use client";
import { useActionState } from "react";
import { createMinuteAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MinuteForm() {
  const [state, formAction, pending] = useActionState(createMinuteAction, {});
  return (
    <form action={formAction} className="max-w-md space-y-4">
      <div className="space-y-1">
        <Label htmlFor="type">Tipo</Label>
        <select id="type" name="type" className="h-9 w-full rounded-md border px-2 text-sm" defaultValue="board">
          <option value="board">Comisión Directiva</option>
          <option value="assembly">Asamblea</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="number">Número</Label>
        <Input id="number" name="number" type="number" min={1} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="date">Fecha</Label>
        <Input id="date" name="date" type="date" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="description">Descripción</Label>
        <Input id="description" name="description" maxLength={500} />
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Crear acta"}</Button>
    </form>
  );
}
```

```tsx
// src/app/admin/actas/nueva/page.tsx
import { MinuteForm } from "./minute-form";

export default function NuevaActaPage() {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Nueva acta</h1>
      <MinuteForm />
    </div>
  );
}
```

```tsx
// src/app/admin/actas/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS, MOVEMENT_LABELS } from "@/lib/members/labels";

export const dynamic = "force-dynamic";

export default async function ActaPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const minute = await prisma.minute.findUnique({
    where: { id: Number(id) },
    include: { movements: { include: { member: true }, orderBy: { id: "asc" } } },
  });
  if (!minute) notFound();
  return (
    <div className="space-y-4 p-6">
      <p className="text-sm text-muted-foreground"><Link href="/admin/actas" className="hover:underline">Actas</Link></p>
      <h1 className="text-2xl font-semibold">
        Acta {MINUTE_TYPE_LABELS[minute.type]} N° {minute.number} — {formatDateAR(minute.date)}
      </h1>
      {minute.description && <p>{minute.description}</p>}
      <h2 className="text-lg font-medium">Movimientos asentados</h2>
      {minute.movements.length === 0 && <p className="text-sm text-muted-foreground">Sin movimientos asociados.</p>}
      <ul className="space-y-1">
        {minute.movements.map((mv) => (
          <li key={mv.id} className="text-sm">
            {MOVEMENT_LABELS[mv.type]} — <Link className="text-primary hover:underline" href={`/admin/socios/${mv.memberId}`}>{mv.member.fullName}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// src/components/admin/minute-picker.tsx
"use client";
// Reusable "existing minute or new minute" block. Emits the field names
// expected by minuteSelectionSchema (src/lib/members/minute-form.ts).
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type MinuteOption = { id: number; label: string };

export function MinutePicker({ minutes }: { minutes: MinuteOption[] }) {
  const [mode, setMode] = useState<"existing" | "new">(minutes.length > 0 ? "existing" : "new");
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Acta</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" name="minuteMode" checked={mode === "existing"} onChange={() => setMode("existing")} disabled={minutes.length === 0} />
          Acta existente
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="minuteMode" checked={mode === "new"} onChange={() => setMode("new")} />
          Acta nueva
        </label>
      </div>
      {mode === "existing" ? (
        <select name="minuteId" className="h-9 w-full rounded-md border px-2 text-sm" required>
          {minutes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <input type="hidden" name="minuteNew" value="1" />
          <div className="space-y-1">
            <Label htmlFor="minuteType">Tipo</Label>
            <select id="minuteType" name="minuteType" className="h-9 w-full rounded-md border px-2 text-sm" defaultValue="board">
              <option value="board">Comisión Directiva</option>
              <option value="assembly">Asamblea</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="minuteNumber">Número</Label>
            <Input id="minuteNumber" name="minuteNumber" type="number" min={1} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="minuteDate">Fecha</Label>
            <Input id="minuteDate" name="minuteDate" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="minuteDescription">Descripción</Label>
            <Input id="minuteDescription" name="minuteDescription" maxLength={500} />
          </div>
        </div>
      )}
    </fieldset>
  );
}
```

Nota: cuando `mode === "existing"` los campos del modo "nueva" no se renderizan, así que el FormData solo lleva un juego de names (el union del schema resuelve bien).

- [ ] **Step 4: Verificar en el navegador**

Crear un acta desde `/admin/actas/nueva` (ej. Comisión Directiva N° 1, fecha de hoy). Expected: aparece en el listado; crearla de nuevo con el mismo tipo+número muestra el error "Ya existe el acta…".

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/actas src/components/admin/minute-picker.tsx src/lib/members/minute-form.ts tests/minute-form.test.ts src/app/admin/page.tsx
git commit -m "feat: minutes CRUD and reusable minute picker"
```

---

### Task 12: Alta manual + acciones societarias (baja, categoría, suspensión, reingreso)

**Files:**
- Create: `src/app/admin/socios/nuevo/page.tsx`, `src/app/admin/socios/nuevo/admit-form.tsx`, `src/app/admin/socios/nuevo/actions.ts`, `src/app/admin/socios/[id]/action-form.tsx`, `src/app/admin/socios/[id]/actions.ts`, `src/app/admin/socios/[id]/[accion]/page.tsx`

**Decisión de diseño (Mariano, 18/08/2026):** las cuatro acciones (baja, categoría, suspensión, reingreso) NO tienen una página cada una: viven en una sola ruta paramétrica `[accion]` con un mapa de configuración. Evita cuatro archivos casi idénticos.

**Interfaces:**
- Consumes: `memberService` (Task 8), `minuteSelectionSchema`/`resolveMinuteId` (Task 11), `MinutePicker` (Task 11), `parseForm` (Task 5), labels (Task 9), `hasArrearsDebt` (Task 8), `audit`, `auth`.
- Produces: páginas de acción operativas. Todas las server actions devuelven `{ error?: string }`, auditan (`member_admit`, `member_withdraw`, `member_category_change`, `member_suspend`, `member_suspension_end`, `member_readmit`) y redirigen a la ficha.

- [ ] **Step 1: Server actions**

```ts
// src/app/admin/socios/[id]/actions.ts
"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { civilDateUtc } from "@/lib/dates";
import { memberService } from "@/lib/members/service";
import { minuteSelectionSchema, resolveMinuteId } from "@/lib/members/minute-form";

const CATEGORIES = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"] as const;
const REASONS = ["death", "resignation", "arrears", "moved_away", "not_reregistered", "expulsion", "duplicate_annulment", "other"] as const;

type State = { error?: string };

async function actor(): Promise<number | null> {
  const session = await auth();
  return session?.user?.id ? Number(session.user.id) : null;
}

function dateFrom(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return civilDateUtc(y, m, d);
}

async function runAction(
  formData: FormData,
  extraSchema: z.ZodRawShape,
  run: (actorId: number, memberId: number, minuteId: number, data: Record<string, unknown>) => Promise<void>,
  auditAction: string,
): Promise<State> {
  const actorId = await actor();
  if (!actorId) return { error: "Sesión inválida." };
  const base = z.object({ memberId: z.coerce.number().int().positive(), ...extraSchema });
  const parsedBase = parseForm(base, formData);
  if (!parsedBase.ok) return { error: parsedBase.error };
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) return { error: "Elegí o creá el acta." };
  const memberId = parsedBase.data.memberId as number;
  try {
    const minuteId = await resolveMinuteId(prisma, sel.data, actorId);
    await run(actorId, memberId, minuteId, parsedBase.data);
    await audit({ userId: actorId, action: auditAction, entity: "member", entityId: memberId });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error inesperado." };
  }
  redirect(`/admin/socios/${memberId}`);
}

export async function withdrawAction(_p: State, formData: FormData): Promise<State> {
  return runAction(formData,
    { reason: z.enum(REASONS), detail: z.string().max(300).optional() },
    async (actorId, memberId, minuteId, data) => {
      await memberService.withdraw({ memberId, minuteId, actorId, reason: data.reason as (typeof REASONS)[number], detail: data.detail as string | undefined });
    },
    "member_withdraw");
}

export async function changeCategoryAction(_p: State, formData: FormData): Promise<State> {
  return runAction(formData,
    { newCategory: z.enum(CATEGORIES) },
    async (actorId, memberId, minuteId, data) => {
      await memberService.changeCategory({ memberId, minuteId, actorId, newCategory: data.newCategory as (typeof CATEGORIES)[number] });
    },
    "member_category_change");
}

export async function suspendAction(_p: State, formData: FormData): Promise<State> {
  return runAction(formData,
    {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha desde inválida"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha hasta inválida"),
      detail: z.string().max(300).optional(),
    },
    async (actorId, memberId, minuteId, data) => {
      await memberService.suspend({
        memberId, minuteId, actorId,
        from: dateFrom(data.from as string), to: dateFrom(data.to as string),
        detail: data.detail as string | undefined,
      });
    },
    "member_suspend");
}

export async function endSuspensionAction(_p: State, formData: FormData): Promise<State> {
  return runAction(formData, {},
    async (actorId, memberId, minuteId) => {
      await memberService.endSuspension({ memberId, minuteId, actorId });
    },
    "member_suspension_end");
}

export async function readmitAction(_p: State, formData: FormData): Promise<State> {
  return runAction(formData,
    { category: z.enum(CATEGORIES) },
    async (actorId, memberId, minuteId, data) => {
      await memberService.readmit({ memberId, minuteId, actorId, category: data.category as (typeof CATEGORIES)[number] });
    },
    "member_readmit");
}
```

```ts
// src/app/admin/socios/nuevo/actions.ts
"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { memberService } from "@/lib/members/service";
import { minuteSelectionSchema, resolveMinuteId } from "@/lib/members/minute-form";

const CATEGORIES = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"] as const;

const schema = z.object({
  fullName: z.string().min(3, "Ingresá apellido y nombre"),
  category: z.enum(CATEGORIES),
  dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números)").optional(),
  email: z.string().email("Email inválido").optional(),
});

export async function admitAction(
  _prev: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sesión inválida." };
  const actorId = Number(session.user.id);
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) return { error: "Elegí o creá el acta de admisión." };
  let memberId: number;
  try {
    const minuteId = await resolveMinuteId(prisma, sel.data, actorId);
    const member = await memberService.admit({ ...parsed.data, minuteId, actorId });
    memberId = member.id;
    await audit({ userId: actorId, action: "member_admit", entity: "member", entityId: member.id });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: "Ya existe un socio con ese DNI." };
    }
    return { error: e instanceof Error ? e.message : "Error inesperado." };
  }
  redirect(`/admin/socios/${memberId}`);
}
```

- [ ] **Step 2: Formulario cliente compartido y páginas**

```tsx
// src/app/admin/socios/[id]/action-form.tsx
"use client";
// Shared shell for statutory action forms: renders children (fields),
// the MinutePicker, the error line and the submit button.
import { useActionState, type ReactNode } from "react";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { Button } from "@/components/ui/button";

type Action = (prev: { error?: string }, fd: FormData) => Promise<{ error?: string }>;

export function ActionForm(props: {
  action: Action; memberId: number; minutes: MinuteOption[];
  submitLabel: string; children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(props.action, {});
  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <input type="hidden" name="memberId" value={props.memberId} />
      {props.children}
      <MinutePicker minutes={props.minutes} />
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : props.submitLabel}</Button>
    </form>
  );
}
```

Una sola ruta paramétrica cubre las cuatro acciones. Los campos propios de cada una se eligen con un `switch` sobre el slug; el resto (cargar socio, cargar actas, layout, `ActionForm`) se escribe una vez.

```tsx
// src/app/admin/socios/[id]/[accion]/page.tsx
// One parametric route for every statutory action: /admin/socios/7/baja,
// /categoria, /suspension, /reingreso. Each slug picks its server action,
// its copy and its extra fields; everything else is shared.
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, MINUTE_TYPE_LABELS, REASON_LABELS } from "@/lib/members/labels";
import { hasArrearsDebt } from "@/lib/members/rules";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ActionForm } from "../action-form";
import {
  changeCategoryAction, endSuspensionAction, readmitAction, suspendAction, withdrawAction,
} from "../actions";

export const dynamic = "force-dynamic";

const SLUGS = ["baja", "categoria", "suspension", "reingreso"] as const;
type Slug = (typeof SLUGS)[number];

type MemberRow = NonNullable<Awaited<ReturnType<typeof prisma.member.findUnique>>>;

type Screen = {
  title: string;
  notice?: ReactNode;
  action: Parameters<typeof ActionForm>[0]["action"];
  submitLabel: string;
  fields: ReactNode;
};

function selectField(name: string, label: string, options: [string, string][], defaultValue?: string) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <select id={name} name={name} defaultValue={defaultValue}
        className="h-9 w-full rounded-md border px-2 text-sm" required>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function detailField() {
  return (
    <div className="space-y-1">
      <Label htmlFor="detail">Detalle (opcional)</Label>
      <Input id="detail" name="detail" maxLength={300} />
    </div>
  );
}

function screenFor(slug: Slug, member: MemberRow): Screen {
  switch (slug) {
    case "baja":
      return {
        title: `Dar de baja a ${member.fullName}`,
        notice: "La baja queda asentada con acta, en el historial y en auditoría. No borra datos.",
        action: withdrawAction,
        submitLabel: "Registrar baja",
        fields: (
          <>
            {selectField("reason", "Motivo (catálogo REG-18)", Object.entries(REASON_LABELS))}
            {detailField()}
          </>
        ),
      };
    case "categoria":
      return {
        title: `Cambiar categoría de ${member.fullName}`,
        notice: `Categoría actual: ${CATEGORY_LABELS[member.category]}. El cambio no interrumpe la antigüedad (Art. 5° ter).`,
        action: changeCategoryAction,
        submitLabel: "Cambiar categoría",
        fields: selectField(
          "newCategory", "Nueva categoría",
          Object.entries(CATEGORY_LABELS).filter(([v]) => v !== member.category),
        ),
      };
    case "suspension":
      return member.status === "suspended"
        ? {
            title: `Levantar la suspensión de ${member.fullName}`,
            notice: `Suspendido desde ${member.suspendedFrom ? formatDateAR(member.suspendedFrom) : "—"} hasta ${member.suspendedTo ? formatDateAR(member.suspendedTo) : "—"}.`,
            action: endSuspensionAction,
            submitLabel: "Levantar suspensión",
            fields: null,
          }
        : {
            title: `Suspender a ${member.fullName}`,
            notice: "La suspensión no puede exceder 180 días (Art. 10 inc. b).",
            action: suspendAction,
            submitLabel: "Suspender",
            fields: (
              <>
                <div className="space-y-1">
                  <Label htmlFor="from">Desde</Label>
                  <Input id="from" name="from" type="date" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="to">Hasta</Label>
                  <Input id="to" name="to" type="date" required />
                </div>
                {detailField()}
              </>
            ),
          };
    case "reingreso":
      return {
        title: `Reingreso de ${member.fullName}`,
        notice: hasArrearsDebt(member) ? (
          <span className="block rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">
            Cesante por mora con deuda: para reingresar debe saldar la totalidad de la deuda a valores
            vigentes (Art. 9 inc. c). El cálculo del monto estará disponible con el Módulo 4 — registrá
            el cobro en tesorería papel antes de confirmar.
          </span>
        ) : undefined,
        action: readmitAction,
        submitLabel: "Registrar reingreso",
        fields: selectField("category", "Categoría de reingreso", Object.entries(CATEGORY_LABELS), member.category),
      };
  }
}

export default async function AccionPage(props: { params: Promise<{ id: string; accion: string }> }) {
  const { id, accion } = await props.params;
  if (!SLUGS.includes(accion as Slug)) notFound();
  const member = await prisma.member.findUnique({ where: { id: Number(id) } });
  if (!member) notFound();
  const minutes = (await prisma.minute.findMany({ orderBy: [{ date: "desc" }], take: 30 }))
    .map((m) => ({ id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}` }));
  const screen = screenFor(accion as Slug, member);

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{screen.title}</h1>
      {screen.notice && <div className="text-sm text-muted-foreground">{screen.notice}</div>}
      <ActionForm action={screen.action} memberId={member.id} minutes={minutes} submitLabel={screen.submitLabel}>
        {screen.fields}
      </ActionForm>
    </div>
  );
}
```

```tsx
// src/app/admin/socios/nuevo/admit-form.tsx
"use client";
import { useActionState } from "react";
import { admitAction } from "./actions";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORY_LABELS } from "@/lib/members/labels";

export function AdmitForm({ minutes }: { minutes: MinuteOption[] }) {
  const [state, formAction, pending] = useActionState(admitAction, {});
  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-1">
        <Label htmlFor="fullName">Apellido y nombre</Label>
        <Input id="fullName" name="fullName" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="category">Categoría</Label>
        <select id="category" name="category" className="h-9 w-full rounded-md border px-2 text-sm" required>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="dni">DNI (opcional)</Label>
        <Input id="dni" name="dni" inputMode="numeric" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email (opcional)</Label>
        <Input id="email" name="email" type="email" />
      </div>
      <MinutePicker minutes={minutes} />
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Dar de alta"}</Button>
    </form>
  );
}
```

```tsx
// src/app/admin/socios/nuevo/page.tsx
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { AdmitForm } from "./admit-form";

export const dynamic = "force-dynamic";

export default async function NuevoSocioPage() {
  const minutes = (await prisma.minute.findMany({ orderBy: [{ date: "desc" }], take: 30 }))
    .map((m) => ({ id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}` }));
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Alta manual de socio</h1>
      <p className="text-sm text-muted-foreground">
        El número de socio se asigna automáticamente (siguiente del libro abierto) y la fecha de ingreso
        es la fecha del acta de admisión (REG-11). El resto de la ficha se completa después en modo carga.
      </p>
      <AdmitForm minutes={minutes} />
    </div>
  );
}
```

- [ ] **Step 3: Verificar en el navegador**

1. Alta manual (categoría Cadete, con acta nueva) → redirige a la ficha; N° asignado = 306; `joinedAt` = fecha del acta.
2. Cambio de categoría sobre ese socio → historial muestra "Cambio de categoría · Cadete → Adherente" con acta.
3. Poner `elecciones_en_curso=true` (`npx tsx -e "import {prisma} from './src/lib/prisma'; prisma.configuration.update({where:{key:'elecciones_en_curso'},data:{value:true}}).then(()=>prisma.$disconnect())"`) → el cambio de categoría muestra el error de elecciones. Restaurar a `false` igual.
4. Baja con motivo Expulsión → la ficha muestra "Reingreso bloqueado" y la página de reingreso rechaza con el mensaje de expulsión.
5. Verificar auditoría: `npx tsx -e "import {prisma} from './src/lib/prisma'; prisma.auditLog.findMany({orderBy:{id:'desc'},take:5}).then(r=>{console.log(r.map(x=>x.action)); return prisma.$disconnect();})"` → acciones `member_*`.

- [ ] **Step 4: Suite + typecheck + commit**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/app/admin/socios
git commit -m "feat: manual admission and statutory member actions with minutes"
```

---

### Task 13: Modo carga de fichas + autocompletado de calles + envío de verificación

**Files:**
- Create: `src/app/admin/socios/carga/[numero]/page.tsx`, `src/app/admin/socios/carga/[numero]/carga-form.tsx`, `src/app/admin/socios/carga/[numero]/actions.ts`, `src/components/admin/street-autocomplete.tsx`

**Interfaces:**
- Consumes: `normalizeStreetName` (Task 2, funciona en cliente), `parseForm` (Task 5), `tokens` (Task 6), `mailer` + `verificationEmail` (Task 7), labels (Task 9), `audit`, `auth`.
- Produces:
  - `updateMemberAction(prev, formData)` — edita SOLO datos de ficha (nunca `joinedAt`, `status`, `category`); devuelve `{ error?: string; saved?: true }`.
  - `sendVerificationAction(prev, formData)` — emite token `email_verification`, manda `verificationEmail` con URL `${AUTH_URL}/verificar/<token>`, audita `member_send_verification`; devuelve `{ error?: string; sent?: true }`.
  - `StreetAutocomplete` (client): props `{ streets: Array<{ id: number; name: string; loadOrder: number }>; defaultStreetId: number | null; defaultStreetText: string | null }`; emite `streetId` (hidden) o `streetText`; matchea por `normalizedName` y por `loadOrder`.

- [ ] **Step 1: Server actions**

```ts
// src/app/admin/socios/carga/[numero]/actions.ts
"use server";
import { z } from "zod";
import { auth } from "@/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { civilDateUtc } from "@/lib/dates";
import { tokens } from "@/lib/tokens";
import { mailer } from "@/lib/email";
import { verificationEmail } from "@/lib/email/templates";

const schema = z.object({
  memberId: z.coerce.number().int().positive(),
  fullName: z.string().min(3, "Ingresá apellido y nombre"),
  dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números)").optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de nacimiento inválida").optional(),
  civilStatus: z.string().max(40).optional(),
  nationality: z.string().max(60).optional(),
  occupation: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  streetId: z.coerce.number().int().positive().optional(),
  streetText: z.string().max(120).optional(),
  streetNumber: z.string().max(10).optional(),
  neighborhood: z.string().max(60).optional(),
  email: z.string().email("Email inválido").optional(),
});

export type SaveState = { error?: string; saved?: boolean };

export async function updateMemberAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sesión inválida." };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;
  const member = await prisma.member.findUnique({ where: { id: d.memberId } });
  if (!member) return { error: "Socio inexistente." };

  const email = d.email?.toLowerCase() ?? null;
  const emailChanged = email !== member.email;
  let birthDate: Date | null = null;
  if (d.birthDate) {
    const [y, m, day] = d.birthDate.split("-").map(Number);
    birthDate = civilDateUtc(y, m, day);
  }
  try {
    await prisma.member.update({
      where: { id: member.id },
      data: {
        fullName: d.fullName, dni: d.dni ?? null, birthDate,
        civilStatus: d.civilStatus ?? null, nationality: d.nationality ?? null,
        occupation: d.occupation ?? null, phone: d.phone ?? null,
        streetId: d.streetId ?? null,
        streetText: d.streetId ? null : d.streetText ?? null,
        streetNumber: d.streetNumber ?? null, neighborhood: d.neighborhood ?? null,
        email,
        // email nuevo o cambiado vuelve a "declared"; borrado → "none"; sin cambios → intacto
        emailStatus: emailChanged ? (email ? "declared" : "none") : member.emailStatus,
        emailVerifiedAt: emailChanged ? null : member.emailVerifiedAt,
      },
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: "Ya existe otro socio con ese DNI." };
    }
    throw e;
  }
  await audit({ userId: Number(session.user.id), action: "member_update", entity: "member", entityId: member.id });
  return { saved: true };
}

export type SendState = { error?: string; sent?: boolean };

export async function sendVerificationAction(_prev: SendState, formData: FormData): Promise<SendState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sesión inválida." };
  const memberId = Number(formData.get("memberId"));
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member?.email) return { error: "El socio no tiene email cargado. Guardá la ficha primero." };
  if (member.emailStatus === "verified") return { error: "El email ya está verificado." };
  const raw = await tokens.issue({ purpose: "email_verification", memberId: member.id });
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  await mailer.sendToMember({
    memberId: member.id, to: member.email, type: "email_verification",
    message: verificationEmail({ name: member.fullName, url: `${base}/verificar/${raw}` }),
    summary: "verificación de email + invitación de acceso",
  });
  await audit({ userId: Number(session.user.id), action: "member_send_verification", entity: "member", entityId: member.id });
  return { sent: true };
}
```

- [ ] **Step 2: Autocompletado de calle**

```tsx
// src/components/admin/street-autocomplete.tsx
"use client";
// Matches by normalized name ("hernandez" → "Hernandez , Jose") and by
// loadOrder ("1906"). Falls back to free text for out-of-neighborhood addresses.
import { useMemo, useState } from "react";
import { normalizeStreetName } from "@/lib/streets/normalize";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type StreetOption = { id: number; name: string; loadOrder: number };

export function StreetAutocomplete(props: {
  streets: StreetOption[];
  defaultStreetId: number | null;
  defaultStreetText: string | null;
}) {
  const initial = props.streets.find((s) => s.id === props.defaultStreetId);
  const [freeMode, setFreeMode] = useState(!initial && !!props.defaultStreetText);
  const [selected, setSelected] = useState<StreetOption | null>(initial ?? null);
  const [query, setQuery] = useState(initial?.name ?? "");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return props.streets.slice(0, 10);
    const qn = normalizeStreetName(q);
    return props.streets
      .filter((s) => normalizeStreetName(s.name).includes(qn) || String(s.loadOrder).startsWith(q))
      .slice(0, 10);
  }, [props.streets, query]);

  if (freeMode) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="streetText">Calle (fuera del barrio)</Label>
          <button type="button" className="text-xs text-primary hover:underline"
            onClick={() => { setFreeMode(false); setQuery(""); }}>
            Usar catálogo del barrio
          </button>
        </div>
        <Input id="streetText" name="streetText" defaultValue={props.defaultStreetText ?? ""} />
      </div>
    );
  }

  return (
    <div className="relative space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor="street-search">Calle (catálogo)</Label>
        <button type="button" className="text-xs text-primary hover:underline"
          onClick={() => { setFreeMode(true); setSelected(null); }}>
          Está en otro barrio
        </button>
      </div>
      {selected && <input type="hidden" name="streetId" value={selected.id} />}
      <Input
        id="street-search" autoComplete="off" value={query}
        placeholder="Nombre o código (ej. hernandez, 1906)"
        onChange={(e) => { setQuery(e.target.value); setSelected(null); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && !selected && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow">
          {matches.map((s) => (
            <li key={s.id}>
              <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={() => { setSelected(s); setQuery(s.name); setOpen(false); }}>
                {s.name} <span className="text-muted-foreground">({s.loadOrder})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Formulario de carga con Ctrl+S y navegación**

```tsx
// src/app/admin/socios/carga/[numero]/carga-form.tsx
"use client";
import { useActionState, useEffect, useRef } from "react";
import { sendVerificationAction, updateMemberAction, type SaveState, type SendState } from "./actions";
import { StreetAutocomplete, type StreetOption } from "@/components/admin/street-autocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MemberData = {
  id: number; fullName: string; dni: string | null; birthDate: string | null;
  civilStatus: string | null; nationality: string | null; occupation: string | null;
  phone: string | null; streetId: number | null; streetText: string | null;
  streetNumber: string | null; neighborhood: string | null; email: string | null;
  emailStatus: string;
};

function F(props: { name: string; label: string; defaultValue: string | null; type?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input id={props.name} name={props.name} type={props.type ?? "text"} defaultValue={props.defaultValue ?? ""} />
    </div>
  );
}

export function CargaForm({ member, streets }: { member: MemberData; streets: StreetOption[] }) {
  const [saveState, saveAction, saving] = useActionState<SaveState, FormData>(updateMemberAction, {});
  const [sendState, sendAction, sending] = useActionState<SendState, FormData>(sendVerificationAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-6">
      <form ref={formRef} action={saveAction} className="grid max-w-3xl grid-cols-2 gap-4">
        <input type="hidden" name="memberId" value={member.id} />
        <F name="fullName" label="Apellido y nombre" defaultValue={member.fullName} />
        <F name="dni" label="DNI" defaultValue={member.dni} />
        <F name="birthDate" label="Fecha de nacimiento" defaultValue={member.birthDate} type="date" />
        <F name="civilStatus" label="Estado civil" defaultValue={member.civilStatus} />
        <F name="nationality" label="Nacionalidad" defaultValue={member.nationality} />
        <F name="occupation" label="Ocupación" defaultValue={member.occupation} />
        <F name="phone" label="Teléfono" defaultValue={member.phone} />
        <F name="email" label="Email" defaultValue={member.email} type="email" />
        <StreetAutocomplete streets={streets} defaultStreetId={member.streetId} defaultStreetText={member.streetText} />
        <F name="streetNumber" label="Altura" defaultValue={member.streetNumber} />
        <F name="neighborhood" label="Barrio" defaultValue={member.neighborhood} />
        <div className="col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar (Ctrl+S)"}</Button>
          {saveState.saved && <span className="text-sm text-green-700">Guardado ✓</span>}
          {saveState.error && <span role="alert" className="text-sm text-destructive">{saveState.error}</span>}
        </div>
      </form>

      <form action={sendAction} className="flex items-center gap-3">
        <input type="hidden" name="memberId" value={member.id} />
        <Button type="submit" variant="outline" disabled={sending || !member.email || member.emailStatus === "verified"}>
          {sending ? "Enviando…" : "Enviar verificación + invitación de acceso"}
        </Button>
        {member.emailStatus === "verified" && <span className="text-sm text-green-700">Email verificado ✓</span>}
        {sendState.sent && <span className="text-sm text-green-700">Enviado ✓</span>}
        {sendState.error && <span role="alert" className="text-sm text-destructive">{sendState.error}</span>}
      </form>
    </div>
  );
}
```

```tsx
// src/app/admin/socios/carga/[numero]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { formatDateAR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CargaForm } from "./carga-form";

export const dynamic = "force-dynamic";

export default async function CargaPage(props: { params: Promise<{ numero: string }> }) {
  const numero = Number((await props.params).numero);
  const book = await prisma.book.findFirst({ where: { status: "open" } });
  if (!book) notFound();
  const membership = await prisma.membership.findUnique({
    where: { bookId_memberNumber: { bookId: book.id, memberNumber: numero } },
    include: { member: true },
  });
  if (!membership) notFound();
  const m = membership.member;

  const [prev, next, streets] = await Promise.all([
    prisma.membership.findFirst({
      where: { bookId: book.id, memberNumber: { lt: numero } },
      orderBy: { memberNumber: "desc" }, select: { memberNumber: true },
    }),
    prisma.membership.findFirst({
      where: { bookId: book.id, memberNumber: { gt: numero } },
      orderBy: { memberNumber: "asc" }, select: { memberNumber: true },
    }),
    prisma.street.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, loadOrder: true } }),
  ]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/socios" className="hover:underline">Socios</Link> / Modo carga
          </p>
          <h1 className="text-2xl font-semibold">N° {numero} — {m.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {CATEGORY_LABELS[m.category]} · {STATUS_LABELS[m.status]} · Ingreso {formatDateAR(m.joinedAt)} ·{" "}
            <Link className="text-primary hover:underline" href={`/admin/socios/${m.id}`}>ver ficha</Link>
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" disabled={!prev}>
            <Link href={prev ? `/admin/socios/carga/${prev.memberNumber}` : "#"}>← {prev?.memberNumber ?? ""}</Link>
          </Button>
          <Button asChild variant="outline" disabled={!next}>
            <Link href={next ? `/admin/socios/carga/${next.memberNumber}` : "#"}>{next?.memberNumber ?? ""} →</Link>
          </Button>
        </div>
      </div>
      <CargaForm
        member={{
          id: m.id, fullName: m.fullName, dni: m.dni,
          birthDate: m.birthDate ? m.birthDate.toISOString().slice(0, 10) : null,
          civilStatus: m.civilStatus, nationality: m.nationality, occupation: m.occupation,
          phone: m.phone, streetId: m.streetId, streetText: m.streetText,
          streetNumber: m.streetNumber, neighborhood: m.neighborhood,
          email: m.email, emailStatus: m.emailStatus,
        }}
        streets={streets}
      />
    </div>
  );
}
```

- [ ] **Step 4: Verificar en el navegador**

1. `/admin/socios/carga/14` → ficha del socio 14 con datos. "1906" y "hernandez" encuentran "Hernandez , Jose" en el autocompletado.
2. Ctrl+S guarda ("Guardado ✓"); la navegación 13 ← / → 15 salta huecos (ej. desde 20 el siguiente es 22).
3. Cargar un email y "Enviar verificación" → en consola dev aparece `[mail:dev]` con la URL `/verificar/...` y en la ficha la notificación queda registrada.
4. Cronometrar una carga completa de ficha: objetivo < 2 minutos (CA #2).

- [ ] **Step 5: Suite + typecheck + commit**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/app/admin/socios/carga src/components/admin/street-autocomplete.tsx
git commit -m "feat: rapid record-entry mode with street autocomplete and verification email"
```

---

### Task 14: Verificación de email + creación de contraseña (flujos públicos)

**Files:**
- Create: `src/app/(public)/verificar/[token]/page.tsx`, `src/app/(public)/verificar/[token]/confirm-form.tsx`, `src/app/(public)/verificar/[token]/actions.ts`, `src/app/(public)/acceso/[token]/page.tsx`, `src/app/(public)/acceso/[token]/password-form.tsx`, `src/app/(public)/acceso/[token]/actions.ts`

**Interfaces:**
- Consumes: `tokens` (Task 6: `peek`/`consume`/`issue`), `validatePassword`/`BCRYPT_COST` (`src/lib/auth/password.ts`), `audit`, `prisma`.
- Produces: flujo completo — el socio abre `/verificar/<token>`, confirma con un botón (el GET solo hace `peek`: los scanners de email no consumen el token), el email queda `verified`, y si no tiene usuario se lo redirige a `/acceso/<token2>` donde crea su contraseña → se crea `User` con rol `socio` vinculado al `Member`.

**Diseño anti-scanner:** NUNCA consumir tokens en un GET. Las páginas hacen `tokens.peek(...)` para renderizar; el `consume` ocurre en la server action del botón/formulario.

- [ ] **Step 1: Página y acción de verificación**

```ts
// src/app/(public)/verificar/[token]/actions.ts
"use server";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";

export async function confirmEmailAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const raw = String(formData.get("token") ?? "");
  const t = await tokens.consume(raw, "email_verification");
  if (!t?.memberId) return { error: "El enlace venció o ya fue usado. Pedí a la vecinal que te lo reenvíe." };
  const member = await prisma.member.update({
    where: { id: t.memberId },
    data: { emailStatus: "verified", emailVerifiedAt: new Date() },
  });
  await audit({ action: "member_email_verified", entity: "member", entityId: member.id });
  if (!member.userId) {
    const invite = await tokens.issue({ purpose: "password_invitation", memberId: member.id });
    redirect(`/acceso/${invite}`);
  }
  redirect("/ingresar");
}
```

```tsx
// src/app/(public)/verificar/[token]/confirm-form.tsx
"use client";
import { useActionState } from "react";
import { confirmEmailAction } from "./actions";
import { Button } from "@/components/ui/button";

export function ConfirmForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(confirmEmailAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Confirmando…" : "Confirmar mi email"}</Button>
    </form>
  );
}
```

```tsx
// src/app/(public)/verificar/[token]/page.tsx
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { ConfirmForm } from "./confirm-form";

export const dynamic = "force-dynamic";

export default async function VerificarPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const t = await tokens.peek(token, "email_verification");
  const member = t?.memberId ? await prisma.member.findUnique({ where: { id: t.memberId } }) : null;
  return (
    <div className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Verificación de email</h1>
      {member ? (
        <>
          <p>Hola <strong>{member.fullName}</strong>: confirmá que <strong>{member.email}</strong> es tu domicilio electrónico ante la Vecinal Ciudadela.</p>
          <ConfirmForm token={token} />
        </>
      ) : (
        <p role="alert">El enlace venció o ya fue usado. Pedí a la vecinal que te lo reenvíe.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Página y acción de creación de contraseña**

```ts
// src/app/(public)/acceso/[token]/actions.ts
"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { BCRYPT_COST, validatePassword } from "@/lib/auth/password";

export async function createPasswordAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const raw = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const check = validatePassword(password);
  if (!check.ok) return { error: check.error };
  if (password !== confirm) return { error: "Las contraseñas no coinciden." };

  const t = await tokens.consume(raw, "password_invitation");
  if (!t?.memberId) return { error: "El enlace venció o ya fue usado. Pedí a la vecinal que te lo reenvíe." };
  const member = await prisma.member.findUnique({ where: { id: t.memberId } });
  if (!member?.email) return { error: "El socio no tiene email registrado." };

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const socioRole = await prisma.role.findUniqueOrThrow({ where: { name: "socio" } });

  const existing = await prisma.user.findUnique({ where: { email: member.email } });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } })
    : await prisma.user.create({ data: { email: member.email, passwordHash, name: member.fullName } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: socioRole.id } },
    create: { userId: user.id, roleId: socioRole.id },
    update: {},
  });
  await prisma.member.update({ where: { id: member.id }, data: { userId: user.id } });
  await audit({ userId: user.id, action: "member_user_created", entity: "member", entityId: member.id });
  redirect("/ingresar");
}
```

```tsx
// src/app/(public)/acceso/[token]/password-form.tsx
"use client";
import { useActionState } from "react";
import { createPasswordAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(createPasswordAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1">
        <Label htmlFor="password">Contraseña (mínimo 8 caracteres)</Label>
        <Input id="password" name="password" type="password" required minLength={8} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">Repetí la contraseña</Label>
        <Input id="confirm" name="confirm" type="password" required minLength={8} />
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Creando…" : "Crear contraseña e ingresar"}</Button>
    </form>
  );
}
```

```tsx
// src/app/(public)/acceso/[token]/page.tsx
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function AccesoPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const t = await tokens.peek(token, "password_invitation");
  const member = t?.memberId ? await prisma.member.findUnique({ where: { id: t.memberId } }) : null;
  return (
    <div className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Creá tu contraseña</h1>
      {member ? (
        <>
          <p>Hola <strong>{member.fullName}</strong>: creá tu contraseña para acceder al panel de socios con <strong>{member.email}</strong>.</p>
          <PasswordForm token={token} />
        </>
      ) : (
        <p role="alert">El enlace venció o ya fue usado. Pedí a la vecinal que te lo reenvíe.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar el circuito completo en el navegador**

1. En modo carga, cargar tu email real de prueba a un socio y "Enviar verificación".
2. Tomar la URL `/verificar/...` del `[mail:dev]` de la consola. Abrirla en ventana de incógnito → botón "Confirmar mi email" → redirige a `/acceso/...`.
3. Crear contraseña → redirige a `/ingresar` → loguearse → entra a `/mi` (tarjetas "Próximamente" — esperado).
4. Reabrir la URL de verificación usada → mensaje de enlace vencido.
5. En la ficha admin: email "Verificado", notificación registrada, auditoría con `member_email_verified` y `member_user_created`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(public)/verificar" "src/app/(public)/acceso"
git commit -m "feat: public email verification and password invitation flows"
```

---

### Task 15: Recupero de contraseña

**Files:**
- Create: `src/app/(public)/ingresar/recuperar/page.tsx`, `src/app/(public)/ingresar/recuperar/recover-form.tsx`, `src/app/(public)/ingresar/recuperar/actions.ts`, `src/app/(public)/ingresar/restablecer/[token]/page.tsx`, `src/app/(public)/ingresar/restablecer/[token]/reset-form.tsx`, `src/app/(public)/ingresar/restablecer/[token]/actions.ts`
- Modify: `src/app/(public)/ingresar/login-form.tsx` (agregar link "¿Olvidaste tu contraseña?" → `/ingresar/recuperar`)

**Interfaces:**
- Consumes: `tokens`, `getTransport` + `passwordResetEmail` (Task 7), `ipLimiter` (`src/lib/auth/rate-limiter.ts`), `validatePassword`/`BCRYPT_COST`, `audit`.
- Produces: recupero completo con token de 30 min de un solo uso. La respuesta del formulario es SIEMPRE la misma exista o no el email (no filtrar existencia de cuentas).

- [ ] **Step 1: Acción de solicitud**

```ts
// src/app/(public)/ingresar/recuperar/actions.ts
"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { tokens } from "@/lib/tokens";
import { getTransport } from "@/lib/email/transport";
import { passwordResetEmail } from "@/lib/email/templates";
import { ipLimiter } from "@/lib/auth/rate-limiter";

const schema = z.object({ email: z.string().email("Email inválido") });
const DONE = { done: true as const };

export async function recoverAction(
  _prev: { done?: boolean; error?: string }, formData: FormData,
): Promise<{ done?: boolean; error?: string }> {
  // Misma política de IP que el login: solo x-real-ip (seteado por Nginx).
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  if (!ipLimiter.check(ip)) return { error: "Demasiados intentos. Probá de nuevo en unos minutos." };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const email = parsed.data.email.toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.active) {
    const raw = await tokens.issue({ purpose: "password_reset", userId: user.id });
    const base = process.env.AUTH_URL ?? "http://localhost:3000";
    await getTransport().send({ to: email, ...passwordResetEmail({ url: `${base}/ingresar/restablecer/${raw}` }) });
    await audit({ userId: user.id, action: "password_reset_requested", ip });
  }
  return DONE; // idéntica respuesta exista o no la cuenta
}
```

- [ ] **Step 2: Acción de restablecimiento**

```ts
// src/app/(public)/ingresar/restablecer/[token]/actions.ts
"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { BCRYPT_COST, validatePassword } from "@/lib/auth/password";

export async function resetPasswordAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const raw = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const check = validatePassword(password);
  if (!check.ok) return { error: check.error };
  if (password !== confirm) return { error: "Las contraseñas no coinciden." };
  const t = await tokens.consume(raw, "password_reset");
  if (!t?.userId) return { error: "El enlace venció o ya fue usado. Pedí uno nuevo." };
  await prisma.user.update({
    where: { id: t.userId },
    data: { passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
  });
  await audit({ userId: t.userId, action: "password_reset_completed" });
  redirect("/ingresar");
}
```

- [ ] **Step 3: Páginas y formularios**

`recover-form.tsx` y `reset-form.tsx` siguen EXACTAMENTE el patrón de `password-form.tsx` de la Task 14 (useActionState + hidden token donde aplique). `recuperar/page.tsx` es estática (título "Recuperar contraseña", texto "Te enviamos un enlace si el email corresponde a una cuenta", y tras `state.done` muestra: "Si el email existe, te enviamos un enlace para restablecer la contraseña. Vence en 30 minutos."). `restablecer/[token]/page.tsx` hace `tokens.peek(raw, "password_reset")` y muestra el formulario o el mensaje de vencido, igual que `acceso/[token]/page.tsx`.

En `login-form.tsx`, debajo del botón de submit agregar:

```tsx
<p className="text-center text-sm">
  <Link href="/ingresar/recuperar" className="text-primary hover:underline">¿Olvidaste tu contraseña?</Link>
</p>
```

(con `import Link from "next/link";` arriba).

- [ ] **Step 4: Verificar en el navegador**

1. `/ingresar/recuperar` con el email del superadmin → consola muestra `[mail:dev]` con URL; con un email inexistente → misma pantalla de éxito, sin email en consola.
2. Abrir la URL, poner contraseña nueva → redirige a login → entra con la nueva.
3. Reusar la URL → "enlace vencido o usado".

- [ ] **Step 5: Suite + commit**

Run: `npm test && npx tsc --noEmit` → Expected: PASS.

```bash
git add "src/app/(public)/ingresar"
git commit -m "feat: password recovery with single-use 30-minute tokens"
```

---

### Task 16: Export Excel del padrón

**Files:**
- Create: `src/app/api/admin/padron-export/route.ts`

**Interfaces:**
- Consumes: `parsePadronFilters`/`fetchPadron` (Task 9 — mismos filtros que el listado), labels (Task 9), `formatDateAR`, `auth`, `audit`, exceljs.
- Produces: `GET /api/admin/padron-export?q=&category=&status=&email=&dni=` → descarga `padron-libro-1.xlsx` (403 sin rol admin/superadmin).

- [ ] **Step 1: Implementar la route**

```ts
// src/app/api/admin/padron-export/route.ts
import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { fetchPadron, parsePadronFilters } from "@/lib/members/query";
import { CATEGORY_LABELS, EMAIL_STATUS_LABELS, REASON_LABELS, STATUS_LABELS } from "@/lib/members/labels";

export async function GET(req: NextRequest) {
  const session = await auth();
  const roles = session?.user?.roles ?? [];
  if (!session?.user?.id || (!roles.includes("admin") && !roles.includes("superadmin"))) {
    return new Response("No autorizado", { status: 403 });
  }
  const filters = parsePadronFilters(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const rows = await fetchPadron(prisma, filters);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("padron");
  ws.columns = [
    { header: "numero_socio", key: "n", width: 12 },
    { header: "apellido_nombre", key: "name", width: 32 },
    { header: "dni", key: "dni", width: 12 },
    { header: "categoria", key: "cat", width: 14 },
    { header: "estado", key: "st", width: 12 },
    { header: "email", key: "email", width: 30 },
    { header: "email_estado", key: "es", width: 14 },
    { header: "telefono", key: "phone", width: 16 },
    { header: "domicilio", key: "addr", width: 30 },
    { header: "barrio", key: "nb", width: 16 },
    { header: "fecha_ingreso", key: "in", width: 14 },
    { header: "fecha_egreso", key: "out", width: 14 },
    { header: "motivo_baja", key: "reason", width: 22 },
    { header: "deuda_tesoreria", key: "debt", width: 14 },
    { header: "debito_automatico", key: "ad", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const { memberNumber, member } of rows) {
    ws.addRow({
      n: memberNumber, name: member.fullName, dni: member.dni ?? "",
      cat: CATEGORY_LABELS[member.category], st: STATUS_LABELS[member.status],
      email: member.email ?? "", es: EMAIL_STATUS_LABELS[member.emailStatus],
      phone: member.phone ?? "",
      addr: [member.streetText, member.streetNumber].filter(Boolean).join(" "),
      nb: member.neighborhood ?? "",
      in: formatDateAR(member.joinedAt),
      out: member.leftAt ? formatDateAR(member.leftAt) : "",
      reason: member.withdrawalReason ? REASON_LABELS[member.withdrawalReason] : "",
      debt: member.debtAtWithdrawal ? "Sí" : "No",
      ad: member.autoDebit ? "Sí" : "No",
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  await audit({
    userId: Number(session.user.id), action: "padron_export",
    detail: { filters, rows: rows.length },
  });
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="padron-libro-1.xlsx"',
    },
  });
}
```

Nota: el domicilio exporta `streetText`/`streetNumber`; para socios con `streetId` del catálogo, `fetchPadron` no incluye la relación — agregar en `query.ts` el `include: { member: { include: { street: true } } }` y en el route usar `member.street?.name ?? member.streetText`. Hacer ese ajuste tipado en `query.ts` (el tipo de retorno pasa a incluir `street`).

- [ ] **Step 2: Verificar**

Con sesión admin, abrir `/admin/socios?status=active` → "Exportar Excel". Expected: descarga con 160 filas + encabezado; abrirlo en Excel y chequear tildes (Ñiripil, Agüero) y fechas DD/MM/AAAA. Sin sesión (incógnito): 403.

- [ ] **Step 3: Suite + commit**

Run: `npm test && npx tsc --noEmit` → Expected: PASS.

```bash
git add src/app/api/admin/padron-export src/lib/members/query.ts
git commit -m "feat: filtered padron excel export"
```

---

### Task 17: Actualización de documentación

**Files:**
- Modify: `docs/02-marco-estatutario.md` (REG-35), `docs/04-modelo-de-datos.md` (Socio + import), `docs/07-plan-de-etapas.md` (CA M1 + ideas nuevas en M3/M4/M5), `CLAUDE.md` (sección "Datos incluidos")

- [ ] **Step 1: docs/02 — REG-35**

Localizar el texto de REG-35 y reemplazar la parte de numeración por:

> numeración 1-305 con **22 huecos**: 12 anulados por duplicidad (21, 71, 72, 73, 93, 94, 95, 97, 125, 147, 238, 254), 8 fichas extraviadas que se desestiman (199, 208, 214, 221, 222, 223, 224, 245) y 2 duplicados eliminados en la carga definitiva del 18/08/2026 (132, 263) — estos números simplemente no existen en el libro. Total: **283 registros** (160 vigentes: 55 activos + 105 adherentes; 123 bajas).

- [ ] **Step 2: docs/04 — entidad Socio e importación**

En la entidad Socio, agregar a los flags:

> - `debt_at_withdrawal` (boolean): tenía deuda de tesorería al momento de la baja (columna `deuda_tesoreria` del padrón). Lo usa el Módulo 3 para bloquear el re-ingreso web de cesantes por mora con deuda; el Módulo 4 lo reemplaza por la cuenta corriente real.
> - `auto_debit` (boolean): candidato a vincular suscripción MP preexistente (columna `debito_automatico` del padrón, ver 06).

En la sección de importación inicial, actualizar los números (283 registros, 22 huecos) y agregar:

> Estado real del archivo (18/08/2026): 283 filas con DNI casi completo (faltan socios 287 y 288), emails ~36, resto de la ficha a completar desde el panel. `fecha_ingreso` es la fecha oficial del libro a todos los efectos (decisión: no se recaptura de las fichas papel).

- [ ] **Step 3: docs/07 — CA del M1 + ideas nuevas**

1. En el Módulo 1, reemplazar en el CA "285 registros ... 20 huecos" por "283 registros importados con sus números originales y los 22 huecos correctos".
2. Agregar al Módulo 3: "Bloqueo del botón ASOCIATE por estado: socio vigente → 'ya estás asociado'; ex socio con `debt_at_withdrawal` → mensaje 'acercate a la sede vecinal' sin permitir continuar. Resumen mensual de socios aceptados para confeccionar el acta."
3. Agregar al Módulo 4: "Recibo automático por email para débitos acreditados; registro de pago en efectivo con comprobante automático por email; notificación del 30 de cada mes a socios con cuotas adeudadas (cantidad de cuotas, fehaciente); resumen diario 9:00 a la Comisión con las novedades del día anterior (si no hubo, no se envía); export Padrón electoral (REG-31, diferido del M1)."
4. Agregar al Módulo 5: "El socio ve cuántas cuotas debe; puede solicitar cambio de categoría solo sin deuda de tesorería (REG-07)."

- [ ] **Step 4: CLAUDE.md — datos**

Reemplazar la línea de `datos/padron_socios.xlsx`:

> - `datos/padron_socios.xlsx` — padrón definitivo del Libro N° 1 (283 filas, numeración 1-305 con 22 huecos; DNIs completos salvo socios 287/288). Importado por `scripts/import-padron.ts`; el resto de la ficha se completa desde el panel. Ver `docs/04-modelo-de-datos.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/02-marco-estatutario.md docs/04-modelo-de-datos.md docs/07-plan-de-etapas.md CLAUDE.md
git commit -m "docs: sync statute regs, data model and roadmap with final padron and new ideas"
```

---

### Task 18: Verificación final del módulo

**REQUIRED SUB-SKILL en esta task:** superpowers:verification-before-completion — nada se declara terminado sin evidencia.

- [ ] **Step 1: Suite completa + typecheck + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todos los tests PASS (los 29 del M0 + los nuevos), 0 errores TS, build OK.

- [ ] **Step 2: Checklist de criterios de aceptación (spec §11) con evidencia**

Con `npm run dev` corriendo y sesión admin:

1. **CA1 — Import:** `npx tsx scripts/import-padron.ts` re-ejecutado: `creados: 0 | actualizados: 283`, huecos 22 correctos. ✔/✘
2. **CA2 — Carga <2 min:** cronometrar una ficha completa (DNI + domicilio de catálogo + email) en modo carga. ✔/✘
3. **CA3 — Baja con acta:** dar de baja un socio de prueba → aparece en historial de la ficha, en la vista del acta y en `audit_log` (`member_withdraw`). ✔/✘
4. **CA4 — Email:** circuito verificación + invitación completo (Task 14 Step 3); con credenciales Brevo en `.env` el email llega de verdad (si aún no están, `[mail:dev]` en consola cuenta como verificación parcial y se repite en staging). ✔/✘
5. **CA5 — Export:** descarga con filtros aplicados y datos correctos. ✔/✘
6. **CA6 — Recupero:** token de 30 min usable una sola vez. ✔/✘
7. **CA7 — Docs:** los 4 archivos actualizados y commiteados. ✔/✘

- [ ] **Step 3: Limpieza de datos de prueba**

Los socios/actas de prueba creados durante la verificación (alta manual 306+, actas de prueba) se eliminan re-creando la DB local: `npx prisma migrate reset` + `npx tsx scripts/import-calles.ts` + `npx tsx scripts/import-padron.ts` + `npx tsx prisma/seed.ts`. (Solo en dev; staging se puebla limpio con el deploy.)

- [ ] **Step 4: Commit final y resumen**

```bash
git status   # verificar que no quede nada sin commitear
```

Reportar a Mariano: resultados del checklist, pendientes registrados (spec §13) y el bloque de comandos de deploy a staging para que él ejecute (git push → pull en VPS → `npm ci` → `npx prisma migrate deploy` → build → `pm2 restart sigev` → correr imports en el VPS).
