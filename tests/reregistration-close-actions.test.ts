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
  countDebitCalls: vi.fn(),
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
import { redirect } from "next/navigation";
import { resolveMinuteId } from "@/lib/members/minute-form";
import { WITHDRAWAL_DEBIT_CALL_BUDGET } from "@/lib/reregistration/close";
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
  // El caso REAL de esta pantalla: los convocados son adherentes y la categoría
  // no habilita el débito automático, así que el lote no llama a Mercado Pago ni
  // una vez. Cada test que quiera débitos vivos lo dice.
  domain.countDebitCalls.mockResolvedValue({ members: 0, calls: 0 });
  vi.mocked(resolveMinuteId).mockClear();
  vi.mocked(redirect).mockClear();
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

describe("declareWithdrawalsAction — el lote se presupuesta en LLAMADAS DE RED", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("declara los 90 de una tanda cuando ninguno tiene débito automático vivo", async () => {
    // El pedido del operador después del ensayo del 26/08/2026: "deberíamos
    // poder seleccionar a todos". Declaró 90 bajas en cuatro tandas por un tope
    // de 25 nombres que existía para acotar las cancelaciones de débito en
    // Mercado Pago — y en esas 90 bajas no hubo NINGUNA (son adherentes, y la
    // categoría no habilita el débito).
    reset();
    domain.listPendingWithdrawals.mockResolvedValue(many(90).map((id) => pending(id)));
    domain.declareBatch.mockResolvedValue({
      declared: many(90), failures: [], debitFailures: [], unstamped: [],
    });
    domain.notifyWithdrawal.mockResolvedValue("board");

    await declareWithdrawalsAction({}, confirmedForm(many(90)));

    expect(domain.declareBatch).toHaveBeenCalledTimes(1);
    expect(domain.declareBatch.mock.calls[0][0].presentationIds).toHaveLength(90);
  });

  it("si las cancelaciones pasan el presupuesto rechaza, y NO crea el acta", async () => {
    // El orden importa tanto como el corte: un lote rechazado después de
    // resolver el acta deja un asiento fantasma en un libro que la asociación
    // presenta ante la IGJ.
    reset();
    const over = WITHDRAWAL_DEBIT_CALL_BUDGET + 1;
    domain.listPendingWithdrawals.mockResolvedValue(many(over).map((id) => pending(id)));
    domain.countDebitCalls.mockResolvedValue({ members: over, calls: over });

    const state = await declareWithdrawalsAction({}, confirmedForm(many(over)));

    expect(state.error).toContain(String(over));
    expect(state.error).toContain(String(WITHDRAWAL_DEBIT_CALL_BUDGET));
    expect(resolveMinuteId).not.toHaveBeenCalled();
    expect(domain.declareBatch).not.toHaveBeenCalled();
  });

  it("presupuesta sobre la lista VIVA de la base, no sobre lo que manda el formulario", async () => {
    // Mismo criterio que el resto de la pantalla: lo que vale es la base. Un
    // POST armado a mano con ids que ya no corresponden no puede hacer que la
    // guarda mida otra cosa que los socios que se van a dar de baja.
    reset();
    domain.listPendingWithdrawals.mockResolvedValue([pending(1), pending(2)]);
    domain.declareBatch.mockResolvedValue({
      declared: [1, 2], failures: [], debitFailures: [], unstamped: [],
    });
    domain.notifyWithdrawal.mockResolvedValue("board");

    await declareWithdrawalsAction({}, confirmedForm([1, 2, 999]));

    expect(domain.countDebitCalls).toHaveBeenCalledWith([10, 20]);
  });

  it("devuelve el acta que usó la tanda, para que la siguiente no cree una duplicada", async () => {
    // La fricción medida en el ensayo: al terminar una tanda el selector volvía
    // a "Acta nueva" con el número anterior todavía tipeado, y la lista de actas
    // existentes era la de cuando se montó la página. El acta recién usada tiene
    // que volver identificada para que la pantalla la pueda ofrecer.
    reset();
    domain.listPendingWithdrawals.mockResolvedValue([pending(1)]);
    domain.declareBatch.mockResolvedValue({
      declared: [1], failures: [], debitFailures: [], unstamped: [],
    });
    domain.notifyWithdrawal.mockResolvedValue("blocked");

    const state = await declareWithdrawalsAction({}, confirmedForm([1]));

    expect(state.minute).toEqual({ id: 77, label: "Acta de Comisión N° 12 — 10/11/2026" });
  });

  it("con la tanda limpia el acta viaja en el redirect, que es donde el estado se pierde", async () => {
    reset();
    domain.listPendingWithdrawals.mockResolvedValue([pending(1)]);
    domain.declareBatch.mockResolvedValue({
      declared: [1], failures: [], debitFailures: [], unstamped: [],
    });
    domain.notifyWithdrawal.mockResolvedValue("board");

    await declareWithdrawalsAction({}, confirmedForm([1]));

    expect(redirect).toHaveBeenCalledWith(
      "/admin/reempadronamiento/cierre?declaradas=1&cartelera=1&acta=77",
    );
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
