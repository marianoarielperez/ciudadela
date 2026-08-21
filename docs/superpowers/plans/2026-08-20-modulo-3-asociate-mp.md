# Módulo 3 — ASOCIATE + Mercado Pago — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Circuito completo de alta web: wizard público de 5 pasos con Turnstile y uploads, suscripción de débito automático en Mercado Pago con webhooks firmados e idempotentes, bandeja admin de solicitudes con asiento en acta masivo (alta o reingreso), recategorización y rechazo, resumen mensual para el acta, emails de resultado y primer endpoint de cron.

**Architecture:** Se siguen los patrones de M1/M2: lógica pura y factories inyectables en `src/lib/<dominio>/` (reciben un Prisma "pick", exportan el singleton), server actions colocalizadas que se autorizan solas (`requireAdmin` / token de retome), auditoría con `audit()`, formularios con `useActionState`. Lo nuevo: un gateway de MP (`makeMpGateway`) que envuelve el SDK oficial detrás de una interfaz propia mockeable, un webhook procesado inline con idempotencia por `WebhookEvent` (reprocesable si el intento anterior falló), y el wizard público como UNA ruta con estado cliente donde la solicitud se persiste al final del paso 3 y de ahí en más se opera con un token de retome (sha256 en DB, crudo solo en el cliente y en el email).

**Tech Stack:** Next.js 16.3.1 (App Router, `proxy.ts`), React 19.2.8, Prisma 7 + MariaDB (`@prisma/adapter-mariadb`), Auth.js v5, Tailwind v4 + shadcn, vitest 4. Dependencia nueva: `mercadopago@^2` (SDK oficial). Turnstile sin SDK (fetch a siteverify + script del widget).

**Spec:** `docs/superpowers/specs/2026-08-20-modulo-3-asociate-mp-design.md` — leer ENTERA antes de arrancar.

## Global Constraints

- UI en español es-AR ("vos", fechas DD/MM/AAAA, moneda `$ 1.234,56` vía `formatARS`); código, tablas, commits en inglés.
- Mensajes de zod SIEMPRE en es-AR: se muestran tal cual en pantalla.
- Toda action admin que escribe: `requireAdmin()` propio + `parseForm` + `audit()` + `redirect()` FUERA del try. Las actions públicas del wizard se autentican con Turnstile + rate limit (creación) o token de retome (resto), y auditan sin `userId`.
- En módulos `"use server"` no exportar nada que no sea función async (los `type State` van sin export).
- IP del cliente: solo header `x-real-ip`, fallback `"unknown"`.
- Auditoría (Ley 25.326): en `detail` van ids, códigos y flags — NUNCA DNI, email ni domicilios. Errores de nodemailer: loguear solo `code`.
- Dinero: `Decimal(10,2)` en DB; en TypeScript los montos de MP viajan como `number` (pesos) y se convierten con `new Prisma.Decimal(x.toFixed(2))` al persistir.
- Fechas civiles a mediodía UTC (`civilDateUtc`); guardar UTC; formatear con `formatDateAR`.
- Migraciones con `npx prisma migrate dev` (Docker Desktop corriendo, `SHADOW_DATABASE_URL` en `.env`), nunca `db push`.
- Uploads en `UPLOADS_DIR` (dev `./uploads`), NUNCA en `public/` ni el repo; documentos personales solo por ruta autenticada de admin, cada visualización auditada.
- Color de marca `#2E9BDF` solo decorativo; interactivo usa el token `--primary`. Componentes del shell obligatorios en el panel: `PageHeader`, `FormMessage`, `EmptyState`, badges por `status-badges.ts`. Nunca un `thead` sin filas.
- Tests con vitest (`npm test`), lógica pura sin base (factories con fakes), mocks de server actions con `vi.mock` + `redirect` que lanza `REDIRECT:${url}`.
- Commits frecuentes en inglés estilo `feat(scope): ...` con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Las tareas de UI pública (12 y 13) DEBEN invocar antes la skill `frontend-design:frontend-design`.
- Trabajar en la rama `feature/modulo-3-asociate-mp` (creada en la Task 1). No pushear: el push lo corre Mariano.

---

### Task 1: Rama, dependencia SDK y migración nº 6

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `package.json` (vía npm install)
- Modify: `.env.example`
- Create: `prisma/migrations/<timestamp>_add_module_3_applications_mp/migration.sql` (generada)

**Interfaces:**
- Produces: modelos `Application` (tabla `applications`), `Document` (`documents`), `MpSubscription` (`mp_subscriptions`), `WebhookEvent` (`webhook_events`); enums `ApplicationStatus`, `DocumentOwner`, `DocumentType`, `WebhookOrigin`; `ActionToken.applicationId`, `Notification.applicationId`; back-relations en `User`, `Member`, `Street`, `Minute`.

- [ ] **Step 1: Crear la rama e instalar el SDK**

```bash
git checkout -b feature/modulo-3-asociate-mp
npm install mercadopago@^2
```

Expected: exit 0, `postinstall` corre `prisma generate` sin errores.

- [ ] **Step 2: Agregar el bloque del Módulo 3 al schema**

En `prisma/schema.prisma`, al final del archivo:

```prisma
// ---------------------------------------------------------------------------
// Módulo 3 — ASOCIATE + Mercado Pago
// ---------------------------------------------------------------------------

// Máquina de estados de la solicitud de alta web (docs/04 + spec M3 §2).
//   started → pending_payment → approved_pending_minute → completed   (con débito)
//   started → pending_board → completed                               (adherente sin débito)
//   rechazo y expiración cortan cualquier rama viva.
enum ApplicationStatus {
  started
  pending_payment
  approved_pending_minute
  pending_board
  completed
  rejected
  expired
}

// Solicitud de alta del wizard público. Espejo de los datos de Member: acá son
// obligatorios (REG-02 exige la ficha completa para el alta web), en Member son
// nullable porque el padrón histórico vino incompleto.
model Application {
  id       Int    @id @default(autoincrement())
  fullName String @map("full_name") @db.VarChar(160)
  // Obligatorio en el alta web (a diferencia de Member.dni). NO es unique: una
  // misma persona puede tener una rechazada vieja y una viva; la invariante
  // "una sola solicitud VIVA por DNI" se valida en runtime dentro de la
  // transacción de creación (MySQL no tiene índices parciales).
  dni             String    @db.VarChar(12)
  birthDate       DateTime  @map("birth_date")
  civilStatus     String    @map("civil_status") @db.VarChar(40)
  nationality     String    @db.VarChar(60)
  occupation      String    @db.VarChar(80)
  phone           String    @db.VarChar(40)
  email           String    @db.VarChar(191)
  // Doble opt-in de la solicitud (REG-08). Se copia a la ficha al asentar.
  emailVerifiedAt DateTime? @map("email_verified_at")
  streetId        Int?      @map("street_id")
  street          Street?   @relation(fields: [streetId], references: [id], onDelete: SetNull)
  streetText      String?   @map("street_text") @db.VarChar(120)
  streetNumber    String?   @map("street_number") @db.VarChar(10)
  neighborhood    String?   @db.VarChar(60)
  // Solo active | adherent | collaborator llegan por acá (REG-01): lo valida
  // el zod del wizard y lo revalida el service. El enum se comparte con Member.
  requestedCategory MemberCategory    @map("requested_category")
  wantsDebit        Boolean           @default(false) @map("wants_debit")
  status            ApplicationStatus @default(started)
  preapprovalId     String?           @unique @map("preapproval_id") @db.VarChar(64)
  // El pago de la cuota de ingreso (REG-14). Pago/Recibo llegan con el M4:
  // hasta entonces este par de campos ES el registro del ingreso.
  mpPaymentIdEntry String?  @map("mp_payment_id_entry") @db.VarChar(64)
  entryAmount      Decimal? @map("entry_amount") @db.Decimal(10, 2)
  // sha256 del token de retome (mismo criterio que ActionToken: el crudo viaja
  // una sola vez, en el cliente del wizard y en el email de recordatorio).
  resumeTokenHash String    @unique @map("resume_token_hash") @db.Char(64)
  // Seteado cuando el DNI matcheó un ex socio sin bloqueo: el asiento hace
  // REINGRESO sobre esta ficha en vez de crear un socio duplicado (REG-25).
  memberId   Int?      @map("member_id")
  member     Member?   @relation(fields: [memberId], references: [id], onDelete: SetNull)
  // Acta del asiento o del rechazo (REG-11 / REG-13).
  minuteId   Int?      @map("minute_id")
  minute     Minute?   @relation(fields: [minuteId], references: [id], onDelete: SetNull)
  decidedAt  DateTime? @map("decided_at")
  // Recordatorio de pago enviado (una sola vez, cron del M3).
  remindedAt      DateTime? @map("reminded_at")
  acceptedTermsAt DateTime  @map("accepted_terms_at")
  ip              String    @db.VarChar(45)
  userAgent       String    @map("user_agent") @db.VarChar(255)
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  subscriptions   MpSubscription[]
  tokens          ActionToken[]
  notifications   Notification[]

  @@index([status])
  @@index([dni])
  @@map("applications")
}

enum DocumentOwner {
  application
  member
  presentation
}

enum DocumentType {
  dni_front
  dni_back
  annex
}

// Documento subido (DNI, anexos). Polimórfico a propósito (docs/04): M6 lo
// reutiliza para las presentaciones del re-empadronamiento. `ownerId` no tiene
// FK real; la integridad la cuida la capa de servicio. Conservación PERMANENTE
// (decisión institucional). Acceso solo admin, auditado por visualización.
model Document {
  id            Int           @id @default(autoincrement())
  ownerType     DocumentOwner @map("owner_type")
  ownerId       Int           @map("owner_id")
  type          DocumentType
  path          String        @db.VarChar(255)
  mime          String        @db.VarChar(100)
  size          Int
  uploadedAt    DateTime      @default(now()) @map("uploaded_at")
  validatedById Int?          @map("validated_by_id")
  validatedBy   User?         @relation(fields: [validatedById], references: [id], onDelete: SetNull)
  validatedAt   DateTime?     @map("validated_at")

  @@index([ownerType, ownerId])
  @@map("documents")
}

// Suscripción de débito automático en MP. En M3 nacen de solicitudes
// (`applicationId`); `memberId` se completa al asentar. `linkedManually` es
// para las preexistentes que vincula el M4.
model MpSubscription {
  id             Int          @id @default(autoincrement())
  preapprovalId  String       @unique @map("preapproval_id") @db.VarChar(64)
  planId         String       @map("plan_id") @db.VarChar(64)
  applicationId  Int?         @map("application_id")
  application    Application? @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  memberId       Int?         @map("member_id")
  member         Member?      @relation(fields: [memberId], references: [id], onDelete: SetNull)
  // Estados de MP tal cual llegan (pending | authorized | paused | cancelled…):
  // string y no enum, porque el catálogo es de MP y puede crecer sin avisarnos.
  status         String       @db.VarChar(32)
  payerEmail     String       @map("payer_email") @db.VarChar(191)
  linkedManually Boolean      @default(false) @map("linked_manually")
  lastSyncAt     DateTime?    @map("last_sync_at")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  @@map("mp_subscriptions")
}

enum WebhookOrigin {
  mp
  brevo
}

// Registro crudo de cada webhook entrante. La unique [origin, externalEventId]
// ES la idempotencia: un reintento del proveedor inserta-o-encuentra y solo se
// reprocesa si el intento anterior quedó sin `processedAt` (spec §3).
model WebhookEvent {
  id              BigInt        @id @default(autoincrement())
  origin          WebhookOrigin
  externalEventId String        @map("external_event_id") @db.VarChar(128)
  topic           String        @db.VarChar(64)
  payload         Json
  receivedAt      DateTime      @default(now()) @map("received_at")
  processedAt     DateTime?     @map("processed_at")
  result          String?       @db.VarChar(64)
  error           String?       @db.VarChar(500)

  @@unique([origin, externalEventId])
  @@map("webhook_events")
}
```

- [ ] **Step 3: Extender los modelos existentes**

En `ActionToken`, después de `memberId`/`member` agregar:

```prisma
  // Token de una solicitud de alta que todavía no es socio (M3): la
  // verificación de email del wizard. Cascade: si la solicitud se borra, sus
  // enlaces mueren con ella.
  applicationId Int?         @map("application_id")
  application   Application? @relation(fields: [applicationId], references: [id], onDelete: Cascade)
```

En `Notification`, después de `memberId`/`member` agregar:

```prisma
  // Notificación dirigida a una solicitud (M3): el destinatario todavía no es
  // socio, pero el envío tiene que quedar acreditado igual (Art. 5° quater).
  applicationId Int?         @map("application_id")
  application   Application? @relation(fields: [applicationId], references: [id], onDelete: SetNull)
```

Back-relations (agregar junto a las existentes de cada modelo):
- `User`: `documentsValidated Document[]`
- `Member`: `applications Application[]` y `mpSubscriptions MpSubscription[]`
- `Street`: `applications Application[]`
- `Minute`: `applications Application[]`

- [ ] **Step 4: Generar la migración**

```bash
npx prisma migrate dev --name add_module_3_applications_mp
```

Expected: migración creada y aplicada, `prisma generate` OK. Verificar en el SQL generado que `applications.reminded_at` sea `DATETIME(3) NULL`.

- [ ] **Step 5: Actualizar `.env.example`**

Agregar debajo del bloque Turnstile existente (y renombrar la clave pública):

```
# Turnstile: la site key es pública y la lee el cliente (NEXT_PUBLIC_).
# En dev usar las claves dummy de Cloudflare que siempre pasan:
#   NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
#   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
NEXT_PUBLIC_TURNSTILE_SITE_KEY=***
TURNSTILE_SECRET_KEY=***

# SOLO staging: casillas separadas por coma; si está definida, ningún email
# sale hacia otra dirección (guarda de pruebas). En producción NO definirla.
EMAIL_ALLOWLIST=
```

Si `.env.example` tenía `TURNSTILE_SITE_KEY` sin prefijo, reemplazarla por `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Actualizar también la tabla de env de `CLAUDE.md` en la Task 22 (no ahora).

- [ ] **Step 6: Correr los tests y commitear**

```bash
npm test
git add -A
git commit -m "feat(db): module 3 migration — applications, documents, MP subscriptions, webhook events"
```

Expected: 672 tests OK (ninguno toca los modelos nuevos todavía).

---

### Task 2: Allowlist de emails para staging

**Files:**
- Modify: `src/lib/email/transport.ts`
- Test: `tests/allowlist-transport.test.ts`

**Interfaces:**
- Produces: `parseAllowlist(csv: string | undefined): Set<string> | null`, `makeAllowlistTransport(inner: MailTransport, allowlist: Set<string>): MailTransport`. `getTransport()` queda envuelto automáticamente cuando `EMAIL_ALLOWLIST` está definida.
- Consumes: `MailTransport` existente.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/allowlist-transport.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeAllowlistTransport, parseAllowlist, type MailTransport } from "@/lib/email/transport";

function innerMock(): { transport: MailTransport; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue({ messageId: "mid-1" });
  return { transport: { send }, send };
}

describe("parseAllowlist", () => {
  it("devuelve null sin variable o con string vacío", () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist("")).toBeNull();
    expect(parseAllowlist(" , ,")).toBeNull();
  });
  it("normaliza a minúsculas y recorta espacios", () => {
    const set = parseAllowlist(" A@b.com , c@D.com ");
    expect(set).toEqual(new Set(["a@b.com", "c@d.com"]));
  });
});

describe("makeAllowlistTransport", () => {
  const allow = new Set(["ok@test.com"]);
  it("deja pasar una casilla listada (case-insensitive)", async () => {
    const { transport, send } = innerMock();
    const t = makeAllowlistTransport(transport, allow);
    const res = await t.send({ to: "OK@test.com", subject: "s", text: "t", html: "<p>h</p>" });
    expect(send).toHaveBeenCalledOnce();
    expect(res.messageId).toBe("mid-1");
  });
  it("bloquea una casilla ajena sin llamar al transporte interno", async () => {
    const { transport, send } = innerMock();
    const t = makeAllowlistTransport(transport, allow);
    await expect(t.send({ to: "otro@x.com", subject: "s", text: "t", html: "h" })).rejects.toThrow(
      /restringidos/i,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/allowlist-transport.test.ts`
Expected: FAIL — `parseAllowlist` no existe.

- [ ] **Step 3: Implementar en `transport.ts`**

Agregar al final de `src/lib/email/transport.ts` (antes de `getTransport`) y reemplazar `getTransport`:

```ts
/** Guarda de STAGING (spec M3 §6): con EMAIL_ALLOWLIST definida, ningún correo
 *  sale hacia una casilla no listada. Vive en el transporte y no en los
 *  call-sites para cubrir wizard, panel y cron por igual. El error viaja como
 *  excepción: los call-sites ya compensan un fallo de envío (queman token,
 *  devuelven cupo), y un bloqueo silencioso escondería que la prueba no probó
 *  nada. El log NO incluye la dirección (docs/08). */
export function parseAllowlist(csv: string | undefined): Set<string> | null {
  if (!csv) return null;
  const items = csv.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
  return items.length > 0 ? new Set(items) : null;
}

export function makeAllowlistTransport(inner: MailTransport, allowlist: Set<string>): MailTransport {
  return {
    async send(msg) {
      if (!allowlist.has(msg.to.trim().toLowerCase())) {
        console.warn("[mail:allowlist] envío bloqueado por EMAIL_ALLOWLIST");
        throw new Error("Envíos de email restringidos en este entorno (EMAIL_ALLOWLIST).");
      }
      return inner.send(msg);
    },
  };
}

export function getTransport(): MailTransport {
  const inner = makeBrevoTransport() ?? makeConsoleTransport();
  const allowlist = parseAllowlist(process.env.EMAIL_ALLOWLIST);
  return allowlist ? makeAllowlistTransport(inner, allowlist) : inner;
}
```

- [ ] **Step 4: Verificar y commitear**

Run: `npm test`
Expected: PASS (los nuevos + los 672 previos).

```bash
git add src/lib/email/transport.ts tests/allowlist-transport.test.ts
git commit -m "feat(email): EMAIL_ALLOWLIST staging guard at the transport layer"
```

---

### Task 3: Configuración — claves nuevas, pantalla y borrador de textos legales

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/app/admin/configuracion/page.tsx`, `src/app/admin/configuracion/actions.ts`, `src/app/admin/configuracion/config-form.tsx` (leer los tres ANTES de editar: el patrón `useSyncedForm` ya está ahí)
- Modify: `prisma/seed.ts`
- Test: `tests/config.test.ts` (ampliar), `tests/config-actions-auth.test.ts` (verificar que sigue pasando)

**Interfaces:**
- Produces: `CONFIG_KEYS.termsText = "terms_text"`, `CONFIG_KEYS.privacyConsentText = "privacy_consent_text"`, `CONFIG_KEYS.mpPlanActiveId = "mp_plan_active_id"`, `CONFIG_KEYS.mpPlanSharedId = "mp_plan_shared_id"`; lector cacheado `getLegalTexts(): Promise<{ terms: string | null; privacyConsent: string | null }>`.
- Nota de alcance: los textos legales se guardan como **texto plano** y se renderizan con `whitespace-pre-line` (desvío de la spec §2 acordado en el plan: más simple y sin superficie XSS; anotarlo en la Task 22 al actualizar la spec/docs).

- [ ] **Step 1: Ampliar `CONFIG_KEYS` y agregar el lector cacheado**

En `src/lib/config.ts`, dentro de `CONFIG_KEYS` agregar:

```ts
  termsText: "terms_text",
  privacyConsentText: "privacy_consent_text",
  mpPlanActiveId: "mp_plan_active_id",
  mpPlanSharedId: "mp_plan_shared_id",
```

Y al final del archivo:

```ts
// Textos legales del wizard ASOCIATE (M3). Texto PLANO: se renderiza con
// whitespace-pre-line; nunca HTML del admin al DOM.
export const getLegalTexts = unstable_cache(
  async () => ({
    terms: await configReader.getString(CONFIG_KEYS.termsText),
    privacyConsent: await configReader.getString(CONFIG_KEYS.privacyConsentText),
  }),
  ["config-legal"],
  { tags: [CACHE_TAGS.config] },
);
```

- [ ] **Step 2: Pantalla de configuración**

En `config-form.tsx` / `actions.ts` / `page.tsx`, siguiendo EXACTAMENTE el patrón de los campos existentes (`contact_phone`): agregar al schema zod de la action —

```ts
  termsText: z.string().max(20000, "Los términos no pueden superar los 20.000 caracteres").optional(),
  privacyConsentText: z.string().max(20000, "El consentimiento no puede superar los 20.000 caracteres").optional(),
  mpPlanActiveId: z.string().max(64, "El id de plan no puede superar los 64 caracteres").optional(),
  mpPlanSharedId: z.string().max(64, "El id de plan no puede superar los 64 caracteres").optional(),
```

— persistirlos como strings en `Configuration` (mismo upsert que las claves existentes, dentro de la transacción existente), y en el form agregar una sección "ASOCIATE — Módulo 3" con: dos `<Textarea>` (términos, consentimiento; `rows={10}`) y dos `TextField` (ids de plan MP, con hint "Se obtiene del instructivo de sandbox / panel de MP"). La action ya invalida `CACHE_TAGS.config`, no hay nada más que invalidar.

- [ ] **Step 3: Borrador de textos en el seed**

En `prisma/seed.ts`, junto a las claves de configuración existentes, agregar upserts **solo-si-no-existe** (no pisar lo que el superadmin haya editado — usar `create` dentro de try/catch de P2002, o `upsert` con `update: {}`):

```ts
const TERMS_DRAFT = `Términos y condiciones de la solicitud de asociación

1. La solicitud de asociación se rige por el Estatuto de la Asociación Vecinal del Barrio Ciudadela y su admisión es resuelta por la Comisión Directiva (Art. 5 y Art. 23).
2. En las categorías con débito automático, el primer débito corresponde a la cuota de ingreso, equivalente a un mes de cuota. La cuota de ingreso NO es reembolsable, cualquiera sea el resultado de la solicitud.
3. La Comisión Directiva conserva la facultad de recategorizar o rechazar la solicitud si la documentación no acredita los requisitos de la categoría.
4. El solicitante declara que los datos consignados son veraces y que la documentación adjunta es auténtica.
5. La solicitud rechazada puede reintentarse a los 6 (seis) meses de la resolución denegatoria (Art. 5 inc. 7).

[BORRADOR — sujeto a aprobación de la Comisión Directiva]`;

