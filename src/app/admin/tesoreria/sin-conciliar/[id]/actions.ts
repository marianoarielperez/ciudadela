"use server";
// Resolver una fila de la bandeja (spec 4B §7, ampliada por la 2026-09-10):
// repartirla entre hasta cinco socios —cada parte con su concepto, sus cuotas y
// su importe, con el `mpPaymentId` y la fecha REAL del cobro y no la del reloj de
// esta corrida—, o descartarla con motivo.
//
// El reparto va en DOS pasos: el primer envío devuelve la vista previa resuelta
// contra la base con un token, y sólo el segundo —que trae ese token— cobra. Un
// socio solo es un reparto de una parte: no hay un segundo camino de escritura.
//
// La auditoría lleva ids, códigos, contadores y montos. NUNCA el email del
// pagador ni el texto libre que escribió el operador (Ley 25.326): esos datos
// viven en la fila, que la lee sólo el panel.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PaymentStatus } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { parseArsInput } from "@/lib/treasury/ars-input";
import { OtherIncomeError, recordOtherIncome } from "@/lib/treasury/other-income";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import type { ReceiptEmailOutcome } from "@/lib/treasury/receipt-notice";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";
import { cents, loadGroup, MAX_SPLIT_PARTS } from "@/lib/treasury/split-group";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";
import {
  previewSplit, splitConfirmToken, splitPartGuards,
  type SplitPartPlan, type SplitPreviewPart,
} from "@/lib/treasury/split-preview";

// El recibo viaja aparte del texto: un string no puede llevar un link, y sin
// link al recibo el mensaje del duplicado deja al operador sin a dónde ir.
// `kind` es para el duplicado que YA está bien asentado: ahí no hay nada roto
// —el recibo existe— y pintarlo de rojo diría que se perdió plata.
type State = {
  error?: string;
  kind?: "error" | "warning";
  receipt?: { id: number; number: string };
  /** El ingreso no societario del que habla el mensaje. Igual que `receipt`:
   *  un rechazo que no lleva a ningún lado es un callejón, y este ahora tiene
   *  salida —corregir el texto en Otros ingresos—. Viaja el id, no el concepto:
   *  el texto libre del operador no va a la URL (Ley 25.326, docs/08). */
  income?: { id: number };
  /** El paso de confirmación (spec 2026-09-10 §8.2): las partes resueltas en el
   *  servidor y el token que vuelve con el segundo envío. */
  confirm?: { token: string; total: number; parts: SplitPreviewPart[] };
};

const BASE = "/admin/tesoreria/sin-conciliar";

// Del error se loguea SOLO el código o el nombre. El `message` de Prisma vuelca
// los argumentos de la consulta —incluida la nota que escribió el operador— y
// el de nodemailer trae la dirección en claro: los dos son dato personal
// (Ley 25.326) y no van al log.
function errCode(e: unknown): string {
  const o = e as { code?: unknown; name?: unknown } | null;
  if (typeof o?.code === "string") return o.code;
  if (typeof o?.name === "string") return o.name;
  return "unknown";
}

// Ese `mpPaymentId` ya tiene un Payment: otro escritor (la vinculación de una
// suscripción, el cron, otro operador) asentó ESTE cobro entre la vista previa y
// el commit. El caso "recibo anulado" ya no es un callejón —las partes nuevas
// cuelgan del portador anulado, así que un reparto sobre una fila reabierta
// entra igual—: si se llega acá fue una carrera, y lo que corresponde es
// recargar la fila. En los dos casos viaja el número de recibo y su link, que es
// lo único accionable que hay.
function alreadyProcessedState(
  existing: { status: PaymentStatus; receipt: { id: number; number: string } | null } | null,
): State {
  if (!existing) return { error: "Ese cobro de Mercado Pago ya está registrado como pago." };
  const receipt = existing.receipt ?? undefined;
  if (existing.status === "applied") {
    return {
      kind: "warning",
      error: receipt
        ? `Este cobro de Mercado Pago ya está asentado: se registró con el recibo N° ${receipt.number}. No hace falta volver a aplicarlo.`
        : "Este cobro de Mercado Pago ya está asentado como pago. No hace falta volver a aplicarlo.",
      receipt,
    };
  }
  return {
    error: receipt
      ? `Este cobro de Mercado Pago se asentó con el recibo N° ${receipt.number} mientras lo repartías, y ese recibo figura anulado. Recargá la fila y volvé a intentarlo.`
      : "Este cobro de Mercado Pago se asentó mientras lo repartías. Recargá la fila y volvé a intentarlo.",
    receipt,
  };
}

