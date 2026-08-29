# La invitación viaja también por correo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que perder el redirect después de verificar el email no le cueste la cuenta a nadie: la invitación de contraseña viaja además por correo (§7.1), el segundo POST dice la verdad (§7.2) y el operador ve en `/admin/salud` a los que quedaron a mitad de camino (§7.3).

**Architecture:** Tres piezas independientes sobre el circuito existente, sin migraciones y sin tocar `tokens.consume`, `peek` ni `applyEmailVerification`. (1) Un módulo nuevo `invitation-email.ts` (factory + singleton, patrón de `access.ts`) que manda por correo el MISMO token que viaja en el redirect, después del commit, best-effort; lo llaman las dos ramas de `confirmEmailAction`. (2) Una función pura `deadVerificationCopy` en `access.ts` que elige el texto del enlace muerto según el estado de la ficha, cableada en la página (GET) y en la action (POST). (3) Un dato nuevo en `fetchHealth` + función pura `classifyStuckAccess` + alerta *review* + panel en la pestaña Correo.

**Tech Stack:** Next.js 16 App Router (server actions), Prisma/MariaDB (sin cambios de schema), Nodemailer vía `mailer`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-invitacion-perdida-diagnostico.md` (leerla entera antes de empezar; la §7 es el contrato y la §7.4 lista lo que NO hay que hacer).

## Global Constraints

- **UI en es-AR con voseo; código, variables y commits en inglés.** Los comentarios del código de este repo están en español: mantener ese estilo.
- **Ninguna llamada de red dentro de una `$transaction`.** El correo va SIEMPRE después del commit.
- **Un solo token:** el que viaja por correo es el mismo del redirect. No emitir un segundo (revocaría al primero).
- **Best-effort:** un fallo de correo no tumba una verificación asentada ni rompe el redirect. `sendAfterVerification` NUNCA rechaza.
- **Ley 25.326:** ningún log ni asiento lleva la dirección de correo ni el objeto de error de nodemailer; sólo el `code`.
- **Suites protegidas** (deben pasar SIN tocar una aserción): `tests/member-access.test.ts`, `tests/redeem-pages.test.ts`, `tests/tokens.test.ts`, `tests/application-verify.test.ts`. Si alguna falla, el error está en el cambio. Corolario verificado: `member-access.test.ts:204` fija el contrato de `verifyEmail` con `toEqual` estricto → **NO extender `VerifyResult` ni el retorno de `applyEmailVerification`**; los datos para el correo se releen en la action después del commit.
- `tests/admin-health*.test.ts`, `tests/salud-tabs.test.ts` NO están en la lista protegida: sus fixtures pueden extenderse (el tipo `HealthSnapshot` crece), pero sin debilitar aserciones existentes.
- **No tocar** (§7.4): `peek` vs `consume` en la página, la atomicidad de `tokens.consume`, el anti-enumeración del recupero, la protección de doble clic del formulario.
- **Sin migraciones**: nada de este plan toca `schema.prisma`.
- Tests: `npx vitest run` (suite completa: 3512 pasando al 29/08/2026). Correr suites puntuales con `npx vitest run tests/<archivo>`.
- Rama de trabajo: `invitation-email-net`, creada desde `main`.
- Commits terminan con la línea `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 0: Rama

- [ ] **Step 1: Crear la rama desde main**

```bash
git checkout main && git checkout -b invitation-email-net
```

---

### Task 1: El módulo de la red — `invitation-email.ts` (§7.1)

**Files:**
- Create: `src/lib/members/invitation-email.ts`
- Test: `tests/invitation-email.test.ts`

**Interfaces:**
- Consumes: `portalInvite` (`src/lib/email/templates.ts`), `mailer.sendToMember` (`src/lib/email/index.ts`), `prisma`.
- Produces: `makeInvitationEmailer(deps)` → `{ sendAfterVerification(memberId: number, rawInvite: string): Promise<void> }` y el singleton ligado `invitationEmailer`. **Contrato: `sendAfterVerification` nunca rechaza** — la Task 2 redirige inmediatamente después y una excepción rompería el redirect.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/invitation-email.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// El módulo liga su singleton con `prisma` y `mailer` al evaluarse: se mockean
// los dos para que el import no arrastre ni la base ni el transporte (misma
// técnica que tests/application-verify.test.ts).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ mailer: { sendToMember: vi.fn() } }));

import { makeInvitationEmailer } from "@/lib/members/invitation-email";

const MEMBER = { email: "vecina@example.com", fullName: "Vecina Ejemplo" };

function makeDeps(member: unknown = MEMBER) {
  return {
    db: { member: { findUnique: vi.fn(async () => member) } },
    mail: { sendToMember: vi.fn(async () => ({ messageId: "x" })) },
  };
}

