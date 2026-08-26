import { beforeEach, describe, expect, it, vi } from "vitest";

// Las acciones societarias de `/admin/socios/[id]` son "use server" y usan los
// singletones de producción, así que se mockean sus dependencias módulo por
// módulo — el mismo patrón de `tests/minute-actions.test.ts`.
//
// Lo que fija este archivo: el reingreso NO se bloquea por deuda (la decisión es
// de la Comisión, REG-16), y justamente por eso el asiento de auditoría es el
// único lugar del sistema donde queda registrado con cuántas cuotas pendientes
// se readmitió al socio (spec §6.3).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: vi.fn() },
    fee: { count: vi.fn(async () => 0) },
    minute: { findUnique: vi.fn(async () => ({ id: 5 })) },
    memberRequest: { findUnique: vi.fn() },
  },
}));

// M5B Task 9 (revisión): `markAccepted` y `notifyRequestDecided` sólo se tocan
// cuando el formulario trae `requestId` (el camino "Aplicar" de la bandeja de
// solicitudes) — ver el bloque `describe("el camino de la bandeja de
// solicitudes (requestId)"` más abajo. El resto de este archivo nunca manda
// `requestId`, así que estos dobles quedan sin llamar y no cambian nada de lo
// que ya prueba el archivo.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma existe para tipar, no para leerse
const markAccepted = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/members/member-requests/service", () => ({
  memberRequests: { markAccepted: (...a: unknown[]) => markAccepted(...a) },
}));
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma existe para tipar, no para leerse
const notifyRequestDecided = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/members/member-requests/notify", () => ({
  notifyRequestDecided: (...a: unknown[]) => notifyRequestDecided(...a),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.9"]])),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 7 })),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

// `withdraw` está en el doble A PROPÓSITO, aunque la acción ya no deba
// llamarlo: si no estuviera, la aserción de abajo se cumpliría por la forma del
// doble y no por lo que hace producción (un `memberService.withdraw(...)` que
// volviera tiraría `is not a function` y el test caería por otra razón, sin
// decir cuál). Con el doble presente, `not.toHaveBeenCalled()` prueba el camino.
vi.mock("@/lib/members/service", () => ({
  electionsOngoing: vi.fn(async () => false),
  memberService: { readmit: vi.fn(async () => ({})), withdraw: vi.fn(async () => ({})) },
}));

// La baja pasa por `withdrawWithDebits` y no por `memberService.withdraw`: es
// el camino que además corta el débito automático en Mercado Pago.
vi.mock("@/lib/members/withdraw-with-debits", () => ({
  withdrawWithDebits: {
    withdraw: vi.fn(async () => ({ debits: { cancelled: [], failed: [] } })),
  },
}));

import { redirect } from "next/navigation";
import { readmitAction, withdrawAction } from "@/app/admin/socios/[id]/actions";
import { audit } from "@/lib/audit";
import { memberService } from "@/lib/members/service";
import { withdrawWithDebits } from "@/lib/members/withdraw-with-debits";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

const db = prisma as unknown as {
  member: { findUnique: MockedFn };
  fee: { count: MockedFn };
  minute: { findUnique: MockedFn };
  memberRequest: { findUnique: MockedFn };
};

const WITHDRAWN = {
  id: 12, fullName: "Cesante Juan", category: "active", status: "withdrawn",
  reentryBlocked: false, withdrawalReason: "arrears",
};

function readmitForm(over: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = { memberId: "12", category: "active", minuteId: "5", ...over };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.member.findUnique.mockResolvedValue(WITHDRAWN);
  db.minute.findUnique.mockResolvedValue({ id: 5 });
  db.fee.count.mockResolvedValue(0);
});