// Todo mensaje va explícito y en castellano, incluida la COERCIÓN: sin mensaje
// propio, un valor que no es número llega a zod como NaN y el operador lee
// "Invalid input: expected number, received NaN" en pantalla.
const resolveSchema = z.object({
  rowId: z.coerce.number("Fila inválida.").int("Fila inválida.").positive("Fila inválida."),
  socios: z.string(M.noParts).min(1, M.noParts),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
  confirmar: z.string().optional(),
  confirmToken: z.string().optional(),
});

const CONCEPTS = ["fees", "voluntary", "extraordinary"] as const;

// Las partes viajan como `part_<socio>_concept|count|amount`, en el orden de
// `socios`. Se leen a mano: zod no modela claves dinámicas y el mensaje tiene
// que decir QUÉ parte falló en el idioma del operador.
function readParts(formData: FormData, socios: string): { ok: true; parts: SplitPartPlan[] } | { ok: false; error: string } {
  const ids = socios.split(",").map((s) => s.trim());
  if (ids.some((s) => !/^\d+$/.test(s) || Number(s) <= 0)) return { ok: false, error: M.noParts };
  if (ids.length > MAX_SPLIT_PARTS) return { ok: false, error: M.tooManyParts };
  if (new Set(ids).size !== ids.length) return { ok: false, error: M.duplicateMember };
  const parts: SplitPartPlan[] = [];
  for (const id of ids) {
    const concept = String(formData.get(`part_${id}_concept`) ?? "");
    if (!(CONCEPTS as readonly string[]).includes(concept)) return { ok: false, error: "Elegí cómo aplicar cada parte." };
    const countRaw = String(formData.get(`part_${id}_count`) ?? "").trim();
    const n = concept === "fees" ? Number(countRaw) : 0;
    if (concept === "fees" && (!/^\d{1,2}$/.test(countRaw) || n < 1 || n > 60)) return { ok: false, error: M.count };
    const amount = parseArsInput(String(formData.get(`part_${id}_amount`) ?? ""));
    if (amount === null || amount <= 0) return { ok: false, error: M.amountZero };
    parts.push({ memberId: Number(id), concept: concept as SplitPartPlan["concept"], n, amount });
  }
  return { ok: true, parts };
}

