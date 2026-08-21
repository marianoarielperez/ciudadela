import { beforeEach, describe, expect, it, vi } from "vitest";

// Las dos decisiones de la Comisión sobre una solicitud viva: recategorizarla y
// rechazarla. Lo que se prueba acá es lo que NO se ve desde el dominio: cuándo
// se viaja a Mercado Pago, qué pasa cuando MP contesta mal, y qué queda firme
// cuando el rechazo ya está asentado en el acta.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo.
const txMock = vi.hoisted(() => ({
  application: { updateMany: vi.fn() },
  member: { update: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  application: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  member: { findUnique: vi.fn(), update: vi.fn() },
  minute: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  movement: { count: vi.fn(async () => 0) },
  book: { count: vi.fn(async () => 0) },
  mpSubscription: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
const gatewayMock = vi.hoisted(() => ({
  updatePreapprovalAmount: vi.fn(),
  cancelPreapproval: vi.fn(),
}));
const feesMock = vi.hoisted(() => ({ getFeeAmounts: vi.fn() }));
const mailerMock = vi.hoisted(() => ({ sendToApplication: vi.fn(), sendToMember: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 3 })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/tokens", () => ({ tokens: { issue: vi.fn(), revokeForMember: vi.fn() } }));
vi.mock("@/lib/email", () => ({ mailer: mailerMock }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: gatewayMock }));
vi.mock("@/lib/mp/plans", () => feesMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers([["x-real-ip", "1.2.3.4"]]) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  recategorizeApplicationAction, rejectApplicationAction,
} from "@/app/admin/solicitudes/actions";
import { audit } from "@/lib/audit";
import { changesFeeAmount, DECIDABLE_STATUSES, isDecidable } from "@/lib/applications/decision";

type Action = (prev: { error?: string }, fd: FormData) => Promise<{ error?: string }>;

const APP = {
  id: 5, fullName: "Perez Ana", dni: "30111222", email: "ana@example.com",
  requestedCategory: "adherent" as string, status: "approved_pending_minute" as string,
  preapprovalId: "PRE-1" as string | null, mpPaymentIdEntry: "PAY-1" as string | null,
  memberId: null as number | null, streetId: 7 as number | null,
};

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

const recategorize = (to: string) => form([["applicationId", "5"], ["newCategory", to]]);
const rejectWithMinute = () => form([["applicationId", "5"], ["minuteId", "10"]]);
const rejectWithNewMinute = () =>
  form([
    ["applicationId", "5"], ["minuteNew", "1"], ["minuteType", "board"],
    ["minuteNumber", "47"], ["minuteDate", "2026-08-20"],
  ]);

/** Las dos actions terminan en `redirect`, que señaliza con una excepción. */
async function runExpectingRedirect(action: Action, fd: FormData): Promise<string> {
  try {
    const state = await action({}, fd);
    throw new Error(`no redirigió: ${JSON.stringify(state)}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.startsWith("REDIRECT:")) throw e;
    return message.slice("REDIRECT:".length);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.application.findUnique.mockResolvedValue({ ...APP });
  prismaMock.application.update.mockResolvedValue({});
  prismaMock.minute.findUnique.mockResolvedValue({ id: 10 });
  prismaMock.minute.create.mockResolvedValue({ id: 77 });
  prismaMock.movement.count.mockResolvedValue(0);
  prismaMock.book.count.mockResolvedValue(0);
  prismaMock.mpSubscription.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
  );
  txMock.application.updateMany.mockResolvedValue({ count: 1 });
  txMock.member.update.mockResolvedValue({});
  gatewayMock.updatePreapprovalAmount.mockResolvedValue(undefined);
  gatewayMock.cancelPreapproval.mockResolvedValue(undefined);
  feesMock.getFeeAmounts.mockResolvedValue({ active: 5000, shared: 2500 });
  mailerMock.sendToApplication.mockResolvedValue({ messageId: "mid" });
});

describe("recategorizar una solicitud", () => {
  // Los planes de MP son dos: "SOCIO ACTIVO" y "SOCIO ADHERENTE/COLABORADOR".
  // Mover a alguien dentro del segundo no cambia un peso, y una llamada de más a
  // la API de MP es un punto de falla gratuito sobre un débito ya firmado.
  it("adherente → colaborador no toca Mercado Pago: comparten plan", async () => {
    const url = await runExpectingRedirect(recategorizeApplicationAction, recategorize("collaborator"));

    expect(url).toBe("/admin/solicitudes/5");
    expect(gatewayMock.updatePreapprovalAmount).not.toHaveBeenCalled();
    expect(feesMock.getFeeAmounts).not.toHaveBeenCalled();
    expect(prismaMock.application.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { requestedCategory: "collaborator" },
    });
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({
      from: "adherent", to: "collaborator", subscriptionUpdated: false,
    });
  });

  it("adherente → activo actualiza el monto de la suscripción con el del plan activo", async () => {
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("active"));

    expect(gatewayMock.updatePreapprovalAmount).toHaveBeenCalledWith("PRE-1", 5000);
    expect(prismaMock.application.update).toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ subscriptionUpdated: true });
  });

  it("sin suscripción firmada no hay nada que actualizar en MP", async () => {
    prismaMock.application.findUnique.mockResolvedValue({ ...APP, preapprovalId: null });
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("active"));

    expect(gatewayMock.updatePreapprovalAmount).not.toHaveBeenCalled();
    expect(prismaMock.application.update).toHaveBeenCalled();
  });

  // Al revés —guardar primero y avisarle a MP después— la solicitud diría
  // "activo" mientras el débito sigue saliendo por el monto de adherente, y
  // nadie lo compensaría.
  it("si MP rechaza el cambio de monto, la categoría NO se guarda", async () => {
    gatewayMock.updatePreapprovalAmount.mockRejectedValue(new Error("400"));
    const result = await recategorizeApplicationAction({}, recategorize("active"));

    expect(result.error).toMatch(/MP no aceptó el cambio de monto/);
    expect(prismaMock.application.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("sin monto de cuota legible tampoco se guarda", async () => {
    feesMock.getFeeAmounts.mockResolvedValue(null);
    const result = await recategorizeApplicationAction({}, recategorize("active"));

    expect(result.error).toMatch(/valor de la cuota/);
    expect(gatewayMock.updatePreapprovalAmount).not.toHaveBeenCalled();
    expect(prismaMock.application.update).not.toHaveBeenCalled();
  });

  it("una solicitud ya resuelta no se recategoriza", async () => {
    prismaMock.application.findUnique.mockResolvedValue({ ...APP, status: "completed" });
    const result = await recategorizeApplicationAction({}, recategorize("active"));

    expect(result.error).toMatch(/ya fue resuelta/);
    expect(prismaMock.application.update).not.toHaveBeenCalled();
  });

  it("recategorizar a la misma categoría no hace nada", async () => {
    const result = await recategorizeApplicationAction({}, recategorize("adherent"));
    expect(result.error).toMatch(/ya tiene esa categoría/);
    expect(prismaMock.application.update).not.toHaveBeenCalled();
  });

  // Cadete, honorario y vitalicio no se piden por la web (REG-01): las otorga la
  // Comisión sobre una ficha del padrón, no sobre una solicitud.
  it("no acepta una categoría que no se solicita por la web", async () => {
    const result = await recategorizeApplicationAction({}, recategorize("honorary"));
    expect(result.error).toMatch(/categoría/i);
    expect(prismaMock.application.update).not.toHaveBeenCalled();
  });
});

describe("rechazar una solicitud", () => {
  it("exige acta: sin ella no hay rechazo (REG-13)", async () => {
    const result = await rejectApplicationAction({}, form([["applicationId", "5"]]));

    expect(result.error).toMatch(/acta/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(gatewayMock.cancelPreapproval).not.toHaveBeenCalled();
  });

  it("asienta el rechazo, cancela la suscripción y avisa reteniendo el ingreso", async () => {
    const url = await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());

    expect(url).toBe("/admin/solicitudes/5");
    expect(txMock.application.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: { in: ["pending_payment", "approved_pending_minute", "pending_board"] } },
      data: expect.objectContaining({ status: "rejected", minuteId: 10 }),
    });
    expect(gatewayMock.cancelPreapproval).toHaveBeenCalledWith("PRE-1");
    expect(prismaMock.mpSubscription.updateMany).toHaveBeenCalledWith({
      where: { preapprovalId: "PRE-1" },
      data: expect.objectContaining({ status: "cancelled" }),
    });
    // REG-12.b: la retención sólo se menciona porque hubo débito real.
    expect(mailerMock.sendToApplication.mock.calls[0][0]).toMatchObject({
      applicationId: 5, to: "ana@example.com", type: "application_result",
    });
    const sent = mailerMock.sendToApplication.mock.calls[0][0].message;
    expect(sent.text).toMatch(/no es reembolsable/);
  });

  it("sin cuota de ingreso debitada el correo no habla de retención", async () => {
    prismaMock.application.findUnique.mockResolvedValue({ ...APP, mpPaymentIdEntry: null });
    await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());

    expect(mailerMock.sendToApplication.mock.calls[0][0].message.text).not.toMatch(/reembolsable/);
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ entryFeeRetained: false });
  });

  // REG-05: seis meses de bloqueo. Sobre la ficha cuando la solicitud matcheó a
  // un ex socio; para el DNI sin ficha el bloqueo sale de la propia Application
  // rechazada (`checkEligibility` lee las dos fuentes).
  it("bloquea la ficha del ex socio por seis meses", async () => {
    prismaMock.application.findUnique.mockResolvedValue({ ...APP, memberId: 99 });
    await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());

    expect(txMock.member.update).toHaveBeenCalledTimes(1);
    const call = txMock.member.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 99 });
    const until: Date = call.data.rejectedUntil;
    const decidedAt: Date = txMock.application.updateMany.mock.calls[0][0].data.decidedAt;
    const expected = new Date(decidedAt.getTime());
    expected.setUTCMonth(expected.getUTCMonth() + 6);
    expect(until.getTime()).toBe(expected.getTime());
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ hadMember: true });
  });

  it("sin ficha no toca el padrón", async () => {
    await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());
    expect(txMock.member.update).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ hadMember: false });
  });

  // El rechazo YA está asentado en el acta de la Comisión: no se revierte porque
  // MP esté caído. Lo que no puede pasar es que el fallo se pierda.
  it("con MP caído el rechazo queda firme y el fallo queda en la auditoría", async () => {
    gatewayMock.cancelPreapproval.mockRejectedValue(new Error("503"));
    const url = await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());

    expect(url).toBe("/admin/solicitudes/5");
    expect(prismaMock.mpSubscription.updateMany).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ cancelFailed: true });
    // Y el vecino igual se entera.
    expect(mailerMock.sendToApplication).toHaveBeenCalled();
  });

  it("con el SMTP caído el rechazo también queda firme", async () => {
    mailerMock.sendToApplication.mockRejectedValue(Object.assign(new Error("smtp"), { code: "ECONN" }));
    const url = await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());

    expect(url).toBe("/admin/solicitudes/5");
    expect(audit).toHaveBeenCalled();
  });

  // Mismo cuidado que el asiento masivo: un acta creada para un rechazo que no
  // llegó a asentarse es basura en un libro que se presenta ante la IGJ.
  it("descarta el acta recién creada si la solicitud ya la resolvió otro admin", async () => {
    txMock.application.updateMany.mockResolvedValue({ count: 0 });
    const result = await rejectApplicationAction({}, rejectWithNewMinute());

    expect(result.error).toMatch(/ya fue resuelta por otro admin/);
    expect(prismaMock.minute.delete).toHaveBeenCalledWith({ where: { id: 77 } });
    expect(gatewayMock.cancelPreapproval).not.toHaveBeenCalled();
    expect(mailerMock.sendToApplication).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("no descarta un acta EXISTENTE que eligió el operador", async () => {
    txMock.application.updateMany.mockResolvedValue({ count: 0 });
    await rejectApplicationAction({}, rejectWithMinute());
    expect(prismaMock.minute.delete).not.toHaveBeenCalled();
  });

  // La pre-validación corre ANTES de tocar el acta: sobre una solicitud ya
  // resuelta no llega a crearse ni una.
  it("una solicitud ya resuelta no se rechaza y no crea acta", async () => {
    prismaMock.application.findUnique.mockResolvedValue({ ...APP, status: "rejected" });
    const result = await rejectApplicationAction({}, rejectWithNewMinute());

    expect(result.error).toMatch(/ya fue resuelta/);
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // docs/08 (Ley 25.326): el rastro lleva ids y banderas, nunca el nombre, el
  // DNI ni la dirección de quien fue rechazado.
  it("audita con la IP de X-Real-IP y sin datos personales", async () => {
    await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());

    expect(audit).toHaveBeenCalledWith({
      userId: 3, action: "application_reject", entity: "application", entityId: 5,
      detail: { minuteId: 10, entryFeeRetained: true, cancelFailed: false, hadMember: false },
      ip: "1.2.3.4",
    });
    expect(JSON.stringify(vi.mocked(audit).mock.calls[0][0])).not.toMatch(/Perez|ana@example|30111222/);
  });
});

// Las reglas puras que comparten la pantalla y el servidor: el aviso "se
// actualizará el monto en MP" que ve el operador sale del MISMO predicado que
// decide el viaje a la API.
describe("changesFeeAmount", () => {
  it("adherente y colaborador comparten plan: no mueve el monto", () => {
    expect(changesFeeAmount("adherent", "collaborator")).toBe(false);
    expect(changesFeeAmount("collaborator", "adherent")).toBe(false);
  });

  it("cualquier cruce contra activo sí lo mueve", () => {
    expect(changesFeeAmount("adherent", "active")).toBe(true);
    expect(changesFeeAmount("active", "collaborator")).toBe(true);
  });
});

describe("isDecidable", () => {
  it("sólo las solicitudes vivas: ni el borrador ni las ya resueltas", () => {
    expect(DECIDABLE_STATUSES).toEqual(["pending_payment", "approved_pending_minute", "pending_board"]);
    for (const s of DECIDABLE_STATUSES) expect(isDecidable(s)).toBe(true);
    for (const s of ["started", "completed", "rejected", "expired"] as const) {
      expect(isDecidable(s)).toBe(false);
    }
  });
});
