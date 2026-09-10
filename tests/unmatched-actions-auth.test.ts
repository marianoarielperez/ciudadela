import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "@/lib/auth/require-admin";
import type { ReceiptEmailResult } from "@/lib/treasury/receipt-email";

// La bandeja sin conciliar mueve plata que YA entró: aplicar una fila emite un
// recibo a nombre de un vecino. La guarda tiene que cortar ANTES de tocar el
// servicio, la base, la auditoría y el redirect. Y el asiento no puede llevar
// el email del pagador ni el texto libre del descarte (Ley 25.326).
const mocks = vi.hoisted(() => ({
  // El reparto es el ÚNICO camino de "aplicar" desde la bandeja (Task 4): un
  // solo socio es un reparto de una parte.
  registerSplit: vi.fn(),
  // El grupo del cobro y las guardas por socio son consultas propias, ya
  // probadas aparte: acá se prueba el CONTRATO de la action.
  loadGroup: vi.fn(),
  guards: vi.fn(async (): Promise<string | null> => null),
  preview: vi.fn(),
  findUnique: vi.fn(),
  // El pago que ganó el `mpPaymentId`: es lo que distingue "ya está bien
  // asentado" de "se había asentado y ese recibo se anuló".
  paymentFindUnique: vi.fn(),
  paymentFindMany: vi.fn(async () => []),
  updateMany: vi.fn(async () => ({ count: 1 })),
  // La tercera salida escribe en `other_incomes` con el `tx` de la transacción.
  incomeCreate: vi.fn(async () => ({ id: 77 })),
  incomeFindUnique: vi.fn(),
  // Tipado explícito, como `admin`: el reparto manda un email por parte y el
  // test necesita devolver un `{ sent: false, reason }` por parte, que la
  // inferencia de `{ sent: true }` no admite.
  sendEmail: vi.fn(async (): Promise<ReceiptEmailResult> => ({ sent: true })),
  audit: vi.fn(async () => {}),
  // Tipado explícito: sin él TS infiere la forma del rechazo y el
  // `mockResolvedValueOnce` del caso autorizado no compila.
  admin: vi.fn(async (): Promise<AdminActor> => (
    { ok: false, reason: "not_admin", error: "No tenés permiso para editar el padrón." }
  )),
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    mpUnmatchedPayment: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    otherIncome: { create: mocks.incomeCreate, findUnique: mocks.incomeFindUnique },
    // La tercera salida ahora lee el GRUPO con el `tx` de su propia transacción
    // (la guarda del reembolso). `loadGroup` está mockeada más abajo, así que el
    // veredicto lo da el mock; esto está para que el doble tenga la misma FORMA
    // que el cliente que la action le pasa.
    payment: { findUnique: mocks.paymentFindUnique, findMany: mocks.paymentFindMany },
  };
  return {
    prisma: {
      ...tx,
      payment: { findUnique: mocks.paymentFindUnique },
      // El registro como ingreso no societario y el cierre de la fila van en la
      // MISMA transacción: el mock la ejecuta en el acto con el mismo cliente.
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/lib/treasury/service", () => ({
  treasuryService: { registerSplitPayment: mocks.registerSplit },
  TreasuryError: class extends Error {},
}));
// Mocks PARCIALES: el token y los textos de las guardas salen de los módulos
// reales. Si se mockearan enteros, el test verificaría su propia copia del
// formato del token en vez del que la action va a emitir.
vi.mock("@/lib/treasury/split-group", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/treasury/split-group")>()),
  loadGroup: mocks.loadGroup,
}));
vi.mock("@/lib/treasury/split-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/treasury/split-preview")>()),
  splitPartGuards: mocks.guards,
  previewSplit: mocks.preview,
}));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { TreasuryError } from "@/lib/treasury/service";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";
import { splitConfirmToken } from "@/lib/treasury/split-preview";
import {
  dismissUnmatchedAction,
  registerAsOtherIncomeAction,
  resolveUnmatchedAction,
} from "@/app/admin/tesoreria/sin-conciliar/[id]/actions";