describe("readmitAction", () => {
  it("asienta las cuotas pendientes con las que se readmitió al socio", async () => {
    db.fee.count.mockResolvedValue(3);

    await readmitAction({}, readmitForm());

    expect(memberService.readmit).toHaveBeenCalledWith({
      memberId: 12, minuteId: 5, actorId: 7, category: "active",
    });
    expect(db.fee.count).toHaveBeenCalledWith({ where: { memberId: 12, status: "pending" } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "member_readmit",
      entity: "member",
      entityId: 12,
      detail: { minuteId: 5, category: "active", pendingCount: 3 },
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/socios/12");
  });

  it("el socio sin deuda queda asentado con cero, no sin el dato", async () => {
    await readmitAction({}, readmitForm());

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: { minuteId: 5, category: "active", pendingCount: 0 },
    }));
  });
});

// ── La baja y el débito automático ────────────────────────────────────────────
//
// Hasta la 4C `withdrawAction` llamaba a `memberService.withdraw` y nada más: el
// socio dejaba de serlo y Mercado Pago le seguía debitando la cuota todos los
// meses. Lo que se fija acá es el camino (el módulo que cancela) y qué pasa
// cuando MP no acepta: la baja NO se deshace, pero la ficha se entera.
describe("withdrawAction", () => {
  const VIGENTE = {
    id: 12, fullName: "Socio Ana", category: "active", status: "active",
    reentryBlocked: false, withdrawalReason: null,
  };

  function withdrawForm(over: Record<string, string> = {}) {
    const fd = new FormData();
    const values: Record<string, string> = {
      memberId: "12", reason: "resignation", minuteMode: "existing", minuteId: "5", ...over,
    };
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  }

  beforeEach(() => {
    db.member.findUnique.mockResolvedValue(VIGENTE);
    vi.mocked(withdrawWithDebits.withdraw).mockResolvedValue({
      debits: { cancelled: [], failed: [] },
    });
  });

  it("da la baja por el camino que cancela el débito", async () => {
    vi.mocked(withdrawWithDebits.withdraw).mockResolvedValueOnce({
      debits: { cancelled: ["pre-1"], failed: [] },
    });
    await withdrawAction({}, withdrawForm({ detail: "Se mudó" }));
    expect(withdrawWithDebits.withdraw).toHaveBeenCalledWith({
      memberId: 12, minuteId: 5, actorId: 7, reason: "resignation", detail: "Se mudó",
    });
    // Y NO por el camino viejo, que dejaba el débito vivo. El doble define
    // `withdraw`, así que esto falla si producción vuelve a llamarlo.
    expect(vi.mocked(memberService.withdraw)).not.toHaveBeenCalled();
    // El asiento dice QUÉ se canceló: es donde el operador busca el id para
    // reintentar en el panel de Mercado Pago.
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "member_withdraw",
      detail: {
        minuteId: 5, reason: "resignation", debitsCancelled: ["pre-1"], debitsFailed: [],
      },
    }));
    // Sin nada abierto, el redirect es el de siempre: sin aviso que dar.
    expect(redirect).toHaveBeenCalledWith("/admin/socios/12");
  });

  it("si MP no acepta cancelar, la baja sale igual y la ficha lo dice", async () => {
    vi.mocked(withdrawWithDebits.withdraw).mockResolvedValueOnce({
      debits: { cancelled: [], failed: [{ preapprovalId: "pre-1", code: "internal_error" }] },
    });
    const r = await withdrawAction({}, withdrawForm());
    // La baja NO devuelve error: ya está asentada en el acta.
    expect(r?.error).toBeUndefined();
    expect(redirect).toHaveBeenCalledWith("/admin/socios/12?debito=pendiente&n=1");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        debitsFailed: [{ preapprovalId: "pre-1", code: "internal_error" }],
      }),
    }));
  });

  it("dos débitos abiertos se cuentan en el aviso", async () => {
    vi.mocked(withdrawWithDebits.withdraw).mockResolvedValueOnce({
      debits: {
        cancelled: [],
        failed: [
          { preapprovalId: "pre-1", code: "internal_error" },
          { preapprovalId: "pre-2", code: "internal_error" },
        ],
      },
    });
    await withdrawAction({}, withdrawForm());
    expect(redirect).toHaveBeenCalledWith("/admin/socios/12?debito=pendiente&n=2");
  });

  it("un socio ya dado de baja se rechaza antes de tocar Mercado Pago", async () => {
    db.member.findUnique.mockResolvedValueOnce({ ...VIGENTE, status: "withdrawn" });
    const r = await withdrawAction({}, withdrawForm());
    expect(r?.error).toBeTruthy();
    expect(withdrawWithDebits.withdraw).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  // ── El camino de la bandeja de solicitudes (requestId) ────────────────────
  //
  // Revisión de Task 9: el `<select>` de motivo del formulario de baja viene
  // precargado en "renuncia" pero NO fijo. Sin esta guarda, un operador que
  // aplica desde la bandeja podía cambiarlo a expulsión o cesantía por mora y
  // asentar la baja con otro motivo mientras la solicitud quedaba `accepted`
  // y el correo le decía al socio que se le concedió la renuncia.
  describe("el camino de la bandeja de solicitudes (requestId)", () => {
    const PENDING_WITHDRAWAL_REQUEST = { id: 55, memberId: 12, status: "pending", type: "withdrawal" };

    beforeEach(() => {
      db.memberRequest.findUnique.mockResolvedValue(PENDING_WITHDRAWAL_REQUEST);
    });

    it("rechaza asentar otro motivo que no sea renuncia, sin tocar Mercado Pago ni la solicitud", async () => {
      const r = await withdrawAction({}, withdrawForm({ requestId: "55", reason: "expulsion" }));
      expect(r?.error).toContain("renuncia");
      expect(withdrawWithDebits.withdraw).not.toHaveBeenCalled();
      expect(markAccepted).not.toHaveBeenCalled();
      expect(notifyRequestDecided).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("con reason=resignation: da la baja, marca la solicitud aceptada y avisa al socio", async () => {
      await withdrawAction({}, withdrawForm({ requestId: "55" }));
      expect(withdrawWithDebits.withdraw).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: 12, reason: "resignation" }),
      );
      expect(markAccepted).toHaveBeenCalledWith({
        requestId: 55, memberId: 12, decidedById: 7, type: "withdrawal",
      });
      expect(notifyRequestDecided).toHaveBeenCalledWith({ memberId: 12, type: "withdrawal", accepted: true });
      expect(redirect).toHaveBeenCalledWith("/admin/socios/12");
    });

    // M6A Task 5: la baja cancela las solicitudes pendientes del socio. La que
    // se está aplicando tiene que quedar EXCEPTUADA: `markAccepted` corre
    // después del commit y filtra por `status: "pending"`, así que sin la
    // excepción la solicitud quedaría "cancelada" en vez de "aceptada" y sin el
    // vínculo con el acta. El camino de siempre (sin `requestId`) no manda el
    // campo — lo verifica la aserción exacta de "da la baja por el camino que
    // cancela el débito", que compara el objeto entero.
    it("le pasa al servicio cuál solicitud NO cancelar (la que se está aplicando)", async () => {
      await withdrawAction({}, withdrawForm({ requestId: "55" }));
      expect(withdrawWithDebits.withdraw).toHaveBeenCalledWith(
        expect.objectContaining({ sparedRequestId: 55 }),
      );
    });

    it("si markAccepted falla, la baja sale igual (ya commiteó) y el aviso no se manda", async () => {
      markAccepted.mockRejectedValueOnce(new Error("db hiccup"));
      const r = await withdrawAction({}, withdrawForm({ requestId: "55" }));
      expect(r?.error).toBeUndefined();
      expect(redirect).toHaveBeenCalledWith("/admin/socios/12");
      expect(notifyRequestDecided).not.toHaveBeenCalled();
    });

    it("una solicitud que no está pendiente rechaza antes de tocar Mercado Pago", async () => {
      db.memberRequest.findUnique.mockResolvedValueOnce({ ...PENDING_WITHDRAWAL_REQUEST, status: "accepted" });
      const r = await withdrawAction({}, withdrawForm({ requestId: "55" }));
      expect(r?.error).toBeTruthy();
      expect(withdrawWithDebits.withdraw).not.toHaveBeenCalled();
    });
  });
});