const PRIVACY_DRAFT = `Consentimiento para el tratamiento de datos personales (Ley 25.326)

Los datos personales y la documentación cargados en este formulario serán utilizados por la Asociación Vecinal del Barrio Ciudadela exclusivamente para la gestión de su solicitud de asociación y, de resultar admitido/a, para la administración de su condición de socio/a (registro de asociados, tesorería y notificaciones estatutarias).
Los datos no serán cedidos a terceros. El titular podrá ejercer los derechos de acceso, rectificación y supresión previstos por la Ley 25.326 ante la Comisión Directiva, en la sede de la asociación.
La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, tiene la atribución de atender denuncias y reclamos sobre incumplimiento de las normas de protección de datos personales.

[BORRADOR — sujeto a aprobación de la Comisión Directiva]`;
```

y sembrar `terms_text` / `privacy_consent_text` con esos valores.

- [ ] **Step 4: Test, seed y commit**

```bash
npm test
npx prisma db seed
git add -A
git commit -m "feat(config): legal texts + MP plan id keys for the ASOCIATE wizard"
```

Expected: tests OK; el seed reporta las claves nuevas creadas.

---

### Task 4: Turnstile server-side + rate limiters nuevos

**Files:**
- Create: `src/lib/turnstile.ts`
- Modify: `src/lib/auth/rate-limiter.ts`
- Test: `tests/turnstile.test.ts`

**Interfaces:**
- Produces: `makeTurnstileVerifier(fetchFn?: typeof fetch): (token: string, ip: string | null) => Promise<boolean>`; singleton `verifyTurnstile`. Limiters `applicationCreateLimiter` (5/h por IP) y `resumeResendLimiter` (3/h por IP), constantes `APPLICATION_CREATE_LIMIT`, `RESUME_RESEND_LIMIT`, `APPLICATION_WINDOW_MS`.

- [ ] **Step 1: Test que falla**

`tests/turnstile.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTurnstileVerifier } from "@/lib/turnstile";

function fetchOk(success: boolean) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success }) });
}

