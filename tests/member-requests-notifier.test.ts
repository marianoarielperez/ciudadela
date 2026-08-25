// Test puro del módulo de aviso (`member-requests/notify.ts`), habilitado por
// la Task 9 (revisión, arreglo 5): antes usaba `@/lib/prisma` y `mailer`
// directos, así que la mitad emisora —la guarda de email inutilizable y el
// mapeo aceptada/rechazada → tipo de notificación— sólo se podía probar
// mockeando módulos enteros (ver `tests/solicitudes-socios-actions.test.ts`).
// Con `makeMemberRequestNotifier(deps)` esto es un test puro, sin Prisma ni
// red, mismo criterio que `tests/member-requests-service.test.ts`.
import { describe, expect, it, vi } from "vitest";
// El singleton al final de `notify.ts` liga `db: prisma` y el `mailer` real
// (`@/lib/email` → `@/lib/prisma`, que tira sin `DATABASE_URL`) — mismo motivo
// que `tests/member-requests-service.test.ts` y `tests/treasury-receipt-email.test.ts`
// mockean ambos módulos antes de importar. Este archivo prueba únicamente
// `makeMemberRequestNotifier`, con dobles propios: nunca toca el singleton.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ mailer: {} }));
import { makeMemberRequestNotifier } from "@/lib/members/member-requests/notify";

type Member = { id: number; fullName: string; email: string | null; emailStatus: string };
type SendToMemberArgs = {
  memberId: number | null; to: string; type: string;
  message: unknown; summary: string; period?: string | null;
};

function setup(member: Member | null) {
  const db = { member: { findUnique: vi.fn(async () => member) } };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma existe para tipar el mock, no para leerse
  const sendToMember = vi.fn(async (_input: SendToMemberArgs) => ({ messageId: "m-1" }));
  const mailer = { sendToMember };
  const notifier = makeMemberRequestNotifier({ db: db as never, mailer });
  return { db, mailer, sendToMember, notifier };
}

describe("makeMemberRequestNotifier", () => {
  it("socio sin email: no llama al mailer", async () => {
    const { sendToMember, notifier } = setup({ id: 1, fullName: "Sin Correo", email: null, emailStatus: "declared" });
    await notifier.notifyRequestDecided({ memberId: 1, type: "withdrawal", accepted: true });
    expect(sendToMember).not.toHaveBeenCalled();
  });

  it("socio con email rebotado: tampoco llama al mailer", async () => {
    const { sendToMember, notifier } = setup({
      id: 2, fullName: "Rebotado Juan", email: "rebotado@example.com", emailStatus: "bounced",
    });
    await notifier.notifyRequestDecided({ memberId: 2, type: "withdrawal", accepted: true });
    expect(sendToMember).not.toHaveBeenCalled();
  });

  it("socio inexistente: no revienta y no llama al mailer", async () => {
    const { sendToMember, notifier } = setup(null);
    await notifier.notifyRequestDecided({ memberId: 999, type: "category_change", accepted: false });
    expect(sendToMember).not.toHaveBeenCalled();
  });

  it("aceptada: manda con type request_accepted y el email de la ficha", async () => {
    const { sendToMember, notifier } = setup({
      id: 3, fullName: "Soto Juan", email: "soto@example.com", emailStatus: "verified",
    });
    await notifier.notifyRequestDecided({ memberId: 3, type: "withdrawal", accepted: true });
    expect(sendToMember).toHaveBeenCalledTimes(1);
    const call = sendToMember.mock.calls[0][0];
    expect(call.memberId).toBe(3);
    expect(call.to).toBe("soto@example.com");
    expect(call.type).toBe("request_accepted");
  });

  it("rechazada: manda con type request_rejected", async () => {
    const { sendToMember, notifier } = setup({
      id: 4, fullName: "Perez Ana", email: "ana@example.com", emailStatus: "verified",
    });
    await notifier.notifyRequestDecided({ memberId: 4, type: "category_change", accepted: false, note: "Deuda pendiente." });
    expect(sendToMember).toHaveBeenCalledTimes(1);
    const call = sendToMember.mock.calls[0][0];
    expect(call.type).toBe("request_rejected");
  });

  it("un fallo del mailer no propaga: es best-effort", async () => {
    const db = {
      member: {
        findUnique: vi.fn(async () => ({ id: 5, fullName: "Falla Envío", email: "falla@example.com", emailStatus: "verified" })),
      },
    };
    const sendToMember = vi.fn(async () => { throw new Error("smtp down"); });
    const notifier = makeMemberRequestNotifier({ db: db as never, mailer: { sendToMember } });
    await expect(
      notifier.notifyRequestDecided({ memberId: 5, type: "withdrawal", accepted: true }),
    ).resolves.toBeUndefined();
  });

  it("un fallo de la base al buscar la ficha tampoco propaga", async () => {
    const db = { member: { findUnique: vi.fn(async () => { throw new Error("db down"); }) } };
    const notifier = makeMemberRequestNotifier({ db: db as never, mailer: { sendToMember: vi.fn() } });
    await expect(
      notifier.notifyRequestDecided({ memberId: 6, type: "withdrawal", accepted: true }),
    ).resolves.toBeUndefined();
  });
});
