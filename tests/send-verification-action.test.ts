import { beforeEach, describe, expect, it, vi } from "vitest";

// La ola anterior dejó sin test el cableado de `sendVerificationAction`
// (src/app/admin/socios/carga/[numero]/actions.ts): `target.kind` —lo que
// devuelve `verificationTarget` (testeado sin base en tests/card-edit.test.ts)—
// tiene que llegar IGUAL a los tres puntos que lo consumen: el propósito del
// token (`tokens.issue`), la plantilla (`portalInvite`) y el tipo de la
// notificación (`mailer.sendToMember`). Si alguno de los tres queda
// hardcodeado en vez de leer `target.kind`, el socio recibe el correo
// equivocado (o el token con el propósito equivocado) sin que nada lo avise.
//
// La action es "use server" y usa los singletones de producción directo (no
// sigue el patrón `make*(deps)` del resto del módulo), así que acá se
// mockean sus dependencias módulo por módulo, como ya hace tests/email.test.ts
// con "@/lib/prisma".
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: vi.fn() },
    actionToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "127.0.0.1"]])),
}));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 1 })),
}));

vi.mock("@/lib/auth/rate-limiter", () => ({
  verificationMemberLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
  verificationActorLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
}));

vi.mock("@/lib/tokens", () => ({
  hashToken: vi.fn((raw: string) => `hash:${raw}`),
  tokens: {
    issue: vi.fn(async () => "RAW-TOKEN"),
    revokeForMember: vi.fn(async () => 0),
  },
  MEMBER_EMAIL_TOKEN_PURPOSES: ["email_verification", "password_invitation"],
}));

vi.mock("@/lib/email", () => ({
  mailer: { sendToMember: vi.fn(async () => ({ messageId: "mid-1" })) },
}));

vi.mock("@/lib/email/templates", () => ({
  portalInvite: vi.fn(() => ({
    message: { subject: "s", text: "t", html: "<p>t</p>" },
    summary: "resumen",
  })),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { sendVerificationAction } from "@/app/admin/socios/carga/[numero]/actions";
import { verificationActorLimiter, verificationMemberLimiter } from "@/lib/auth/rate-limiter";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { mailer } from "@/lib/email";
import { portalInvite } from "@/lib/email/templates";

type MockedFn = ReturnType<typeof vi.fn>;

function member(over: Partial<{
  id: number; status: string; email: string | null; emailStatus: string;
  userId: number | null; fullName: string;
}> = {}) {
  return {
    id: 1, status: "active", email: "vecino@example.com", emailStatus: "declared",
    userId: null, fullName: "Perez Ana", ...over,
  };
}

// Sin esto, los `toHaveBeenCalled` de un test veían las llamadas del anterior.
beforeEach(() => {
  vi.clearAllMocks();
});

function formDataFor(memberId: number) {
  const fd = new FormData();
  fd.set("memberId", String(memberId));
  return fd;
}

describe("sendVerificationAction — cableado de target.kind", () => {
  // El socio todavía no confirmó el email: `verificationTarget` devuelve
  // kind: "email_verification", y ese valor tiene que ser el que viaja a
  // `tokens.issue` (propósito del token), `portalInvite` (plantilla + ruta) y
  // `mailer.sendToMember` (tipo de la notificación acreditada).
  it("wires an unverified member's email_verification kind through all three calls", async () => {
    (prisma.member.findUnique as MockedFn).mockResolvedValue(member({ emailStatus: "declared" }));

    const res = await sendVerificationAction({}, formDataFor(1));

    expect(res).toEqual({ sent: true });
    expect(tokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "email_verification", memberId: 1 }),
    );
    expect(portalInvite).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "email_verification" }),
    );
    expect(mailer.sendToMember).toHaveBeenCalledWith(
      expect.objectContaining({ type: "email_verification", to: "vecino@example.com" }),
    );
  });

  // El socio ya confirmó el email y todavía no tiene cuenta: `verificationTarget`
  // devuelve kind: "password_invitation" acá, y los mismos tres puntos tienen
  // que seguirlo. Confirmar los dos valores (y no sólo uno) es lo que hace que
  // el test falle si algún punto quedó con un kind pisado a mano.
  it("wires a verified member's password_invitation kind through all three calls", async () => {
    (prisma.member.findUnique as MockedFn).mockResolvedValue(
      member({ emailStatus: "verified", userId: null }),
    );

    const res = await sendVerificationAction({}, formDataFor(1));

    expect(res).toEqual({ sent: true });
    expect(tokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "password_invitation", memberId: 1 }),
    );
    expect(portalInvite).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "password_invitation" }),
    );
    expect(mailer.sendToMember).toHaveBeenCalledWith(
      expect.objectContaining({ type: "password_invitation", to: "vecino@example.com" }),
    );
  });
});

// ── Guardas del envío ─────────────────────────────────────────────────────────
//
// El botón ahora se ofrece también desde la ficha (`/admin/socios/[id]`, spec
// §8) y no sólo desde el modo carga. Las dos pantallas llaman a ESTA action, así
// que las guardas se fijan acá: si alguna se debilitara, ninguna de las dos
// pantallas alcanzaría para notarlo.
describe("sendVerificationAction — guardas que las dos pantallas comparten", () => {
  it("never writes to a withdrawn member: no token, no mail", async () => {
    (prisma.member.findUnique as MockedFn).mockResolvedValue(member({ status: "withdrawn" }));

    const res = await sendVerificationAction({}, formDataFor(1));

    expect(res.error).toContain("dado de baja");
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("refuses a member who already created the account", async () => {
    (prisma.member.findUnique as MockedFn).mockResolvedValue(
      member({ emailStatus: "verified", userId: 42 }),
    );

    const res = await sendVerificationAction({}, formDataFor(1));

    expect(res.error).toContain("ya tiene su cuenta creada");
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("refuses a member with no email on the card", async () => {
    (prisma.member.findUnique as MockedFn).mockResolvedValue(member({ email: null }));

    const res = await sendVerificationAction({}, formDataFor(1));

    expect(res.error).toContain("no tiene email cargado");
    expect(mailer.sendToMember).not.toHaveBeenCalled();
  });

  // El cupo por socio y el cupo por operador siguen vigentes y siguen cobrándose
  // recién cuando los DOS habilitan (ver el comentario largo de la action).
  it("honours the per-member rate limit without charging the operator quota", async () => {
    (prisma.member.findUnique as MockedFn).mockResolvedValue(member());
    (verificationMemberLimiter.allows as MockedFn).mockReturnValueOnce(false);

    const res = await sendVerificationAction({}, formDataFor(1));

    expect(res.error).toContain("Esperá");
    expect(verificationActorLimiter.record).not.toHaveBeenCalled();
    expect(mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("honours the per-operator rate limit", async () => {
    (prisma.member.findUnique as MockedFn).mockResolvedValue(member());
    (verificationActorLimiter.allows as MockedFn).mockReturnValueOnce(false);

    const res = await sendVerificationAction({}, formDataFor(1));

    expect(res.error).toContain("demasiados correos");
    expect(verificationMemberLimiter.record).not.toHaveBeenCalled();
    expect(mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("records both quotas on a successful send", async () => {
    (prisma.member.findUnique as MockedFn).mockResolvedValue(member());

    await sendVerificationAction({}, formDataFor(1));

    expect(verificationMemberLimiter.record).toHaveBeenCalledTimes(1);
    expect(verificationActorLimiter.record).toHaveBeenCalledTimes(1);
  });
});