describe("makeTurnstileVerifier", () => {
  beforeEach(() => { process.env.TURNSTILE_SECRET_KEY = "sec-1"; });
  afterEach(() => { delete process.env.TURNSTILE_SECRET_KEY; });

  it("aprueba cuando siteverify responde success", async () => {
    const f = fetchOk(true);
    const verify = makeTurnstileVerifier(f as unknown as typeof fetch);
    await expect(verify("tok", "1.2.3.4")).resolves.toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(String(init.body)).toContain("response=tok");
    expect(String(init.body)).toContain("remoteip=1.2.3.4");
  });
  it("rechaza con success=false", async () => {
    const verify = makeTurnstileVerifier(fetchOk(false) as unknown as typeof fetch);
    await expect(verify("tok", null)).resolves.toBe(false);
  });
  it("falla CERRADO sin secreto configurado o sin token", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const f = fetchOk(true);
    const verify = makeTurnstileVerifier(f as unknown as typeof fetch);
    await expect(verify("tok", null)).resolves.toBe(false);
    process.env.TURNSTILE_SECRET_KEY = "sec-1";
    await expect(verify("", null)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("rechaza si la red falla", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom"));
    const verify = makeTurnstileVerifier(f as unknown as typeof fetch);
    await expect(verify("tok", null)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/turnstile.test.ts` — Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`src/lib/turnstile.ts`:

```ts
// Verificación server-side de Cloudflare Turnstile (docs/08: captcha en todos
// los formularios públicos; diferido del M0 a este módulo). FALLA CERRADO: sin
// secreto, sin token o con la red caída se rechaza — un captcha que aprueba
// cuando no puede verificar no es un captcha. En dev se usan las claves dummy
// de Cloudflare (ver .env.example), que pasan siempre.
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifier = (token: string, ip: string | null) => Promise<boolean>;

export function makeTurnstileVerifier(fetchFn: typeof fetch = fetch): TurnstileVerifier {
  return async (token, ip) => {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret || !token) return false;
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip && ip !== "unknown") body.set("remoteip", ip);
      const res = await fetchFn(SITEVERIFY_URL, { method: "POST", body });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  };
}

export const verifyTurnstile: TurnstileVerifier = makeTurnstileVerifier();
```

Al final de `src/lib/auth/rate-limiter.ts`:

```ts
export const APPLICATION_WINDOW_MS = 60 * 60_000
export const APPLICATION_CREATE_LIMIT = 5
export const RESUME_RESEND_LIMIT = 3

/** Creación de solicitudes ASOCIATE, por IP. Detrás de Turnstile, pero el
 *  captcha no raciona el volumen de un humano persistente: cinco solicitudes
 *  por hora desde un mismo origen alcanzan para cualquier hogar (CGNAT
 *  incluido) y frenan el llenado masivo del padrón de solicitudes. Es además
 *  la única puerta del chequeo de elegibilidad por DNI (anti-enumeración,
 *  spec M3 §4). */
export const applicationCreateLimiter = createRateLimiter({
  limit: APPLICATION_CREATE_LIMIT,
  windowMs: APPLICATION_WINDOW_MS,
})

/** Reenvío del link de retome ("ya tenés una solicitud en trámite"), por IP:
 *  dispara un correo hacia afuera desde un formulario anónimo, mismo criterio
 *  que el recupero de contraseña. */
export const resumeResendLimiter = createRateLimiter({
  limit: RESUME_RESEND_LIMIT,
  windowMs: APPLICATION_WINDOW_MS,
})
```

- [ ] **Step 4: Verificar y commitear**

```bash
npm test
git add src/lib/turnstile.ts src/lib/auth/rate-limiter.ts tests/turnstile.test.ts
git commit -m "feat(security): Turnstile server-side verifier + application rate limiters"
```

---

### Task 5: Validación de firma de webhooks de MP (pura)

**Files:**
- Create: `src/lib/mp/signature.ts`
- Test: `tests/mp-signature.test.ts`

**Interfaces:**
- Produces: `validateMpSignature(input: { xSignature: string | null; xRequestId: string | null; dataId: string; secret: string; nowMs?: number; toleranceMs?: number }): boolean`; `MP_SIGNATURE_TOLERANCE_MS = 5 * 60_000`.

- [ ] **Step 1: Test que falla**

`tests/mp-signature.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MP_SIGNATURE_TOLERANCE_MS, validateMpSignature } from "@/lib/mp/signature";

const SECRET = "test-secret";

function sign(dataId: string, requestId: string, tsSeconds: number): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${tsSeconds};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return `ts=${tsSeconds},v1=${v1}`;
}

describe("validateMpSignature", () => {
  const now = 1_755_700_000_000; // ms
  const ts = Math.floor(now / 1000);

  it("acepta una firma válida dentro de la tolerancia", () => {
    expect(
      validateMpSignature({
        xSignature: sign("12345", "req-1", ts),
        xRequestId: "req-1",
        dataId: "12345",
        secret: SECRET,
        nowMs: now,
      }),
    ).toBe(true);
  });
  it("rechaza v1 adulterada, request-id cambiado y data.id cambiado", () => {
    const sig = sign("12345", "req-1", ts);
    expect(validateMpSignature({ xSignature: sig.replace(/.$/, "0"), xRequestId: "req-1", dataId: "12345", secret: SECRET, nowMs: now })).toBe(false);
    expect(validateMpSignature({ xSignature: sig, xRequestId: "req-2", dataId: "12345", secret: SECRET, nowMs: now })).toBe(false);
    expect(validateMpSignature({ xSignature: sig, xRequestId: "req-1", dataId: "99999", secret: SECRET, nowMs: now })).toBe(false);
  });
  it("rechaza headers ausentes y ts fuera de tolerancia", () => {
    expect(validateMpSignature({ xSignature: null, xRequestId: "r", dataId: "1", secret: SECRET, nowMs: now })).toBe(false);
    expect(validateMpSignature({ xSignature: sign("1", "r", ts), xRequestId: null, dataId: "1", secret: SECRET, nowMs: now })).toBe(false);
    const old = ts - Math.ceil(MP_SIGNATURE_TOLERANCE_MS / 1000) - 10;
    expect(validateMpSignature({ xSignature: sign("1", "r", old), xRequestId: "r", dataId: "1", secret: SECRET, nowMs: now })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo** — `npx vitest run tests/mp-signature.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

`src/lib/mp/signature.ts`:

```ts
// Validación del header `x-signature` de los webhooks de Mercado Pago
// (docs/06 §4: rechazar si no valida). Formato del header: "ts=...,v1=..." y
// manifiesto HMAC-SHA256: `id:{data.id};request-id:{x-request-id};ts:{ts};`.
// OJO: si data.id es alfanumérico, MP lo firma en minúsculas — el caller pasa
// `dataId` ya normalizado (los ids de pagos/suscripciones son numéricos, así
// que en la práctica no cambia nada, pero queda documentado).
//
// La tolerancia de ts NO rompe los reintentos de MP: cada reintento se firma
// de nuevo con un ts fresco. Lo que raciona es el replay de una captura vieja.
import { createHmac, timingSafeEqual } from "node:crypto";

export const MP_SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function validateMpSignature(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  secret: string;
  nowMs?: number;
  toleranceMs?: number;
}): boolean {
  if (!input.xSignature || !input.xRequestId || !input.secret) return false;
  const parts = new Map<string, string>();
  for (const piece of input.xSignature.split(",")) {
    const idx = piece.indexOf("=");
    if (idx > 0) parts.set(piece.slice(0, idx).trim(), piece.slice(idx + 1).trim());
  }
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1) return false;

  const tsMs = Number(ts) * 1000;
  const now = input.nowMs ?? Date.now();
  const tolerance = input.toleranceMs ?? MP_SIGNATURE_TOLERANCE_MS;
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > tolerance) return false;

  const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Verificar y commitear**

```bash
npm test
git add src/lib/mp/signature.ts tests/mp-signature.test.ts
git commit -m "feat(mp): x-signature webhook validation"
```

---

### Task 6: Gateway de MP y lectura de montos de los planes

**Files:**
- Create: `src/lib/mp/gateway.ts`
- Create: `src/lib/mp/plans.ts`
- Test: `tests/mp-plans.test.ts`

**Interfaces:**
- Produces (gateway):

```ts
export type MpGateway = {
  getPlan(planId: string): Promise<{ id: string; reason: string; amount: number }>;
  createPreapproval(input: {
    planId: string; payerEmail: string; externalReference: string; backUrl: string;
  }): Promise<{ id: string; initPoint: string; status: string }>;
  cancelPreapproval(id: string): Promise<void>;
  updatePreapprovalAmount(id: string, amount: number): Promise<void>;
  getPreapproval(id: string): Promise<{ id: string; status: string; payerEmail: string | null; externalReference: string | null }>;
  getPayment(id: string): Promise<{ id: string; status: string; transactionAmount: number; externalReference: string | null }>;
  getAuthorizedPayment(id: string): Promise<{ id: string; preapprovalId: string | null; status: string }>;
};
export function makeMpGateway(): MpGateway; // lee MP_ACCESS_TOKEN
export const mpGateway: MpGateway;          // singleton lazy
```

- Produces (plans): `makeFeeAmountsReader(deps: { gateway: Pick<MpGateway, "getPlan">; config: { getString(key: string): Promise<string | null> }; now?: () => number })` → `{ getFeeAmounts(): Promise<FeeAmounts | null> }` con `FeeAmounts = { active: number; shared: number }`; singleton `getFeeAmounts()`. Cache in-memory 24 h con **stale-on-error** (si MP falla, sirve el último valor bueno; si nunca hubo, `null`). `FEE_CACHE_TTL_MS = 24 * 60 * 60_000`.

- [ ] **Step 1: Test del lector de montos (falla)**

`tests/mp-plans.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { FEE_CACHE_TTL_MS, makeFeeAmountsReader } from "@/lib/mp/plans";

function deps(overrides?: { getPlan?: ReturnType<typeof vi.fn> }) {
  const getPlan = overrides?.getPlan ?? vi.fn(async (id: string) => ({
    id, reason: "Plan", amount: id === "plan-A" ? 6000 : 3000,
  }));
  const config = {
    getString: vi.fn(async (key: string) =>
      key === "mp_plan_active_id" ? "plan-A" : key === "mp_plan_shared_id" ? "plan-S" : null),
  };
  return { gateway: { getPlan }, config, getPlan };
}

describe("makeFeeAmountsReader", () => {
  it("lee los dos planes y cachea 24 h", async () => {
    let t = 0;
    const d = deps();
    const reader = makeFeeAmountsReader({ ...d, now: () => t });
    await expect(reader.getFeeAmounts()).resolves.toEqual({ active: 6000, shared: 3000 });
    t += FEE_CACHE_TTL_MS - 1;
    await reader.getFeeAmounts();
    expect(d.getPlan).toHaveBeenCalledTimes(2); // una vez por plan, sin refetch
    t += 2;
    await reader.getFeeAmounts();
    expect(d.getPlan).toHaveBeenCalledTimes(4); // vencido: refetch
  });
  it("devuelve null sin ids configurados", async () => {
    const d = deps();
    d.config.getString = vi.fn(async () => null);
    const reader = makeFeeAmountsReader(d);
    await expect(reader.getFeeAmounts()).resolves.toBeNull();
  });
  it("sirve el último valor bueno si MP falla (stale-on-error)", async () => {
    let t = 0;
    let fail = false;
    const getPlan = vi.fn(async (id: string) => {
      if (fail) throw new Error("mp down");
      return { id, reason: "Plan", amount: 6000 };
    });
    const d = deps({ getPlan });
    const reader = makeFeeAmountsReader({ ...d, now: () => t });
    await reader.getFeeAmounts();
    fail = true;
    t += FEE_CACHE_TTL_MS + 1;
    await expect(reader.getFeeAmounts()).resolves.toEqual({ active: 6000, shared: 6000 });
  });
  it("devuelve null si MP falla y nunca hubo valor bueno", async () => {
    const getPlan = vi.fn(async () => { throw new Error("mp down"); });
    const reader = makeFeeAmountsReader(deps({ getPlan }));
    await expect(reader.getFeeAmounts()).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver el fallo** — `npx vitest run tests/mp-plans.test.ts` → FAIL.

- [ ] **Step 3: Implementar el gateway**

`src/lib/mp/gateway.ts`:

```ts
// Único punto de contacto con la API de Mercado Pago. El dominio consume ESTA
// interfaz, nunca el SDK: los tests mockean MpGateway y no hay red en vitest.
// SDK oficial `mercadopago` v2 (docs/03). `/authorized_payments` no está en el
// SDK: va con fetch autenticado directo, documentado acá y en la spec §3.
import { MercadoPagoConfig, Payment, PreApproval, PreApprovalPlan } from "mercadopago";

export type MpGateway = {
  getPlan(planId: string): Promise<{ id: string; reason: string; amount: number }>;
  createPreapproval(input: {
    planId: string; payerEmail: string; externalReference: string; backUrl: string;
  }): Promise<{ id: string; initPoint: string; status: string }>;
  cancelPreapproval(id: string): Promise<void>;
  updatePreapprovalAmount(id: string, amount: number): Promise<void>;
  getPreapproval(id: string): Promise<{ id: string; status: string; payerEmail: string | null; externalReference: string | null }>;
  getPayment(id: string): Promise<{ id: string; status: string; transactionAmount: number; externalReference: string | null }>;
  getAuthorizedPayment(id: string): Promise<{ id: string; preapprovalId: string | null; status: string }>;
};

function accessToken(): string {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN no está configurado.");
  return token;
}

export function makeMpGateway(): MpGateway {
  // Lazy: la config se construye recién en la primera llamada, así el import
  // del módulo no explota en dev sin credenciales (mismo criterio que el
  // transporte de email, que cae a consola).
  let client: MercadoPagoConfig | null = null;
  function mp(): MercadoPagoConfig {
    if (!client) client = new MercadoPagoConfig({ accessToken: accessToken() });
    return client;
  }

  return {
    async getPlan(planId) {
      const plan = await new PreApprovalPlan(mp()).get({ preApprovalPlanId: planId });
      const amount = plan.auto_recurring?.transaction_amount;
      if (!plan.id || typeof amount !== "number") {
        throw new Error(`El plan ${planId} no tiene monto en MP.`);
      }
      return { id: plan.id, reason: plan.reason ?? "", amount };
    },
    async createPreapproval(input) {
      const res = await new PreApproval(mp()).create({
        body: {
          preapproval_plan_id: input.planId,
          payer_email: input.payerEmail,
          external_reference: input.externalReference,
          back_url: input.backUrl,
          status: "pending",
        },
      });
      if (!res.id || !res.init_point) throw new Error("MP no devolvió la suscripción creada.");
      return { id: res.id, initPoint: res.init_point, status: res.status ?? "pending" };
    },
    async cancelPreapproval(id) {
      await new PreApproval(mp()).update({ id, body: { status: "cancelled" } });
    },
    async updatePreapprovalAmount(id, amount) {
      await new PreApproval(mp()).update({
        id,
        body: { auto_recurring: { transaction_amount: amount, currency_id: "ARS" } },
      });
    },
    async getPreapproval(id) {
      const res = await new PreApproval(mp()).get({ id });
      return {
        id: res.id ?? id,
        status: res.status ?? "unknown",
        payerEmail: res.payer_email ?? null,
        externalReference: res.external_reference ?? null,
      };
    },
    async getPayment(id) {
      const res = await new Payment(mp()).get({ id });
      return {
        id: String(res.id ?? id),
        status: res.status ?? "unknown",
        transactionAmount: res.transaction_amount ?? 0,
        externalReference: res.external_reference ?? null,
      };
    },
    async getAuthorizedPayment(id) {
      const res = await fetch(`https://api.mercadopago.com/authorized_payments/${id}`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
      });
      if (!res.ok) throw new Error(`authorized_payments/${id} respondió ${res.status}`);
      const data = (await res.json()) as { id?: number; preapproval_id?: string; status?: string };
      return {
        id: String(data.id ?? id),
        preapprovalId: data.preapproval_id ?? null,
        status: data.status ?? "unknown",
      };
    },
  };
}

export const mpGateway: MpGateway = makeMpGateway();
```

Nota para el implementador: si el tipado del SDK difiere en algún campo
(`init_point`, `auto_recurring`), ajustar el mapeo ACÁ y solo acá — la interfaz
`MpGateway` no cambia. Verificarlo compilando (`npm run build` o `npx tsc --noEmit`).

- [ ] **Step 4: Implementar el lector de montos**

`src/lib/mp/plans.ts`:

```ts
// Montos de la cuota: la fuente de verdad son los DOS planes de MP (decisión
// 20/08/2026, reemplaza los 3 de docs/06: "SOCIO ACTIVO" y "SOCIO
// ADHERENTE/COLABORADOR" comparten monto). Cache in-memory 24 h con
// stale-on-error: si MP está caído se sirve el último valor bueno antes que
// inventar un monto o tirar abajo el wizard. In-memory alcanza: PM2 corre un
// único proceso (mismo criterio que rate-limiter.ts).
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { mpGateway, type MpGateway } from "./gateway";

export type FeeAmounts = { active: number; shared: number };

export const FEE_CACHE_TTL_MS = 24 * 60 * 60_000;

type Deps = {
  gateway: Pick<MpGateway, "getPlan">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => number;
};

export function makeFeeAmountsReader(deps: Deps) {
  const now = deps.now ?? Date.now;
  let cached: { value: FeeAmounts; at: number } | null = null;

  return {
    async getFeeAmounts(): Promise<FeeAmounts | null> {
      if (cached && now() - cached.at < FEE_CACHE_TTL_MS) return cached.value;
      const [activeId, sharedId] = await Promise.all([
        deps.config.getString(CONFIG_KEYS.mpPlanActiveId),
        deps.config.getString(CONFIG_KEYS.mpPlanSharedId),
      ]);
      if (!activeId || !sharedId) return cached?.value ?? null;
      try {
        const [active, shared] = await Promise.all([
          deps.gateway.getPlan(activeId),
          deps.gateway.getPlan(sharedId),
        ]);
        cached = { value: { active: active.amount, shared: shared.amount }, at: now() };
        return cached.value;
      } catch {
        // MP caído: el último valor bueno sigue siendo mejor que nada. La
        // divergencia real plan↔local la vigila el sync del M4 (REG-34).
        return cached?.value ?? null;
      }
    },
  };
}

const reader = makeFeeAmountsReader({ gateway: mpGateway, config: configReader });
export const getFeeAmounts = reader.getFeeAmounts;
```

- [ ] **Step 5: Verificar y commitear**

```bash
npm test
git add src/lib/mp/gateway.ts src/lib/mp/plans.ts tests/mp-plans.test.ts
git commit -m "feat(mp): gateway over the official SDK + fee amounts reader with 24h cache"
```

---

### Task 7: Elegibilidad por DNI (regla pura)

**Files:**
- Create: `src/lib/applications/eligibility.ts`
- Test: `tests/application-eligibility.test.ts`

**Interfaces:**
- Produces:

```ts
export const REJECTION_BLOCK_MONTHS = 6;
export type EligibilityBlock =
  | { code: "in_progress"; error: string; applicationId: number }
  | { code: "already_member"; error: string }
  | { code: "visit_office"; error: string }
  | { code: "debt"; error: string }
  | { code: "rejected_wait"; error: string; retryAt: Date };
export type Eligibility = { ok: true; memberId: number | null } | ({ ok: false } & EligibilityBlock);
export function checkEligibility(input: {
  member: Pick<Member, "id" | "status" | "withdrawalReason" | "debtAtWithdrawal" | "reentryBlocked" | "rejectedUntil"> | null;
  liveApplication: { id: number } | null;
  lastRejectionAt: Date | null; // decidedAt de la última Application rechazada con ese DNI
  now: Date;
}): Eligibility;
```

- Consumes: tipos de `@/generated/prisma/client`.

- [ ] **Step 1: Test que falla**

`tests/application-eligibility.test.ts` — la tabla completa de la spec §4:

```ts
import { describe, expect, it } from "vitest";
import { checkEligibility, REJECTION_BLOCK_MONTHS } from "@/lib/applications/eligibility";

const NOW = new Date("2026-08-20T15:00:00Z");
const base = { member: null, liveApplication: null, lastRejectionAt: null, now: NOW };
type M = NonNullable<Parameters<typeof checkEligibility>[0]["member"]>;
const member = (o: Partial<M>): M => ({
  id: 7, status: "withdrawn", withdrawalReason: null, debtAtWithdrawal: false,
  reentryBlocked: false, rejectedUntil: null, ...o,
});

describe("checkEligibility", () => {
  it("DNI desconocido → alta común", () => {
    expect(checkEligibility(base)).toEqual({ ok: true, memberId: null });
  });
  it("solicitud viva → in_progress (gana a cualquier otro estado)", () => {
    const r = checkEligibility({ ...base, liveApplication: { id: 33 }, member: member({ status: "active" }) });
    expect(r).toMatchObject({ ok: false, code: "in_progress", applicationId: 33 });
  });
  it("socio vigente y suspendido → already_member con el MISMO mensaje", () => {
    const a = checkEligibility({ ...base, member: member({ status: "active" }) });
    const s = checkEligibility({ ...base, member: member({ status: "suspended" }) });
    expect(a).toMatchObject({ ok: false, code: "already_member" });
    expect(s).toEqual(a); // no revelar la suspensión
  });
  it("expulsado → visit_office genérico (sin revelar el motivo)", () => {
    const r = checkEligibility({ ...base, member: member({ reentryBlocked: true, withdrawalReason: "expulsion" }) });
    expect(r).toMatchObject({ ok: false, code: "visit_office" });
    expect((r as { error: string }).error).not.toMatch(/expuls/i);
  });
  it("baja por mora o con deuda → debt (sede)", () => {
    expect(checkEligibility({ ...base, member: member({ withdrawalReason: "arrears" }) }))
      .toMatchObject({ ok: false, code: "debt" });
    expect(checkEligibility({ ...base, member: member({ withdrawalReason: "resignation", debtAtWithdrawal: true }) }))
      .toMatchObject({ ok: false, code: "debt" });
  });
  it("rejectedUntil futuro → rejected_wait con la fecha", () => {
    const until = new Date("2026-11-01T12:00:00Z");
    const r = checkEligibility({ ...base, member: member({ rejectedUntil: until }) });
    expect(r).toMatchObject({ ok: false, code: "rejected_wait", retryAt: until });
  });
  it("Application rechazada hace <6 meses (sin ficha) → rejected_wait a +6 meses", () => {
    const rejected = new Date("2026-06-01T12:00:00Z");
    const r = checkEligibility({ ...base, lastRejectionAt: rejected });
    expect(r).toMatchObject({ ok: false, code: "rejected_wait" });
    const retry = (r as { retryAt: Date }).retryAt;
    expect(retry.getUTCMonth()).toBe(11); // junio + 6 = diciembre
  });
  it("rechazo viejo (>6 meses) ya no bloquea", () => {
    const r = checkEligibility({ ...base, lastRejectionAt: new Date("2025-08-01T12:00:00Z") });
    expect(r).toEqual({ ok: true, memberId: null });
  });
  it("ex socio sin deuda (renuncia/mudanza/no reempadronado) → ok con memberId (reingreso)", () => {
    for (const reason of ["resignation", "moved_away", "not_reregistered", "other"] as const) {
      const r = checkEligibility({ ...base, member: member({ withdrawalReason: reason }) });
      expect(r).toEqual({ ok: true, memberId: 7 });
    }
  });
});
```

- [ ] **Step 2: Correr y ver el fallo** — `npx vitest run tests/application-eligibility.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

`src/lib/applications/eligibility.ts`:

```ts
// Bloqueos del paso 3 del wizard (spec M3 §4). Regla PURA: la action junta los
// insumos (ficha por DNI, solicitud viva, último rechazo) y esta función decide.
// Los mensajes son user-facing es-AR y NO revelan más de lo necesario: el
// suspendido ve lo mismo que el vigente, el expulsado ve lo mismo que
// cualquier "acercate a la sede" (anti-enumeración + Ley 25.326).
import type { Member } from "@/generated/prisma/client";

export const REJECTION_BLOCK_MONTHS = 6; // REG-05

export type EligibilityBlock =
  | { code: "in_progress"; error: string; applicationId: number }
  | { code: "already_member"; error: string }
  | { code: "visit_office"; error: string }
  | { code: "debt"; error: string }
  | { code: "rejected_wait"; error: string; retryAt: Date };

export type Eligibility = { ok: true; memberId: number | null } | ({ ok: false } & EligibilityBlock);

type MemberSlice = Pick<
  Member,
  "id" | "status" | "withdrawalReason" | "debtAtWithdrawal" | "reentryBlocked" | "rejectedUntil"
>;

function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function checkEligibility(input: {
  member: MemberSlice | null;
  liveApplication: { id: number } | null;
  lastRejectionAt: Date | null;
  now: Date;
}): Eligibility {
  const { member, liveApplication, lastRejectionAt, now } = input;

  // 1. Una solicitud viva gana a todo: la respuesta correcta es retomarla,
  //    no diagnosticar el estado del padrón.
  if (liveApplication) {
    return {
      ok: false,
      code: "in_progress",
      applicationId: liveApplication.id,
      error: "Ya tenés una solicitud en trámite. Te podemos reenviar por email el enlace para retomarla.",
    };
  }

  if (member) {
    // 2. Vigente o suspendido: mismo mensaje (no se revela la suspensión).
    if (member.status === "active" || member.status === "suspended") {
      return { ok: false, code: "already_member", error: "Ya estás asociado/a a la vecinal." };
    }
    // 3. Expulsión (REG-04): genérico, sin nombrar el motivo. Doble señal como
    //    en canReadmit: flag O motivo, cualquiera alcanza.
    if (member.reentryBlocked || member.withdrawalReason === "expulsion") {
      return {
        ok: false,
        code: "visit_office",
        error: "No podemos procesar tu solicitud por este medio. Acercate a la sede vecinal.",
      };
    }
    // 4. Deuda de tesorería (REG-16, pedido del cliente): mora o deuda al bajar.
    if (member.withdrawalReason === "arrears" || member.debtAtWithdrawal) {
      return {
        ok: false,
        code: "debt",
        error: "Tenés una deuda pendiente con tesorería. Acercate a la sede vecinal para regularizarla.",
      };
    }
    // 5. Rechazo reciente sobre la ficha (REG-05).
    if (member.rejectedUntil && member.rejectedUntil > now) {
      return rejectedWait(member.rejectedUntil);
    }
  }

  // 5bis. Rechazo reciente SIN ficha: sale de la propia Application rechazada.
  if (lastRejectionAt) {
    const retryAt = addMonthsUtc(lastRejectionAt, REJECTION_BLOCK_MONTHS);
    if (retryAt > now) return rejectedWait(retryAt);
  }

  // 6. Ex socio sin bloqueo → reingreso (REG-25); DNI desconocido → alta común.
  return { ok: true, memberId: member?.id ?? null };
}

function rejectedWait(retryAt: Date): Eligibility {
  return {
    ok: false,
    code: "rejected_wait",
    retryAt,
    error: "No podés presentar una nueva solicitud por el momento. Vas a poder reintentar más adelante.",
  };
}
```

Nota: el mensaje de `rejected_wait` no incluye la fecha en el string — la
pantalla la formatea con `formatDateAR(retryAt)` ("hasta el DD/MM/AAAA").

- [ ] **Step 4: Verificar y commitear**

```bash
npm test
git add src/lib/applications/eligibility.ts tests/application-eligibility.test.ts
git commit -m "feat(applications): DNI eligibility rules for the public wizard"
```

---

### Task 8: Servicio de solicitudes, labels y badge

**Files:**
- Create: `src/lib/applications/service.ts`
- Create: `src/lib/applications/labels.ts`
- Modify: `src/lib/admin/status-badges.ts`
- Modify: `src/lib/tokens.ts` (issue acepta `applicationId`)
- Test: `tests/application-service.test.ts`, `tests/status-badges.test.ts` (ampliar si existe; si no, verificar `admin-nav`/`dashboard-cards` intactos)

**Interfaces:**
- Produces:

```ts
// service.ts
export const LIVE_APPLICATION_STATUSES: ApplicationStatus[] =
  ["started", "pending_payment", "approved_pending_minute", "pending_board"];
export class DuplicateLiveApplicationError extends Error {}
export function makeApplicationService(db: Pick<PrismaClient, "application" | "$transaction" | ...>): {
  create(input: CreateApplicationInput): Promise<{ id: number; resumeToken: string }>;
  findLiveByDni(dni: string): Promise<{ id: number; email: string } | null>;
  lastRejectionAt(dni: string): Promise<Date | null>;
  findByResumeToken(raw: string): Promise<Application | null>;
  verifyEmail(applicationId: number, now?: Date): Promise<void>;
};
export const applicationService: ...;
// labels.ts
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string>;
// status-badges.ts
export function applicationStatusBadgeVariant(status: ApplicationStatus): BadgeVariant;
// tokens.ts — issue() acepta applicationId?: number
```

`CreateApplicationInput`: todos los campos de datos del wizard (`fullName, dni, birthDate, civilStatus, nationality, occupation, phone, email, streetId?, streetText?, streetNumber?, neighborhood?, requestedCategory, wantsDebit, memberId (number | null), acceptedTermsAt, ip, userAgent`).

- [ ] **Step 1: Tests que fallan**

`tests/application-service.test.ts` — con un fake de Prisma estilo `tests/member-service.test.ts` (leerlo antes para copiar el patrón del fake `$transaction` que pasa un tx con los mismos mocks):

```ts
import { describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/tokens";
import {
  DuplicateLiveApplicationError, LIVE_APPLICATION_STATUSES, makeApplicationService,
} from "@/lib/applications/service";

function fakeDb() {
  const application = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 55, ...data })),
    findUnique: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const db = {
    application,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ application })),
  };
  return { db: db as never, application };
}

const input = {
  fullName: "Vecina Prueba", dni: "30111222", birthDate: new Date("1990-05-05T12:00:00Z"),
  civilStatus: "soltera", nationality: "argentina", occupation: "docente",
  phone: "2974000000", email: "test@x.com", streetId: 3, streetText: null,
  streetNumber: "123", neighborhood: null, requestedCategory: "active" as const,
  wantsDebit: true, memberId: null, acceptedTermsAt: new Date(), ip: "1.1.1.1", userAgent: "vitest",
};

describe("applicationService.create", () => {
  it("crea la solicitud started con el hash del token (nunca el crudo)", async () => {
    const { db, application } = fakeDb();
    const svc = makeApplicationService(db);
    const { id, resumeToken } = await svc.create(input);
    expect(id).toBe(55);
    expect(resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url de 32 bytes
    const data = application.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.resumeTokenHash).toBe(hashToken(resumeToken));
    expect(data.status).toBeUndefined(); // default started del schema
    expect(JSON.stringify(data)).not.toContain(resumeToken);
  });
  it("rechaza si hay una solicitud viva con el mismo DNI (dentro de la transacción)", async () => {
    const { db, application } = fakeDb();
    application.findFirst.mockResolvedValue({ id: 9 });
    const svc = makeApplicationService(db);
    await expect(svc.create(input)).rejects.toBeInstanceOf(DuplicateLiveApplicationError);
    expect(application.findFirst.mock.calls[0][0].where.status).toEqual({ in: LIVE_APPLICATION_STATUSES });
    expect(application.create).not.toHaveBeenCalled();
  });
});

describe("findByResumeToken / verifyEmail", () => {
  it("busca por hash", async () => {
    const { db, application } = fakeDb();
    const svc = makeApplicationService(db);
    await svc.findByResumeToken("raw-token");
    expect(application.findUnique).toHaveBeenCalledWith({
      where: { resumeTokenHash: hashToken("raw-token") },
    });
  });
  it("verifyEmail solo escribe si aún no estaba verificada", async () => {
    const { db, application } = fakeDb();
    const svc = makeApplicationService(db);
    const now = new Date();
    await svc.verifyEmail(55, now);
    expect(application.updateMany).toHaveBeenCalledWith({
      where: { id: 55, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });
  });
});
```

- [ ] **Step 2: Correr y ver el fallo** — FAIL (módulo inexistente).

- [ ] **Step 3: Implementar el servicio**

`src/lib/applications/service.ts`:

```ts
// Ciclo de vida de la Solicitud de alta web. Mismo patrón que members/service:
// factory con un Prisma "pick", transacciones con callback, singleton al final.
import { randomBytes } from "node:crypto";
import type { Application, ApplicationStatus, MemberCategory, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

// Estados en los que la solicitud "existe" para el vecino y para la unicidad
// por DNI. rejected/expired/completed no bloquean una solicitud nueva
// (completed no llega a molestar: ahí el DNI ya es socio vigente y lo frena
// la elegibilidad).
export const LIVE_APPLICATION_STATUSES: ApplicationStatus[] = [
  "started", "pending_payment", "approved_pending_minute", "pending_board",
];

export class DuplicateLiveApplicationError extends Error {
  constructor() {
    super("Ya tenés una solicitud en trámite.");
  }
}

export type CreateApplicationInput = {
  fullName: string; dni: string; birthDate: Date; civilStatus: string; nationality: string;
  occupation: string; phone: string; email: string;
  streetId: number | null; streetText: string | null; streetNumber: string | null;
  neighborhood: string | null;
  requestedCategory: MemberCategory; wantsDebit: boolean;
  memberId: number | null; acceptedTermsAt: Date; ip: string; userAgent: string;
};

type Db = Pick<PrismaClient, "application" | "$transaction">;

export function makeApplicationService(db: Db) {
  return {
    // La unicidad "una sola viva por DNI" se revalida DENTRO de la transacción:
    // la elegibilidad de la action corre antes y sin lock, dos POST simultáneos
    // del mismo DNI pasan los dos el chequeo externo (patrón requireOpenBook).
    async create(input: CreateApplicationInput): Promise<{ id: number; resumeToken: string }> {
      const raw = randomBytes(32).toString("base64url");
      const created = await db.$transaction(async (tx) => {
        const live = await tx.application.findFirst({
          where: { dni: input.dni, status: { in: LIVE_APPLICATION_STATUSES } },
          select: { id: true },
        });
        if (live) throw new DuplicateLiveApplicationError();
        return tx.application.create({
          data: { ...input, resumeTokenHash: hashToken(raw) },
        });
      });
      return { id: created.id, resumeToken: raw };
    },

    async findLiveByDni(dni: string): Promise<{ id: number; email: string } | null> {
      const app = await db.application.findFirst({
        where: { dni, status: { in: LIVE_APPLICATION_STATUSES } },
        select: { id: true, email: true },
      });
      return app;
    },

    // Para el bloqueo REG-05 de no-socios: fecha de la última rechazada.
    async lastRejectionAt(dni: string): Promise<Date | null> {
      const app = await db.application.findFirst({
        where: { dni, status: "rejected", decidedAt: { not: null } },
        orderBy: { decidedAt: "desc" },
        select: { decidedAt: true },
      });
      return app?.decidedAt ?? null;
    },

    async findByResumeToken(raw: string): Promise<Application | null> {
      return db.application.findUnique({ where: { resumeTokenHash: hashToken(raw) } });
    },

    // UPDATE condicional (patrón tokens.consume): dos clics en el enlace de
    // verificación no escriben dos veces.
    async verifyEmail(applicationId: number, now: Date = new Date()): Promise<void> {
      await db.application.updateMany({
        where: { id: applicationId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
    },
  };
}

export const applicationService = makeApplicationService(prisma);
```

- [ ] **Step 4: Labels y badge**

`src/lib/applications/labels.ts`:

```ts
// Etiquetas es-AR únicas de los estados de solicitud (patrón members/labels).
import type { ApplicationStatus } from "@/generated/prisma/client";

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  started: "Iniciada",
  pending_payment: "Esperando pago",
  approved_pending_minute: "Aceptada — pendiente de acta",
  pending_board: "A tratar por la CD",
  completed: "Alta completada",
  rejected: "Rechazada",
  expired: "Vencida",
};
```

En `src/lib/admin/status-badges.ts` agregar (import `ApplicationStatus` junto a los existentes):

```ts
// La bandeja resalta lo accionable: la aceptada que espera acta es "default"
// (celeste); lo terminal va apagado.
export function applicationStatusBadgeVariant(status: ApplicationStatus): BadgeVariant {
  if (status === "approved_pending_minute") return "default";
  if (status === "pending_board" || status === "pending_payment") return "secondary";
  if (status === "rejected") return "destructive";
  return "outline"; // started, completed, expired
}
```

- [ ] **Step 5: `tokens.issue` acepta solicitudes**

En `src/lib/tokens.ts`, cambiar la firma de `issue` y el `create`:

```ts
    async issue(input: {
      purpose: TokenPurpose; memberId?: number; userId?: number; applicationId?: number; now?: Date;
    }): Promise<string> {
      const raw = randomBytes(32).toString("base64url");
      const now = input.now ?? new Date();
      await db.actionToken.create({
        data: {
          purpose: input.purpose,
          tokenHash: hashToken(raw),
          memberId: input.memberId ?? null,
          userId: input.userId ?? null,
          applicationId: input.applicationId ?? null,
          expiresAt: new Date(now.getTime() + TOKEN_TTL[input.purpose]),
        },
      });
      return raw;
    },
```

(No hace falta `revokeForApplication`: el token de verificación de la solicitud
es uno solo, se emite una única vez al crearla, y el Cascade del schema lo
limpia si la solicitud se borra.)

- [ ] **Step 6: Verificar y commitear**

```bash
npm test
git add src/lib/applications/ src/lib/admin/status-badges.ts src/lib/tokens.ts tests/application-service.test.ts
git commit -m "feat(applications): application service, labels, badge variant, application tokens"
```

---

### Task 9: Almacenamiento de documentos (magic bytes + guardado)

**Files:**
- Create: `src/lib/documents/storage.ts`
- Test: `tests/document-storage.test.ts`

**Interfaces:**
- Produces:

```ts
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_KINDS: Record<string, string>; // ext → mime
export function sniffDocument(buf: Buffer): { ext: "jpg" | "png" | "webp" | "pdf"; mime: string } | null;
export function makeDocumentStore(db: Pick<PrismaClient, "document">, rootDir?: string): {
  saveApplicationDocument(input: {
    applicationId: number; type: DocumentType; data: Buffer;
  }): Promise<{ id: number }>;  // reemplaza el anterior del mismo type (dni_front re-subido)
  readDocumentFile(doc: { path: string }): Promise<Buffer>;
};
export const documentStore: ...;
```

- Nota: `rootDir` default = `process.env.UPLOADS_DIR ?? "./uploads"` — ANTES de implementar, leer `src/lib/news/images.ts` y usar el MISMO helper/criterio de resolución de `UPLOADS_DIR` que ya usa la portada de noticias (si expone una función, importarla; no duplicar la lógica).

- [ ] **Step 1: Tests que fallan**

`tests/document-storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, sniffDocument } from "@/lib/documents/storage";

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
const PDF = Buffer.from("%PDF-1.7\n...");

describe("sniffDocument", () => {
  it("reconoce jpg, png, webp y pdf por contenido", () => {
    expect(sniffDocument(JPG)).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(sniffDocument(PNG)).toEqual({ ext: "png", mime: "image/png" });
    expect(sniffDocument(WEBP)).toEqual({ ext: "webp", mime: "image/webp" });
    expect(sniffDocument(PDF)).toEqual({ ext: "pdf", mime: "application/pdf" });
  });
  it("rechaza contenido desconocido aunque venga con extensión linda", () => {
    expect(sniffDocument(Buffer.from("GIF89a..."))).toBeNull();
    expect(sniffDocument(Buffer.from("<html>"))).toBeNull();
    expect(sniffDocument(Buffer.alloc(0))).toBeNull();
  });
  it("expone el límite de 10 MB", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});
```

(El guardado a disco se prueba manualmente en el smoke de la Task 13: escribir
un test de filesystem acá aportaría poco contra el costo de fixtures.)

- [ ] **Step 2: Correr y ver el fallo** — FAIL.

- [ ] **Step 3: Implementar**

`src/lib/documents/storage.ts`:

```ts
// Documentos personales del wizard (DNI, anexos). Guardado FUERA de public/
// (UPLOADS_DIR, docs/08); el archivo se valida por MAGIC BYTES, nunca por
// extensión ni por el Content-Type que declare el cliente. Se sirve solo por
// la ruta autenticada de admin (Task 16).
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DocumentType, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB (spec M3 §2)

export function sniffDocument(buf: Buffer): { ext: "jpg" | "png" | "webp" | "pdf"; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { ext: "pdf", mime: "application/pdf" };
  }
  return null;
}

function uploadsRoot(): string {
  // Mismo criterio que las portadas de noticias (src/lib/news/images.ts): si
  // aquel módulo exporta un helper de raíz, usarlo en lugar de esto.
  return process.env.UPLOADS_DIR ?? "./uploads";
}

export function makeDocumentStore(db: Pick<PrismaClient, "document">, rootDir?: string) {
  const root = () => rootDir ?? uploadsRoot();
  return {
    // Reemplaza el documento anterior del mismo tipo: re-subir el frente del
    // DNI no acumula versiones (el vecino corrigió una foto movida). El borrado
    // del archivo viejo es best-effort: un unlink fallido no puede dejar la
    // solicitud sin su documento nuevo.
    async saveApplicationDocument(input: {
      applicationId: number; type: DocumentType; data: Buffer;
    }): Promise<{ id: number }> {
      if (input.data.length === 0 || input.data.length > MAX_DOCUMENT_BYTES) {
        throw new Error("El archivo supera el máximo de 10 MB o está vacío.");
      }
      const kind = sniffDocument(input.data);
      if (!kind) throw new Error("Formato no admitido: subí una foto JPG/PNG/WebP o un PDF.");

      const relative = path.posix.join("applications", String(input.applicationId), `${randomUUID()}.${kind.ext}`);
      const absolute = path.join(root(), relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, input.data);

      const previous = await db.document.findFirst({
        where: { ownerType: "application", ownerId: input.applicationId, type: input.type },
      });
      const created = await db.document.create({
        data: {
          ownerType: "application", ownerId: input.applicationId, type: input.type,
          path: relative, mime: kind.mime, size: input.data.length,
        },
      });
      if (previous) {
        await db.document.delete({ where: { id: previous.id } });
        try { await unlink(path.join(root(), previous.path)); } catch { /* best-effort */ }
      }
      return { id: created.id };
    },

    async readDocumentFile(doc: { path: string }): Promise<Buffer> {
      return readFile(path.join(root(), doc.path));
    },
  };
}

export const documentStore = makeDocumentStore(prisma);
```

Detalle para los anexos: `type: "annex"` admite hasta 2 — el reemplazo por tipo
NO aplica a los anexos (si ya hay 2, la action de la Task 13 rechaza el
tercero; el reemplazo de arriba solo corre para `dni_front`/`dni_back`).
Ajustar el `if (previous)` así:

```ts
      const previous = input.type === "annex"
        ? null
        : await db.document.findFirst({
            where: { ownerType: "application", ownerId: input.applicationId, type: input.type },
          });
```

(y mover esa consulta ANTES del `create`, como está en el bloque principal).

- [ ] **Step 4: Verificar y commitear**

```bash
npm test
git add src/lib/documents/storage.ts tests/document-storage.test.ts
git commit -m "feat(documents): magic-byte validated storage under UPLOADS_DIR"
```

---

### Task 10: Emails del circuito de solicitud + `sendToApplication`

**Files:**
- Modify: `src/lib/email/templates.ts`
- Modify: `src/lib/email/index.ts`
- Test: `tests/application-emails.test.ts`

**Interfaces:**
- Produces (templates): `verifyUrl` pasa a ser **exported**; nuevas plantillas `applicationAcceptedEmail(opts: { name: string })`, `applicationReceivedEmail(opts: { name: string })`, `applicationRejectedEmail(opts: { entryFeeRetained: boolean })`, `applicationResumeEmail(opts: { url: string })`, `paymentReminderEmail(opts: { url: string })` — todas devuelven `Rendered = { subject, text, html }`.
- Produces (mailer): `mailer.sendToApplication(input: { applicationId: number; to: string; type: NotificationType; message: Rendered; summary: string }): Promise<{ messageId: string | null }>` — registra la `Notification` con `applicationId` y `memberId: null`.

- [ ] **Step 1: Tests que fallan**

`tests/application-emails.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  applicationAcceptedEmail, applicationReceivedEmail, applicationRejectedEmail,
  applicationResumeEmail, paymentReminderEmail,
} from "@/lib/email/templates";
import { makeMailer } from "@/lib/email";

describe("plantillas de solicitud", () => {
  it("aceptada: saluda por nombre y explica el asiento en acta", () => {
    const m = applicationAcceptedEmail({ name: "Ana Pérez" });
    expect(m.subject).toMatch(/aceptada/i);
    expect(m.text).toContain("Ana Pérez");
    expect(m.text).toMatch(/Comisión Directiva/);
    expect(m.text).toMatch(/fecha de ingreso/i);
  });
  it("rechazada: NO saluda por nombre, sin causa, y solo menciona el ingreso si se retuvo", () => {
    const sin = applicationRejectedEmail({ entryFeeRetained: false });
    const con = applicationRejectedEmail({ entryFeeRetained: true });
    expect(sin.text).not.toMatch(/cuota de ingreso/i);
    expect(con.text).toMatch(/cuota de ingreso/i);
    expect(con.text).toMatch(/no es reembolsable/i);
    expect(con.text).toMatch(/6 .*meses|seis meses/i);
  });
  it("retome y recordatorio llevan la URL en texto plano", () => {
    expect(applicationResumeEmail({ url: "https://x/asociate/retomar/T" }).text).toContain("/asociate/retomar/T");
    const r = paymentReminderEmail({ url: "https://x/asociate/retomar/T" });
    expect(r.text).toContain("/asociate/retomar/T");
    expect(r.text).toMatch(/7 días|vence/i);
  });
});

describe("mailer.sendToApplication", () => {
  it("envía primero y acredita la Notification con applicationId", async () => {
    const calls: string[] = [];
    const transport = { send: vi.fn(async () => { calls.push("send"); return { messageId: "m1" }; }) };
    const notification = { create: vi.fn(async () => { calls.push("record"); return {}; }) };
    const mailer = makeMailer({ transport, db: { notification } as never });
    await mailer.sendToApplication({
      applicationId: 55, to: "a@b.com", type: "application_result",
      message: { subject: "s", text: "t", html: "h" }, summary: "resumen",
    });
    expect(calls).toEqual(["send", "record"]);
    expect(notification.create.mock.calls[0][0].data).toMatchObject({
      applicationId: 55, memberId: null, via: "email", status: "sent", brevoMessageId: "m1",
    });
  });
  it("si el SMTP falla no acredita nada", async () => {
    const transport = { send: vi.fn().mockRejectedValue(new Error("smtp")) };
    const notification = { create: vi.fn() };
    const mailer = makeMailer({ transport, db: { notification } as never });
    await expect(
      mailer.sendToApplication({
        applicationId: 55, to: "a@b.com", type: "application_result",
        message: { subject: "s", text: "t", html: "h" }, summary: "x",
      }),
    ).rejects.toThrow();
    expect(notification.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y ver el fallo** — FAIL.

- [ ] **Step 3: Plantillas**

En `src/lib/email/templates.ts`: exportar `verifyUrl` (cambiar `function` por `export function`) y agregar al final:

```ts
// ── Módulo 3: circuito de la solicitud de alta ────────────────────────────────
//
// Criterio de nombres (mismo razonamiento que arriba): la ACEPTADA y la
// RECIBIDA sí saludan por nombre — la dirección la tipeó la propia persona en
// el wizard y confirmó el tipeo, no hay operador en el medio—. La RECHAZADA no
// saluda ni da causa: el estatuto no la exige (Art. 5 inc. 7) y el correo no
// tiene por qué cargar más datos que el hecho.

/** Aceptación automática (REG-12): el débito se autorizó y el primer pago entró. */
export function applicationAcceptedEmail(opts: { name: string }): Rendered {
  return {
    subject: "¡Tu solicitud fue aceptada! — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

¡Bienvenido/a! Tu solicitud de asociación fue aceptada.

El alta formal se asentará en la próxima reunión de la Comisión Directiva, y la fecha de esa acta será tu fecha de ingreso como socio/a.

Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder recibir el acceso al portal de socios apenas se asiente tu alta.${SIGNATURE}`,
    html: layout("¡Tu solicitud fue aceptada!", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>¡Bienvenido/a! Tu solicitud de asociación fue <strong>aceptada</strong>.</p>
<p>El alta formal se asentará en la próxima reunión de la Comisión Directiva, y la fecha de esa acta será tu <strong>fecha de ingreso</strong> como socio/a.</p>
<p>Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder recibir el acceso al portal de socios apenas se asiente tu alta.</p>`),
  };
}

/** Rama sin débito (adherente que no adhiere): la CD la trata en reunión. */
export function applicationReceivedEmail(opts: { name: string }): Rendered {
  return {
    subject: "Recibimos tu solicitud — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

Tu solicitud de asociación fue recibida y será tratada por la Comisión Directiva en su próxima reunión. Te vamos a avisar por este medio el resultado.

Te enviamos aparte un correo para verificar tu dirección de email.${SIGNATURE}`,
    html: layout("Recibimos tu solicitud", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Tu solicitud de asociación fue recibida y será tratada por la Comisión Directiva en su próxima reunión. Te vamos a avisar por este medio el resultado.</p>
<p>Te enviamos aparte un correo para verificar tu dirección de email.</p>`),
  };
}

/** Rechazo (REG-13): sin expresión de causa. La retención del ingreso solo se
 *  menciona si hubo débito (REG-12.b), citando los términos aceptados. */
export function applicationRejectedEmail(opts: { entryFeeRetained: boolean }): Rendered {
  const retained = opts.entryFeeRetained
    ? `\n\nLa cuota de ingreso abonada no es reembolsable, conforme a los términos y condiciones aceptados al enviar la solicitud.`
    : "";
  const retainedHtml = opts.entryFeeRetained
    ? `<p>La cuota de ingreso abonada <strong>no es reembolsable</strong>, conforme a los términos y condiciones aceptados al enviar la solicitud.</p>`
    : "";
  return {
    subject: "Sobre tu solicitud de asociación — Vecinal Ciudadela",
    text: `Te escribimos por tu solicitud de asociación a la ${ORG}.

La Comisión Directiva resolvió no hacer lugar a la solicitud.${retained}

Según el estatuto, podés presentar una nueva solicitud pasados 6 (seis) meses de esta resolución. Ante cualquier consulta, acercate a la sede vecinal.${SIGNATURE}`,
    html: layout("Sobre tu solicitud de asociación", `<p>Te escribimos por tu solicitud de asociación a la ${esc(ORG)}.</p>
<p>La Comisión Directiva resolvió no hacer lugar a la solicitud.</p>
${retainedHtml}
<p>Según el estatuto, podés presentar una nueva solicitud pasados 6 (seis) meses de esta resolución. Ante cualquier consulta, acercate a la sede vecinal.</p>`),
  };
}

/** Reenvío del enlace de retome ("ya tenés una solicitud en trámite"). */
export function applicationResumeEmail(opts: { url: string }): Rendered {
  return {
    subject: "Retomá tu solicitud — Vecinal Ciudadela",
    text: `Pediste retomar tu solicitud de asociación a la ${ORG}. Abrí este enlace para continuarla donde la dejaste:

${opts.url}

Si no fuiste vos, ignorá este correo.${SIGNATURE}`,
    html: layout("Retomá tu solicitud", `<p>Pediste retomar tu solicitud de asociación a la ${esc(ORG)}. Hacé clic para continuarla donde la dejaste:</p>
${button(opts.url, "Retomar mi solicitud")}
<p>Si no fuiste vos, ignorá este correo.</p>`),
  };
}

/** Recordatorio del cron (día 3 de pending_payment): el checkout quedó a medias. */
export function paymentReminderEmail(opts: { url: string }): Rendered {
  return {
    subject: "Tu solicitud está esperando el pago — Vecinal Ciudadela",
    text: `Tu solicitud de asociación a la ${ORG} quedó pendiente de autorizar el débito automático en Mercado Pago.

Podés retomarla desde este enlace:

${opts.url}

Si no completás el pago, la solicitud vence a los 7 días de iniciada y vas a tener que empezar de nuevo.${SIGNATURE}`,
    html: layout("Tu solicitud está esperando el pago", `<p>Tu solicitud de asociación a la ${esc(ORG)} quedó pendiente de autorizar el débito automático en Mercado Pago.</p>
${button(opts.url, "Retomar y completar el pago")}
<p>Si no completás el pago, la solicitud <strong>vence a los 7 días</strong> de iniciada y vas a tener que empezar de nuevo.</p>`),
  };
}
```

- [ ] **Step 4: `sendToApplication` en el mailer**

En `src/lib/email/index.ts`, ampliar `MailerDeps` y `makeMailer`:

```ts
type MailerDeps = { transport: MailTransport; db: Pick<PrismaClient, "notification"> };

export function makeMailer(deps: MailerDeps) {
  async function send(input: {
    memberId: number | null;
    applicationId: number | null;
    to: string;
    type: NotificationType;
    message: { subject: string; text: string; html: string };
    summary: string;
  }): Promise<{ messageId: string | null }> {
    // Primero el envío: si el SMTP falla, no queda registrada una
    // notificación que nunca salió.
    const { messageId } = await deps.transport.send({ to: input.to, ...input.message });
    await deps.db.notification.create({
      data: {
        memberId: input.memberId,
        applicationId: input.applicationId,
        type: input.type,
        via: "email",
        status: "sent",
        brevoMessageId: messageId,
        payloadSummary: input.summary,
      },
    });
    return { messageId };
  }
  return {
    sendToMember(input: {
      memberId: number | null; to: string; type: NotificationType;
      message: { subject: string; text: string; html: string }; summary: string;
    }) {
      return send({ ...input, applicationId: null });
    },
    // El destinatario todavía no es socio, pero el envío queda acreditado
    // igual (Art. 5° quater): la Notification cuelga de la solicitud.
    sendToApplication(input: {
      applicationId: number; to: string; type: NotificationType;
      message: { subject: string; text: string; html: string }; summary: string;
    }) {
      return send({ ...input, memberId: null });
    },
  };
}
```

- [ ] **Step 5: Verificar y commitear**

```bash
npm test
git add src/lib/email/ tests/application-emails.test.ts
git commit -m "feat(email): application lifecycle templates + sendToApplication"
```

---

### Task 11: Server actions públicas — crear solicitud y reenviar retome

**Files:**
- Create: `src/lib/applications/wizard.ts` (helpers puros)
- Create: `src/app/(public)/asociate/actions.ts`
- Modify: `src/lib/applications/service.ts` (agregar `rotateResumeToken`)
- Test: `tests/application-wizard.test.ts`, `tests/create-application-action.test.ts`

**Interfaces:**
- Produces (wizard.ts):

```ts
export const WEB_CATEGORIES = ["active", "adherent", "collaborator"] as const;
export function isAdult(birthDate: Date, now: Date): boolean; // 18+ en años civiles UTC
export function categoryAllowedForResidence(category: MemberCategory, livesInBarrio: boolean): boolean;
```

- Produces (actions.ts): `createApplicationAction(prev: CreateState, formData: FormData): Promise<CreateState>` con

```ts
type CreateState = {
  error?: string;
  blocked?: { code: "in_progress" | "already_member" | "visit_office" | "debt" | "rejected_wait"; message: string; retryAtIso?: string };
  created?: { resumeToken: string };
};
```

y `resendResumeLinkAction(prev: ResendState, formData: FormData): Promise<ResendState>` con `ResendState = { error?: string; done?: boolean }` (respuesta SIEMPRE genérica, anti-enumeración).
- Produces (service.ts): ~~`rotateResumeToken(applicationId)`~~ — **SUPERADO durante
  la ejecución (fix de la Task 11, commit `66a49eb`)**: rotar antes de enviar dejaba
  al vecino sin el enlace que ya tenía cuando el SMTP fallaba, y cada reintento lo
  volvía a romper. Lo reemplazan `mintResumeToken(): { raw, hash }` (no toca la base)
  y `commitResumeToken(applicationId, hash)`, en el orden **acuñar → enviar →
  persistir**. El código es la fuente de verdad; esta sección queda como registro.
- Consumes: `verifyTurnstile`, `applicationCreateLimiter`, `resumeResendLimiter`, `checkEligibility`, `applicationService`, `tokens.issue({ applicationId })`, `mailer.sendToApplication`, `verificationEmail`, `verifyUrl`, `applicationResumeEmail`, `parseForm`, `civilDateUtc`, `audit`.

- [ ] **Step 1: Tests de los helpers puros (fallan)**

`tests/application-wizard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryAllowedForResidence, isAdult, WEB_CATEGORIES } from "@/lib/applications/wizard";

describe("isAdult", () => {
  const now = new Date("2026-08-20T12:00:00Z");
  it("cumple 18 exactamente hoy → adulto", () => {
    expect(isAdult(new Date("2008-08-20T12:00:00Z"), now)).toBe(true);
  });
  it("los cumple mañana → menor", () => {
    expect(isAdult(new Date("2008-08-21T12:00:00Z"), now)).toBe(false);
  });
});

describe("categoryAllowedForResidence (REG-01 + Art. 5 bis)", () => {
  it("Ciudadela: active y adherent sí, collaborator no", () => {
    expect(categoryAllowedForResidence("active", true)).toBe(true);
    expect(categoryAllowedForResidence("adherent", true)).toBe(true);
    expect(categoryAllowedForResidence("collaborator", true)).toBe(false);
  });
  it("otro barrio: solo collaborator", () => {
    expect(categoryAllowedForResidence("collaborator", false)).toBe(true);
    expect(categoryAllowedForResidence("active", false)).toBe(false);
    expect(categoryAllowedForResidence("adherent", false)).toBe(false);
  });
  it("las categorías web son exactamente tres", () => {
    expect(WEB_CATEGORIES).toEqual(["active", "adherent", "collaborator"]);
  });
});
```

- [ ] **Step 2: Implementar `wizard.ts`**

```ts
// Reglas puras del wizard público (REG-01, REG-02). Separadas de la action
// para testearlas sin mocks.
import type { MemberCategory } from "@/generated/prisma/client";

export const WEB_CATEGORIES = ["active", "adherent", "collaborator"] as const;

// 18+ comparando fechas civiles en UTC (las dos vienen ancladas a mediodía
// UTC por civilDateUtc, así que la comparación por componentes es exacta).
export function isAdult(birthDate: Date, now: Date): boolean {
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate(), 12,
  ));
  return birthDate <= cutoff;
}

