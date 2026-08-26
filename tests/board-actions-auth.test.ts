// Las guardas de las dos acciones de cartelera.
//
// Una server action es un endpoint HTTP: Next las despacha por el id del
// encabezado `Next-Action` contra un manifiesto global del build, así que el
// botón deshabilitado de la tarjeta no protege NADA. Lo único que cierra la
// puerta es el `require*` de la primera línea, y este archivo fija que el
// rechazo corte ANTES de tocar el dominio y antes de auditar.
//
// Asentar la fijación es de SUPERADMIN: es el acto que da por notificados a los
// cien convocados sin casilla y hace correr sus veinte días hábiles. Sumar a un
// cartel sin fijar no mueve ningún plazo, así que alcanza con `requireAdmin`.
import { describe, expect, it, vi } from "vitest";

const boardMock = vi.hoisted(() => ({
  post: vi.fn(async () => ({ ok: true as const, dueAt: new Date(), stamped: 0 })),
  openOther: vi.fn(async () => ({ ok: true as const, noticeId: 1 })),
}));
const requireMock = vi.hoisted(() => ({
  admin: vi.fn(async () => ({ ok: false, reason: "not_admin", error: "No sos administrador." })),
  superadmin: vi.fn(async () => ({
    ok: false,
    reason: "not_admin",
    error: "Solo el superadmin puede asentar la fijación.",
  })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { holiday: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/board/notice", () => ({ boardNotices: boardMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: requireMock.admin,
  requireSuperadmin: requireMock.superadmin,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { audit } from "@/lib/audit";
import {
  addToBoardNoticeAction, postBoardNoticeAction,
} from "@/app/admin/reempadronamiento/avisos/actions";

describe("postBoardNoticeAction sin superadmin", () => {
  it("un admin común no puede asentar la fijación", async () => {
    const form = new FormData();
    form.append("noticeId", "5");
    form.append("postedAt", "2026-10-02");

    const result = await postBoardNoticeAction({}, form);

    expect(result.error).toBe("Solo el superadmin puede asentar la fijación.");
    // Ni el dominio ni la auditoría: el rechazo es lo primero que pasa.
    expect(boardMock.post).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("addToBoardNoticeAction sin admin", () => {
  it("sin rol de administración no se abre ningún cartel", async () => {
    const form = new FormData();
    form.append("processId", "1");
    form.append("memberId", "7");

    const result = await addToBoardNoticeAction({}, form);

    expect(result.error).toBe("No sos administrador.");
    expect(boardMock.openOther).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("postBoardNoticeAction con superadmin", () => {
  function allow() {
    requireMock.superadmin.mockResolvedValueOnce(
      { ok: true, actorId: 1 } as unknown as Awaited<ReturnType<typeof requireMock.superadmin>>,
    );
  }

  it("no se puede asentar que el cartel se colgó MAÑANA", async () => {
    // Una fecha futura adelantaría el vencimiento del plazo de cien vecinos, y
    // la fijación se registra una sola vez: no hay pantalla para corregirla.
    allow();
    const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const form = new FormData();
    form.append("noticeId", "5");
    form.append("postedAt", tomorrow);

    const result = await postBoardNoticeAction({}, form);

    expect(result.error).toContain("no puede ser futura");
    expect(boardMock.post).not.toHaveBeenCalled();
  });

  it("un día que no existe en el calendario no llega al dominio", async () => {
    // `civilDateUtc` rodaría "2026-02-31" al 03/03 en silencio.
    allow();
    const form = new FormData();
    form.append("noticeId", "5");
    form.append("postedAt", "2026-02-31");

    const result = await postBoardNoticeAction({}, form);

    expect(result.error).toContain("no existe en el calendario");
    expect(boardMock.post).not.toHaveBeenCalled();
  });
});