const PAID_AT = new Date("2026-08-10T14:00:00.000Z");

// `audit` se mockea sin parámetros (como en el test de efectivo), así que
// `mock.calls[0]` es una tupla vacía para TS: el ensanchado deja inspeccionar el
// asiento sin tener que tipar un argumento que el mock no usa.
function auditedEntry(): unknown {
  return (mocks.audit.mock.calls[0] as unknown[] | undefined)?.[0];
}

// La fila tal como la deja el webhook: con el email del pagador cargado, que es
// justamente lo que no puede escaparse a la auditoría.
function openRow() {
  return {
    id: 5,
    mpPaymentId: "mp-123",
    amount: "12000.00",
    paidAt: PAID_AT,
    payerEmail: "vecino@example.com",
    externalReference: null,
    description: "Cuota mensual",
    preapprovalId: "pre-9",
    reason: "no_reference",
    status: "open" as const,
  };
}

// El reparto de referencia: $ 18.000 entre dos socios, dos cuotas y una.
const TWO_PLUS_ONE = [
  { memberId: 192, concept: "fees" as const, n: 2, amount: 12000 },
  { memberId: 193, concept: "fees" as const, n: 1, amount: 6000 },
];
function splitForm(opts: { confirm?: boolean; token?: string; note?: string; amounts?: [string, string] } = {}): FormData {
  const form = new FormData();
  form.append("rowId", "5");
  form.append("socios", "192,193");
  form.append("part_192_concept", "fees");
  form.append("part_192_count", "2");
  form.append("part_192_amount", opts.amounts?.[0] ?? "12000");
  form.append("part_193_concept", "fees");
  form.append("part_193_count", "1");
  form.append("part_193_amount", opts.amounts?.[1] ?? "6000");
  if (opts.note) form.append("note", opts.note);
  if (opts.confirm) {
    form.append("confirmar", "1");
    form.append("confirmToken", opts.token ?? splitConfirmToken(5, TWO_PLUS_ONE));
  }
  return form;
}
function openGroup(unassigned = 18000) {
  return {
    holder: null, parts: [], all: [], refunded: false,
    totals: { assigned: 18000 - unassigned, unassigned, status: unassigned === 18000 ? "open" : "partial" },
  };
}
// Reembolsado: la fila volvió a `open` porque el reparto se deshizo, pero la
// plata volvió al pagador. La aritmética del grupo dice "todo sin asignar", que
// es justamente por qué hace falta la bandera aparte.
function refundedGroup() {
  return { ...openGroup(), refunded: true };
}
const PREVIEW = [
  { memberId: 192, name: "Araoz Hugo", memberNumber: 192, concept: "Cuota social · julio a agosto 2026 (2 cuotas)", amount: 12000 },
  { memberId: 193, name: "Maza Monica", memberNumber: 193, concept: "Cuota social · agosto 2026", amount: 6000 },
];
const REGISTERED = {
  kind: "registered" as const, rowStatus: "matched" as const,
  parts: [
    { memberId: 192, paymentId: 3, receiptId: 7, number: "2026-00007", periods: ["2026-07", "2026-08"], amount: 12000, pdfWritten: true },
    { memberId: 193, paymentId: 4, receiptId: 8, number: "2026-00008", periods: ["2026-08"], amount: 6000, pdfWritten: true },
  ],
};