// Ciudadela → active | adherent; otro barrio → collaborator (Art. 5 y 5 bis).
export function categoryAllowedForResidence(category: MemberCategory, livesInBarrio: boolean): boolean {
  if (livesInBarrio) return category === "active" || category === "adherent";
  return category === "collaborator";
}
```

- [ ] **Step 3: `rotateResumeToken` en el servicio**

En `src/lib/applications/service.ts`, dentro del objeto retornado por `makeApplicationService`:

```ts
    // Para el reenvío del enlace de retome: no podemos recuperar el crudo (solo
    // guardamos el hash), así que se ROTA. El enlace anterior y cualquier
    // pestaña vieja quedan inválidos: el último pedido manda.
    async rotateResumeToken(applicationId: number): Promise<string> {
      const raw = randomBytes(32).toString("base64url");
      await db.application.update({
        where: { id: applicationId },
        data: { resumeTokenHash: hashToken(raw) },
      });
      return raw;
    },
```

- [ ] **Step 4: La action de creación**

`src/app/(public)/asociate/actions.ts`:

```ts
"use server";
// Las actions públicas del wizard. No hay sesión: la creación se protege con
// Turnstile + rate limit por IP, y el resto del circuito con el token de
// retome. Los mensajes de bloqueo vienen de checkEligibility y no revelan más
// de lo necesario (spec M3 §4).
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { civilDateUtc, parseCivilDate } from "@/lib/dates";
import { mailer } from "@/lib/email";
import { applicationResumeEmail, verificationEmail, verifyUrl } from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { applicationCreateLimiter, resumeResendLimiter } from "@/lib/auth/rate-limiter";
import { checkEligibility } from "@/lib/applications/eligibility";
import { applicationService } from "@/lib/applications/service";
import { categoryAllowedForResidence, isAdult, WEB_CATEGORIES } from "@/lib/applications/wizard";
import { tokens } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";

type CreateState = {
  error?: string;
  blocked?: { code: string; message: string; retryAtIso?: string };
  created?: { resumeToken: string };
};
type ResendState = { error?: string; done?: boolean };

const RESEND_DONE = "Si existe una solicitud en trámite con ese DNI, te reenviamos el enlace por email.";

const schema = z.object({
  livesInBarrio: z.enum(["si", "no"], { error: "Contanos dónde vivís." }),
  streetId: z.coerce.number().int().positive().optional(),
  streetText: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  neighborhood: z.string().max(60, "El barrio no puede superar los 60 caracteres").optional(),
  streetNumber: z.string().min(1, "Ingresá la altura").max(10, "La altura no puede superar los 10 caracteres"),
  requestedCategory: z.enum(WEB_CATEGORIES, { error: "Elegí la categoría." }),
  wantsDebit: z.enum(["si", "no"]).optional(),
  fullName: z.string().min(3, "Ingresá tu nombre y apellido").max(160, "El nombre no puede superar los 160 caracteres"),
  dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números, sin puntos)"),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá tu fecha de nacimiento"),
  civilStatus: z.string().min(1, "Ingresá tu estado civil").max(40, "El estado civil no puede superar los 40 caracteres"),
  nationality: z.string().min(1, "Ingresá tu nacionalidad").max(60, "La nacionalidad no puede superar los 60 caracteres"),
  occupation: z.string().min(1, "Ingresá tu ocupación").max(80, "La ocupación no puede superar los 80 caracteres"),
  phone: z.string().min(6, "Ingresá tu teléfono").max(40, "El teléfono no puede superar los 40 caracteres"),
  email: z.string().email("Ingresá un email válido").max(191, "El email no puede superar los 191 caracteres"),
  emailConfirm: z.string().min(1, "Repetí tu email"),
  acceptTerms: z.literal("on", { error: "Tenés que aceptar los términos y el consentimiento de datos." }),
});

async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-real-ip") ?? "unknown", userAgent: (h.get("user-agent") ?? "").slice(0, 255) };
}

