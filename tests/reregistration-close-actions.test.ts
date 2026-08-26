// Las acciones de la pantalla de cierre, del lado que decide QUÉ SE LE DICE AL
// OPERADOR cuando una baja queda sin notificar.
//
// Por qué este archivo existe: una baja no notificada es una baja que el socio
// puede impugnar y que la asociación no puede sostener ante la IGJ —desde la
// notificación fehaciente le corren treinta días para recurrir ante la asamblea
// (Art. 9° bis d)—. Y el camino por el que hoy queda sin notificar no es raro:
// `EMAIL_ALLOWLIST` sigue definida en producción hasta el lanzamiento
// (docs/07), un bloqueo NO escribe fila de notificación, y la persona ya no es
// socia vigente, así que desaparece de la lista de pendientes apenas se recarga
// la pantalla. Si el nombre no viaja en el resultado, no queda en ningún lado.
//
// Se doblan el dominio y la base: acá lo que se prueba es el reporte y la
// autorización, no la escritura de la baja (eso es
// `tests/reregistration-withdrawals.test.ts`).
import { describe, expect, it, vi } from "vitest";

const requireMock = vi.hoisted(() => ({
  superadmin: vi.fn(async () => ({ ok: true, actorId: 4 })),
}));
const domain = vi.hoisted(() => ({
  listPendingWithdrawals: vi.fn(),
  listUnnotifiedWithdrawals: vi.fn(),
  declareBatch: vi.fn(),
  notifyWithdrawal: vi.fn(),
}));

vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: requireMock.superadmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reregistrationProcess: {
      findUnique: vi.fn(async () => ({
        id: 1,
        status: "second_instance",
        // Vencida: la precondición del cierre se revalida contra la base.
        secondEndsAt: new Date("2026-08-01T12:00:00Z"),
      })),
    },
  },
}));
vi.mock("@/lib/members/minute-form", async (orig) => ({
  ...(await orig<typeof import("@/lib/members/minute-form")>()),
  resolveMinuteId: vi.fn(async () => 77),
  describeMinuteSelection: vi.fn(async () => "Acta de Comisión N° 12 — 10/11/2026"),
  discardUnusedMinute: vi.fn(async () => {}),
}));
vi.mock("@/lib/reregistration/withdrawals", () => ({
  WITHDRAWAL_BATCH_MAX: 25,
  WITHDRAWAL_RETRY_AUDIT_ACTION: "reregistration_withdrawal_retry",
  WITHDRAWAL_AUDIT_ENTITY: "member",
  withdrawals: domain,
}));
vi.mock("@/lib/board/notice", () => ({
  boardNotices: { openWithdrawalNotice: vi.fn() },
  NOTICE_AUDIT_ENTITY: "board_notice",
  WITHDRAWAL_NOTICE_AUDIT_ACTION: "board_notice_withdrawal",
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.4"]])),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { audit } from "@/lib/audit";
import {
  declareWithdrawalsAction, retryWithdrawalNoticesAction,
} from "@/app/admin/reempadronamiento/cierre/actions";
import { withdrawalConfirmToken } from "@/lib/reregistration/withdrawal-confirm";

function pending(id: number, over: Record<string, unknown> = {}) {
  return {
    presentationId: id,
    memberId: id * 10,
    fullName: `Socio ${id * 10}`,
    memberNumber: id * 10,
    status: "pending" as const,
    byEmail: true,
    notices: [],
    ...over,
  };
}

function unnotified(id: number, over: Record<string, unknown> = {}) {
  return {
    presentationId: id,
    memberId: id * 10,
    fullName: `Socio ${id * 10}`,
    memberNumber: id * 10,
    byEmail: true,
    ...over,
  };
}

/** El formulario del segundo paso, con la huella que la action revalida. */
function confirmedForm(ids: number[]) {
  const form = new FormData();
  form.append("processId", "1");
  for (const id of ids) form.append("ids", String(id));
  form.append("minuteId", "12");
  form.append("confirmar", "1");
  form.append("confirmToken", withdrawalConfirmToken(ids, { minuteId: 12 }));
  return form;
}

function reset() {
  vi.mocked(audit).mockClear();
  requireMock.superadmin.mockReset();
  requireMock.superadmin.mockResolvedValue({ ok: true, actorId: 4 });
  for (const fn of Object.values(domain)) fn.mockReset();
}

describe("declareWithdrawalsAction — el bloqueo del correo viaja CON NOMBRE", () => {
  it("los bloqueados por la lista del entorno se dicen por su nombre, no como un número", async () => {
    // El defecto que este test fija: `blocked` viajaba como CONTADOR y se
    // mostraba dentro de la caja verde de éxito. El nombre de quien quedó de
    // baja sin notificar no quedaba en ningún lado —el bloqueo no escribe fila
    // de notificación y la persona ya no es socia vigente, así que sale de la
    // lista de pendientes en cuanto la pantalla se recarga—.
    reset();
    domain.listPendingWithdrawals.mockResolvedValue([pending(1), pending(2), pending(3)]);
    domain.declareBatch.mockResolvedValue({
      declared: [1, 2, 3], failures: [], debitFailures: [], unstamped: [],
    });
    domain.notifyWithdrawal
      .mockResolvedValueOnce("email")
      .mockResolvedValueOnce("blocked")
      .mockResolvedValueOnce("failed");

    const state = await declareWithdrawalsAction({}, confirmedForm([1, 2, 3]));

    expect(state.declared).toBe(3);
    expect(state.notices?.emailed).toBe(1);
    expect(state.notices?.blocked).toEqual(["Socio 20"]);
    expect(state.notices?.failed).toEqual(["Socio 30"]);
  });

  it("un bloqueo solo alcanza para no redirigir: si redirige, el nombre se pierde", async () => {
    reset();
    domain.listPendingWithdrawals.mockResolvedValue([pending(1)]);
    domain.declareBatch.mockResolvedValue({
      declared: [1], failures: [], debitFailures: [], unstamped: [],
    });
    domain.notifyWithdrawal.mockResolvedValue("blocked");

    const state = await declareWithdrawalsAction({}, confirmedForm([1]));

    // Con `redirect` el querystring sólo lleva números y el nombre no llega.
    expect(state.notices?.blocked).toEqual(["Socio 10"]);
    expect(state.declared).toBe(1);
  });
});

describe("retryWithdrawalNoticesAction", () => {
  const form = () => {
    const f = new FormData();
    f.append("processId", "1");
    return f;
  };

  it("sin superadmin no notifica ni audita nada", async () => {
    // Una server action se despacha por el id del encabezado `Next-Action`, no
    // por su URL: el botón deshabilitado no protege nada.
    reset();
    requireMock.superadmin.mockResolvedValue({
      ok: false, actorId: 0, error: "Solo el superadmin puede declarar bajas.",
    } as never);

    const state = await retryWithdrawalNoticesAction({}, form());

    expect(state.error).toBe("Solo el superadmin puede declarar bajas.");
    expect(domain.listUnnotifiedWithdrawals).not.toHaveBeenCalled();
    expect(domain.notifyWithdrawal).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("reintenta la lista VIVA de la base y no lo que mande el formulario", async () => {
    reset();
    domain.listUnnotifiedWithdrawals.mockResolvedValue([unnotified(1), unnotified(2)]);
    domain.notifyWithdrawal.mockResolvedValue("email");

    const f = form();
    // Un POST armado a mano no puede elegir a quién se le notifica.
    f.append("ids", "999");
    const state = await retryWithdrawalNoticesAction({}, f);

    expect(domain.listUnnotifiedWithdrawals).toHaveBeenCalledWith(1);
    expect(domain.notifyWithdrawal.mock.calls.map((c) => c[0].presentationId)).toEqual([1, 2]);
    expect(state.emailed).toBe(2);
  });

  it("al lograrlo lo dice, y a los que siguen sin notificar los nombra", async () => {
    reset();
    domain.listUnnotifiedWithdrawals.mockResolvedValue([
      unnotified(1), unnotified(2), unnotified(3), unnotified(4, { byEmail: false }),
    ]);
    domain.notifyWithdrawal
      .mockResolvedValueOnce("email")
      .mockResolvedValueOnce("blocked")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("board");

    const state = await retryWithdrawalNoticesAction({}, form());

    expect(state.emailed).toBe(1);
    // HONESTIDAD: el reintento no puede prometer lo que no hace. Un bloqueo por
    // la lista del entorno va a volver a bloquearse mientras esa lista exista.
    expect(state.blocked).toEqual(["Socio 20"]);
    expect(state.failed).toEqual(["Socio 30"]);
    // El que no tiene casilla no se notifica por acá nunca: su vía es el cartel.
    expect(state.board).toBe(1);
  });

  it("audita por persona, con ids y códigos y sin datos personales", async () => {
    reset();
    domain.listUnnotifiedWithdrawals.mockResolvedValue([unnotified(1), unnotified(2, { byEmail: false })]);
    domain.notifyWithdrawal.mockResolvedValueOnce("email").mockResolvedValueOnce("board");

    await retryWithdrawalNoticesAction({}, form());

    // Uno solo: al que no tiene casilla no se le intentó ningún envío, y un
    // asiento por cada uno de los cien del cartel sería ruido en el libro.
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(audit).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 4,
      action: "reregistration_withdrawal_retry",
      entity: "member",
      entityId: 10,
      detail: { processId: 1, presentationId: 1, outcome: "email" },
    });
    expect(JSON.stringify(entry)).not.toContain("Socio 10");
  });

  it("si a ninguno se le puede mandar correo lo dice, en vez de terminar mudo", async () => {
    // Es el caso del padrón real: 100 de 124 adherentes no tienen casilla. El
    // botón ya llega apagado, así que esto cubre la carrera y el POST armado a
    // mano — y sobre todo, que la acción no termine sin decir nada.
    reset();
    domain.listUnnotifiedWithdrawals.mockResolvedValue([unnotified(1, { byEmail: false })]);
    domain.notifyWithdrawal.mockResolvedValue("board");

    const state = await retryWithdrawalNoticesAction({}, form());

    expect(state.ok).toContain("cartel de la sede");
    expect(state.board).toBe(1);
  });

  it("sin nada que reintentar lo dice y no manda ningún correo", async () => {
    reset();
    domain.listUnnotifiedWithdrawals.mockResolvedValue([]);

    const state = await retryWithdrawalNoticesAction({}, form());

    expect(state.ok).toBeTruthy();
    expect(domain.notifyWithdrawal).not.toHaveBeenCalled();
  });
});