describe("resolveUnmatchedAction (reparto en dos pasos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.loadGroup.mockResolvedValue(openGroup());
    mocks.guards.mockResolvedValue(null);
    mocks.preview.mockResolvedValue(PREVIEW);
  });

  it("sin admin no lee la fila, no registra, no audita y no redirige", async () => {
    const r = await resolveUnmatchedAction({}, splitForm());
    expect(r.error).toBe("No tenés permiso para editar el padrón.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.registerSplit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("primer envío: devuelve la confirmación resuelta en el servidor y NO registra", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    const r = await resolveUnmatchedAction({}, splitForm());
    expect(r.confirm).toEqual({ token: splitConfirmToken(5, TWO_PLUS_ONE), total: 18000, parts: PREVIEW });
    expect(mocks.preview).toHaveBeenCalledWith(expect.anything(), TWO_PLUS_ONE);
    expect(mocks.registerSplit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("segundo envío con el token: registra el reparto con la fila y el actor, manda un email por parte, audita sin la casilla y vuelve a la fila", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.registerSplit.mockResolvedValueOnce(REGISTERED);
    mocks.sendEmail.mockResolvedValueOnce({ sent: true }).mockResolvedValueOnce({ sent: false, reason: "no_email" });
    await resolveUnmatchedAction({}, splitForm({ confirm: true, note: "matrimonio" }));
    expect(mocks.registerSplit).toHaveBeenCalledWith({ rowId: 5, parts: TWO_PLUS_ONE, actorId: 9, note: "matrimonio" });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenNthCalledWith(1, 7);
    expect(mocks.sendEmail).toHaveBeenNthCalledWith(2, 8);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, ip: "unknown",
      action: "unmatched_resolve", entity: "mp_unmatched_payment", entityId: 5,
      detail: {
        action: "apply", rowStatus: "matched", total: 18000,
        parts: [
          { memberId: 192, paymentId: 3, receiptId: 7, concept: "fees", count: 2, amount: 12000, emailed: "sent" },
          { memberId: 193, paymentId: 4, receiptId: 8, concept: "fees", count: 1, amount: 6000, emailed: "no_email" },
        ],
      },
    }));
    const entry = JSON.stringify(auditedEntry());
    expect(entry).not.toContain("vecino@example.com");
    expect(entry).not.toContain("Cuota mensual");
    expect(entry).not.toContain("matrimonio");
    expect(entry).not.toContain("Araoz");
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/sin-conciliar/5?emitidos=2&email=sent,no_email");
  });

  it("un token de otro reparto (las partes cambiaron después de leer) vuelve a pedir confirmación", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true, token: "5|192:fees:1:1200000,193:fees:1:600000" }));
    expect(r.confirm?.token).toBe(splitConfirmToken(5, TWO_PLUS_ONE));
    expect(mocks.registerSplit).not.toHaveBeenCalled();
  });

  it("la suma inexacta se rechaza con los dos importes, antes de la vista previa", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    const r = await resolveUnmatchedAction({}, splitForm({ amounts: ["12000", "5000"] }));
    expect(r.error).toBe("Las partes suman $ 17.000,00 y hay $ 18.000,00 sin asignar.");
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.registerSplit).not.toHaveBeenCalled();
  });

  it("una fila parcial se compara contra lo sin asignar y se puede completar", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ ...openRow(), status: "partial" });
    mocks.loadGroup.mockResolvedValueOnce(openGroup(6000));
    const form = new FormData();
    form.append("rowId", "5");
    form.append("socios", "200");
    form.append("part_200_concept", "fees");
    form.append("part_200_count", "1");
    form.append("part_200_amount", "6000");
    const r = await resolveUnmatchedAction({}, form);
    expect(r.confirm?.total).toBe(6000);
  });

  it("un cobro REEMBOLSADO no se reparte: el motivo real, sin vista previa ni registro", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.loadGroup.mockResolvedValueOnce(refundedGroup());
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(r.error).toBe(M.refunded);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.registerSplit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un id que no entra en el INT de MySQL se rechaza sin leer la fila", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("socios", "99999999999");
    const r = await resolveUnmatchedAction({}, form);
    expect(r.error).toBe(M.noParts);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.loadGroup).not.toHaveBeenCalled();
  });

  it("una fila ya resuelta no se vuelve a cobrar", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ ...openRow(), status: "matched" });
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(r.error).toBe("Esta fila ya fue resuelta.");
    expect(mocks.registerSplit).not.toHaveBeenCalled();
  });

  it("la guarda de un socio se muestra tal cual (categoría, cesante, exento)", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.guards.mockResolvedValueOnce("Ese concepto no corresponde a la categoría del socio.");
    const r = await resolveUnmatchedAction({}, splitForm());
    expect(r.error).toBe("Ese concepto no corresponde a la categoría del socio.");
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("si la vista previa explota, el operador lee un mensaje y no se cobra nada", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.preview.mockRejectedValueOnce(new Error("boom"));
    const r = await resolveUnmatchedAction({}, splitForm());
    expect(r.error).toBe("No se pudo armar la vista previa. Reintentá en un momento.");
    expect(mocks.registerSplit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("más de cinco socios, un socio repetido, cuotas o importe inválidos: se rechazan antes de tocar la base", async () => {
    // Uno por llamada, y NINGUNO persistente: si un `expect` de los de abajo
    // falla, el test corta y un `mockResolvedValue` sin restaurar dejaría a los
    // tests siguientes corriendo con un admin autorizado.
    for (let i = 0; i < 4; i++) mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const six = new FormData();
    six.append("rowId", "5");
    six.append("socios", "1,2,3,4,5,6");
    expect((await resolveUnmatchedAction({}, six)).error).toBe("Como máximo 5 socios por pago.");
    const dup = new FormData();
    dup.append("rowId", "5");
    dup.append("socios", "192,192");
    expect((await resolveUnmatchedAction({}, dup)).error).toBe("Un socio no puede aparecer dos veces en el reparto.");
    const badCount = splitForm();
    badCount.set("part_192_count", "72");
    expect((await resolveUnmatchedAction({}, badCount)).error).toBe("La cantidad de cuotas tiene que estar entre 1 y 60.");
    const badAmount = splitForm({ amounts: ["12.000", "6000"] });
    expect((await resolveUnmatchedAction({}, badAmount)).error).toBe("El importe de cada parte tiene que ser mayor a cero.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("una regla de negocio del servicio se le muestra al operador tal como la redactó", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.registerSplit.mockRejectedValueOnce(new TreasuryError("Este pago cambió mientras lo repartías. Revisá la fila y volvé a intentarlo."));
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(r.error).toBe("Este pago cambió mientras lo repartías. Revisá la fila y volvé a intentarlo.");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("already_processed con el pago aplicado: dice el recibo, lo linkea y no lo pinta de error", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.registerSplit.mockResolvedValueOnce({ kind: "already_processed", paymentId: 3 });
    mocks.paymentFindUnique.mockResolvedValueOnce({ status: "applied", receipt: { id: 7, number: "2026-00007" } });
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(r.error).toBe("Este cobro de Mercado Pago ya está asentado: se registró con el recibo N° 2026-00007. No hace falta volver a aplicarlo.");
    expect(r.kind).toBe("warning");
    expect(r.receipt).toEqual({ id: 7, number: "2026-00007" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("si el email de una parte explota, la plata ya cobrada igual queda auditada y redirige", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.registerSplit.mockResolvedValueOnce(REGISTERED);
    mocks.sendEmail.mockRejectedValueOnce(Object.assign(new Error("pool timeout"), { code: "ETIMEDOUT" }));
    await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ parts: [expect.objectContaining({ emailed: "error" }), expect.objectContaining({ emailed: "sent" })] }),
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/sin-conciliar/5?emitidos=2&email=error,sent");
  });
});

describe("dismissUnmatchedAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("sin admin no escribe, no audita y no redirige", async () => {
    const form = new FormData();
    form.append("rowId", "5");
    form.append("reason", "Cobro duplicado de MP");
    const r = await dismissUnmatchedAction({}, form);
    expect(r.error).toBe("No tenés permiso para editar el padrón.");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un motivo demasiado corto se rechaza en castellano y no escribe nada", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("reason", "no");
    const r = await dismissUnmatchedAction({}, form);
    expect(r.error).toBe("Indicá el motivo del descarte.");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("con admin: descarta acotando a las filas abiertas y audita SIN el texto del motivo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("reason", "Es un cobro de prueba del piloto");
    await dismissUnmatchedAction({}, form);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: "open" },
      data: expect.objectContaining({
        status: "dismissed", resolvedById: 9, description: "Es un cobro de prueba del piloto",
      }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, action: "unmatched_resolve", entity: "mp_unmatched_payment", entityId: 5,
      detail: { action: "dismiss" },
    }));
    // El motivo es texto libre: puede nombrar a un vecino y no entra al asiento.
    expect(JSON.stringify(auditedEntry())).not.toContain("piloto");
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/sin-conciliar?estado=resueltos");
  });

  it("una fila que ya estaba resuelta no dice que se descartó", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const form = new FormData();
    form.append("rowId", "5");
    form.append("reason", "Cobro duplicado de MP");
    const r = await dismissUnmatchedAction({}, form);
    expect(r.error).toBe("Esta fila ya fue resuelta.");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

// La tercera salida de la bandeja: la plata entró y es de la asociación, pero no
// es de ningún socio. No emite recibo y no toca el núcleo de plata — lo único
// que tiene que quedar blindado es que sin admin no escribe nada, y que el
// concepto (texto libre, puede nombrar al inquilino del salón) no llega jamás al
// asiento de auditoría.
describe("registerAsOtherIncomeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.incomeCreate.mockResolvedValue({ id: 77 });
    // Explícito y no heredado del describe de arriba: `clearAllMocks` borra las
    // llamadas, no las implementaciones, y depender de eso hace que el orden de
    // los describes decida el resultado.
    mocks.loadGroup.mockResolvedValue(openGroup());
  });

  function incomeForm(concept = "Alquiler del salón para el cumpleaños de Ramírez"): FormData {
    const form = new FormData();
    form.append("rowId", "5");
    form.append("concept", concept);
    form.append("note", "Lo trajo en mano");
    return form;
  }

  it("sin admin no lee la fila, no escribe el ingreso, no audita y no redirige", async () => {
    const r = await registerAsOtherIncomeAction({}, incomeForm());
    expect(r.error).toBe("No tenés permiso para editar el padrón.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.incomeCreate).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un concepto de dos letras se rechaza en castellano y no escribe nada", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await registerAsOtherIncomeAction({}, incomeForm("ok"));
    expect(r.error).toBe("Ingresá a qué corresponde el ingreso.");
    expect(mocks.incomeCreate).not.toHaveBeenCalled();
  });

  it("con admin: registra con el monto y la fecha de la fila, la cierra y audita SIN el texto libre", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    await registerAsOtherIncomeAction({}, incomeForm());
    // El monto y la fecha salen de la fila, no del formulario: es lo que Mercado
    // Pago cobró y cuándo.
    expect(mocks.incomeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: "12000.00",
        receivedAt: PAID_AT,
        method: "mp",
        mpPaymentId: "mp-123",
        registeredById: 9,
      }),
      select: { id: true },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: "open" },
      data: expect.objectContaining({ status: "other_income", resolvedById: 9 }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, ip: "unknown",
      action: "unmatched_resolve", entity: "mp_unmatched_payment", entityId: 5,
      detail: { action: "other_income", incomeId: 77, amount: 12000 },
    }));
    const asiento = JSON.stringify(auditedEntry());
    // Ni el concepto, ni la nota, ni el email del pagador (Ley 25.326).
    expect(asiento).not.toContain("Ramírez");
    expect(asiento).not.toContain("mano");
    expect(asiento).not.toContain("vecino@example.com");
    // Por id: Otros ingresos se organiza por ejercicio, y un cobro de diciembre
    // resuelto en enero no cae en el que está en curso. El `?ingreso=` abre el
    // ejercicio del propio ingreso, con esa fila a la vista.
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/otros-ingresos?ingreso=77&registrado=1");
  });

  it("un cobro REEMBOLSADO tampoco es un ingreso de la asociación: no se registra nada", async () => {
    // La MISMA guarda que el reparto y con la misma función: la plata volvió al
    // pagador, así que no es de un socio NI de la asociación. La única salida de
    // esa fila es descartarla.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.loadGroup.mockResolvedValueOnce(refundedGroup());
    const r = await registerAsOtherIncomeAction({}, incomeForm());
    expect(r.error).toBe(M.refunded);
    expect(mocks.incomeCreate).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("una fila ya resuelta no se vuelve a registrar", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ ...openRow(), status: "dismissed" });
    const r = await registerAsOtherIncomeAction({}, incomeForm());
    expect(r.error).toBe("Esta fila ya fue resuelta.");
    expect(mocks.incomeCreate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("si ese cobro ya tuvo un ingreso y se anuló, no deja la fila apuntando al registro anulado", async () => {
    // La unique de `mpPaymentId` no se libera al anular (MariaDB no tiene
    // índices únicos parciales), así que el segundo registro chocaría con el
    // anulado. Cerrar la fila ahí la dejaría apuntando a un registro que ya no
    // vale — justo lo que la anulación había deshecho al devolverla a Pendientes.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.incomeCreate.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    mocks.incomeFindUnique
      .mockResolvedValueOnce({ id: 42 })                                   // el ingreso que ganó la unique
      .mockResolvedValueOnce({ voidedAt: new Date("2026-08-20T12:00:00Z") }); // y está anulado
    const r = await registerAsOtherIncomeAction({}, incomeForm());
    expect(r.error).toContain("ese registro se anuló");
    // El mensaje ya no es un callejón: nombra la corrección y lleva al ingreso.
    // Viaja el id, nunca el concepto (Ley 25.326).
    expect(r.error).toContain("editalo en Otros ingresos");
    expect(r.income).toEqual({ id: 42 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("si ese cobro ya tiene un ingreso VIGENTE, cierra la fila y no falla", async () => {
    // El segundo operador sobre la misma fila, o el mismo cobro llegando por dos
    // caminos: es el MISMO hecho, no una falla. El ingreso anterior sigue
    // vigente, así que la fila queda apuntando a un registro que vale.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.incomeCreate.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    mocks.incomeFindUnique
      .mockResolvedValueOnce({ id: 42 })        // el ingreso que ganó la unique
      .mockResolvedValueOnce({ voidedAt: null }); // y sigue vigente
    // Sin `error`: la action redirige, y una action que redirige no devuelve nada.
    expect(await registerAsOtherIncomeAction({}, incomeForm())).toBeUndefined();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: "open" },
      data: expect.objectContaining({ status: "other_income", resolvedById: 9 }),
    });
    // El asiento apunta al ingreso que YA existía, no a uno nuevo.
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: { action: "other_income", incomeId: 42, amount: 12000 },
    }));
    // Al ingreso que YA existía: es el mismo hecho, y es el que hay que mostrar.
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/otros-ingresos?ingreso=42&registrado=1");
  });

  it("si otro operador resuelve la fila en el medio, el ingreso recién escrito se revierte", async () => {
    // La carrera: entre el findUnique y el updateMany, el otro operador cerró la
    // fila. El `status: "open"` del where deja el count en 0 y la excepción hace
    // rollback del ingreso — si no, quedaría plata registrada dos veces y una
    // fila resuelta de otra manera.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await registerAsOtherIncomeAction({}, incomeForm());
    expect(r.error).toBe("Esta fila ya fue resuelta.");
    expect(mocks.incomeCreate).toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