export async function createApplicationAction(_p: CreateState, formData: FormData): Promise<CreateState> {
  const { ip, userAgent } = await requestMeta();

  if (!applicationCreateLimiter.allows(ip)) {
    return { error: "Demasiados intentos desde esta conexión. Probá de nuevo en un rato." };
  }
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { error: "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo." };
  applicationCreateLimiter.record(ip);

  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const data = parsed.data;

  if (data.email.trim().toLowerCase() !== data.emailConfirm.trim().toLowerCase()) {
    return { error: "Los dos emails no coinciden: revisá el tipeo." };
  }
  const livesInBarrio = data.livesInBarrio === "si";
  if (livesInBarrio && !data.streetId) return { error: "Elegí tu calle del listado del barrio." };
  if (!livesInBarrio && (!data.streetText || !data.neighborhood)) {
    return { error: "Ingresá tu calle y tu barrio." };
  }
  if (!categoryAllowedForResidence(data.requestedCategory, livesInBarrio)) {
    return { error: "La categoría elegida no corresponde a tu lugar de residencia. Volvé al paso 2." };
  }

  let birthDate: Date;
  try {
    birthDate = parseCivilDate(data.birthDate);
  } catch {
    return { error: "La fecha de nacimiento no es válida." };
  }
  if (!isAdult(birthDate, civilDateUtc(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, new Date().getUTCDate()))) {
    return { error: "Para asociarte por la web tenés que ser mayor de 18 años. Los cadetes (14-17) se asocian en la sede." };
  }

  // Elegibilidad por DNI (spec §4): corre DESPUÉS de Turnstile + rate limit.
  const now = new Date();
  const member = await prisma.member.findUnique({
    where: { dni: data.dni },
    select: { id: true, status: true, withdrawalReason: true, debtAtWithdrawal: true, reentryBlocked: true, rejectedUntil: true },
  });
  const [liveApplication, lastRejectionAt] = await Promise.all([
    applicationService.findLiveByDni(data.dni),
    applicationService.lastRejectionAt(data.dni),
  ]);
  const eligibility = checkEligibility({ member, liveApplication, lastRejectionAt, now });
  if (!eligibility.ok) {
    return {
      blocked: {
        code: eligibility.code,
        message: eligibility.error,
        retryAtIso: eligibility.code === "rejected_wait" ? eligibility.retryAt.toISOString() : undefined,
      },
    };
  }

  // wantsDebit solo tiene sentido para el adherente; activo y colaborador
  // SIEMPRE van con débito (cuota obligatoria, docs/05 §2).
  const wantsDebit = data.requestedCategory === "adherent" ? data.wantsDebit === "si" : true;

  let created: { id: number; resumeToken: string };
  try {
    created = await applicationService.create({
      fullName: data.fullName, dni: data.dni, birthDate,
      civilStatus: data.civilStatus, nationality: data.nationality,
      occupation: data.occupation, phone: data.phone, email: data.email.trim().toLowerCase(),
      streetId: livesInBarrio ? (data.streetId ?? null) : null,
      streetText: livesInBarrio ? null : (data.streetText ?? null),
      streetNumber: data.streetNumber,
      neighborhood: livesInBarrio ? null : (data.neighborhood ?? null),
      requestedCategory: data.requestedCategory, wantsDebit,
      memberId: eligibility.memberId, acceptedTermsAt: now, ip, userAgent,
    });
  } catch {
    // Carrera de dos POST con el mismo DNI: el segundo cae acá.
    return { blocked: { code: "in_progress", message: "Ya tenés una solicitud en trámite. Te podemos reenviar por email el enlace para retomarla." } };
  }

  // Verificación de email inmediata (REG-08). Best-effort: si el SMTP falla,
  // la solicitud sigue — el vecino puede verificar más adelante y el asiento
  // no depende de esto.
  try {
    const raw = await tokens.issue({ purpose: "email_verification", applicationId: created.id });
    const baseUrl = process.env.AUTH_URL ?? "";
    await mailer.sendToApplication({
      applicationId: created.id, to: data.email.trim().toLowerCase(), type: "email_verification",
      message: verificationEmail({ url: verifyUrl(baseUrl, raw) }),
      summary: "verificación de email de la solicitud",
    });
  } catch (e) {
    console.error("application verification email failed", (e as { code?: string })?.code ?? "unknown");
  }

  await audit({
    action: "application_created", entity: "application", entityId: created.id,
    detail: { category: data.requestedCategory, wantsDebit, reentry: eligibility.memberId !== null }, ip,
  });

  return { created: { resumeToken: created.resumeToken } };
}

export async function resendResumeLinkAction(_p: ResendState, formData: FormData): Promise<ResendState> {
  const { ip } = await requestMeta();
  if (!resumeResendLimiter.allows(ip)) {
    return { error: "Demasiados intentos desde esta conexión. Probá de nuevo en un rato." };
  }
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { error: "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo." };
  resumeResendLimiter.record(ip);

  const parsed = parseForm(z.object({ dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números, sin puntos)") }), formData);
  if (!parsed.ok) return { error: parsed.error };

  // Respuesta SIEMPRE genérica: este formulario no puede funcionar como
  // verificador de solicitudes por DNI.
  const live = await applicationService.findLiveByDni(parsed.data.dni);
  if (live) {
    try {
      const raw = await applicationService.rotateResumeToken(live.id);
      const baseUrl = process.env.AUTH_URL ?? "";
      await mailer.sendToApplication({
        applicationId: live.id, to: live.email, type: "generic",
        message: applicationResumeEmail({ url: `${baseUrl}/asociate/retomar/${raw}` }),
        summary: "reenvío del enlace de retome",
      });
      await audit({ action: "application_resume_link_sent", entity: "application", entityId: live.id, ip });
    } catch (e) {
      console.error("resume link email failed", (e as { code?: string })?.code ?? "unknown");
    }
  }
  return { done: true };
}
```

Nota sobre `parseCivilDate`: leer su firma real en `src/lib/dates.ts` antes de
usarla (si devuelve `null` en vez de lanzar, adaptar el manejo — el mensaje
es-AR de arriba no cambia).

- [ ] **Step 5: Test de la action (mocks al estilo del repo)**

`tests/create-application-action.test.ts` — con `vi.mock` de `@/lib/prisma`, `@/lib/turnstile`, `@/lib/tokens`, `@/lib/email`, `@/lib/audit`, `next/headers`, y `@/lib/applications/service`. Casos mínimos:

```ts
// 1. Turnstile inválido → { error } y NO se llama a applicationService.create.
// 2. DNI de socio vigente → { blocked: { code: "already_member" } } y NO create.
// 3. Camino feliz → { created.resumeToken }, audit con action "application_created"
//    y detail SIN dni ni email; el mailer recibió la verificación.
// 4. limiter agotado (mockear applicationCreateLimiter.allows → false) → { error }.
```

Escribir los cuatro con el patrón de `tests/news-actions-auth.test.ts` (usar
`vi.hoisted` para los mocks compartidos). El assert del punto 3 sobre el
detail: `expect(JSON.stringify(auditMock.mock.calls[0][0])).not.toMatch(/30111222|test@x/)`.

- [ ] **Step 6: Verificar y commitear**

```bash
npm test
git add src/lib/applications/ src/app/\(public\)/asociate/actions.ts tests/application-wizard.test.ts tests/create-application-action.test.ts
git commit -m "feat(asociate): create-application and resume-link server actions"
```

---

### Task 12: Wizard UI — página, stepper y pasos 1 a 3

> **REQUIRED SUB-SKILL antes de escribir JSX:** invocar `frontend-design:frontend-design`. El wizard es la cara pública más importante del sitio después de la home: mobile-first (el vecino entra desde el celular), tipografía y colores del sistema existente (`--primary`, tokens de M2), targets ≥44px, foco visible.

**Files:**
- Modify: `src/app/(public)/asociate/page.tsx` (reemplaza el placeholder)
- Create: `src/app/(public)/asociate/asociate-wizard.tsx` (client)
- Create: `src/components/public/turnstile-widget.tsx`
- Test: no unit (UI); smoke con dev server al final de la Task 13.

**Interfaces:**
- Consumes: `getAsociateActive`, `getLegalTexts`, `getFeeAmounts`, `formatARS`, `createApplicationAction`, `resendResumeLinkAction`, lista de calles (`prisma.street.findMany`).
- Produces: `<AsociateWizard streets legal fees siteKey initial?>` — `initial` lo usa la Task 13 para rehidratar desde `/asociate/retomar/[token]`.

- [ ] **Step 1: La página servidor**

`src/app/(public)/asociate/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getAsociateActive, getLegalTexts } from "@/lib/config";
import { getFeeAmounts } from "@/lib/mp/plans";
import { prisma } from "@/lib/prisma";
import { AsociateWizard } from "./asociate-wizard";

export const metadata: Metadata = { title: "Asociate" };

export default async function AsociatePage() {
  // La home ya esconde el botón, pero la URL es pública: revalidar acá.
  const active = await getAsociateActive();
  if (!active) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Asociate</h1>
        <p className="mt-4 text-muted-foreground">
          Las asociaciones están suspendidas temporalmente. Consultá en la sede vecinal.
        </p>
      </main>
    );
  }
  const [legal, fees, streets] = await Promise.all([
    getLegalTexts(),
    getFeeAmounts(),
    prisma.street.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, normalizedName: true } }),
  ]);
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <AsociateWizard
        streets={streets}
        legal={legal}
        fees={fees}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      />
    </main>
  );
}
```

- [ ] **Step 2: El widget de Turnstile**

`src/components/public/turnstile-widget.tsx` — modo implícito: el script de
Cloudflare renderiza todo `.cf-turnstile` e inyecta un `<input hidden
name="cf-turnstile-response">` dentro del form que lo contiene (la action lee
exactamente ese nombre):

```tsx
"use client";
import Script from "next/script";

// Widget implícito de Turnstile. Va DENTRO del <form>: Cloudflare inyecta el
// hidden input cf-turnstile-response que la server action valida con
// siteverify. El token es de un solo uso: tras un submit fallido hay que
// resetear (window.turnstile.reset re-emite).
export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="auto" data-language="es" />
    </>
  );
}
```

- [ ] **Step 3: El wizard cliente (estructura y pasos 1-3)**

`src/app/(public)/asociate/asociate-wizard.tsx`. Estructura obligatoria (el
detalle visual lo guía la skill de frontend-design):

- Estado: `const [step, setStep] = useState(1)` + un objeto `draft` con todos
  los campos de los pasos 1-3 (`useState<Draft>`), y `resumeToken` cuando la
  Task 13 rehidrata.
- Stepper: encabezado "Paso {step} de 5" + barra de progreso (`div` con
  `width: ${step * 20}%`, `bg-primary`, `aria-hidden`) + título del paso como
  `<h1>`; anunciar el cambio de paso con un `<p role="status" className="sr-only">`.
- **Paso 1 — ¿Dónde vivís?**: dos radios grandes ("En el Barrio Ciudadela" /
  "En otro barrio"). Rama Ciudadela: buscador de calle sobre las 40 calles
  pasadas por prop — un `<input>` con filtrado client-side contra
  `normalizedName` (normalizar el query: lowercase + sin tildes con
  `q.normalize("NFD").replace(/[̀-ͯ]/g, "")`) que también matchea
  `loadOrder` numérico; lista de resultados como botones; al elegir queda
  `streetId` + el nombre visible. Campo altura (`streetNumber`). Rama otro
  barrio: calle y barrio de texto libre + altura.
- **Paso 2 — Categoría**: tarjetas seleccionables según la rama. Ciudadela:
  ACTIVO (muestra `formatARS(fees.active)` + "/mes — obligatoria · voz y voto,
  podés ocupar cargos") y ADHERENTE (`formatARS(fees.shared)` + " voluntaria ·
  voz sin voto en asambleas; votás en elecciones"); si elige Adherente,
  sub-pregunta "¿Querés adherir al débito automático de la cuota voluntaria?"
  (radios Sí/No) y si marca Sí, el aviso suave de upgrade de docs/05 §2 con un
  botón "Cambiar a ACTIVO" (no bloquea). Otro barrio: única tarjeta COLABORADOR
  (`formatARS(fees.shared)` + "/mes — obligatoria") + aviso de que deberá
  acreditar vinculación con el barrio. **Si `fees === null`**: en lugar de las
  tarjetas, un aviso de error ("No pudimos obtener el valor de la cuota en este
  momento. Probá de nuevo más tarde.") y el botón Continuar deshabilitado — no
  se inventa un monto.
- **Paso 3 — Tus datos**: formulario con `useActionState(createApplicationAction, {})`.
  Campos controlados desde `draft`; los datos de los pasos 1-2 viajan como
  `<input type="hidden">` (livesInBarrio, streetId, streetText, neighborhood,
  streetNumber, requestedCategory, wantsDebit). Email + confirmación de email.
  Checkbox de términos con dos `<details>` (o modal) que muestran
  `legal.terms` y `legal.privacyConsent` con `whitespace-pre-line`.
  `<TurnstileWidget siteKey={siteKey} />` + botón submit con `pending`.
  - `state.error` → `<FormMessage kind="error" box>` (importarlo de
    `@/components/admin/form-message` — es agnóstico del panel).
  - `state.blocked` → pantalla de bloqueo que REEMPLAZA el formulario:
    `FormMessage kind="warning" box` con `blocked.message` (+ fecha
    `formatDateAR` si `retryAtIso`); si `code === "in_progress"`, debajo un
    mini-form con `useActionState(resendResumeLinkAction, {})`: campo DNI
    prellenado (hidden), su propio `<TurnstileWidget>`, botón "Reenviarme el
    enlace" y el texto de confirmación genérico al terminar.
  - `state.created` → `setResumeToken(state.created.resumeToken)` y `setStep(4)`
    (via `useEffect` sobre `state`).
- Navegación: botones "Volver" / "Continuar" (los pasos 1-2 validan localmente
  que haya selección antes de avanzar). Botón primario `bg-primary` con target
  ≥44px; todo control con `focus-visible` visible.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit
git add src/app/\(public\)/asociate/ src/components/public/turnstile-widget.tsx
git commit -m "feat(asociate): public wizard shell + steps 1-3"
```

---

### Task 13: Wizard pasos 4-5, retome y retorno de MP

**Files:**
- Modify: `src/app/(public)/asociate/actions.ts` (agregar 4 actions)
- Modify: `src/app/(public)/asociate/asociate-wizard.tsx` (pasos 4-5 + pantallas de estado)
- Create: `src/app/(public)/asociate/retomar/[token]/page.tsx`
- Create: `src/lib/applications/documents-rules.ts`
- Modify: `next.config.ts` (`bodySizeLimit: "12mb"` — el upload va de a UN archivo de hasta 10 MB + sobre multipart; el margen es para el sobre, mismo criterio del comentario existente)
- Test: `tests/application-documents-rules.test.ts`, `tests/application-upload-action.test.ts`

**Interfaces:**
- Produces (documents-rules.ts):

```ts
export const MAX_ANNEXES = 2;
export function requiredDocsComplete(
  docs: Array<{ type: DocumentType }>, category: MemberCategory,
): { ok: true } | { ok: false; error: string };
// dni_front + dni_back obligatorios; collaborator exige además ≥1 annex (REG-03)
```

- Produces (actions.ts):

```ts
uploadDocumentAction(prev: UploadState, formData: FormData): Promise<UploadState>
// campos: resumeToken, docType ("dni_front"|"dni_back"|"annex"), file (File)
// UploadState = { error?: string; uploaded?: { type: string; count: number } }
submitNoDebitAction(prev: SubmitState, formData: FormData): Promise<SubmitState>
// SubmitState = { error?: string; done?: boolean }
startPaymentAction(prev: PayState, formData: FormData): Promise<PayState>
// PayState = { error?: string; redirectUrl?: string }
applicationStatusAction(resumeToken: string): Promise<{ status: string } | { error: string }>
// para el polling de la pantalla "estamos confirmando tu pago"
```

- Consumes: `documentStore.saveApplicationDocument`, `MAX_DOCUMENT_BYTES`, `requiredDocsComplete`, `applicationService.findByResumeToken`, `mpGateway.createPreapproval`, `getFeeAmounts`, `CONFIG_KEYS` (ids de plan), `mailer.sendToApplication`, `applicationReceivedEmail`, `publicTokenLimiter`.
- Regla transversal de estas actions: **toda entrada se autentica con el token
  de retome** (`findByResumeToken`) y se verifica el estado esperado; el rate
  limit de los POST con token reutiliza `publicTokenLimiter` por IP.

- [ ] **Step 1: Tests de la regla de completitud (fallan)**

`tests/application-documents-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { requiredDocsComplete } from "@/lib/applications/documents-rules";

const d = (types: string[]) => types.map((type) => ({ type })) as never;

describe("requiredDocsComplete", () => {
  it("activo/adherente: frente + dorso alcanzan", () => {
    expect(requiredDocsComplete(d(["dni_front", "dni_back"]), "active").ok).toBe(true);
    expect(requiredDocsComplete(d(["dni_front", "dni_back"]), "adherent").ok).toBe(true);
  });
  it("falta el dorso → error nombrándolo", () => {
    const r = requiredDocsComplete(d(["dni_front"]), "active");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dorso/i);
  });
  it("colaborador exige al menos un anexo (REG-03)", () => {
    expect(requiredDocsComplete(d(["dni_front", "dni_back"]), "collaborator").ok).toBe(false);
    expect(requiredDocsComplete(d(["dni_front", "dni_back", "annex"]), "collaborator").ok).toBe(true);
  });
});
```

Implementación `src/lib/applications/documents-rules.ts`:

```ts
// Completitud documental del paso 4 (REG-03). Pura: la consumen la action de
// envío/pago y la pantalla del paso 4 para habilitar el botón.
import type { DocumentType, MemberCategory } from "@/generated/prisma/client";

export const MAX_ANNEXES = 2;

export function requiredDocsComplete(
  docs: Array<{ type: DocumentType }>,
  category: MemberCategory,
): { ok: true } | { ok: false; error: string } {
  const types = new Set(docs.map((d) => d.type));
  if (!types.has("dni_front")) return { ok: false, error: "Falta la foto del frente del DNI." };
  if (!types.has("dni_back")) return { ok: false, error: "Falta la foto del dorso del DNI." };
  if (category === "collaborator" && !docs.some((d) => d.type === "annex")) {
    return {
      ok: false,
      error: "Como colaborador/a tenés que adjuntar al menos un comprobante de vinculación con el barrio (título, factura, etc.).",
    };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Las cuatro actions**

Agregar a `src/app/(public)/asociate/actions.ts`:

```ts
// ── Pasos 4 y 5: operan sobre la solicitud autenticándose con el token ───────

type UploadState = { error?: string; uploaded?: { type: string; count: number } };
type SubmitState = { error?: string; done?: boolean };
type PayState = { error?: string; redirectUrl?: string };

const DOC_TYPES = ["dni_front", "dni_back", "annex"] as const;

// La URL de checkout de una suscripción es determinística: no persistimos el
// init_point, lo reconstruimos para el reintento ("volver al pago").
function checkoutUrlFor(preapprovalId: string): string {
  return `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=${preapprovalId}`;
}

async function appFromToken(formData: FormData) {
  const raw = String(formData.get("resumeToken") ?? "");
  if (!raw) return null;
  const { ip } = await requestMeta();
  if (!publicTokenLimiter.check(ip)) return null;
  return applicationService.findByResumeToken(raw);
}

export async function uploadDocumentAction(_p: UploadState, formData: FormData): Promise<UploadState> {
  const app = await appFromToken(formData);
  if (!app || app.status !== "started") {
    return { error: "No encontramos tu solicitud o ya no se puede modificar. Volvé a empezar desde /asociate." };
  }
  const docType = String(formData.get("docType") ?? "");
  if (!(DOC_TYPES as readonly string[]).includes(docType)) return { error: "Tipo de documento inválido." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí un archivo." };
  if (file.size > MAX_DOCUMENT_BYTES) return { error: "El archivo supera el máximo de 10 MB." };

  if (docType === "annex") {
    const annexes = await prisma.document.count({
      where: { ownerType: "application", ownerId: app.id, type: "annex" },
    });
    if (annexes >= MAX_ANNEXES) return { error: "Ya subiste los 2 anexos permitidos." };
  }

  try {
    await documentStore.saveApplicationDocument({
      applicationId: app.id,
      type: docType as (typeof DOC_TYPES)[number],
      data: Buffer.from(await file.arrayBuffer()),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No pudimos guardar el archivo." };
  }
  const count = await prisma.document.count({ where: { ownerType: "application", ownerId: app.id } });
  return { uploaded: { type: docType, count } };
}

export async function submitNoDebitAction(_p: SubmitState, formData: FormData): Promise<SubmitState> {
  const app = await appFromToken(formData);
  if (!app || app.status !== "started") return { error: "No encontramos tu solicitud o ya fue enviada." };
  if (!(app.requestedCategory === "adherent" && !app.wantsDebit)) {
    return { error: "Tu solicitud requiere autorizar el débito automático: usá el botón de pago." };
  }
  const docs = await prisma.document.findMany({
    where: { ownerType: "application", ownerId: app.id }, select: { type: true },
  });
  const complete = requiredDocsComplete(docs, app.requestedCategory);
  if (!complete.ok) return { error: complete.error };

  // UPDATE condicional por estado: dos envíos simultáneos escriben uno solo.
  const { count } = await prisma.application.updateMany({
    where: { id: app.id, status: "started" }, data: { status: "pending_board" },
  });
  if (count === 1) {
    try {
      await mailer.sendToApplication({
        applicationId: app.id, to: app.email, type: "application_result",
        message: applicationReceivedEmail({ name: app.fullName }),
        summary: "solicitud recibida (pendiente de CD)",
      });
    } catch (e) {
      console.error("application received email failed", (e as { code?: string })?.code ?? "unknown");
    }
    const { ip } = await requestMeta();
    await audit({ action: "application_submitted", entity: "application", entityId: app.id, detail: { branch: "no_debit" }, ip });
  }
  return { done: true };
}

export async function startPaymentAction(_p: PayState, formData: FormData): Promise<PayState> {
  const app = await appFromToken(formData);
  if (!app) return { error: "No encontramos tu solicitud. Volvé a empezar desde /asociate." };

  // Reintento: si ya hay suscripción creada, se vuelve al mismo checkout.
  if (app.status === "pending_payment" && app.preapprovalId) {
    return { redirectUrl: checkoutUrlFor(app.preapprovalId) };
  }
  if (app.status !== "started") return { error: "Tu solicitud ya fue enviada." };
  if (app.requestedCategory === "adherent" && !app.wantsDebit) {
    return { error: "Elegiste no adherir al débito: enviá la solicitud con el otro botón." };
  }
  const docs = await prisma.document.findMany({
    where: { ownerType: "application", ownerId: app.id }, select: { type: true },
  });
  const complete = requiredDocsComplete(docs, app.requestedCategory);
  if (!complete.ok) return { error: complete.error };

  const planKey = app.requestedCategory === "active" ? CONFIG_KEYS.mpPlanActiveId : CONFIG_KEYS.mpPlanSharedId;
  const planId = await configReader.getString(planKey);
  if (!planId) return { error: "El sistema de pagos no está configurado todavía. Probá más tarde o consultá en la sede." };

  let sub: { id: string; initPoint: string; status: string };
  try {
    sub = await mpGateway.createPreapproval({
      planId,
      payerEmail: app.email,
      externalReference: `solicitud:${app.id}`,
      backUrl: `${process.env.AUTH_URL ?? ""}/asociate/retomar/${String(formData.get("resumeToken"))}`,
    });
  } catch (e) {
    console.error("createPreapproval failed", e instanceof Error ? e.message : e);
    return { error: "No pudimos iniciar el pago en Mercado Pago. Probá de nuevo en unos minutos." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: app.id }, data: { status: "pending_payment", preapprovalId: sub.id },
    });
    await tx.mpSubscription.create({
      data: {
        preapprovalId: sub.id, planId, applicationId: app.id,
        status: sub.status, payerEmail: app.email,
      },
    });
  });
  const { ip } = await requestMeta();
  await audit({ action: "application_submitted", entity: "application", entityId: app.id, detail: { branch: "debit" }, ip });
  return { redirectUrl: sub.initPoint };
}

