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
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import type { ReceiptEmailOutcome } from "@/lib/treasury/receipt-notice";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";

type State = { error?: string };

const BASE = "/admin/tesoreria/sin-conciliar";

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
    console.error("[unmatched] registerPayment", e instanceof Error ? e.message : e);
    return { error: "No se pudo aplicar el pago. Reintentá en un momento." };
  }
  if (result.kind === "already_processed") {
    return { error: "Ese cobro de Mercado Pago ya está registrado como pago." };
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
  await prisma.mpUnmatchedPayment.updateMany({
    where: { id: row.id, status: "matched" },
    data: { resolvedById: actor.actorId },
  });

  // Best-effort, igual que en Efectivo: para acá el pago, la imputación y el
  // recibo numerado ya están commiteados. Si el email explota, el resultado se
  // degrada a "error" y el flujo sigue — reintentar le cobraría dos veces al
  // socio. `sendReceiptEmail` decide solo si hay casilla a la que mandar.
  let emailed: ReceiptEmailOutcome = "skipped";
  try {
    const r = await sendReceiptEmail(result.receiptId);
    emailed = r.sent ? "sent" : r.reason;
  } catch (e) {
    // Sólo el código: el error de nodemailer trae la dirección en claro.
    const code = (e as { code?: unknown } | null)?.code;
    console.error("[unmatched] sendReceiptEmail lanzó", typeof code === "string" ? code : "unknown");
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
