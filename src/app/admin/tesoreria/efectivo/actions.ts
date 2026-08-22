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
import type { ReceiptEmailOutcome } from "@/lib/treasury/receipt-notice";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";

type State = { error?: string };

// Todo mensaje va explícito y en castellano, incluido el de la COERCIÓN: un
// valor que no es número llega a zod como NaN y sin mensaje propio el operador
// lee "Invalid input: expected number, received NaN" en pantalla. Pasa con un
// POST a mano, pero también con un campo que quedó a medio tipear.
//
// El monto es en pesos enteros, igual que el valor de cuota de Configuración:
// con centavos habría que decidir si la coma es decimal o separador de miles, y
// equivocarse ahí cobra de más sin que nadie lo note. El techo lo pone el
// servicio (Decimal(10,2)), que ya lo dice en castellano.
const schema = z.object({
  memberId: z.coerce
    .number("Elegí a qué socio se le cobra.")
    .int("Elegí a qué socio se le cobra.")
    .positive("Elegí a qué socio se le cobra."),
  concept: z.enum(["fees", "voluntary", "extraordinary"], { error: "Elegí el concepto del pago." }),
  count: z.coerce
    .number("Indicá cuántas cuotas paga.")
    .int("La cantidad de cuotas tiene que ser un número entero.")
    .positive("Indicá cuántas cuotas paga.")
    .optional(),
  amount: z.coerce
    .number("Ingresá el monto del aporte.")
    .int("El monto tiene que ser un número entero de pesos.")
    .positive("Ingresá el monto del aporte.")
    .optional(),
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

  // El tipo sale de `receipt-notice.ts` (no se retipea acá): es el mapa que la
  // pantalla del recibo usa para leer este mismo valor de la URL.
  let emailed: ReceiptEmailOutcome = "skipped";
  if (d.sendEmail === "on") {
    // `sendReceiptEmail` está documentado como best-effort y pensado para no
    // tirar nunca, pero su primer statement (el findUnique del recibo) vive
    // AFUERA del try interno del módulo: un timeout del pool ahí se escapa
    // igual. Para este momento el pago, la imputación y el recibo numerado ya
    // están commiteados — degradar a "error" (el mismo resultado que un envío
    // que sí falló prolijamente) es lo único correcto: la auditoría y el
    // redirect tienen que pasar sí o sí, o el operador reintentaría y le
    // cobraría dos veces al socio.
    try {
      const r = await sendReceiptEmail(result.receiptId);
      emailed = r.sent ? "sent" : r.reason;
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      console.error("[treasury] sendReceiptEmail lanzó", typeof code === "string" ? code : "unknown");
      emailed = "error";
    }
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