export async function applicationStatusAction(resumeToken: string): Promise<{ status: string } | { error: string }> {
  const { ip } = await requestMeta();
  if (!publicTokenLimiter.check(ip)) return { error: "rate_limited" };
  const app = await applicationService.findByResumeToken(resumeToken);
  if (!app) return { error: "not_found" };
  return { status: app.status };
}
```

Imports nuevos que necesita el archivo: `publicTokenLimiter` (de
`@/lib/auth/rate-limiter`), `documentStore`, `MAX_DOCUMENT_BYTES` (de
`@/lib/documents/storage`), `requiredDocsComplete`, `MAX_ANNEXES` (de
`@/lib/applications/documents-rules`), `mpGateway` (de `@/lib/mp/gateway`),
`configReader`, `CONFIG_KEYS` (de `@/lib/config`), `applicationReceivedEmail`.

- [ ] **Step 3: Test de guardas del upload**

`tests/application-upload-action.test.ts` — mocks `vi.mock` como en la Task 11:
1. token inexistente → `{ error }` sin tocar `documentStore`;
2. solicitud en `pending_board` → `{ error }` (solo `started` puede subir);
3. tercer `annex` → `{ error }` con "2 anexos";
4. camino feliz → llama `saveApplicationDocument` con el `applicationId` y devuelve `uploaded.count`.

- [ ] **Step 4: UI de los pasos 4-5 y pantallas de estado**

En `asociate-wizard.tsx`:

- **Paso 4 — Documentación**: tres slots (frente DNI, dorso DNI, anexos):
  cada slot es un mini-form `useActionState(uploadDocumentAction, {})` con
  `<input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment">`,
  hidden `resumeToken` y `docType`, botón "Subir" con `pending`, y estado
  visual subido/no subido (usar el `uploaded` del state + un estado local
  `docsUploaded: Set<string>`). Para colaborador, texto que explica el anexo
  obligatorio. Botón Continuar habilitado cuando frente+dorso (+anexo si
  colaborador) están subidos.
- **Paso 5 — Pago / envío**: dos ramas según `requestedCategory`/`wantsDebit`:
  - Débito: recuadro informativo destacado (borde `--warning`) con el texto de
    la cuota de ingreso NO reembolsable (docs/05 §2, copiar textual) y botón
    "Ir a Mercado Pago" → `useActionState(startPaymentAction, {})`; cuando el
    state trae `redirectUrl`, `window.location.assign(state.redirectUrl)` en un
    `useEffect`.
  - Sin débito: resumen + botón "Enviar solicitud" →
    `useActionState(submitNoDebitAction, {})`; con `done`, pantalla de éxito
    "Tu solicitud fue recibida" (mismo contenido que el email).
- **Pantallas de estado** (las usa también el retome): componente
  `ApplicationStatusScreen({ status, resumeToken, preapprovalId })`:
  - `pending_payment`: "Estamos confirmando tu pago…" + polling cada 5 s
    (máx. 24 intentos) llamando `applicationStatusAction(resumeToken)`; si pasa
    a `approved_pending_minute` → pantalla de bienvenida (texto de docs/05 §2
    paso 5); botón secundario "Volver al pago" (link a
    `checkoutUrlFor(preapprovalId)` — pasarlo por prop desde el servidor).
  - `approved_pending_minute`: bienvenida.
  - `pending_board`: recibida.
  - `expired` / `rejected`: aviso con enlace a `/asociate` (vencida) o el
    mensaje neutro de rechazo ("La solicitud fue resuelta; revisá tu email.").

- [ ] **Step 5: La página de retome**

`src/app/(public)/asociate/retomar/[token]/page.tsx`:

```tsx
import { applicationService } from "@/lib/applications/service";
import { getLegalTexts } from "@/lib/config";
import { getFeeAmounts } from "@/lib/mp/plans";
import { prisma } from "@/lib/prisma";
import { AsociateWizard } from "../../asociate-wizard";

// GET sin efectos: solo lee (el token de retome no se consume, es la llave
// de la solicitud mientras viva). El escáner de un cliente de correo que abra
// el enlace no rompe nada.
export default async function RetomarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const app = await applicationService.findByResumeToken(token);
  if (!app || app.status === "expired" || app.status === "rejected" || app.status === "completed") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Solicitud no disponible</h1>
        <p className="mt-4 text-muted-foreground">
          El enlace no corresponde a una solicitud en trámite. Si querés asociarte, empezá de nuevo.
        </p>
        <a href="/asociate" className="mt-6 inline-block text-primary underline">Ir a ASOCIATE</a>
      </main>
    );
  }
  const docs = await prisma.document.findMany({
    where: { ownerType: "application", ownerId: app.id }, select: { type: true },
  });
  const [legal, fees] = await Promise.all([getLegalTexts(), getFeeAmounts()]);
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <AsociateWizard
        streets={[]} legal={legal} fees={fees}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        initial={{
          resumeToken: token,
          status: app.status,
          requestedCategory: app.requestedCategory,
          wantsDebit: app.wantsDebit,
          preapprovalId: app.preapprovalId,
          uploadedTypes: docs.map((d) => d.type),
          fullName: app.fullName,
        }}
      />
    </main>
  );
}
```

En el wizard, `initial` decide la pantalla: `status === "started"` → paso 4
(o 5 si los docs están completos, usando `requiredDocsComplete` — importable
porque es pura); cualquier otro estado → `ApplicationStatusScreen`.

- [ ] **Step 6: Smoke manual + commit**

Con el dev server (usar la preview del entorno, no Bash): recorrer
`/asociate` de punta a punta con las claves dummy de Turnstile y sin MP
configurado (la rama adherente-sin-débito debe completarse entera; la rama con
débito debe llegar al paso 5 y mostrar el error es-AR de MP no configurado).
Verificar en la DB que la solicitud, los documentos y los archivos en
`./uploads/applications/{id}/` existen.

```bash
npm test
git add -A
git commit -m "feat(asociate): wizard steps 4-5, resume flow and MP checkout handoff"
```

---

### Task 14: Webhook de Mercado Pago — procesador y ruta

**Files:**
- Create: `src/lib/mp/webhook-processor.ts`
- Create: `src/app/api/webhooks/mp/route.ts`
- Test: `tests/mp-webhook-processor.test.ts`, `tests/mp-webhook-route.test.ts`

**Interfaces:**
- Produces:

```ts
// webhook-processor.ts
export type WebhookInput = { topic: string; dataId: string };
export function makeWebhookProcessor(deps: {
  db: Pick<PrismaClient, "application" | "mpSubscription" | "$transaction">;
  gateway: Pick<MpGateway, "getPayment" | "getPreapproval" | "getAuthorizedPayment">;
  mailer: Pick<typeof mailer, "sendToApplication">;
}): { process(input: WebhookInput): Promise<string> }; // devuelve el `result`
export const webhookProcessor: ...;
```

- Resultados posibles (VarChar(64) de `WebhookEvent.result`): `application_approved`, `already_processed`, `payment_rejected`, `payment_ignored`, `subscription_synced`, `authorized_payment_traced`, `no_match`, `unknown_topic`.

- [ ] **Step 1: Tests del procesador (fallan)**

`tests/mp-webhook-processor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeWebhookProcessor } from "@/lib/mp/webhook-processor";

function deps(payment?: Partial<{ status: string; externalReference: string | null; transactionAmount: number }>) {
  const application = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue({ id: 55, fullName: "Ana Pérez", email: "a@b.com", status: "approved_pending_minute" }),
  };
  const mpSubscription = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const db = {
    application, mpSubscription,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ application, mpSubscription })),
  };
  const gateway = {
    getPayment: vi.fn().mockResolvedValue({
      id: "777", status: "approved", transactionAmount: 6000, externalReference: "solicitud:55", ...payment,
    }),
    getPreapproval: vi.fn().mockResolvedValue({ id: "pre-1", status: "authorized", payerEmail: "a@b.com", externalReference: "solicitud:55" }),
    getAuthorizedPayment: vi.fn().mockResolvedValue({ id: "9", preapprovalId: "pre-1", status: "processed" }),
  };
  const mailerMock = { sendToApplication: vi.fn().mockResolvedValue({ messageId: "m" }) };
  return { db: db as never, gateway: gateway as never, mailer: mailerMock as never, application, mailerMock };
}

describe("webhookProcessor payments", () => {
  it("pago aprobado de una solicitud pendiente → transición + email de aceptada", async () => {
    const d = deps();
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    const upd = d.application.updateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: 55, status: "pending_payment" });
    expect(upd.data).toMatchObject({ status: "approved_pending_minute", mpPaymentIdEntry: "777" });
    // UN solo email acá (la bienvenida): la verificación ya salió al crear la
    // solicitud (Task 11) y no se repite.
    expect(d.mailerMock.sendToApplication).toHaveBeenCalledTimes(1);
  });
  it("reintento (updateMany count 0) → already_processed y SIN email", async () => {
    const d = deps();
    d.application.updateMany.mockResolvedValue({ count: 0 });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("already_processed");
    expect(d.mailerMock.sendToApplication).not.toHaveBeenCalled();
  });
  it("pago rechazado → payment_rejected sin transición", async () => {
    const d = deps({ status: "rejected" });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("payment_rejected");
    expect(d.application.updateMany).not.toHaveBeenCalled();
  });
  it("external_reference ajena → no_match (nunca error)", async () => {
    const d = deps({ externalReference: "otra-cosa" });
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "payment", dataId: "777" })).resolves.toBe("no_match");
  });
});

describe("webhookProcessor subscriptions", () => {
  it("subscription_preapproval sincroniza el status local", async () => {
    const d = deps();
    const p = makeWebhookProcessor(d);
    await expect(p.process({ topic: "subscription_preapproval", dataId: "pre-1" })).resolves.toBe("subscription_synced");
  });
  it("tópico desconocido → unknown_topic", async () => {
    const p = makeWebhookProcessor(deps());
    await expect(p.process({ topic: "raro", dataId: "1" })).resolves.toBe("unknown_topic");
  });
});
```

- [ ] **Step 2: Implementar el procesador**

`src/lib/mp/webhook-processor.ts`:

```ts
// Procesamiento de webhooks de MP (docs/06 §4), inline y idempotente. El
// registro crudo y la respuesta HTTP viven en la ruta; acá solo la reacción a
// cada tópico. Todo camino "raro" devuelve un result y NO lanza: lo que lanza
// es un fallo real (DB caída, MP caído) y la ruta lo convierte en 500 para que
// MP reintente.
import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { mailer } from "@/lib/email";
import { applicationAcceptedEmail } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";
import { mpGateway, type MpGateway } from "./gateway";

export type WebhookInput = { topic: string; dataId: string };

const APPLICATION_REF = /^solicitud:(\d+)$/;

type Deps = {
  db: Pick<PrismaClient, "application" | "mpSubscription" | "$transaction">;
  gateway: Pick<MpGateway, "getPayment" | "getPreapproval" | "getAuthorizedPayment">;
  mailer: { sendToApplication(input: never): Promise<{ messageId: string | null }> } | typeof mailer;
};

export function makeWebhookProcessor(deps: Deps) {
  async function onPayment(dataId: string): Promise<string> {
    const payment = await deps.gateway.getPayment(dataId);
    const match = payment.externalReference?.match(APPLICATION_REF);
    if (!match) return "no_match";
    const applicationId = Number(match[1]);

    if (payment.status === "rejected") return "payment_rejected";
    if (payment.status !== "approved") return "payment_ignored";

    // UPDATE condicional por estado = idempotencia de la transición: el
    // reintento del mismo evento (o un segundo pago del ciclo) ve count 0.
    const { count } = await deps.db.application.updateMany({
      where: { id: applicationId, status: "pending_payment" },
      data: {
        status: "approved_pending_minute",
        mpPaymentIdEntry: payment.id,
        entryAmount: new Prisma.Decimal(payment.transactionAmount.toFixed(2)),
      },
    });
    if (count === 0) return "already_processed";

    const app = await deps.db.application.findUnique({ where: { id: applicationId } });
    if (app) {
      // Best-effort: el estado ya cambió; un SMTP caído no puede des-aceptar.
      try {
        await (deps.mailer as typeof mailer).sendToApplication({
          applicationId: app.id, to: app.email, type: "application_result",
          message: applicationAcceptedEmail({ name: app.fullName }),
          summary: "solicitud aceptada (débito autorizado)",
        });
      } catch (e) {
        console.error("accepted email failed", (e as { code?: string })?.code ?? "unknown");
      }
    }
    return "application_approved";
  }

  async function onPreapproval(dataId: string): Promise<string> {
    const pre = await deps.gateway.getPreapproval(dataId);
    const { count } = await deps.db.mpSubscription.updateMany({
      where: { preapprovalId: pre.id },
      data: { status: pre.status, lastSyncAt: new Date() },
    });
    return count > 0 ? "subscription_synced" : "no_match";
  }

  async function onAuthorizedPayment(dataId: string): Promise<string> {
    // M3 solo lo traza (queda en el WebhookEvent); la aplicación a cuotas es M4.
    await deps.gateway.getAuthorizedPayment(dataId);
    return "authorized_payment_traced";
  }

  return {
    async process(input: WebhookInput): Promise<string> {
      switch (input.topic) {
        case "payment":
        case "payments":
          return onPayment(input.dataId);
        case "subscription_preapproval":
          return onPreapproval(input.dataId);
        case "subscription_authorized_payment":
          return onAuthorizedPayment(input.dataId);
        default:
          return "unknown_topic";
      }
    },
  };
}

export const webhookProcessor = makeWebhookProcessor({ db: prisma, gateway: mpGateway, mailer });
```

- [ ] **Step 3: La ruta**

`src/app/api/webhooks/mp/route.ts`:

```ts
// POST /api/webhooks/mp — recepción de webhooks (docs/06 §4).
// 1. Firma inválida → 401 SIN persistir el payload (no llenar la base con
//    basura anónima). 2. Registro crudo con idempotencia [origin, event id]:
//    un duplicado YA procesado responde 200 sin efectos; uno que quedó sin
//    processedAt (el intento anterior falló) se reprocesa sobre la misma fila.
// 3. Error de procesamiento → queda en `error` y se responde 500: MP reintenta
//    con backoff y el paso 2 garantiza que reintentar es seguro.
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { validateMpSignature } from "@/lib/mp/signature";
import { webhookProcessor } from "@/lib/mp/webhook-processor";
import type { WebhookEvent } from "@/generated/prisma/client";

export async function POST(req: NextRequest) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 500 });

  const url = new URL(req.url);
  let body: { id?: unknown; type?: unknown; topic?: unknown; data?: { id?: unknown } } | null = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  // MP firma el data.id que viaja en la query string de la notificación.
  const dataId = url.searchParams.get("data.id") ?? String(body?.data?.id ?? "");
  const valid = validateMpSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId: dataId.toLowerCase(),
    secret,
  });
  if (!valid) {
    await audit({
      action: "webhook_rejected_signature", entity: "webhook",
      ip: req.headers.get("x-real-ip") ?? "unknown",
    });
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const topic = String(body?.type ?? body?.topic ?? url.searchParams.get("type") ?? "unknown");
  const externalEventId = String(body?.id ?? `${topic}:${dataId}`).slice(0, 128);

  // Insert-or-find: la unique [origin, externalEventId] decide.
  let event: WebhookEvent;
  try {
    event = await prisma.webhookEvent.create({
      data: { origin: "mp", externalEventId, topic: topic.slice(0, 64), payload: body ?? {} },
    });
  } catch {
    const existing = await prisma.webhookEvent.findUnique({
      where: { origin_externalEventId: { origin: "mp", externalEventId } },
    });
    if (!existing) return Response.json({ error: "storage" }, { status: 500 });
    if (existing.processedAt) {
      return Response.json({ result: "ignored_duplicate" }, { status: 200 });
    }
    event = existing; // el intento anterior murió a mitad: reprocesar
  }

  try {
    const result = await webhookProcessor.process({ topic, dataId });
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), result: result.slice(0, 64), error: null },
    });
    return Response.json({ result }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 500) : "unknown";
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { error: message } }).catch(() => {});
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Test de la ruta**

`tests/mp-webhook-route.test.ts` — mockear `@/lib/prisma`, `@/lib/mp/webhook-processor`, `@/lib/audit`; firmar con el helper real (`createHmac`, como en `tests/mp-signature.test.ts`) usando `process.env.MP_WEBHOOK_SECRET = "test-secret"`:
1. firma inválida → 401, `webhookEvent.create` NO llamado, `audit` con `webhook_rejected_signature`;
2. evento nuevo → 200, `create` + `process` + `update` con `processedAt`;
3. duplicado ya procesado (create rechaza, `findUnique` devuelve fila con `processedAt`) → 200 `ignored_duplicate`, `process` NO llamado;
4. `process` lanza → 500 y `update` con `error`.

Construir el `NextRequest` con `new Request(url, { method: "POST", headers, body: JSON.stringify(...) })` casteado, como hace `tests/padron-export-route.test.ts` (leerlo para copiar el patrón).

- [ ] **Step 5: Verificar y commitear**

```bash
npm test
git add src/lib/mp/webhook-processor.ts src/app/api/webhooks/ tests/mp-webhook-processor.test.ts tests/mp-webhook-route.test.ts
git commit -m "feat(mp): signed idempotent webhook endpoint with inline processing"
```

---

### Task 15: `/verificar/[token]` — tokens de solicitud

**Files:**
- Modify: `src/app/(public)/verificar/[token]/page.tsx` y su `actions.ts` (LEER AMBOS antes: el circuito actual usa `tokens.peek` en el GET y consume en el POST vía `memberAccess.verifyEmail`)
- Test: `tests/application-verify.test.ts`

**Interfaces:**
- Consumes: `tokens.peek/consume`, `applicationService.verifyEmail`, `audit`.
- Comportamiento nuevo: un token `email_verification` cuyo `applicationId` no es null verifica la SOLICITUD (marca `emailVerifiedAt`) en lugar de una ficha. La página de éxito NO ofrece crear contraseña (la invitación llega al asentar el alta, spec §6).

- [ ] **Step 1: Test que falla**

`tests/application-verify.test.ts` — mockear `@/lib/tokens`, `@/lib/applications/service`, `@/lib/audit` y el módulo de acceso de socios; verificar:
1. token con `applicationId: 55` → se llama `applicationService.verifyEmail(55)` y NO el circuito de socios;
2. auditoría `application_email_verified` con `entityId: 55` y sin email en `detail`;
3. token con `memberId` (sin applicationId) → el circuito de socios sigue intacto (se llama exactamente lo que se llamaba antes — fijarlo leyendo la action actual).

- [ ] **Step 2: Implementar la rama**

En la action del POST de `/verificar/[token]` (delante del circuito de socios existente):

```ts
  // Rama de SOLICITUD (M3): el token pertenece a una Application, no a una
  // ficha. Consume + marca verificada; sin invitación de contraseña — la
  // cuenta recién puede existir cuando el asiento cree la ficha (spec §6).
  const peeked = await tokens.peek(raw, "email_verification");
  if (peeked?.applicationId) {
    const consumed = await tokens.consume(raw, "email_verification");
    if (!consumed) return { error: "El enlace ya fue usado o venció." };
    await applicationService.verifyEmail(peeked.applicationId);
    await audit({
      action: "application_email_verified", entity: "application",
      entityId: peeked.applicationId, ip,
    });
    return { verified: "application" };
  }
```

y en la página/formulario, con `verified === "application"`, mostrar la
confirmación con el texto: "¡Listo! Confirmaste tu email. Cuando la Comisión
Directiva asiente tu alta vas a recibir la invitación para crear tu
contraseña." — adaptar los nombres exactos de `State` al archivo real.

El GET (que solo hace `peek`) también debe tolerar tokens de solicitud:
mostrar el mismo formulario de confirmación (el texto genérico actual ya no
nombra al socio, sirve tal cual).

- [ ] **Step 3: Verificar y commitear**

```bash
npm test
git add src/app/\(public\)/verificar/ tests/application-verify.test.ts
git commit -m "feat(asociate): email verification for applications via /verificar"
```

---

### Task 16: Bandeja admin — nav, listado, detalle y visor de documentos

**Files:**
- Modify: `src/lib/admin/nav.ts` (ítem Solicitudes), `src/lib/admin/dashboard-cards.ts` (href a la tarjeta)
- Create: `src/lib/applications/query.ts`
- Create: `src/app/admin/solicitudes/page.tsx`
- Create: `src/app/admin/solicitudes/[id]/page.tsx`
- Create: `src/app/api/admin/solicitudes/[id]/documentos/[docId]/route.ts`
- Test: `tests/applications-query.test.ts` (+ `tests/admin-nav.test.ts` y `tests/dashboard-cards.test.ts` deben seguir en verde SOLOS — si fallan, el cambio de nav quedó mal)

**Interfaces:**
- Produces (nav): ítem `{ href: "/admin/solicitudes", label: "Solicitudes", icon: "inbox" }` — agregar `"inbox"` a `AdminNavIcon` y mapear `Inbox` de lucide en `admin-nav-list.tsx` (leerlo: el mapa icono→componente vive ahí).
- Produces (query.ts):

```ts
export type ApplicationFilters = { q?: string; status?: ApplicationStatus };
export function parseApplicationFilters(sp: Record<string, string | undefined>): ApplicationFilters;
export function applicationsWhere(f: ApplicationFilters): Prisma.ApplicationWhereInput;
export function makeApplicationQueries(db: Pick<PrismaClient, "application">): {
  fetchPage(f: ApplicationFilters, page: number): Promise<{ rows: ApplicationRow[]; total: number }>;
};
export const APPLICATIONS_PAGE_SIZE = 50;
```

- [ ] **Step 1: Nav y tarjeta**

En `ADMIN_NAV`, grupo "Gestión", como PRIMER ítem (es la bandeja de trabajo diario):

```ts
      { href: "/admin/solicitudes", label: "Solicitudes", icon: "inbox" },
```

En `dashboard-cards.ts`, la tarjeta existente "Solicitudes" recibe
`href: "/admin/solicitudes"` y `cta: "Ver la bandeja"` (el orden de la tarjeta
ya coincide con el del nav: primero Solicitudes). Correr
`npx vitest run tests/admin-nav.test.ts tests/dashboard-cards.test.ts` —
**fallarán hasta que exista `src/app/admin/solicitudes/page.tsx`** (el test de
nav verifica contra el filesystem): crear primero la página del Step 3 y
recién entonces correrlos.

- [ ] **Step 2: Queries con test**

`tests/applications-query.test.ts` (patrón de `tests/members-query.test.ts`, leerlo):

```ts
import { describe, expect, it } from "vitest";
import { applicationsWhere, parseApplicationFilters } from "@/lib/applications/query";

