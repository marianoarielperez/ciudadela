"use server";
// Registrar un pago en efectivo (spec §6.2). La regla vive en el servicio; acá
// se valida la forma, se audita con ids y montos (nunca el nombre) y se redirige
// al recibo recién emitido. El email es best-effort y su resultado viaja en la
// URL para que la pantalla del recibo lo cuente.
//
// La auditoría es de esta capa a propósito: el servicio no ve los encabezados
// del request, así que no puede asentar la IP del operador. Y es acá donde se
// decide qué NO entra en el asiento: memberId y receiptId alcanzan para
// reconstruir el caso desde la base, el nombre y el DNI no hacen falta (Ley
// 25.326).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";

type State = { error?: string };

const schema = z.object({
  memberId: z.coerce.number().int().positive(),
  concept: z.enum(["fees", "voluntary", "extraordinary"], { error: "Elegí el concepto del pago." }),
  count: z.coerce
    .number()
    .int("La cantidad de cuotas tiene que ser un número entero.")
    .positive("Indicá cuántas cuotas paga.")
    .optional(),
  amount: z.coerce.number().positive("Ingresá el monto del aporte.").optional(),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
  sendEmail: z.literal("on", { error: "Valor inválido." }).optional(),
});

export async function registerCashPaymentAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;

  let result;
  try {
    result = await treasuryService.registerCashPayment({
      memberId: d.memberId,
      actorId: actor.actorId,
      concept: d.concept,
      count: d.count,
      amount: d.amount,
      note: d.note,
    });
  } catch (e) {
    // Toda regla de negocio ya viene redactada en es-AR desde el servicio; lo
    // demás es un error nuestro y no se le muestra crudo al operador.
    if (e instanceof TreasuryError) return { error: e.message };
    console.error("[treasury] registerCashPayment", e instanceof Error ? e.message : e);
    return { error: "No se pudo registrar el pago. Reintentá en un momento." };
  }

  let emailed: "sent" | "no_email" | "voided" | "error" | "skipped" = "skipped";
  if (d.sendEmail === "on") {
    const r = await sendReceiptEmail(result.receiptId);
    emailed = r.sent ? "sent" : r.reason;
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "cash_payment_create",
    entity: "payment",
    entityId: result.paymentId,
    // Solo ids, códigos y montos. `count` va en null cuando el concepto no es
    // cuotas: la clave está siempre, así que el asiento se lee igual siempre.
    detail: {
      memberId: d.memberId,
      receiptId: result.receiptId,
      number: result.number,
      concept: d.concept,
      count: d.count ?? null,
      amount: result.amount,
      periods: result.periods.length,
      emailed,
    },
    ip,
  });
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/tesoreria/recibos/${result.receiptId}?emitido=1&email=${emailed}`);
}
