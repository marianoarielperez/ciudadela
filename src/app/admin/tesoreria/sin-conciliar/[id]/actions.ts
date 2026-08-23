"use server";
// Resolver una fila de la bandeja (spec 4B §7): aplicarla a un socio como N
// cuotas o como aporte voluntario —con el `mpPaymentId` y la fecha REAL del
// cobro, no la del reloj de esta corrida—, o descartarla con motivo.
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
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import type { ReceiptEmailOutcome } from "@/lib/treasury/receipt-notice";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";

// El recibo viaja aparte del texto: un string no puede llevar un link, y sin
// link al recibo el mensaje del duplicado deja al operador sin a dónde ir.
// `kind` es para el duplicado que YA está bien asentado: ahí no hay nada roto
// —el recibo existe— y pintarlo de rojo diría que se perdió plata.
type State = {
  error?: string;
  kind?: "error" | "warning";
  receipt?: { id: number; number: string };
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

// Ese `mpPaymentId` ya tiene un Payment. Son dos historias muy distintas y el
// operador tiene que poder distinguirlas:
//  - `applied`: el cobro está bien asentado (reenvío de MP, o dos operadores
//    sobre la misma fila). No hay nada que hacer.
//  - `voided` / `refunded`: se había asentado y ese recibo se anuló o se
//    reembolsó. El Payment sobrevive a la anulación, así que sigue frenando el
//    duplicado: la reimputación no se puede hacer desde esta pantalla, y
//    decirle "ya está registrado" a secas lo dejaría sin entender por qué.
// En los dos casos se le da el número de recibo y el link, que es lo único
// accionable que hay. Que un pago anulado deje de contar como duplicado es otra
// discusión —toca la barrera contra el reenvío de MP— y no se decide acá.
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
  const head = receipt
    ? `Este cobro de Mercado Pago ya se había asentado con el recibo N° ${receipt.number}`
    : "Este cobro de Mercado Pago ya se había asentado";
  const tail = existing.status === "voided"
    ? receipt ? " y ese recibo se anuló." : " y ese pago se anuló."
    : " y después figura como reembolsado.";
  return {
    error: `${head}${tail} Por ahora esta plata no se puede volver a imputar desde acá: la fila queda pendiente.`,
    receipt,
  };
}

// Todo mensaje va explícito y en castellano, incluida la COERCIÓN: sin mensaje
// propio, un valor que no es número llega a zod como NaN y el operador lee
// "Invalid input: expected number, received NaN" en pantalla.
const resolveSchema = z.object({
  rowId: z.coerce.number("Fila inválida.").int("Fila inválida.").positive("Fila inválida."),
  memberId: z.coerce
    .number("Elegí a qué socio se le aplica.")
    .int("Elegí a qué socio se le aplica.")
    .positive("Elegí a qué socio se le aplica."),
  concept: z.enum(["fees", "voluntary"], { error: "Elegí cómo aplicar el pago." }),
  count: z.coerce
    .number("Indicá cuántas cuotas.")
    .int("La cantidad tiene que ser un número entero.")
    .positive("Indicá cuántas cuotas.")
    .max(60, "Como máximo 60 cuotas.")
    .optional(),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
});

export async function resolveUnmatchedAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(resolveSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;
  if (d.concept === "fees" && !d.count) return { error: "Indicá cuántas cuotas." };

  const row = await prisma.mpUnmatchedPayment.findUnique({ where: { id: d.rowId } });
  if (!row) return { error: "La fila ya no existe." };
  // Dos operadores sobre la misma fila: el segundo no vuelve a cobrarla. La
  // barrera dura es la unique de `mpPaymentId` en el servicio; esto le da al
  // segundo un mensaje en castellano en vez de un error técnico.
  if (row.status !== "open") return { error: "Esta fila ya fue resuelta." };

  let result;
  try {
    result = await treasuryService.registerPayment({
      memberId: d.memberId,
      // `link` y no `cash`: la plata entró por Mercado Pago y el recibo tiene
      // que decir por dónde entró. `voluntary` no imputa cuotas, así que va con
      // n = 0 (el servicio rechaza cualquier otra cosa).
      type: d.concept === "fees" ? "link" : "voluntary",
      n: d.concept === "fees" ? (d.count ?? 1) : 0,
      amount: Number(row.amount),
      paidAt: row.paidAt,
      mpPaymentId: row.mpPaymentId,
      preapprovalId: row.preapprovalId,
      actorId: actor.actorId,
      note: d.note ?? null,
    });
  } catch (e) {
    // Toda regla de negocio ya viene redactada en es-AR desde el servicio; lo
    // demás es un error nuestro y no se le muestra crudo al operador.
    if (e instanceof TreasuryError) return { error: e.message };
    console.error("[unmatched] registerPayment falló", errCode(e));
    return { error: "No se pudo aplicar el pago. Reintentá en un momento." };
  }
  if (result.kind === "already_processed") {
    const existing = await prisma.payment.findUnique({
      where: { id: result.paymentId },
      select: { status: true, receipt: { select: { id: true, number: true } } },
    });
    return alreadyProcessedState(existing);
  }
  if (result.kind === "no_pending_withdrawn") {
    return {
      error: "El socio está dado de baja y no tiene cuotas pendientes: no hay a qué imputarlo.",
    };
  }

  // `registerPayment` ya cerró la fila DENTRO de su transacción (la marcó
  // `matched` con el paymentId): acá sólo se sella QUIÉN la resolvió. El
  // `updateMany` acotado a `status: "matched"` es a propósito — si por lo que
  // fuera la fila no quedó cerrada, esto no le inventa un responsable.
  //
  // Envuelto en try como el email de al lado: para acá el pago, la imputación y
  // el recibo numerado ya están commiteados. Perder el sello de quién resolvió
  // es cosmético; perder el redirect al recibo —que ya existe y ya tiene
  // número— no: el operador vería un error genérico y no encontraría el recibo.
  try {
    await prisma.mpUnmatchedPayment.updateMany({
      where: { id: row.id, status: "matched" },
      data: { resolvedById: actor.actorId },
    });
  } catch (e) {
    console.error("[unmatched] sellado de resolvedById falló", errCode(e));
  }

  // Best-effort, igual que en Efectivo: para acá el pago, la imputación y el
  // recibo numerado ya están commiteados. Si el email explota, el resultado se
  // degrada a "error" y el flujo sigue — reintentar le cobraría dos veces al
  // socio. `sendReceiptEmail` decide solo si hay casilla a la que mandar.
  let emailed: ReceiptEmailOutcome = "skipped";
  try {
    const r = await sendReceiptEmail(result.receiptId);
    emailed = r.sent ? "sent" : r.reason;
  } catch (e) {
    console.error("[unmatched] sendReceiptEmail lanzó", errCode(e));
    emailed = "error";
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "unmatched_resolve",
    entity: "mp_unmatched_payment",
    entityId: row.id,
    detail: {
      action: "apply",
      memberId: d.memberId,
      paymentId: result.paymentId,
      receiptId: result.receiptId,
      concept: d.concept,
      count: d.count ?? null,
      amount: result.amount,
      emailed,
    },
    ip,
  });
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/tesoreria/recibos/${result.receiptId}?emitido=1&email=${emailed}`);
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