describe("parseApplicationFilters", () => {
  it("acepta estados válidos y descarta basura", () => {
    expect(parseApplicationFilters({ status: "pending_board" })).toEqual({ status: "pending_board" });
    expect(parseApplicationFilters({ status: "nope" })).toEqual({});
  });
});

describe("applicationsWhere", () => {
  it("sin filtros no restringe nada", () => {
    expect(applicationsWhere({})).toEqual({});
  });
  it("q numérica busca por DNI con prefijo; q de texto por nombre", () => {
    expect(applicationsWhere({ q: "301" })).toEqual({ dni: { startsWith: "301" } });
    expect(applicationsWhere({ q: "pérez" })).toEqual({ fullName: { contains: "pérez" } });
  });
  it("el OR de búsqueda convive con el filtro de estado", () => {
    expect(applicationsWhere({ q: "301", status: "started" })).toEqual({
      dni: { startsWith: "301" }, status: "started",
    });
  });
});
```

`src/lib/applications/query.ts`:

```ts
// Filtros y paginado de la bandeja (patrón members/query.ts).
import type { ApplicationStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const APPLICATIONS_PAGE_SIZE = 50;

const STATUSES: ApplicationStatus[] = [
  "started", "pending_payment", "approved_pending_minute", "pending_board", "completed", "rejected", "expired",
];

export type ApplicationFilters = { q?: string; status?: ApplicationStatus };

export function parseApplicationFilters(sp: Record<string, string | undefined>): ApplicationFilters {
  const f: ApplicationFilters = {};
  const q = sp.q?.trim();
  if (q) f.q = q;
  if (sp.status && (STATUSES as string[]).includes(sp.status)) f.status = sp.status as ApplicationStatus;
  return f;
}

export function applicationsWhere(f: ApplicationFilters): Prisma.ApplicationWhereInput {
  const where: Prisma.ApplicationWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.q) {
    if (/^\d+$/.test(f.q)) where.dni = { startsWith: f.q };
    else where.fullName = { contains: f.q };
  }
  return where;
}

export function makeApplicationQueries(db: Pick<PrismaClient, "application">) {
  return {
    async fetchPage(f: ApplicationFilters, page: number) {
      const where = applicationsWhere(f);
      const [rows, total] = await Promise.all([
        db.application.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * APPLICATIONS_PAGE_SIZE,
          take: APPLICATIONS_PAGE_SIZE,
          select: {
            id: true, fullName: true, dni: true, requestedCategory: true, wantsDebit: true,
            status: true, memberId: true, createdAt: true, emailVerifiedAt: true,
          },
        }),
        db.application.count({ where }),
      ]);
      return { rows, total };
    },
  };
}

export const applicationQueries = makeApplicationQueries(prisma);
```

- [ ] **Step 3: Listado**

`src/app/admin/solicitudes/page.tsx` — calcar la estructura de
`src/app/admin/socios/page.tsx` (leerla): `PageHeader` con
`title="Solicitudes de asociación"` y en `actions` el link "Resumen para acta"
(`/admin/solicitudes/resumen`, botón `variant="outline"` — la página llega en
la Task 19, crearla igual: el link puede quedar desde ya). Form GET con input
`q` y `<select name="status">` (opciones desde `APPLICATION_STATUS_LABELS` +
"Todos"). Tabla: Nº, Nombre, DNI, Categoría (labels de members), Débito
(Sí/No), Estado (`Badge variant={applicationStatusBadgeVariant(...)}` +
label), badge extra `Reingreso` (`variant="secondary"`) cuando
`memberId !== null`, Fecha (`formatDateAR(createdAt)`), y link "Ver" a
`/admin/solicitudes/[id]`. `EmptyState` con "No hay solicitudes que coincidan
con los filtros." y CTA "Limpiar filtros" si hay filtros. Paginación con
`APPLICATIONS_PAGE_SIZE` conservando filtros (helper `pageHref` como en socios).
Autorización: la página llama `await requireAdmin()` y ante `!ok` replica lo
que hace `socios/page.tsx` (leerlo — el layout ya bloquea, pero la página se
autoriza a sí misma igual).

- [ ] **Step 4: Detalle con visor de documentos**

`src/app/admin/solicitudes/[id]/page.tsx`: `requireAdmin()`, cargar la
solicitud con `prisma.application.findUnique({ where: { id }, include: { street: true, member: { select: { id: true, fullName: true } }, minute: true, subscriptions: true } })` +
`prisma.document.findMany({ where: { ownerType: "application", ownerId: id } })` +
`prisma.notification.findMany({ where: { applicationId: id }, orderBy: { sentAt: "desc" } })`.
`PageHeader`: **la entidad va en el `<h1>`** → `title={app.fullName}`,
`breadcrumb=[{label:"Solicitudes", href:"/admin/solicitudes"}, {label:\`Solicitud #\${app.id}\`}]`
(última miga sustantivo corto). Secciones en Cards:

1. **Estado**: badge + label, categoría solicitada, débito, fecha de creación,
   `Reingreso de {member.fullName}` con link a la ficha si `memberId`,
   estado del email ("Verificado el DD/MM" o "Sin verificar").
2. **Datos personales**: DNI, nacimiento (`formatDateAR`), estado civil,
   nacionalidad, ocupación, teléfono, email, domicilio (calle del catálogo o
   texto libre + altura + barrio).
3. **Documentación**: lista de documentos con tipo (labels: "DNI — frente",
   "DNI — dorso", "Anexo"), tamaño legible y link "Ver" que abre
   `/api/admin/solicitudes/{id}/documentos/{docId}` en pestaña nueva
   (`target="_blank" rel="noopener"`). Si no hay documentos, `EmptyState size="card"`.
4. **Pago / suscripción**: `preapprovalId`, estado de la MpSubscription,
   `mpPaymentIdEntry` y `entryAmount` con `formatARS(Number(entryAmount))` si
   existen.
5. **Notificaciones**: tipo + fecha + estado (como la ficha de socio).
6. **Acciones** (Task 18 las llena; en esta task dejar la Card con los
   botones deshabilitados o directamente omitirla y agregarla en la 18).

- [ ] **Step 5: La ruta del documento (auditada)**

`src/app/api/admin/solicitudes/[id]/documentos/[docId]/route.ts` — calcar la
estructura de `src/app/api/admin/padron-export/route.ts` (auth, IP, headers):

```ts
// GET del archivo de un documento de solicitud. Documentos personales
// (docs/08): solo admin, sin caché, y CADA visualización queda auditada
// (application_document_view) — es el equivalente digital de abrir la carpeta
// del socio.
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { documentStore } from "@/lib/documents/storage";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response("No autorizado", { status: 403 });

  const { id, docId } = await params;
  const applicationId = Number(id);
  const documentId = Number(docId);
  if (!Number.isInteger(applicationId) || !Number.isInteger(documentId)) {
    return new Response("No encontrado", { status: 404 });
  }
  const doc = await prisma.document.findFirst({
    where: { id: documentId, ownerType: "application", ownerId: applicationId },
  });
  if (!doc) return new Response("No encontrado", { status: 404 });

  let data: Buffer;
  try {
    data = await documentStore.readDocumentFile(doc);
  } catch {
    return new Response("El archivo no está disponible", { status: 404 });
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "application_document_view", entity: "document",
    entityId: doc.id, detail: { applicationId, type: doc.type }, ip,
  });

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": "inline",
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
```

- [ ] **Step 6: Verificar y commitear**

```bash
npm test
git add -A
git commit -m "feat(admin): applications inbox, detail view and audited document route"
```

Expected: `admin-nav` y `dashboard-cards` en verde con la sección nueva.

---

### Task 17: Asentar en acta (masivo) — alta común y reingreso

**Files:**
- Create: `src/lib/applications/record.ts`
- Create: `src/app/admin/solicitudes/actions.ts`
- Modify: `src/app/admin/solicitudes/page.tsx` (checkboxes de selección + form de asiento con `minute-picker`)
- Test: `tests/application-record.test.ts`, `tests/applications-actions-auth.test.ts`

**Interfaces:**
- Produces (record.ts):

```ts
export type RecordResult =
  | { ok: true; applicationId: number; memberId: number; memberNumber: number | null; reentry: boolean }
  | { ok: false; applicationId: number; error: string };
export function makeApplicationRecorder(db: PrismaClient): {
  recordOne(input: { applicationId: number; minuteId: number; actorId: number }): Promise<RecordResult>;
};
export const applicationRecorder: ...;
```

- Produces (actions.ts): `recordApplicationsAction(prev: State, formData: FormData): Promise<State>` — `ids` como múltiples valores `formData.getAll("ids")`, acta vía `minuteSelectionSchema` + `resolveMinuteId` (patrón EXACTO de `src/app/admin/socios/[id]/actions.ts`, incluida la compensación `discardUnusedMinute`).
- Consumes: `requireOpenBook`, `canReadmit` (reglas de `members`), `tokens.issue` + `portalInvite` + `mailer.sendToMember` (invitación de acceso), `audit`.

- [ ] **Step 1: Tests del recorder (fallan)**

`tests/application-record.test.ts` — fake de Prisma con `$transaction` (patrón de `tests/member-service.test.ts`). Casos:

```ts
// 1. ALTA COMÚN: solicitud approved_pending_minute sin memberId →
//    - member.create con los datos de la solicitud, status active,
//      emailStatus "verified" (la solicitud tenía emailVerifiedAt) y
//      joinedAt = fecha del acta (REG-11), autoDebit = wantsDebit;
//    - membership.create con memberNumber = max + 1 del libro abierto;
//    - movement.create type "admission" con newCategory y createdById;
//    - application.update → completed, minuteId, decidedAt;
//    - mpSubscription.updateMany where applicationId → memberId.
// 2. REINGRESO: solicitud pending_board con memberId 7 (member withdrawn por
//    resignation, sin deuda) →
//    - member.update: status active, category, withdrawalReason null,
//      leftAt null, datos de contacto/domicilio de la solicitud, y
//      joinedAt NO aparece en el data (la antigüedad no se toca);
//    - user.update active true si member.userId;
//    - movement type "readmission"; NINGÚN membership.create nuevo;
//    - application.update → completed.
// 3. REINGRESO BLOQUEADO: member con reentryBlocked → { ok: false } con el
//    mensaje de canReadmit, y NADA escrito.
// 4. ESTADO INVÁLIDO: solicitud rejected → { ok: false, error: /ya fue resuelta|estado/ }.
// 5. EMAIL SIN VERIFICAR: member.create con emailStatus "declared".
```

Escribir los cinco con asserts sobre los mocks (mismo estilo que los tests de la Task 8).

- [ ] **Step 2: Implementar el recorder**

`src/lib/applications/record.ts`:

```ts
// El asiento en acta de una solicitud: el momento en que la Solicitud se
// convierte en Socio (alta) o en reingreso sobre la ficha existente (REG-25).
// TODO ocurre en UNA transacción por solicitud — no se reusa
// memberService.admit/readmit porque abren su propia transacción y el asiento
// necesita atomicidad entre el socio, la solicitud y la suscripción (Prisma no
// anida $transaction; mismo dilema documentado en socios/[id]/actions.ts).
// Las reglas puras SÍ se comparten (canReadmit, requireOpenBook).
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canReadmit } from "@/lib/members/rules";
import { requireOpenBook } from "@/lib/members/service";

export type RecordResult =
  | { ok: true; applicationId: number; memberId: number; memberNumber: number | null; reentry: boolean }
  | { ok: false; applicationId: number; error: string };

const RECORDABLE = ["approved_pending_minute", "pending_board"] as const;

export function makeApplicationRecorder(db: PrismaClient) {
  return {
    async recordOne(input: { applicationId: number; minuteId: number; actorId: number }): Promise<RecordResult> {
      const { applicationId, minuteId, actorId } = input;
      try {
        return await db.$transaction(async (tx) => {
          const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
          if (!(RECORDABLE as readonly string[]).includes(app.status)) {
            throw new Error(`La solicitud #${app.id} ya fue resuelta o no está lista para asentar.`);
          }
          const minute = await tx.minute.findUniqueOrThrow({ where: { id: minuteId } });

          const contactData = {
            fullName: app.fullName,
            dni: app.dni,
            birthDate: app.birthDate,
            civilStatus: app.civilStatus,
            nationality: app.nationality,
            occupation: app.occupation,
            phone: app.phone,
            email: app.email,
            emailStatus: (app.emailVerifiedAt ? "verified" : "declared") as "verified" | "declared",
            emailVerifiedAt: app.emailVerifiedAt,
            streetId: app.streetId,
            streetText: app.streetText,
            streetNumber: app.streetNumber,
            neighborhood: app.neighborhood,
            autoDebit: app.wantsDebit,
          };

          let memberId: number;
          let memberNumber: number | null = null;
          const reentry = app.memberId !== null;

          if (app.memberId !== null) {
            // REINGRESO sobre la ficha existente (REG-25). joinedAt NO se toca:
            // la antigüedad no se reinicia (REG-11/REG-29).
            const member = await tx.member.findUniqueOrThrow({ where: { id: app.memberId } });
            const check = canReadmit(member);
            if (!check.ok) throw new Error(check.error);
            await tx.member.update({
              where: { id: member.id },
              data: {
                ...contactData,
                status: "active",
                category: app.requestedCategory,
                withdrawalReason: null,
                leftAt: null,
              },
            });
            if (member.userId) {
              await tx.user.update({ where: { id: member.userId }, data: { active: true } });
            }
            await tx.movement.create({
              data: {
                memberId: member.id, type: "readmission", date: minute.date, minuteId: minute.id,
                newCategory: app.requestedCategory, createdById: actorId,
                detail: `Reingreso vía solicitud web #${app.id}`,
              },
            });
            memberId = member.id;
          } else {
            // ALTA COMÚN: socio nuevo con el número siguiente del libro abierto.
            const book = await requireOpenBook(tx);
            const max = await tx.membership.aggregate({
              where: { bookId: book.id }, _max: { memberNumber: true },
            });
            const member = await tx.member.create({
              data: {
                ...contactData,
                category: app.requestedCategory,
                status: "active",
                joinedAt: minute.date, // REG-11: fecha de ingreso = fecha del acta
              },
            });
            memberNumber = (max._max.memberNumber ?? 0) + 1;
            await tx.membership.create({
              data: { memberId: member.id, bookId: book.id, memberNumber },
            });
            await tx.movement.create({
              data: {
                memberId: member.id, type: "admission", date: minute.date, minuteId: minute.id,
                newCategory: app.requestedCategory, createdById: actorId,
                detail: `Alta vía solicitud web #${app.id}`,
              },
            });
            memberId = member.id;
          }

          await tx.application.update({
            where: { id: app.id },
            data: { status: "completed", minuteId: minute.id, decidedAt: new Date(), memberId },
          });
          await tx.mpSubscription.updateMany({
            where: { applicationId: app.id },
            data: { memberId },
          });

          return { ok: true as const, applicationId, memberId, memberNumber, reentry };
        });
      } catch (e) {
        return { ok: false, applicationId, error: e instanceof Error ? e.message : "Error inesperado." };
      }
    },
  };
}

export const applicationRecorder = makeApplicationRecorder(prisma);
```

Nota sobre `dni` en el alta común: `Member.dni` es UNIQUE — si existiera una
ficha con ese DNI, `member.create` fallaría con P2002 y el resultado es
`{ ok: false }` con el error… en inglés. Capturarlo: envolver el `create` o
detectar `e.code === "P2002"` en el catch y devolver
`"Ya existe un socio con el DNI de la solicitud #N: revisala a mano."`.

- [ ] **Step 3: La action de asiento masivo**

`src/app/admin/solicitudes/actions.ts`:

```ts
"use server";
// Acciones de la bandeja. Mismo esqueleto que socios/[id]/actions.ts: guarda,
// zod, acta aparte (minuteSelectionSchema es un union), compensación del acta
// huérfana, auditoría con IP, redirect fuera del try.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { mailer } from "@/lib/email";
import { portalInvite } from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import { applicationRecorder } from "@/lib/applications/record";

type State = { error?: string };

async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

export async function recordApplicationsAction(_p: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const ids = formData.getAll("ids").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return { error: "Elegí al menos una solicitud para asentar." };

  // El acta se parsea aparte (union sin .shape — ver socios/[id]/actions.ts).
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };

  // Pre-validación anti acta huérfana: al menos una tiene que estar asentable.
  const recordable = await prisma.application.count({
    where: { id: { in: ids }, status: { in: ["approved_pending_minute", "pending_board"] } },
  });
  if (recordable === 0) return { error: "Ninguna de las solicitudes elegidas está lista para asentar." };

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actor.actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  const results = [];
  for (const applicationId of ids) {
    results.push(await applicationRecorder.recordOne({ applicationId, minuteId, actorId: actor.actorId }));
  }
  const okResults = results.filter((r) => r.ok);

  if (okResults.length === 0) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: results.find((r) => !r.ok && "error" in r)?.error ?? "No se pudo asentar ninguna solicitud." };
  }

  // Invitación de acceso: solo a las fichas con email VERIFICADO y sin cuenta
  // (misma regla que verificationTarget: la invitación no puede caer en un
  // buzón sin confirmar). Best-effort: el asiento ya está firme.
  for (const r of okResults) {
    try {
      const member = await prisma.member.findUnique({ where: { id: r.memberId } });
      if (member && member.email && member.emailStatus === "verified" && member.userId === null) {
        await tokens.revokeForMember(member.id, ["password_invitation"]);
        const rawToken = await tokens.issue({ purpose: "password_invitation", memberId: member.id });
        const invite = portalInvite({
          kind: "password_invitation", name: member.fullName,
          baseUrl: process.env.AUTH_URL ?? "", token: rawToken,
        });
        await mailer.sendToMember({
          memberId: member.id, to: member.email, type: "password_invitation",
          message: invite.message, summary: invite.summary,
        });
      }
    } catch (e) {
      console.error("post-record invitation failed", (e as { code?: string })?.code ?? "unknown");
    }
  }

  const ip = await clientIp();
  await audit({
    userId: actor.actorId, action: "application_record", entity: "application",
    detail: {
      minuteId,
      recorded: okResults.map((r) => r.applicationId),
      failed: results.filter((r) => !r.ok).map((r) => r.applicationId),
    },
    ip,
  });

  const failed = results.length - okResults.length;
  redirect(`/admin/solicitudes?asentadas=${okResults.length}${failed > 0 ? `&fallidas=${failed}` : ""}`);
}
```

(`z` queda importado para las actions de la Task 18 en este mismo archivo.)

- [ ] **Step 4: Selección múltiple en el listado**

En `src/app/admin/solicitudes/page.tsx`: envolver la tabla en un componente
cliente `record-form.tsx` (mismo patrón que cualquier form con
`useActionState`): checkbox por fila (`name="ids" value={app.id}`, solo
habilitado para `approved_pending_minute` y `pending_board`), un
`minute-picker` (leer `src/components/admin/minute-picker.tsx` para sus props)
y el botón "Asentar seleccionadas en acta" con `pending`. Mostrar
`FormMessage kind="success"` cuando la URL trae `?asentadas=N`
("N solicitudes asentadas.") y `kind="warning"` si además trae `fallidas`.

- [ ] **Step 5: Tests de autorización**

`tests/applications-actions-auth.test.ts` (patrón exacto de
`tests/news-actions-auth.test.ts`): con `requireAdmin` en `{ok:false}`,
`recordApplicationsAction` (y las actions de la Task 18) no escriben nada, no
llaman `audit` y devuelven `{ error }`.

- [ ] **Step 6: Verificar y commitear**

```bash
npm test
git add -A
git commit -m "feat(admin): bulk record-in-minute — new members and re-admissions from applications"
```

---

### Task 18: Recategorizar y rechazar

**Files:**
- Modify: `src/app/admin/solicitudes/actions.ts`
- Create: `src/app/admin/solicitudes/[id]/decision-forms.tsx` (client)
- Modify: `src/app/admin/solicitudes/[id]/page.tsx` (Card de acciones)
- Test: `tests/application-decision-actions.test.ts` (+ ampliar `applications-actions-auth.test.ts`)

**Interfaces:**
- Produces: `recategorizeApplicationAction(prev, formData)` (campos: `applicationId`, `newCategory` ∈ WEB_CATEGORIES) y `rejectApplicationAction(prev, formData)` (campos: `applicationId` + acta vía `minuteSelectionSchema`). Ambas `State = { error?: string }` y redirect al detalle.
- Consumes: `mpGateway.updatePreapprovalAmount` / `cancelPreapproval`, `getFeeAmounts`, `applicationRejectedEmail`, `mailer.sendToApplication`, `addMonthsUtc`-equivalente (usar `REJECTION_BLOCK_MONTHS` de eligibility — exportar también `addMonthsUtc` desde `eligibility.ts` para no duplicarla).

- [ ] **Step 1: Exportar `addMonthsUtc`**

En `src/lib/applications/eligibility.ts`, cambiar `function addMonthsUtc` a
`export function addMonthsUtc` (la usa el rechazo para `rejectedUntil`).

- [ ] **Step 2: Las dos actions**

Agregar a `src/app/admin/solicitudes/actions.ts`:

```ts
// ── Recategorizar (docs/05 §3) ───────────────────────────────────────────────
export async function recategorizeApplicationAction(_p: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(
    z.object({
      applicationId: z.coerce.number().int().positive(),
      newCategory: z.enum(["active", "adherent", "collaborator"], { error: "Elegí la nueva categoría." }),
    }),
    formData,
  );
  if (!parsed.ok) return { error: parsed.error };
  const { applicationId, newCategory } = parsed.data;

  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) return { error: "La solicitud no existe." };
  if (!["approved_pending_minute", "pending_board", "pending_payment"].includes(app.status)) {
    return { error: "La solicitud ya fue resuelta: no se puede recategorizar." };
  }
  if (app.requestedCategory === newCategory) return { error: "La solicitud ya tiene esa categoría." };

  // Si hay suscripción y el monto de la categoría nueva difiere, se actualiza
  // la suscripción por API (docs/06 §7). active↔(adherent|collaborator) cambia
  // el monto; adherent↔collaborator comparten plan y no toca MP.
  const changesAmount =
    (app.requestedCategory === "active") !== (newCategory === "active");
  if (app.preapprovalId && changesAmount) {
    const fees = await getFeeAmounts();
    if (!fees) return { error: "No pudimos leer el valor de la cuota en MP: reintentá más tarde." };
    const amount = newCategory === "active" ? fees.active : fees.shared;
    try {
      await mpGateway.updatePreapprovalAmount(app.preapprovalId, amount);
    } catch {
      return { error: "MP no aceptó el cambio de monto de la suscripción. Reintentá o resolvelo desde el panel de MP." };
    }
  }

  await prisma.application.update({ where: { id: applicationId }, data: { requestedCategory: newCategory } });
  await audit({
    userId: actor.actorId, action: "application_recategorize", entity: "application",
    entityId: applicationId,
    detail: { from: app.requestedCategory, to: newCategory, subscriptionUpdated: Boolean(app.preapprovalId && changesAmount) },
    ip: await clientIp(),
  });
  redirect(`/admin/solicitudes/${applicationId}`);
}