export async function resolveUnmatchedAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(resolveSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;
  const read = readParts(formData, d.socios);
  if (!read.ok) return { error: read.error };
  const parts = read.parts;

  const row = await prisma.mpUnmatchedPayment.findUnique({ where: { id: d.rowId } });
  if (!row) return { error: M.rowGone };
  // Dos operadores sobre la misma fila: el segundo no vuelve a cobrarla. La
  // barrera dura es el lock de fila y el unique del portador en el servicio;
  // esto le da un mensaje en castellano en vez de un error técnico.
  if (row.status !== "open" && row.status !== "partial") return { error: M.rowResolved };

  // La suma se compara contra lo SIN ASIGNAR (una fila parcial ya tiene una
  // parte aplicada), con la misma aritmética que la pantalla y el núcleo.
  const group = await loadGroup(prisma, { mpPaymentId: row.mpPaymentId, amount: Number(row.amount) });
  const sum = parts.reduce((s, p) => s + cents(p.amount), 0);
  if (sum !== cents(group.totals.unassigned)) return { error: M.sum(sum / 100, group.totals.unassigned) };
  // Pre-validación barata con los MISMOS textos que el núcleo (que revalida).
  const guard = await splitPartGuards(prisma, parts);
  if (guard) return { error: guard };

  // Paso 1: la confirmación, resuelta en el servidor. El token vuelve con el
  // paso 2 y, si las partes cambiaron en el medio, se vuelve a pedir.
  const token = splitConfirmToken(row.id, parts);
  if (d.confirmar !== "1" || d.confirmToken !== token) {
    const preview = await previewSplit(prisma, parts);
    return { confirm: { token, total: group.totals.unassigned, parts: preview } };
  }

  let result;
  try {
    result = await treasuryService.registerSplitPayment({ rowId: row.id, parts, actorId: actor.actorId, note: d.note ?? null });
  } catch (e) {
    // Toda regla de negocio ya viene redactada en es-AR desde el servicio; lo
    // demás es un error nuestro y no se le muestra crudo al operador.
    if (e instanceof TreasuryError) return { error: e.message };
    console.error("[unmatched] registerSplitPayment falló", errCode(e));
    return { error: "No se pudo aplicar el pago. Reintentá en un momento." };
  }
  if (result.kind === "already_processed") {
    const existing = await prisma.payment.findUnique({
      where: { id: result.paymentId },
      select: { status: true, receipt: { select: { id: true, number: true } } },
    });
    return alreadyProcessedState(existing);
  }

  // Best-effort, un email por parte: para acá los pagos, las cuotas y los
  // recibos numerados ya están commiteados. Reintentar cobraría dos veces.
  const emailed: ReceiptEmailOutcome[] = [];
  for (const part of result.parts) {
    try {
      const r = await sendReceiptEmail(part.receiptId);
      emailed.push(r.sent ? "sent" : r.reason);
    } catch (e) {
      console.error("[unmatched] sendReceiptEmail lanzó", errCode(e));
      emailed.push("error");
    }
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ids, códigos, contadores y montos. Ni la casilla del pagador, ni los
  // nombres, ni la nota (Ley 25.326).
  await audit({
    userId: actor.actorId,
    action: "unmatched_resolve",
    entity: "mp_unmatched_payment",
    entityId: row.id,
    detail: {
      action: "apply",
      rowStatus: result.rowStatus,
      total: group.totals.unassigned,
      parts: result.parts.map((p, i) => ({
        memberId: p.memberId, paymentId: p.paymentId, receiptId: p.receiptId,
        concept: parts[i].concept, count: parts[i].concept === "fees" ? parts[i].n : null,
        amount: p.amount, emailed: emailed[i],
      })),
    },
    ip,
  });
  // A la MISMA fila, que muestra las partes con sus recibos y a quién se le
  // envió. Fuera del try: redirect() señaliza con una excepción.
  redirect(`${BASE}/${row.id}?emitidos=${result.parts.length}&email=${emailed.join(",")}`);
}

const dismissSchema = z.object({
  rowId: z.coerce.number("Fila inválida.").int("Fila inválida.").positive("Fila inválida."),
  reason: z
    .string("Indicá el motivo del descarte.")
    .min(3, "Indicá el motivo del descarte.")
    .max(200, "El motivo no puede superar los 200 caracteres."),
});

export async function dismissUnmatchedAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(dismissSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  // El motivo se guarda en `description`: es la columna que existe y la
  // descripción original de MP sigue en `webhook_events`. La pantalla deja de
  // atribuirle ese texto a MP en cuanto la fila queda descartada.
  const { count } = await prisma.mpUnmatchedPayment.updateMany({
    where: { id: parsed.data.rowId, status: "open" },
    data: {
      status: "dismissed",
      resolvedById: actor.actorId,
      resolvedAt: new Date(),
      description: parsed.data.reason.slice(0, 200),
    },
  });
  // `updateMany` no falla cuando el where no matchea: sin mirar el count, un
  // descarte sobre una fila ya resuelta diría que salió bien.
  if (count === 0) return { error: "Esta fila ya fue resuelta." };

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // El motivo NO va al asiento: es texto libre que puede nombrar a un vecino.
  // Queda en la fila, que se lee desde el panel.
  await audit({
    userId: actor.actorId,
    action: "unmatched_resolve",
    entity: "mp_unmatched_payment",
    entityId: parsed.data.rowId,
    detail: { action: "dismiss" },
    ip,
  });
  redirect(`${BASE}?estado=resueltos`);
}

// ── Tercera salida: la plata entró y es de la asociación, pero no es de ningún
// socio (alquiler del salón, rifa, evento). No emite recibo: la serie numerada
// y su PDF están armados alrededor del socio (REG-33) y meterles un tercero era
// tocar el núcleo de plata, que ya está cerrado y probado.
//
// El monto y la fecha NO se tipean: salen de la fila, que es la evidencia de lo
// que Mercado Pago cobró y cuándo.
const otherIncomeSchema = z.object({
  rowId: z.coerce.number("Fila inválida.").int("Fila inválida.").positive("Fila inválida."),
  concept: z
    .string("Ingresá a qué corresponde el ingreso.")
    .min(3, "Ingresá a qué corresponde el ingreso.")
    .max(200, "El concepto no puede superar los 200 caracteres."),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
});

export async function registerAsOtherIncomeAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(otherIncomeSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;

  let result:
    | { kind: "gone" }
    | { kind: "resolved" }
    | { kind: "voided_previous"; incomeId: number }
    | { kind: "ok"; incomeId: number; amount: number };
  try {
    result = await prisma.$transaction(async (tx) => {
      const row = await tx.mpUnmatchedPayment.findUnique({
        where: { id: d.rowId },
        select: { id: true, status: true, amount: true, paidAt: true, mpPaymentId: true },
      });
      if (!row) return { kind: "gone" as const };
      if (row.status !== "open") return { kind: "resolved" as const };
      const income = await recordOtherIncome(tx, {
        amount: Number(row.amount),
        // La fecha del ingreso es la del COBRO, no la del reloj de esta corrida:
        // el alquiler entró el día que Mercado Pago lo acreditó.
        receivedAt: row.paidAt,
        concept: d.concept,
        method: "mp",
        mpPaymentId: row.mpPaymentId,
        note: d.note ?? null,
        actorId: actor.actorId,
      });
      // Ese cobro ya tiene un ingreso y ese ingreso está ANULADO: marcar la fila
      // ahora la dejaría apuntando a un registro anulado, que es exactamente lo
      // que la anulación deshizo cuando devolvió la fila a Pendientes. La unique
      // de `mpPaymentId` no se puede liberar (MariaDB no tiene índices únicos
      // parciales), así que no hay forma de escribirlo de nuevo.
      //
      // Se sale por `return` y no por excepción: el `create` chocó con la unique,
      // así que en esta transacción no se escribió nada que haya que revertir, y
      // el id del ingreso anulado tiene que llegar a la pantalla para armar el
      // enlace. La respuesta se redacta afuera.
      if (income.kind === "already_recorded") {
        const previous = await tx.otherIncome.findUnique({
          where: { id: income.id },
          select: { voidedAt: true },
        });
        if (previous?.voidedAt) return { kind: "voided_previous" as const, incomeId: income.id };
      }
      // El `status: "open"` del where es lo que serializa a dos operadores sobre
      // la misma fila: si el otro la resolvió entre el findUnique y esto, el
      // count es 0 y la excepción hace rollback del ingreso recién escrito.
      const { count } = await tx.mpUnmatchedPayment.updateMany({
        where: { id: row.id, status: "open" },
        data: { status: "other_income", resolvedById: actor.actorId, resolvedAt: new Date() },
      });
      if (count === 0) throw new OtherIncomeError("Esta fila ya fue resuelta.");
      return { kind: "ok" as const, incomeId: income.id, amount: Number(row.amount) };
    });
  } catch (e) {
    if (e instanceof OtherIncomeError) return { error: e.message };
    console.error("[unmatched] registro como ingreso no societario falló", errCode(e));
    return { error: "No se pudo registrar el ingreso. Reintentá en un momento." };
  }
  if (result.kind === "gone") return { error: "La fila ya no existe." };
  if (result.kind === "resolved") return { error: "Esta fila ya fue resuelta." };
  // El único rechazo de esta pantalla que ya no es un callejón: el registro
  // anulado no revive, pero el concepto de un ingreso VIGENTE se corrige sin
  // anular, y ahí es a donde hay que ir la próxima vez.
  if (result.kind === "voided_previous") {
    return {
      error:
        "Este cobro ya se había registrado como ingreso no societario y ese registro se anuló. "
        + "Un cobro de Mercado Pago no se puede registrar dos veces, así que esta plata se aplica "
        + "a un socio o se descarta la fila. Para corregir un concepto mal escrito, editalo en "
        + "Otros ingresos en vez de anularlo.",
      income: { id: result.incomeId },
    };
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ni el concepto ni la nota entran al asiento: son texto libre del operador y
  // pueden nombrar al inquilino del salón (Ley 25.326). Quedan en el registro,
  // que se lee desde el panel.
  await audit({
    userId: actor.actorId,
    action: "unmatched_resolve",
    entity: "mp_unmatched_payment",
    entityId: d.rowId,
    detail: { action: "other_income", incomeId: result.incomeId, amount: result.amount },
    ip,
  });
  // Al destino y no de vuelta a la bandeja: el operador tiene que ver dónde
  // quedó esa plata, que es justamente lo que esta pantalla no sabía decir.
  //
  // Por id y no a la lista pelada: Otros ingresos se organiza por EJERCICIO, y
  // un cobro de diciembre resuelto en enero no está en el ejercicio en curso.
  // El `?ingreso=` resuelve el año del propio ingreso, así que la pantalla abre
  // en el ejercicio correcto y con esa fila a la vista.
  redirect(`/admin/tesoreria/otros-ingresos?ingreso=${result.incomeId}&registrado=1`);
}