describe("invitationEmailer.sendAfterVerification (la red del §7.1)", () => {
  it("manda la invitación a la casilla de la ficha con el MISMO token del redirect", async () => {
    const deps = makeDeps();
    await makeInvitationEmailer(deps as never).sendAfterVerification(7, "RAW-INVITE");

    expect(deps.mail.sendToMember).toHaveBeenCalledTimes(1);
    const call = deps.mail.sendToMember.mock.calls[0][0] as {
      memberId: number; to: string; type: string;
      message: { text: string; html: string }; summary: string;
    };
    expect(call.memberId).toBe(7);
    expect(call.to).toBe("vecina@example.com");
    // El tipo del asiento de Notification es el mismo que usa el reenvío del
    // panel: la ficha lista los dos envíos igual.
    expect(call.type).toBe("password_invitation");
    // Un solo token, el del redirect: si acá apareciera otro, el segundo
    // habría revocado al primero y roto el redirect.
    expect(call.message.text).toContain("/acceso/RAW-INVITE");
    expect(call.message.html).toContain("/acceso/RAW-INVITE");
  });

  it("no manda nada si la ficha quedó sin email (o desapareció)", async () => {
    const sinEmail = makeDeps({ email: null, fullName: "X" });
    await makeInvitationEmailer(sinEmail as never).sendAfterVerification(7, "RAW");
    expect(sinEmail.mail.sendToMember).not.toHaveBeenCalled();

    const sinFicha = makeDeps(null);
    await makeInvitationEmailer(sinFicha as never).sendAfterVerification(7, "RAW");
    expect(sinFicha.mail.sendToMember).not.toHaveBeenCalled();
  });

  it("NUNCA rechaza: un fallo del mailer no puede romper el redirect", async () => {
    const deps = makeDeps();
    deps.mail.sendToMember = vi.fn(async () => {
      throw Object.assign(new Error("smtp caído"), { code: "ECONN" });
    });
    await expect(
      makeInvitationEmailer(deps as never).sendAfterVerification(7, "RAW"),
    ).resolves.toBeUndefined();
  });

  it("tampoco rechaza si la LECTURA de la ficha falla", async () => {
    const deps = makeDeps();
    deps.db.member.findUnique = vi.fn(async () => {
      throw new Error("db caída");
    });
    await expect(
      makeInvitationEmailer(deps as never).sendAfterVerification(7, "RAW"),
    ).resolves.toBeUndefined();
    expect(deps.mail.sendToMember).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/invitation-email.test.ts`
Expected: FAIL — `Cannot find module '@/lib/members/invitation-email'` (o equivalente).

- [ ] **Step 3: Implementar el módulo**

Crear `src/lib/members/invitation-email.ts`:

```ts
// La RED del canje de verificación (spec 2026-08-29-invitacion-perdida §7.1).
//
// Cuando la verificación emite la invitación de contraseña, el token crudo
// existe una sola vez y su único vehículo era el redirect de la action: si ese
// redirect se pierde (segunda pestaña, botón atrás, el navegador que se cierra),
// el token queda vivo sin que nadie lo haya visto nunca — el caso del socio 106.
// Este módulo manda ADEMÁS el mismo token por correo a la casilla que la persona
// acaba de confirmar. El redirect sigue siendo el camino rápido; esto es la red.
//
// Reglas que honra:
//  - Corre DESPUÉS del commit, nunca dentro de la transacción (la lección del
//    PDF del recibo y del cancelPreapproval de la baja).
//  - Best-effort y NUNCA rechaza: los llamadores redirigen inmediatamente
//    después, y una excepción acá les rompería justo el camino que este módulo
//    respalda. Un fallo real ya deja su fila `failed` en Notification (visible
//    en /admin/salud) y el operador conserva el reenvío de la ficha; un bloqueo
//    por EMAIL_ALLOWLIST es el entorno de prueba andando, no un fallo.
//  - UN solo token: el mismo del redirect. Emitir otro revocaría al primero.
//  - Saluda por nombre vía `invitationEmail`, y es correcto acá por el mismo
//    argumento del reenvío del panel (`templates.ts`): a esta rama sólo se
//    llega con el email confirmado por la propia persona haciendo clic.
import type { PrismaClient } from "@/generated/prisma/client";
import { mailer } from "@/lib/email";
import { portalInvite } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";

type Deps = {
  db: Pick<PrismaClient, "member">;
  mail: Pick<typeof mailer, "sendToMember">;
};

export function makeInvitationEmailer(deps: Deps) {
  return {
    async sendAfterVerification(memberId: number, rawInvite: string): Promise<void> {
      try {
        // Se relee acá y no se devuelve desde `verifyEmail`: el contrato de
        // `VerifyResult` está fijado por tests con `toEqual` estricto, y esta
        // consulta corre después del commit, donde ya no bloquea nada.
        const member = await deps.db.member.findUnique({
          where: { id: memberId },
          select: { email: true, fullName: true },
        });
        if (!member?.email) return;
        const base = process.env.AUTH_URL ?? "http://localhost:3000";
        const { message, summary } = portalInvite({
          kind: "password_invitation", name: member.fullName, baseUrl: base, token: rawInvite,
        });
        await deps.mail.sendToMember({
          memberId, to: member.email, type: "password_invitation", message, summary,
        });
      } catch (e) {
        // Sólo el código: el error de nodemailer trae el sobre SMTP con la
        // dirección del socio en claro (Ley 25.326, docs/08).
        const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
        console.error("[verificar] no salió el correo de invitación del socio", memberId, "code:", code);
      }
    },
  };
}

export const invitationEmailer = makeInvitationEmailer({ db: prisma, mail: mailer });
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run tests/invitation-email.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/invitation-email.ts tests/invitation-email.test.ts
git commit -m "feat(access): emailer that mails the password invitation after verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Cablear la red en las DOS ramas de `confirmEmailAction` (§7.1)

**Files:**
- Modify: `src/app/(public)/verificar/[token]/actions.ts` (rama de ficha ~línea 142-150; rama de solicitud ~línea 123-133)
- Test: `tests/verify-invitation-net.test.ts` (nuevo; NO tocar `tests/application-verify.test.ts`)

**Interfaces:**
- Consumes: `invitationEmailer.sendAfterVerification(memberId, rawInvite)` de Task 1.
- Produces: nada nuevo hacia afuera; el comportamiento observable es el correo tras cada canje exitoso que emite invitación.

**Nota de compatibilidad:** `tests/application-verify.test.ts` no mockea el módulo nuevo; al importarlo, el singleton se liga con el `prisma` mockeado de esa suite (`{ $transaction }` sin `member`), y el `try/catch` interno de `sendAfterVerification` se traga el `TypeError`. La suite protegida pasa sin tocarla — verificarlo en el Step 4.

- [ ] **Step 1: Escribir el test de cableado que falla**

Crear `tests/verify-invitation-net.test.ts` (harness calcado de `tests/application-verify.test.ts`, recortado a lo que estas aserciones necesitan):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Cableado del §7.1: después de un canje exitoso que emite invitación, la
// action manda el correo de la red ANTES de redirigir, en las dos ramas.
// `redirect` señaliza con una excepción: si el envío estuviera después, el mock
// que tira corta la action y `sendAfterVerification` no llega a llamarse — esa
// asimetría es lo que prueba el orden.
const h = vi.hoisted(() => {
  type Row = Record<string, unknown> | null;
  const state: { application: Row; member: Row } = { application: null, member: null };
  const tokens = {
    peek: vi.fn(async (): Promise<unknown> => null),
    consume: vi.fn(async (): Promise<unknown> => null),
    ownerOf: vi.fn(async (): Promise<unknown> => null),
    revokeForMember: vi.fn(async () => 0),
    issue: vi.fn(async () => "INVITE-NUEVA"),
  };
  const tx = {
    application: { findUnique: vi.fn(async () => state.application) },
    member: {
      findUnique: vi.fn(async () => state.member),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.member as Record<string, unknown>, data);
        return state.member;
      }),
    },
  };
  return {
    state, tokens, tx,
    applicationSvc: { verifyEmail: vi.fn(async () => {}) },
    prisma: { $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)) },
    verifyEmail: vi.fn(),
    sendAfterVerification: vi.fn(async () => {}),
  };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "203.0.113.9"]])),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth/rate-limiter", () => ({
  publicTokenLimiter: { check: vi.fn(() => true) },
}));
vi.mock("@/lib/tokens", () => ({
  tokens: h.tokens,
  makeTokens: vi.fn(() => h.tokens),
  MEMBER_EMAIL_TOKEN_PURPOSES: ["email_verification", "password_invitation"],
}));
vi.mock("@/lib/applications/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/applications/service")>(
    "@/lib/applications/service",
  );
  return {
    LIVE_APPLICATION_STATUSES: actual.LIVE_APPLICATION_STATUSES,
    makeApplicationService: vi.fn(() => h.applicationSvc),
  };
});
vi.mock("@/lib/members/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/members/access")>("@/lib/members/access");
  return {
    ACCESS_ERRORS: actual.ACCESS_ERRORS,
    canRedeem: actual.canRedeem,
    applyEmailVerification: actual.applyEmailVerification,
    memberAccess: { verifyEmail: h.verifyEmail },
  };
});
vi.mock("@/lib/members/invitation-email", () => ({
  invitationEmailer: { sendAfterVerification: h.sendAfterVerification },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { confirmEmailAction } from "@/app/(public)/verificar/[token]/actions";

const APP_EMAIL = "vecina@example.com";

function formDataFor(token = "RAW") {
  const fd = new FormData();
  fd.set("token", token);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.application = null;
  h.state.member = null;
});

describe("rama de FICHA: la red viaja antes del redirect", () => {
  it("con invitación emitida, manda el correo y recién entonces redirige", async () => {
    h.verifyEmail.mockResolvedValue({ ok: true, memberId: 1, invite: "INV" });
    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/acceso/INV");
    expect(h.sendAfterVerification).toHaveBeenCalledExactlyOnceWith(1, "INV");
  });

  it("sin invitación (la ficha ya tenía cuenta) no manda nada", async () => {
    h.verifyEmail.mockResolvedValue({ ok: true, memberId: 1, invite: null });
    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/ingresar");
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });

  it("con canje fallido no manda nada", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: "x" });
    const res = await confirmEmailAction({}, formDataFor());
    expect(res).toEqual({ error: "x" });
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });
});

