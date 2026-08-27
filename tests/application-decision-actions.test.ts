import { beforeEach, describe, expect, it, vi } from "vitest";

// Las dos decisiones de la Comisión sobre una solicitud viva: recategorizarla y
// rechazarla. Lo que se prueba acá es lo que NO se ve desde el dominio: cuándo
// se viaja a Mercado Pago, qué pasa cuando MP contesta mal, y qué queda firme
// cuando el rechazo ya está asentado en el acta.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo.
const txMock = vi.hoisted(() => ({
  application: { updateMany: vi.fn(), update: vi.fn() },
  member: { update: vi.fn() },
  mpSubscription: { updateMany: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  application: { findUnique: vi.fn(), count: vi.fn() },
  member: { findUnique: vi.fn(), update: vi.fn() },
  minute: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  movement: { count: vi.fn(async () => 0) },
  book: { count: vi.fn(async () => 0) },
  // Los otros tres referentes de un acta que mira `discardUnusedMinute`. Sin
  // ellos el `count` que falta tira un TypeError que el propio `catch` de la
  // función se traga: el acta NO se borra y el fallo aparece acá como una
  // aserción de borrado que no ocurrió.
  reregistrationProcess: { count: vi.fn(async () => 0) },
  feeValue: { count: vi.fn(async () => 0) },
  feeExemption: { count: vi.fn(async () => 0) },
  mpSubscription: { updateMany: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
const gatewayMock = vi.hoisted(() => ({
  updatePreapprovalAmount: vi.fn(),
  cancelPreapproval: vi.fn(),
}));
const feeValuesMock = vi.hoisted(() => ({
  feeValueReader: { current: vi.fn(), history: vi.fn() },
}));
const mailerMock = vi.hoisted(() => ({ sendToApplication: vi.fn(), sendToMember: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 3 })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/tokens", () => ({ tokens: { issue: vi.fn(), revokeForMember: vi.fn() } }));
vi.mock("@/lib/email", () => ({ mailer: mailerMock }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: gatewayMock }));
vi.mock("@/lib/treasury/fee-values", () => feeValuesMock);
// Mock PARCIAL: `@/lib/config` —que llega hasta acá por `members/service`—
// evalúa `unstable_cache` al importarse, así que el resto del módulo tiene que
// seguir existiendo.
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
}));
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
  txMock.application.update.mockResolvedValue({});
  txMock.mpSubscription.updateMany.mockResolvedValue({ count: 1 });
  gatewayMock.updatePreapprovalAmount.mockResolvedValue(undefined);
  gatewayMock.cancelPreapproval.mockResolvedValue(undefined);
  // `fee_values` es la única fuente del monto: es de acá de donde sale el
  // importe que se le escribe a una suscripción viva (REG-34).
  feeValuesMock.feeValueReader.current.mockResolvedValue({
    id: 1, activeAmount: 5000, sharedAmount: 2500,
    validFrom: new Date("2026-08-01T12:00:00Z"), minuteId: null,
  });
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
    expect(feeValuesMock.feeValueReader.current).not.toHaveBeenCalled();
    expect(txMock.application.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { requestedCategory: "collaborator" },
    });
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({
      from: "adherent", to: "collaborator", subscriptionUpdated: false,
    });
  });

  it("adherente → activo actualiza el monto de la suscripción con el valor del activo", async () => {
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("active"));

    expect(gatewayMock.updatePreapprovalAmount).toHaveBeenCalledWith("PRE-1", 5000);
    expect(txMock.application.update).toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ subscriptionUpdated: true });
  });

  // ── El monto que se escribe sale de `fee_values`, no de Mercado Pago ────────
  // `updatePreapprovalAmount` fija lo que MP le debita al socio TODOS los meses.
  // Desde el M4 la tabla `fee_values` es la única fuente de montos (REG-34):
  // preguntarle el importe al plan de MP era una segunda fuente de verdad, que
  // se atrasaba en cuanto la Comisión registraba el valor nuevo en el sistema y
  // nadie lo tocaba en el panel de MP.
  it("el monto sale del valor vigente de `fee_values`", async () => {
    feeValuesMock.feeValueReader.current.mockResolvedValue({
      id: 2, activeAmount: 7400, sharedAmount: 3700,
      validFrom: new Date("2026-08-20T12:00:00Z"), minuteId: null,
    });
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("active"));

    expect(feeValuesMock.feeValueReader.current).toHaveBeenCalled();
    expect(gatewayMock.updatePreapprovalAmount).toHaveBeenCalledWith("PRE-1", 7400);
  });

  // `current()` devuelve `null` cuando todavía no rige ningún valor. Inventar un
  // monto acá sería debitarle al socio una cifra que nadie decidió.
  it("sin valor de cuota vigente, no se toca MP ni se guarda nada", async () => {
    feeValuesMock.feeValueReader.current.mockResolvedValue(null);
    const result = await recategorizeApplicationAction({}, recategorize("active"));

    expect(result.error).toMatch(/El valor de la cuota no está configurado/);
    expect(gatewayMock.updatePreapprovalAmount).not.toHaveBeenCalled();
    expect(txMock.application.update).not.toHaveBeenCalled();
    expect(txMock.mpSubscription.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("si MP rechaza el monto nuevo, no se guarda nada", async () => {
    gatewayMock.updatePreapprovalAmount.mockRejectedValue(
      Object.assign(new Error("MP 500"), { code: "500" }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await recategorizeApplicationAction({}, recategorize("active"));

    expect(result.error).toMatch(/MP no aceptó el cambio de monto/);
    // Ni el cuerpo del SDK ni el error crudo llegan a la pantalla.
    expect(result.error).not.toMatch(/MP 500/);
    expect(txMock.application.update).not.toHaveBeenCalled();
    expect(txMock.mpSubscription.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // La fila local guarda el ÚLTIMO monto empujado: es contra eso que la
  // conciliación compara la suscripción viva. Sin esto seguiría diciendo el
  // importe de la categoría vieja mientras el preapproval cobra el nuevo.
  it("escribe el monto nuevo en la fila local, en la MISMA transacción que la solicitud", async () => {
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("active"));

    expect(txMock.mpSubscription.updateMany).toHaveBeenCalledWith({
      where: { preapprovalId: "PRE-1" },
      data: expect.objectContaining({ amount: "5000.00", lastSyncAt: expect.any(Date) }),
    });
    // El corte queda documentado en el rastro: qué preapproval y con qué monto.
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({
      preapprovalId: "PRE-1", amount: 5000,
    });
  });

  it("adherente → colaborador no toca la fila local: comparten monto", async () => {
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("collaborator"));

    expect(txMock.mpSubscription.updateMany).not.toHaveBeenCalled();
    expect(feeValuesMock.feeValueReader.current).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0][0].detail).not.toHaveProperty("preapprovalId");
  });

  // ── La residencia se asienta, no se bloquea ─────────────────────────────────
  // Una guarda dura mataría la corrección legítima (no hay pantalla para
  // corregirle el domicilio a una solicitud), pero el desvío peligroso —no
  // residente → `active`, que da voto y elegibilidad— no puede quedar mudo.
  it("con `streetId` del catastro, activo respeta el domicilio declarado", async () => {
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("active"));
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ residenceMismatch: false });
  });

  it("quien declaró vivir FUERA del barrio pasa a activo igual, pero queda asentado", async () => {
    prismaMock.application.findUnique.mockResolvedValue({
      ...APP, streetId: null, streetText: "Rivadavia", neighborhood: "Km 8",
      requestedCategory: "collaborator",
    });
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("active"));

    expect(txMock.application.update).toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ residenceMismatch: true });
  });

  // MP ya aceptó el monto nuevo: si el guardado local se cae, lo que no puede
  // pasar es que se pierda cuál es el preapproval que quedó desalineado.
  it("si el guardado local falla, la action lo dice y no audita un cambio que no ocurrió", async () => {
    prismaMock.$transaction.mockRejectedValue(Object.assign(new Error("db"), { code: "P1001" }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await recategorizeApplicationAction({}, recategorize("active"));

    expect(result.error).toMatch(/No pudimos guardar la categoría nueva/);
    expect(audit).not.toHaveBeenCalled();
    expect(spy.mock.calls[0]).toContain("PRE-1");
    spy.mockRestore();
  });

  it("sin suscripción firmada no hay nada que actualizar en MP", async () => {
    prismaMock.application.findUnique.mockResolvedValue({ ...APP, preapprovalId: null });
    await runExpectingRedirect(recategorizeApplicationAction, recategorize("active"));

    expect(gatewayMock.updatePreapprovalAmount).not.toHaveBeenCalled();
    expect(txMock.application.update).toHaveBeenCalled();
  });

  // Al revés —guardar primero y avisarle a MP después— la solicitud diría
  // "activo" mientras el débito sigue saliendo por el monto de adherente, y
  // nadie lo compensaría.
  it("si MP rechaza el cambio de monto, la categoría NO se guarda", async () => {
    gatewayMock.updatePreapprovalAmount.mockRejectedValue(new Error("400"));
    const result = await recategorizeApplicationAction({}, recategorize("active"));

    expect(result.error).toMatch(/MP no aceptó el cambio de monto/);
    expect(txMock.application.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("una solicitud ya resuelta no se recategoriza", async () => {
    prismaMock.application.findUnique.mockResolvedValue({ ...APP, status: "completed" });
    const result = await recategorizeApplicationAction({}, recategorize("active"));

    expect(result.error).toMatch(/ya fue resuelta/);
    expect(txMock.application.update).not.toHaveBeenCalled();
  });

  it("recategorizar a la misma categoría no hace nada", async () => {
    const result = await recategorizeApplicationAction({}, recategorize("adherent"));
    expect(result.error).toMatch(/ya tiene esa categoría/);
    expect(txMock.application.update).not.toHaveBeenCalled();
  });

  // Cadete, honorario y vitalicio no se piden por la web (REG-01): las otorga la
  // Comisión sobre una ficha del padrón, no sobre una solicitud.
  it("no acepta una categoría que no se solicita por la web", async () => {
    const result = await recategorizeApplicationAction({}, recategorize("honorary"));
    expect(result.error).toMatch(/categoría/i);
    expect(txMock.application.update).not.toHaveBeenCalled();
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
    // Con el id del preapproval: es lo único que permite terminar la
    // cancelación a mano desde el panel de MP. Sin él, `cancelFailed: true`
    // avisa que hay algo roto sin decir QUÉ cancelar, mientras al vecino
    // rechazado le siguen debitando la cuota.
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({
      cancelFailed: true, preapprovalId: "PRE-1",
    });
    // Y el vecino igual se entera.
    expect(mailerMock.sendToApplication).toHaveBeenCalled();
  });

  // Los dos pasos van en `try` separados: `cancelFailed` significa "en MP le
  // siguen cobrando". Si lo que falló fue el update local, MP ya dejó de cobrar
  // y marcarlo mandaría al operador a cancelar algo ya cancelado.
  it("un fallo del update local NO se disfraza de cancelación fallida", async () => {
    prismaMock.mpSubscription.updateMany.mockRejectedValue(new Error("db"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());

    expect(gatewayMock.cancelPreapproval).toHaveBeenCalledWith("PRE-1");
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({ cancelFailed: false });
    spy.mockRestore();
  });

  it("sin suscripción firmada el rastro lo dice con un null explícito", async () => {
    prismaMock.application.findUnique.mockResolvedValue({ ...APP, preapprovalId: null });
    await runExpectingRedirect(rejectApplicationAction, rejectWithMinute());

    expect(gatewayMock.cancelPreapproval).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0][0].detail).toMatchObject({
      cancelFailed: false, preapprovalId: null,
    });
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
      detail: {
        minuteId: 10, entryFeeRetained: true, cancelFailed: false, hadMember: false,
        preapprovalId: "PRE-1",
      },
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