// ── Rechazar (REG-13, REG-12.b, REG-05) ──────────────────────────────────────
export async function rejectApplicationAction(_p: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(z.object({ applicationId: z.coerce.number().int().positive() }), formData);
  if (!parsed.ok) return { error: parsed.error };
  const { applicationId } = parsed.data;

  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) return { error: sel.error.issues[0]?.message ?? "El rechazo exige constancia en acta (Art. 5 inc. 7)." };

  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) return { error: "La solicitud no existe." };
  if (!["approved_pending_minute", "pending_board", "pending_payment"].includes(app.status)) {
    return { error: "La solicitud ya fue resuelta." };
  }

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actor.actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  const decidedAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.application.updateMany({
        where: { id: applicationId, status: { in: ["approved_pending_minute", "pending_board", "pending_payment"] } },
        data: { status: "rejected", minuteId, decidedAt },
      });
      if (count === 0) throw new Error("La solicitud ya fue resuelta por otro admin.");
      if (app.memberId) {
        // REG-05 sobre la ficha del ex socio; para no-socios el bloqueo sale
        // de la propia Application rechazada (eligibility.lastRejectionAt).
        await tx.member.update({
          where: { id: app.memberId },
          data: { rejectedUntil: addMonthsUtc(decidedAt, REJECTION_BLOCK_MONTHS) },
        });
      }
    });
  } catch (e) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: e instanceof Error ? e.message : "No se pudo rechazar." };
  }

  // Cancelación de la suscripción y email: DESPUÉS del commit, best-effort —
  // el rechazo asentado no se revierte porque MP o el SMTP estén caídos.
  let cancelFailed = false;
  if (app.preapprovalId) {
    try {
      await mpGateway.cancelPreapproval(app.preapprovalId);
      await prisma.mpSubscription.updateMany({
        where: { preapprovalId: app.preapprovalId },
        data: { status: "cancelled", lastSyncAt: new Date() },
      });
    } catch {
      cancelFailed = true;
      console.error("cancelPreapproval failed for application", applicationId);
    }
  }
  try {
    await mailer.sendToApplication({
      applicationId, to: app.email, type: "application_result",
      message: applicationRejectedEmail({ entryFeeRetained: app.mpPaymentIdEntry !== null }),
      summary: "solicitud rechazada",
    });
  } catch (e) {
    console.error("rejected email failed", (e as { code?: string })?.code ?? "unknown");
  }

  await audit({
    userId: actor.actorId, action: "application_reject", entity: "application",
    entityId: applicationId,
    detail: { minuteId, entryFeeRetained: app.mpPaymentIdEntry !== null, cancelFailed, hadMember: app.memberId !== null },
    ip: await clientIp(),
  });
  redirect(`/admin/solicitudes/${applicationId}`);
}
```

Imports adicionales del archivo: `getFeeAmounts` (`@/lib/mp/plans`),
`mpGateway` (`@/lib/mp/gateway`), `applicationRejectedEmail`
(`@/lib/email/templates`), `addMonthsUtc`, `REJECTION_BLOCK_MONTHS`
(`@/lib/applications/eligibility`).

- [ ] **Step 3: UI en el detalle**

`decision-forms.tsx` (client): Card "Acciones" en el detalle, visible solo si
el estado es accionable:
- **Recategorizar**: `<select name="newCategory">` con las tres categorías web
  menos la actual (labels de members) + botón. Aviso bajo el select cuando hay
  suscripción y el cambio toca el monto ("Se actualizará el monto de la
  suscripción en Mercado Pago.").
- **Rechazar**: `<details>` desplegable ("Rechazar solicitud…") con el
  `minute-picker`, el texto fijo "El rechazo queda asentado en acta. Si hubo
  cuota de ingreso debitada, se retiene (no es reembolsable) y se cancela la
  suscripción." y botón `variant="destructive"`.
Ambos con `useActionState` y `FormMessage kind="error"`.

- [ ] **Step 4: Tests**

`tests/application-decision-actions.test.ts` (mocks estilo Task 11):
1. recategorizar adherent→collaborator con suscripción: NO llama a MP (mismo monto);
2. recategorizar adherent→active con suscripción: llama `updatePreapprovalAmount` con `fees.active`;
3. si MP falla el update → `{ error }` y `application.update` NO llamado;
4. rechazo: transición + `rejectedUntil` seteado cuando hay `memberId`, email con `entryFeeRetained: true` si había `mpPaymentIdEntry`, y `cancelPreapproval` llamado;
5. rechazo con MP caído → el rechazo IGUAL queda firme y `audit.detail.cancelFailed === true`.

- [ ] **Step 5: Verificar y commitear**

```bash
npm test
git add -A
git commit -m "feat(admin): recategorize and reject applications with MP subscription sync"
```

---

### Task 19: Resumen mensual para el acta (pantalla imprimible + Excel)

**Files:**
- Create: `src/app/admin/solicitudes/resumen/page.tsx`
- Create: `src/app/api/admin/solicitudes/resumen-export/route.ts`
- Create: `src/lib/applications/summary.ts`
- Test: `tests/application-summary.test.ts`

**Interfaces:**
- Produces (summary.ts):

```ts
export function parseMonthParam(value: string | undefined, now: Date): { year: number; month: number }; // default: mes actual; formato YYYY-MM
export function monthRangeUtc(year: number, month: number): { from: Date; to: Date }; // [1° 00:00 UTC, 1° del siguiente)
export function makeSummaryQueries(db: Pick<PrismaClient, "application">): {
  fetchSummary(range: { from: Date; to: Date }): Promise<{
    accepted: SummaryRow[];  // approved_pending_minute con updatedAt en el rango… ver nota
    pendingBoard: SummaryRow[];
  }>;
};
```

**Nota de criterio (fijarla en el código):** el "mes" de una aceptada es el de
su ACEPTACIÓN. Para `approved_pending_minute` no hay un campo dedicado — usar
`updatedAt` sería frágil. Agregar en `summary.ts` el criterio simple y honesto:
la sección "aceptadas pendientes de asiento" lista TODAS las
`approved_pending_minute` y `pending_board` vivas (sin filtro de mes — son las
que la próxima reunión debe tratar), y el filtro por mes aplica a una tercera
sección "asentadas en el mes" (`completed` con `decidedAt` en el rango), que
sirve para reconstruir un acta pasada. Tres listas, cero ambigüedad.

- [ ] **Step 1: Tests de `parseMonthParam` y `monthRangeUtc`** (fallan): default al mes actual, parseo "2026-08", basura → default, rango [2026-08-01T00:00Z, 2026-09-01T00:00Z).

- [ ] **Step 2: Implementar `summary.ts`** con las tres consultas (`accepted`: `status approved_pending_minute` ordenadas por `createdAt`; `pendingBoard`: ídem `pending_board`; `recordedInMonth`: `status completed AND decidedAt ∈ rango` ordenadas por `decidedAt`). `SummaryRow`: `{ id, fullName, dni, requestedCategory, wantsDebit, reentry: memberId !== null, createdAt, decidedAt }`.

- [ ] **Step 3: La pantalla**

`resumen/page.tsx`: `requireAdmin()`. `PageHeader title="Resumen para acta"`,
breadcrumb `Solicitudes → Resumen`, actions: selector de mes (form GET con
`<input type="month" name="mes">`), botón "Exportar Excel"
(link a `/api/admin/solicitudes/resumen-export?mes=YYYY-MM`) y botón
"Imprimir" (client button `window.print()`). Tres secciones con tabla
(Nombre, DNI, Categoría, Débito, Reingreso, Fecha): "Aceptadas pendientes de
asiento", "Pendientes de decisión de la CD", "Asentadas en {mes}".
`EmptyState size="card"` por sección vacía. Estilos de impresión: en el
contenedor, clase `print:*` de Tailwind para ocultar nav/botones
(`print:hidden` en los controles) — el shell del panel ya imprime razonable;
verificar con vista previa de impresión del navegador.

- [ ] **Step 4: El export**

`resumen-export/route.ts`: calcar `padron-export/route.ts` (ExcelJS,
`requireAdmin`, `Cache-Control: no-store, private`, auditoría
`application_summary_export` con `{ month, counts }` — sin datos personales).
Tres hojas ("Pendientes de asiento", "Pendientes CD", "Asentadas") con las
mismas columnas de la pantalla; fechas como `Date` con `numFmt: "dd/mm/yyyy"`
(patrón de `members/export.ts`).

- [ ] **Step 5: Verificar y commitear**

```bash
npm test
git add -A
git commit -m "feat(admin): monthly board-minute summary screen and Excel export"
```

---

### Task 20: Cron de solicitudes — recordatorio y expiración

**Files:**
- Create: `src/lib/applications/cron.ts`
- Create: `src/app/api/cron/applications/route.ts`
- Test: `tests/applications-cron.test.ts`

**Interfaces:**
- Produces:

```ts
// cron.ts
export const REMINDER_AFTER_DAYS = 3;
export const EXPIRE_AFTER_DAYS = 7;
export function makeApplicationsCron(deps: {
  db: Pick<PrismaClient, "application" | "mpSubscription">;
  gateway: Pick<MpGateway, "cancelPreapproval">;
  mailer: Pick<Mailer, "sendToApplication">;
  baseUrl: string;
  now?: () => Date;
}): { run(): Promise<{ reminded: number; expired: number; errors: number }> };
// route.ts: POST con Authorization: Bearer ${CRON_SECRET} (timing-safe) → JSON del run()
```

- [ ] **Step 1: Tests (fallan)** — casos:
1. `pending_payment` creada hace 4 días sin `remindedAt` → el cron acuña un token con `mintResumeToken()`, manda `paymentReminderEmail` con esa URL, y SOLO si el envío salió bien hace `commitResumeToken` y sella `remindedAt`; una segunda corrida NO re-manda (ya tiene `remindedAt`). Si el SMTP falla, NO se commitea: el enlace que el vecino ya tiene sigue vivo.
2. `started` de hace 8 días → `expired`; `pending_payment` de hace 8 días con `preapprovalId` → `expired` + `cancelPreapproval` llamado + suscripción local `cancelled`.
3. `cancelPreapproval` que lanza → la solicitud IGUAL expira y `errors` cuenta 1.
4. solicitudes recientes → intactas.

**Nota (fijar en el código):** el cron no conoce el token crudo (solo hay
hash), así que el enlace del recordatorio hay que acuñarlo de nuevo. El orden
es **acuñar → enviar → recién ahí persistir** (`mintResumeToken` +
`commitResumeToken`, Task 11): si se persistiera primero y el SMTP fallara, le
habríamos matado al vecino el enlace que ya tenía sin poder darle uno nuevo —
exactamente el defecto que se corrigió en el reenvío manual. El costo aceptado
es que, cuando el envío SÍ sale, una pestaña vieja queda inválida; a los 3 días
de inactividad y con el enlace nuevo en el correo, es razonable. Dejar este
razonamiento como comentario.

- [ ] **Step 2: Implementar `cron.ts`**

```ts
// Mantenimiento diario de solicitudes (spec §7): recordatorio a los 3 días de
// pending_payment (una sola vez) y expiración a los 7 de started/pending_payment.
// La expiración cancela la suscripción best-effort: si MP falla queda contada
// en errors y la conciliación del M4 la levantará.
import type { PrismaClient } from "@/generated/prisma/client";
import { applicationService } from "@/lib/applications/service";
import { mailer } from "@/lib/email";
import { paymentReminderEmail } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";
import { mpGateway, type MpGateway } from "@/lib/mp/gateway";

export const REMINDER_AFTER_DAYS = 3;
export const EXPIRE_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

type Deps = {
  db: Pick<PrismaClient, "application" | "mpSubscription">;
  gateway: Pick<MpGateway, "cancelPreapproval">;
  mailer: { sendToApplication: typeof mailer.sendToApplication };
  mintResumeToken?: () => { raw: string; hash: string };
  commitResumeToken?: (applicationId: number, hash: string) => Promise<void>;
  baseUrl: string;
  now?: () => Date;
};

export function makeApplicationsCron(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const mint = deps.mintResumeToken ?? applicationService.mintResumeToken;
  const commit = deps.commitResumeToken ?? applicationService.commitResumeToken;
  return {
    async run() {
      let reminded = 0, expired = 0, errors = 0;
      const t = now();

      // 1. Recordatorio (una sola vez por solicitud).
      const toRemind = await deps.db.application.findMany({
        where: {
          status: "pending_payment", remindedAt: null,
          createdAt: { lte: new Date(t.getTime() - REMINDER_AFTER_DAYS * DAY_MS) },
        },
      });
      for (const app of toRemind) {
        try {
          // Acuñar → enviar → persistir. Si el envío falla, el enlace que el
          // vecino ya tiene sigue siendo válido (ver nota del Step 1).
          const { raw, hash } = mint();
          await deps.mailer.sendToApplication({
            applicationId: app.id, to: app.email, type: "fee_reminder",
            message: paymentReminderEmail({ url: `${deps.baseUrl}/asociate/retomar/${raw}` }),
            summary: "recordatorio de pago pendiente",
          });
          await commit(app.id, hash);
          await deps.db.application.update({ where: { id: app.id }, data: { remindedAt: t } });
          reminded++;
        } catch (e) {
          errors++;
          console.error("reminder failed", app.id, (e as { code?: string })?.code ?? "unknown");
        }
      }

      // 2. Expiración.
      const toExpire = await deps.db.application.findMany({
        where: {
          status: { in: ["started", "pending_payment"] },
          createdAt: { lte: new Date(t.getTime() - EXPIRE_AFTER_DAYS * DAY_MS) },
        },
      });
      for (const app of toExpire) {
        const { count } = await deps.db.application.updateMany({
          where: { id: app.id, status: { in: ["started", "pending_payment"] } },
          data: { status: "expired" },
        });
        if (count === 0) continue; // carrera con un webhook que la aprobó: gana el webhook
        expired++;
        if (app.preapprovalId) {
          try {
            await deps.gateway.cancelPreapproval(app.preapprovalId);
            await deps.db.mpSubscription.updateMany({
              where: { preapprovalId: app.preapprovalId },
              data: { status: "cancelled", lastSyncAt: t },
            });
          } catch {
            errors++;
            console.error("cancel on expire failed", app.id);
          }
        }
      }
      return { reminded, expired, errors };
    },
  };
}

export const applicationsCron = makeApplicationsCron({
  db: prisma, gateway: mpGateway, mailer,
  baseUrl: process.env.AUTH_URL ?? "",
});
```

- [ ] **Step 3: La ruta**

`src/app/api/cron/applications/route.ts`:

```ts
// POST /api/cron/applications — lo dispara el crontab del VPS (docs/03).
// Autenticación por CRON_SECRET en comparación timing-safe; sin secreto
// configurado el endpoint no existe a efectos prácticos (503).
import { timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/audit";
import { applicationsCron } from "@/lib/applications/cron";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await applicationsCron.run();
  await audit({ action: "applications_cron", entity: "application", detail: result });
  return Response.json(result);
}
```

- [ ] **Step 4: Verificar y commitear**

```bash
npm test
git add -A
git commit -m "feat(cron): applications reminder + expiry endpoint behind CRON_SECRET"
```

---

### Task 21: CSP y límites de request

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Activar los orígenes**

Llenar los arrays ya preparados (línea 38-41):

```ts
const MP_SCRIPT: string[] = ["https://sdk.mercadopago.com", "https://http2.mlstatic.com"];
const MP_CONNECT: string[] = ["https://api.mercadopago.com"];
const MP_FRAME: string[] = ["https://www.mercadopago.com.ar"];
const TURNSTILE: string[] = ["https://challenges.cloudflare.com"];
```

y ajustar `bodySizeLimit` a `"12mb"` actualizando el comentario existente: el
upload del wizard va de a UN archivo de hasta 10 MB (`MAX_DOCUMENT_BYTES`) y
el margen sigue siendo para el sobre multipart, igual que con la portada.

- [ ] **Step 2: Smoke con dev server**

Levantar el dev server (preview del entorno): `/asociate` debe mostrar el
widget de Turnstile SIN recuadro vacío ni error de CSP en consola (recordar el
comentario del config: un iframe bloqueado falla en silencio — mirar la
consola del navegador, no la página).

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat(security): enable MP + Turnstile CSP origins, raise action body limit"
```

---

### Task 22: Documentación, instructivo y verificación final

**Files:**
- Modify: `docs/04-modelo-de-datos.md`, `docs/05-flujos-funcionales.md`, `docs/06-integracion-mercadopago.md`, `docs/07-plan-de-etapas.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-08-20-modulo-3-asociate-mp-design.md`
- Create: `docs/11-preparacion-mp-sandbox-turnstile.md`

- [ ] **Step 1: Actualizar los docs de especificación**

- `docs/06`: reemplazar los 3 planes por los **2 acordados** ("SOCIO ACTIVO",
  "SOCIO ADHERENTE/COLABORADOR" — mismo monto compartido); anotar que los ids
  de plan viven en `Configuration` (`mp_plan_active_id` / `mp_plan_shared_id`)
  y se cargan desde `/admin/configuracion`.
- `docs/04`: nombres finales en inglés de las entidades nuevas (`Application`,
  `Document`, `MpSubscription`, `WebhookEvent`), el estado `expired`, el token
  de retome, `ActionToken.applicationId`, `Notification.applicationId`.
- `docs/05` §2: la tabla de bloqueos del paso 3 (spec §4), el circuito de
  retome, y el desvío acordado: la invitación de contraseña se envía AL
  ASENTAR (no al aceptar); la verificación de email sí es inmediata.
- `docs/07`: tildar los CA del Módulo 3 que ya se puedan verificar en local;
  los de sandbox quedan pendientes de las credenciales.
- Spec del módulo: anotar dos desvíos acordados durante el plan — "textos
  legales en texto plano" (Task 3) y el resumen para acta con TRES listas en
  vez de dos (Task 19: pendientes de asiento / pendientes de CD / asentadas
  en el mes).
- `CLAUDE.md`: agregar `EMAIL_ALLOWLIST`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` a la
  tabla de env; sección breve de patrones nuevos del panel si aplica (gateway
  MP mockeable, guarda de allowlist, ruta de documentos auditada).

- [ ] **Step 2: El instructivo para Mariano**

`docs/11-preparacion-mp-sandbox-turnstile.md` — paso a paso, en es-AR, con
bloques copiables: (1) crear la aplicación en https://www.mercadopago.com.ar/developers
(cuenta institucional), obtener credenciales de PRUEBA; (2) crear las dos
cuentas de test (vendedor/comprador); (3) crear los 2 planes de suscripción de
sandbox vía `curl POST /preapproval_plan` (bloques listos con `reason`
"SOCIO ACTIVO" $6000 y "SOCIO ADHERENTE/COLABORADOR" $3000,
`frequency: 1, frequency_type: "months"`); (4) configurar la URL de webhooks
de staging (`https://sigev.redaccion.ar/api/webhooks/mp`, tópicos
`payments`, `subscription_preapproval`, `subscription_authorized_payment`) y
copiar el secret; (5) alta del sitio en Cloudflare Turnstile (dominio
`sigev.redaccion.ar` + `localhost`); (6) tabla final de variables → `.env`
local y de staging (incluida `EMAIL_ALLOWLIST` con las dos casillas de
prueba); (7) tarjetas de prueba de MP y cómo simular un débito aprobado;
(8) bloque copiable para el crontab del VPS (Mariano lo corre a mano, Claude
Code no toca el VPS):

```
# SIGeV — cron diario de solicitudes (08:05 hora local)
5 8 * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://sigev.redaccion.ar/api/cron/applications >> /var/log/sigev-cron.log 2>&1
```

(en el instructivo, aclarar que `$CRON_SECRET` se reemplaza por el valor real
del `.env` del VPS o se lee de un archivo protegido).

- [ ] **Step 3: Verificación final del módulo**

```bash
npm test
npm run lint
npm run build
```

Expected: todo verde. Smoke final con dev server: circuito adherente-sin-débito
completo (wizard → bandeja → asentar con acta → socio nuevo en el padrón con
número siguiente → invitación NO enviada si el email no está verificado), y el
resumen para acta mostrando la solicitud asentada en el mes.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "docs: module 3 documentation updates + MP sandbox / Turnstile setup guide"
```

Luego: invocar la skill `superpowers:finishing-a-development-branch` para
decidir el merge a `main` (el push lo corre Mariano a mano).

---

## Orden de ejecución y dependencias

```
Task 1 (migración) ──┬─ Task 2 (allowlist) ─────────────┐
                     ├─ Task 3 (config)                 │
                     ├─ Task 4 (turnstile+limiters)     │
                     ├─ Task 5 (firma) ── Task 14 (webhook)
                     ├─ Task 6 (gateway+planes) ─┤
                     ├─ Task 7 (elegibilidad) ── Task 11 (actions públicas)
                     ├─ Task 8 (servicio) ───────┤
                     ├─ Task 9 (storage) ──── Task 13 (pasos 4-5)
                     └─ Task 10 (emails) ────────┤
Task 11 ── Task 12 (UI 1-3) ── Task 13 ── Task 15 (verificar)
Task 16 (bandeja) ── Task 17 (asentar) ── Task 18 (decisiones) ── Task 19 (resumen)
Task 20 (cron) · Task 21 (CSP) · Task 22 (docs) — al final
```

Las tasks 2-10 son independientes entre sí (solo dependen de la 1) y pueden
ejecutarse en paralelo si se usa subagent-driven-development con worktrees; de
la 11 en adelante el orden de arriba es obligatorio.