describe("rama de SOLICITUD asentada: misma red, mismo orden", () => {
  it("el canje tardío que alcanza la ficha también manda el correo", async () => {
    h.tokens.peek.mockResolvedValue({ applicationId: 5 });
    h.tokens.consume.mockResolvedValue({ applicationId: 5 });
    h.state.application = { id: 5, status: "completed", email: APP_EMAIL, memberId: 3 };
    h.state.member = { id: 3, status: "active", email: APP_EMAIL, userId: null };
    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow(
      "NEXT_REDIRECT:/acceso/INVITE-NUEVA",
    );
    expect(h.sendAfterVerification).toHaveBeenCalledExactlyOnceWith(3, "INVITE-NUEVA");
  });

  it("si la ficha ya tenía cuenta, no hay invitación ni correo", async () => {
    h.tokens.peek.mockResolvedValue({ applicationId: 5 });
    h.tokens.consume.mockResolvedValue({ applicationId: 5 });
    h.state.application = { id: 5, status: "completed", email: APP_EMAIL, memberId: 3 };
    h.state.member = { id: 3, status: "active", email: APP_EMAIL, userId: 77 };
    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/ingresar");
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/verify-invitation-net.test.ts`
Expected: FAIL — los casos con invitación fallan porque `sendAfterVerification` nunca se llama (la action todavía no lo cablea).

- [ ] **Step 3: Cablear la action**

En `src/app/(public)/verificar/[token]/actions.ts`:

1. Agregar el import:

```ts
import { invitationEmailer } from "@/lib/members/invitation-email";
```

2. En la rama de SOLICITUD, dentro de `if (outcome.member) { ... }`, entre el `audit` de `member_email_verified` y el `redirect`:

```ts
    if (outcome.member) {
      // La verificación llegó a la ficha: es el mismo hecho que asienta el
      // canje del token de socio, y se audita con el mismo nombre.
      await audit({ action: "member_email_verified", entity: "member", entityId: outcome.member.memberId, ip });
      // La red del §7.1: el MISMO token del redirect viaja también por correo,
      // después del commit y best-effort (nunca rechaza). Si la persona pierde
      // esta pantalla, el enlace la espera en el buzón que acaba de confirmar.
      if (outcome.member.invite) {
        await invitationEmailer.sendAfterVerification(outcome.member.memberId, outcome.member.invite);
      }
      redirect(outcome.member.invite ? `/acceso/${outcome.member.invite}` : "/ingresar");
    }
```

3. En la rama de FICHA, entre el `audit` y el `redirect` final:

```ts
  await audit({ action: "member_email_verified", entity: "member", entityId: res.memberId, ip });

  // La red del §7.1, idéntica a la rama de solicitud: mismo token, después del
  // commit, best-effort.
  if (res.invite) await invitationEmailer.sendAfterVerification(res.memberId, res.invite);

  // Fuera de cualquier try: `redirect` señaliza con una excepción.
  redirect(res.invite ? `/acceso/${res.invite}` : "/ingresar");
```

- [ ] **Step 4: Verificar por mutación y correr las suites**

Primero la mutación (§9.1 de la spec): comentar la línea `if (res.invite) await invitationEmailer...` de la rama de ficha, correr `npx vitest run tests/verify-invitation-net.test.ts`, y confirmar que el primer test se pone ROJO. Restaurarla. Repetir con la línea de la rama de solicitud y su test. Después:

Run: `npx vitest run tests/verify-invitation-net.test.ts tests/application-verify.test.ts tests/member-access.test.ts tests/tokens.test.ts tests/redeem-pages.test.ts`
Expected: PASS todas, sin haber tocado una aserción de las protegidas.

- [ ] **Step 5: Commit**

```bash
git add src/app/"(public)"/verificar/"[token]"/actions.ts tests/verify-invitation-net.test.ts
git commit -m "feat(access): mail the invitation after email verification in both redeem branches

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Que el segundo POST no mienta (§7.2)

**Files:**
- Modify: `src/lib/members/access.ts` (nueva entrada en `ACCESS_ERRORS` + función pura `deadVerificationCopy`)
- Modify: `src/app/(public)/verificar/[token]/actions.ts` (rama de ficha, el `return { error: res.error }`)
- Modify: `src/app/(public)/verificar/[token]/page.tsx` (el cálculo de `deadCopy`)
- Test: `tests/dead-verification-copy.test.ts`

**Interfaces:**
- Consumes: `tokens.ownerOf(raw, "email_verification")` (ya existe: devuelve el dueño AUNQUE el token esté usado), `ACCESS_ERRORS.dead`.
- Produces: `ACCESS_ERRORS.verifiedNoAccount: string` y `deadVerificationCopy(member: Pick<Member, "status" | "emailStatus" | "userId"> | null): string`.

**Seguridad (límites de la spec §7.2):** la rama nueva sólo es alcanzable con el hash de un token real que viajó en el correo; no dispara ningún envío ni reenvío; el texto no nombra a nadie ni confirma identidad — sólo el estado "confirmado, falta la contraseña". No promete que el correo salió (el envío de Task 1 es best-effort): manda a buscarlo y nombra el reenvío.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/dead-verification-copy.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ACCESS_ERRORS, deadVerificationCopy } from "@/lib/members/access";

// La tabla entera de casos, sin base (patrón de eligibility.ts). La única
// combinación que gana el texto nuevo es la del incidente: verificado, sin
// cuenta, y no dado de baja. Todo lo demás conserva el genérico.
describe("deadVerificationCopy (§7.2)", () => {
  const CASES: Array<{
    name: string;
    member: { status: string; emailStatus: string; userId: number | null } | null;
    expected: string;
  }> = [
    {
      name: "verificado y sin cuenta (el incidente): dice la verdad",
      member: { status: "active", emailStatus: "verified", userId: null },
      expected: ACCESS_ERRORS.verifiedNoAccount,
    },
    {
      name: "suspendido cuenta igual: sigue siendo socio y puede crear su cuenta",
      member: { status: "suspended", emailStatus: "verified", userId: null },
      expected: ACCESS_ERRORS.verifiedNoAccount,
    },
    {
      name: "con cuenta creada: el trámite terminó, el genérico es correcto",
      member: { status: "active", emailStatus: "verified", userId: 7 },
      expected: ACCESS_ERRORS.dead,
    },
    {
      name: "sin verificar: no hay verdad nueva que contar",
      member: { status: "active", emailStatus: "declared", userId: null },
      expected: ACCESS_ERRORS.dead,
    },
    {
      name: "dado de baja: no se le promete ningún camino",
      member: { status: "withdrawn", emailStatus: "verified", userId: null },
      expected: ACCESS_ERRORS.dead,
    },
    { name: "ficha inexistente", member: null, expected: ACCESS_ERRORS.dead },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      expect(deadVerificationCopy(c.member as never)).toBe(c.expected);
    });
  }

  // Mismos candados que el resto del copy de canje (redeem-pages.test.ts):
  // voseo, sin hueco de interpolación, sin dirección ni nombre.
  it("el texto nuevo respeta los candados del copy público", () => {
    const text = ACCESS_ERRORS.verifiedNoAccount;
    expect(text).toContain("Buscá");
    expect(text).not.toMatch(/\$\{|\{\{|%s/);
    expect(text).not.toContain("@");
    // NO afirma que el correo salió (el envío es best-effort): manda a buscarlo.
    expect(text).not.toMatch(/te mandamos|te enviamos/i);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/dead-verification-copy.test.ts`
Expected: FAIL — `verifiedNoAccount` y `deadVerificationCopy` no existen.

- [ ] **Step 3: Implementar en `access.ts`**

En `src/lib/members/access.ts`, agregar la entrada a `ACCESS_ERRORS` (después de `dead`):

```ts
  /** §7.2 del diagnóstico de la invitación perdida: el token de verificación ya
   *  se usó pero el trámite de fondo SÍ avanzó (email verificado, cuenta sin
   *  crear). "Venció o ya fue usado" a secas es cierto sobre el token y falso
   *  sobre lo que le pasó a la persona. No promete que el correo salió —el
   *  envío de la red es best-effort—: manda a buscarlo y nombra el reenvío. */
  verifiedNoAccount:
    "Tu email ya está confirmado: lo que falta es crear tu contraseña. Buscá en tu casilla el correo para crearla (mirá también el spam) y, si no lo encontrás, pedile a la vecinal que te reenvíe el enlace.",
```

Y la función pura, después de `canRedeem`:

```ts
/** Qué decir ante un enlace de verificación MUERTO cuando la ficha del dueño se
 *  conoce (`tokens.ownerOf` la devuelve aunque el token esté usado o vencido).
 *
 *  No es un oráculo abierto: sólo se llega acá con el hash de un token real,
 *  o sea desde el correo que lo trajo, y la rama no dispara ningún envío. Lo
 *  único que revela es "confirmado, falta la contraseña", que es exactamente lo
 *  que el destinatario legítimo necesita para no abandonar el trámite (el
 *  incidente del socio 106: su verificación funcionó y la pantalla le dijo que
 *  falló).
 *
 *  Vive acá y no en la página NI en la action porque lo usan las dos: es la
 *  lección de `coverageFloor` — compartir la función, no copiarla. */
export function deadVerificationCopy(
  member: Pick<Member, "status" | "emailStatus" | "userId"> | null,
): string {
  if (
    member !== null &&
    member.status !== "withdrawn" &&
    member.emailStatus === "verified" &&
    member.userId === null
  ) {
    return ACCESS_ERRORS.verifiedNoAccount;
  }
  return ACCESS_ERRORS.dead;
}
```

- [ ] **Step 4: Verificar que pasa y que las protegidas siguen verdes**

Run: `npx vitest run tests/dead-verification-copy.test.ts tests/member-access.test.ts tests/redeem-pages.test.ts`
Expected: PASS. (Las protegidas referencian claves puntuales de `ACCESS_ERRORS`, nunca el objeto entero: agregar una clave no las toca. Si alguna fallara, el error está en el cambio.)

- [ ] **Step 5: Cablear la ACTION (POST — la captura 1 del incidente)**

En `src/app/(public)/verificar/[token]/actions.ts`:

1. Ampliar el import de access:

```ts
import {
  ACCESS_ERRORS, applyEmailVerification, canRedeem, deadVerificationCopy, memberAccess,
} from "@/lib/members/access";
```

2. En la rama de FICHA, reemplazar `if (!res.ok) return { error: res.error };` por:

```ts
  if (!res.ok) {
    // §7.2: el "ya fue usado" genérico es cierto sobre el token y puede ser
    // falso sobre la persona — su verificación pudo haber funcionado un
    // segundo antes (segunda pestaña, botón atrás). `ownerOf` lee el dueño
    // aunque el token esté usado; la ficha decide el texto. Sin envíos acá:
    // el correo ya salió (o saldrá por el reenvío del panel).
    if (res.error === ACCESS_ERRORS.dead) {
      const owner = await tokens.ownerOf(raw, "email_verification");
      if (owner?.memberId) {
        const member = await prisma.member.findUnique({
          where: { id: owner.memberId },
          select: { status: true, emailStatus: true, userId: true },
        });
        return { error: deadVerificationCopy(member) };
      }
    }
    return { error: res.error };
  }
```

- [ ] **Step 6: Cablear la PÁGINA (GET — la captura 2 del incidente)**

En `src/app/(public)/verificar/[token]/page.tsx`, el cálculo de `deadCopy` (hoy líneas 62-63) pasa a:

```ts
  const deadOwner = t ? null : await tokens.ownerOf(token, "email_verification");
  // §7.2: si el dueño es una FICHA verificada y sin cuenta, el enlace murió pero
  // el trámite avanzó — el texto lo dice (deadVerificationCopy, compartida con
  // la action). El select es mínimo y sin nombre, mismo criterio que
  // REDEEM_CARD_SELECT: esta página sigue siendo anónima.
  const deadMember = deadOwner?.memberId
    ? await prisma.member.findUnique({
        where: { id: deadOwner.memberId },
        select: { status: true, emailStatus: true, userId: true },
      })
    : null;
  const deadCopy = deadOwner?.applicationId ? APPLICATION_COPY.dead : deadVerificationCopy(deadMember);
```

Y ampliar el import de access de la página:

```ts
import {
  ACCESS_ERRORS, canRedeem, deadVerificationCopy, REDEEM_CARD_SELECT, REDEEM_PAGE_COPY,
} from "@/lib/members/access";
```

- [ ] **Step 7: Test de cableado de la action**

Agregar al final de `tests/dead-verification-copy.test.ts` (requiere mover los `vi.mock` del harness ANTES de los imports; usar el mismo harness hoisted de `tests/verify-invitation-net.test.ts`, con un agregado: el mock de `@/lib/prisma` necesita `member.findUnique`). Reemplazar la línea `vi.mock("@/lib/prisma", ...)` del Step 1 por el harness completo. El archivo final queda con esta estructura (los casos de la tabla del Step 1 no cambian):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verifyEmail: vi.fn(),
  ownerOf: vi.fn(async (): Promise<unknown> => null),
  memberFindUnique: vi.fn(async (): Promise<unknown> => null),
  sendAfterVerification: vi.fn(async () => {}),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "203.0.113.9"]])),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { member: { findUnique: h.memberFindUnique } },
}));
vi.mock("@/lib/auth/rate-limiter", () => ({
  publicTokenLimiter: { check: vi.fn(() => true) },
}));
vi.mock("@/lib/tokens", () => ({
  tokens: { peek: vi.fn(async () => null), ownerOf: h.ownerOf },
  makeTokens: vi.fn(),
  MEMBER_EMAIL_TOKEN_PURPOSES: ["email_verification", "password_invitation"],
}));
vi.mock("@/lib/applications/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/applications/service")>(
    "@/lib/applications/service",
  );
  return { LIVE_APPLICATION_STATUSES: actual.LIVE_APPLICATION_STATUSES, makeApplicationService: vi.fn() };
});
vi.mock("@/lib/members/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/members/access")>("@/lib/members/access");
  return { ...actual, memberAccess: { verifyEmail: h.verifyEmail } };
});
vi.mock("@/lib/members/invitation-email", () => ({
  invitationEmailer: { sendAfterVerification: h.sendAfterVerification },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { confirmEmailAction } from "@/app/(public)/verificar/[token]/actions";
import { ACCESS_ERRORS, deadVerificationCopy } from "@/lib/members/access";

function formDataFor(token = "RAW") {
  const fd = new FormData();
  fd.set("token", token);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerOf.mockResolvedValue(null);
  h.memberFindUnique.mockResolvedValue(null);
});

// … (la tabla de casos y el candado de copy del Step 1, sin cambios) …

describe("el segundo POST del incidente (§7.2, cableado de la action)", () => {
  it("token usado + ficha verificada sin cuenta → el texto que dice la verdad", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.dead });
    h.ownerOf.mockResolvedValue({ memberId: 106, applicationId: null });
    h.memberFindUnique.mockResolvedValue({ status: "active", emailStatus: "verified", userId: null });
    const res = await confirmEmailAction({}, formDataFor());
    expect(res).toEqual({ error: ACCESS_ERRORS.verifiedNoAccount });
    // La rama informa, no envía: ningún correo sale de acá.
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });

  it("token usado de una ficha que YA tiene cuenta → el genérico de siempre", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.dead });
    h.ownerOf.mockResolvedValue({ memberId: 106, applicationId: null });
    h.memberFindUnique.mockResolvedValue({ status: "active", emailStatus: "verified", userId: 9 });
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: ACCESS_ERRORS.dead });
  });

  it("token sin rastro → el genérico, sin consultas de ficha", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.dead });
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: ACCESS_ERRORS.dead });
    expect(h.memberFindUnique).not.toHaveBeenCalled();
  });

  it("un rechazo que NO es 'dead' (baja) no toca la rama nueva", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.withdrawn });
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: ACCESS_ERRORS.withdrawn });
    expect(h.ownerOf).not.toHaveBeenCalled();
  });
});
```

(Nota: la tabla pura del Step 1 sigue funcionando con este harness porque el mock de access usa `...actual` y sólo reemplaza `memberAccess`.)

- [ ] **Step 8: Verificar por mutación y correr las suites**

Mutación: borrar temporalmente la condición `member.userId === null` de `deadVerificationCopy` → el caso "con cuenta creada" tiene que ponerse ROJO. Restaurar. Después:

Run: `npx vitest run tests/dead-verification-copy.test.ts tests/verify-invitation-net.test.ts tests/member-access.test.ts tests/redeem-pages.test.ts tests/application-verify.test.ts tests/tokens.test.ts`
Expected: PASS todas.

- [ ] **Step 9: Commit**

```bash
git add src/lib/members/access.ts src/app/"(public)"/verificar/"[token]"/actions.ts src/app/"(public)"/verificar/"[token]"/page.tsx tests/dead-verification-copy.test.ts
git commit -m "feat(access): truthful copy when a used verification link hides a completed verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Los datos de salud — `classifyStuckAccess` (§7.3)

**Files:**
- Modify: `src/lib/admin/health.ts` (tipo `StuckAccessRow`, constante `INVITE_EXPIRING_HOURS`, función pura `classifyStuckAccess`, consulta nueva en `fetchHealth`, campo nuevo en `HealthSnapshot`)
- Test: `tests/stuck-access.test.ts`
- Modify (fixtures solamente): `tests/admin-health.test.ts` — el fake de `member.findMany` tiene que **honrar el `where` que recibe** (lección del M6: despachar por `where.emailStatus !== undefined` → la consulta nueva; si no → la de nombres) y los snapshots esperados suman `stuckAccess: []`. No debilitar ninguna aserción existente.

**Interfaces:**
- Produces: `HealthSnapshot.stuckAccess: StuckAccessRow[]`, con `StuckAccessRow = { memberId: number; memberName: string; verifiedAt: Date | null; invite: "none" | "expiring"; inviteExpiresAt: Date | null }`, `classifyStuckAccess(rows, now)` y `INVITE_EXPIRING_HOURS = 48`.
- Consumes: la relación `Member.tokens` (schema línea 266) para las invitaciones vivas.

**Decisión de ventana (spec §7.3, "acotalo a los casos que todavía se pueden resolver"):** el estado verificado-sin-cuenta es normal y transitorio mientras la invitación está viva y fresca. Se lista SOLO al que ya no tiene invitación viva (`none`: vencida, o revocada sin reemplazo) o al que le quedan menos de 48 h (`expiring`). Así la pantalla no nace acusando al que verificó ayer y todavía no eligió contraseña.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/stuck-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { classifyStuckAccess, INVITE_EXPIRING_HOURS } from "@/lib/admin/health";

const NOW = new Date("2026-08-29T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const row = (over: Partial<{
  id: number; fullName: string; emailVerifiedAt: Date | null; tokens: Array<{ expiresAt: Date }>;
}> = {}) => ({
  id: 1, fullName: "Vecina Uno", emailVerifiedAt: hours(-72), tokens: [], ...over,
});

// La consulta ya trae SOLO invitaciones vivas (usedAt null, expiresAt > now):
// acá se decide únicamente la frescura.
describe("classifyStuckAccess (§7.3)", () => {
  it("sin invitación viva → listado como 'none' (el caso del socio 106 tras vencer)", () => {
    const out = classifyStuckAccess([row()], NOW);
    expect(out).toEqual([{
      memberId: 1, memberName: "Vecina Uno", verifiedAt: hours(-72),
      invite: "none", inviteExpiresAt: null,
    }]);
  });

  it("invitación viva pero por vencer (≤ 48 h) → listado como 'expiring'", () => {
    const expiresAt = hours(INVITE_EXPIRING_HOURS - 1);
    const out = classifyStuckAccess([row({ tokens: [{ expiresAt }] })], NOW);
    expect(out).toEqual([{
      memberId: 1, memberName: "Vecina Uno", verifiedAt: hours(-72),
      invite: "expiring", inviteExpiresAt: expiresAt,
    }]);
  });

  it("invitación fresca → NO se lista: es el transitorio normal entre verificar y elegir contraseña", () => {
    expect(classifyStuckAccess([row({ tokens: [{ expiresAt: hours(72) }] })], NOW)).toEqual([]);
  });

  it("el borde exacto de la ventana cuenta como por vencer", () => {
    const out = classifyStuckAccess([row({ tokens: [{ expiresAt: hours(INVITE_EXPIRING_HOURS) }] })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].invite).toBe("expiring");
  });

  it("con más de una viva (no debería pasar: revocar-al-emitir) manda la que más lejos vence", () => {
    const far = hours(100);
    const out = classifyStuckAccess(
      [row({ tokens: [{ expiresAt: hours(10) }, { expiresAt: far }] })], NOW,
    );
    expect(out).toEqual([]); // la lejana es fresca: no se lista
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/stuck-access.test.ts`
Expected: FAIL — `classifyStuckAccess` no existe.

- [ ] **Step 3: Implementar en `health.ts`**

En `src/lib/admin/health.ts`, después del bloque de `ReceiptsHealth` (~línea 197):

```ts
/** §7.3 del diagnóstico de la invitación perdida: un socio VIGENTE con el email
 *  verificado y sin cuenta quedó a mitad del canje. El estado es normal y
 *  transitorio mientras su invitación está viva y fresca (acaba de verificar,
 *  todavía no eligió contraseña); lo anómalo es que PERSISTA. */
export type StuckAccessRow = {
  memberId: number;
  memberName: string;
  /** Cuándo verificó, para que el operador dimensione la espera. */
  verifiedAt: Date | null;
  /** `none` = sin invitación viva (venció, o se revocó sin reemplazo);
   *  `expiring` = viva pero le quedan menos de `INVITE_EXPIRING_HOURS`. */
  invite: "none" | "expiring";
  inviteExpiresAt: Date | null;
};

/** Frescura de la invitación viva: por debajo de esto, "está por vencer" y el
 *  socio entra a la lista aunque el enlace todavía sirva. 48 de las 168 h del
 *  TTL: si en cinco días no lo usó, esperar los dos que quedan es apostar a
 *  que el correo aparezca solo. */
export const INVITE_EXPIRING_HOURS = 48;

/** Función PURA (patrón de `classifyDebits`): la consulta ya filtró vigencia
 *  (socio vigente, email verificado, sin cuenta) e invitaciones VIVAS; acá sólo
 *  se decide la frescura. Review, no act: no hay nada roto — hay gente
 *  esperando, y la salida que lo apaga es el botón de envío de la ficha. */
export function classifyStuckAccess(
  rows: ReadonlyArray<{
    id: number; fullName: string; emailVerifiedAt: Date | null;
    tokens: ReadonlyArray<{ expiresAt: Date }>;
  }>,
  now: Date,
): StuckAccessRow[] {
  const soon = new Date(now.getTime() + INVITE_EXPIRING_HOURS * 3_600_000);
  const out: StuckAccessRow[] = [];
  for (const r of rows) {
    // Más de una viva no puede haber (revocar-al-emitir), pero si hubiera,
    // manda la que más lejos vence: es la que decide si hay que actuar.
    const best = r.tokens.reduce<Date | null>(
      (acc, t) => (acc === null || t.expiresAt > acc ? t.expiresAt : acc),
      null,
    );
    if (best !== null && best > soon) continue; // fresca: transitorio normal
    out.push({
      memberId: r.id, memberName: r.fullName, verifiedAt: r.emailVerifiedAt,
      invite: best === null ? "none" : "expiring",
      inviteExpiresAt: best,
    });
  }
  return out;
}
```

En `HealthSnapshot`, después de `signInReadySuperadmins`:

```ts
  /** Socios vigentes con el email verificado, sin cuenta, y sin una invitación
   *  fresca que los cubra. Ver `classifyStuckAccess`. */
  stuckAccess: StuckAccessRow[];
```

En `fetchHealth`, agregar al final del `Promise.all` (y `stuckRows` al destructuring que lo recibe):

```ts
    // §7.3: verificados sin cuenta. Acotado por el padrón (hoy son unidades),
    // sin `take`. El filtro de vigencia va acá; el de frescura, en
    // `classifyStuckAccess`, que es puro y se prueba por tabla.
    db.member.findMany({
      where: {
        status: { in: ["active", "suspended"] },
        emailStatus: "verified",
        userId: null,
      },
      select: {
        id: true, fullName: true, emailVerifiedAt: true,
        tokens: {
          where: { purpose: "password_invitation", usedAt: null, expiresAt: { gt: now } },
          select: { expiresAt: true },
        },
      },
    }),
```

Y en el objeto de retorno:

```ts
    stuckAccess: classifyStuckAccess(stuckRows, now),
```

- [ ] **Step 4: Ajustar los fixtures de `tests/admin-health.test.ts`**

El fake de `member.findMany` debe **honrar el `where`** (no re-implementarlo como constante): si `where.emailStatus` está definido, es la consulta nueva → devolver lo que el caso configure (por defecto `[]`); si no, la resolución de nombres existente. Los snapshots esperados suman `stuckAccess: []`. Agregar un caso nuevo que configure una fila verificada-sin-cuenta sin tokens y aserte que el snapshot la trae clasificada como `none`.

Run: `npx vitest run tests/stuck-access.test.ts tests/admin-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/health.ts tests/stuck-access.test.ts tests/admin-health.test.ts
git commit -m "feat(health): surface verified members left without an account

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: La alerta, el ancla y el panel (§7.3)

**Files:**
- Modify: `src/lib/admin/health-alerts.ts` (alerta *review*)
- Modify: `src/lib/admin/salud-tabs.ts` (ancla `accesos` → pestaña `correo`)
- Modify: `src/components/admin/health-panels.tsx` (nuevo `StuckAccessPanel`)
- Modify: `src/app/admin/salud/page.tsx` (montarlo en la pestaña Correo)
- Test: extender `tests/admin-health-screen.test.ts` y `tests/salud-tabs.test.ts` (fixtures + casos nuevos; sin debilitar aserciones)

**Interfaces:**
- Consumes: `HealthSnapshot.stuckAccess` de Task 4.
- Produces: alerta `{ key: "stuck-access", href: "#accesos" }` en `review`; panel con `id="accesos"`.

- [ ] **Step 1: Test de la alerta (falla primero)**

En `tests/admin-health-screen.test.ts` (o donde viva el test de `healthAlerts`; ubicarlo con `grep -l healthAlerts tests/`), agregar — sin tocar los casos existentes — un caso nuevo:

```ts
  it("los verificados sin cuenta alertan como review, nunca como act", () => {
    const health = baseHealth({
      stuckAccess: [{
        memberId: 106, memberName: "Vecina Ejemplo", verifiedAt: new Date("2026-08-29T17:42:28Z"),
        invite: "none", inviteExpiresAt: null,
      }],
    });
    const alerts = healthAlerts(health, okBackup());
    expect(alerts.act.find((a) => a.key === "stuck-access")).toBeUndefined();
    const alert = alerts.review.find((a) => a.key === "stuck-access");
    expect(alert).toBeDefined();
    expect(alert?.href).toBe("#accesos");
    expect(alert?.label).toContain("1 socio");
  });
```

(`baseHealth` / `okBackup`: usar los helpers de fixture que ese archivo ya tenga; si construye los snapshots a mano, replicar el patrón local. El fixture base suma `stuckAccess: []`.)

Run: `npx vitest run tests/admin-health-screen.test.ts` → Expected: FAIL (la alerta no existe).

- [ ] **Step 2: Implementar la alerta**

En `src/lib/admin/health-alerts.ts`, después del bloque de `failed-notices`:

```ts
  // §7.3 del diagnóstico de la invitación perdida. Review y no act: nada está
  // roto — hay gente esperando— y la salida que lo apaga es el botón de envío
  // de la ficha. No es un contador acumulativo: la lista sólo trae a quien
  // TODAVÍA se puede destrabar, y se vacía sola cuando crean su cuenta.
  if (health.stuckAccess.length > 0) {
    review.push({
      key: "stuck-access",
      label: `${plural(health.stuckAccess.length, "socio verificó su email y sigue sin cuenta", "socios verificaron su email y siguen sin cuenta")} de acceso.`,
      href: "#accesos",
    });
  }
```

- [ ] **Step 3: El ancla**

En `src/lib/admin/salud-tabs.ts`, agregar a `ANCHOR_TAB`:

```ts
  accesos: "correo",
```

Y en `tests/salud-tabs.test.ts`, el caso (siguiendo el patrón local del archivo):

```ts
  it("la alerta de accesos cae en la pestaña Correo", () => {
    expect(tabForAlertHref("#accesos")).toBe("correo");
    expect(alertHrefFor("#accesos")).toBe("?tab=correo#accesos");
  });
```

- [ ] **Step 4: El panel**

En `src/components/admin/health-panels.tsx`, agregar `KeyRound` al import de `lucide-react` existente, `StuckAccessRow` e `INVITE_EXPIRING_HOURS` al import de `@/lib/admin/health`, y `formatDateAR` al de `@/lib/format` si no está. Al final del archivo:

```tsx
// ─────────────────────────────────────────────────────────────────────────────
// 7. Verificaron su email y siguen sin cuenta (§7.3 de la invitación perdida)
// ─────────────────────────────────────────────────────────────────────────────

export function StuckAccessPanel({ rows }: { rows: StuckAccessRow[] }) {
  return (
    <Section id="accesos" icon={KeyRound} title="Verificaron su email y siguen sin cuenta">
      {rows.length === 0 ? (
        <EmptyState description="Nadie quedó a mitad de camino: quien verificó su email creó su cuenta o tiene la invitación fresca en su casilla." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Socio</TableHead>
                <TableHead>Verificó su email</TableHead>
                <TableHead>Invitación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.memberId}>
                  <TableCell>
                    <Link className={INLINE_LINK} href={`/admin/socios/${r.memberId}?tab=acceso`}>
                      {r.memberName}
                    </Link>
                  </TableCell>
                  <TableCell>{r.verifiedAt ? formatDateTimeAR(r.verifiedAt) : "—"}</TableCell>
                  <TableCell>
                    {r.invite === "none" || r.inviteExpiresAt === null ? (
                      <Badge variant="secondary">Sin enlace vivo</Badge>
                    ) : (
                      <Badge variant="secondary">{`Vence el ${formatDateAR(r.inviteExpiresAt)}`}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="max-w-3xl text-xs text-muted-foreground">
            Confirmaron su casilla y nunca crearon la contraseña: el enlace de invitación se perdió o está
            por vencer. La salida es el botón de envío de su ficha (pestaña Acceso), que revoca el enlace
            anterior y manda uno nuevo por correo. Quien verificó hace poco y tiene la invitación fresca no
            aparece acá: todavía no hay nada que destrabar.
          </p>
        </>
      )}
    </Section>
  );
}
```

(Si `Section`, `Badge`, `EmptyState`, `INLINE_LINK` o las tablas tienen firmas distintas a las de `FailedNoticesPanel`, copiar EXACTAMENTE el uso de ese panel — está en el mismo archivo, líneas 525-592.)

- [ ] **Step 5: Montar en la página**

En `src/app/admin/salud/page.tsx`: agregar `StuckAccessPanel` al import de `@/components/admin/health-panels` y, dentro del `correo={...}`:

```tsx
          correo={
            <div className="space-y-6">
              <FailedNoticesPanel
                failed={health.failed}
                failedEver={health.failedEver}
                renderResend={renderResend}
              />
              <PendingReceiptsPanel receipts={health.receipts} renderResend={renderResend} />
              <StuckAccessPanel rows={health.stuckAccess} />
            </div>
          }
```

- [ ] **Step 6: Verificar**

Run: `npx vitest run tests/admin-health-screen.test.ts tests/salud-tabs.test.ts tests/admin-health.test.ts tests/stuck-access.test.ts`
Expected: PASS. Después `npx tsc --noEmit` (o el typecheck del proyecto) para confirmar que ningún fixture de `HealthSnapshot` quedó sin el campo nuevo.

- [ ] **Step 7: Commit**

```bash
git add src/lib/admin/health-alerts.ts src/lib/admin/salud-tabs.ts src/components/admin/health-panels.tsx src/app/admin/salud/page.tsx tests/admin-health-screen.test.ts tests/salud-tabs.test.ts
git commit -m "feat(health): review alert and panel for members stuck between verification and account

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Suite completa, humo en dev y cierre documental

**Files:**
- Modify: `docs/superpowers/specs/2026-08-29-invitacion-perdida-diagnostico.md` (encabezado de estado)

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: las 3512 existentes + las nuevas, todas PASS. Cero aserciones tocadas en `member-access`, `redeem-pages`, `tokens`, `application-verify`.

- [ ] **Step 2: Humo en dev (manual, con el dev server)**

Con `npm run dev` y la base local sembrada: (1) mandar una verificación desde una ficha de prueba con casilla de la `EMAIL_ALLOWLIST` local (`marianoaperez@yahoo.com.ar` o `perezmarianoariel@gmail.com`), abrir el enlace, confirmar → verificar que además del redirect a `/acceso/...` llega el correo "Creá tu contraseña" con el MISMO token de la URL; (2) reabrir `/verificar/[token]` con el token ya usado → la página tiene que decir el texto nuevo ("Tu email ya está confirmado…"), no el genérico; (3) dejar la ficha sin crear contraseña, vencerle la invitación a mano (`UPDATE action_tokens SET expires_at = NOW() WHERE ...` en la base LOCAL) y entrar a `/admin/salud` → pestaña Correo, panel "Verificaron su email y siguen sin cuenta" con la fila y la alerta amarilla en el veredicto. **Nunca contra producción.**

- [ ] **Step 3: Actualizar el estado de la spec**

En `docs/superpowers/specs/2026-08-29-invitacion-perdida-diagnostico.md`, línea 3, reemplazar el estado por: `**Fecha:** 29/08/2026 · **Estado:** diagnóstico CERRADO; arreglo §7.1+§7.2+§7.3 implementado en la rama invitation-email-net (ver docs/superpowers/plans/2026-08-29-invitacion-por-correo.md).`

- [ ] **Step 4: Commit final**

```bash
git add docs/superpowers/specs/2026-08-29-invitacion-perdida-diagnostico.md
git commit -m "docs: mark the lost-invitation fix as implemented

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Cierre de rama**

Usar la skill `superpowers:finishing-a-development-branch` (merge a `main` lo decide el operador; el push lo corre Mariano).

---

## Self-review (hecho al escribir el plan)

- **Cobertura de la spec:** §7.1 → Tasks 1-2 (las dos ramas, post-commit, mismo token, best-effort, allowlist cubierta por el transporte). §7.2 → Task 3 (función compartida página+action, sin oráculo de envíos). §7.3 → Tasks 4-5 (review, acotado a destrabables, salida nombrada). §7.4 respetado: ningún task toca `peek`/`consume`, la atomicidad ni el recupero. §9.1-9.4 → los tests por mutación de Tasks 2-3 y los casos de las dos ramas; §9.5 → Task 6 Step 2 con las casillas permitidas.
- **Sin placeholders:** todo código está completo; los dos puntos que dependen de fixtures locales (`tests/admin-health.test.ts`, helpers de `admin-health-screen.test.ts`) instruyen replicar el patrón del archivo, que el implementador tiene delante.
- **Consistencia de tipos:** `sendAfterVerification(memberId, rawInvite)` igual en Tasks 1-3; `StuckAccessRow`/`stuckAccess`/`classifyStuckAccess`/`INVITE_EXPIRING_HOURS` iguales en Tasks 4-5; `verifiedNoAccount`/`deadVerificationCopy` iguales en Task 3.
