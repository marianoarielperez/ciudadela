"use server";
// Vincular una suscripción preexistente de Mercado Pago a un socio.
//
// Es SUPERADMIN y no admin común: el resto de Tesorería asienta plata que ya
// entró, y esto autoriza un cobro que se repite solo, todos los meses, sobre la
// tarjeta de un vecino. Y como cualquier server action, se autoriza a sí misma:
// Next las despacha por el id del encabezado `Next-Action` y no por la URL, así
// que el proxy de /admin no las cubre.
//
// El `confirmToken` NO es una barrera de seguridad —se deriva de datos que el
// cliente ya tiene—: es la guarda contra el mis-click, igual que en la cesantía
// por mora. Lo que impide vincular a ciegas es otra cosa: todo lo que el
// operador leyó en la pantalla anterior lo resolvió el servidor contra la base
// y contra MP, y el vinculador vuelve a leer la suscripción en MP antes de
// escribir la fila.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { subscriptionLinker } from "@/lib/mp/link-subscription";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";

type State = { error?: string };

const schema = z.object({
  preapprovalId: z.string("Suscripción inválida.").regex(/^[a-z0-9-]{1,64}$/, "Suscripción inválida."),
  memberId: z.coerce.number("Elegí el socio.").int("Elegí el socio.").positive("Elegí el socio."),
  confirmToken: z.string("Confirmá la vinculación.").min(1, "Confirmá la vinculación."),
});

export async function linkSubscriptionAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { preapprovalId, memberId, confirmToken } = parsed.data;
  // Huella de "esto es lo que leí": no es seguridad, evita el mis-click.
  if (confirmToken !== `${preapprovalId}|${memberId}`) {
    return { error: "Lo que confirmaste no coincide con lo que se iba a vincular. Volvé a leer y confirmá de nuevo." };
  }

  let result;
  try {
    result = await subscriptionLinker.link({ preapprovalId, memberId, actorId: actor.actorId });
  } catch (e) {
    console.error("[suscripciones] link", e instanceof Error ? e.message : e);
    return { error: "No pudimos vincular la suscripción. Reintentá en un momento." };
  }
  if (!result.ok) return { error: result.error };

  // El aviso del recibo es best-effort, como en el webhook: la plata ya está
  // asentada y el recibo se puede reenviar desde su pantalla.
  let emailed = 0;
  for (const a of result.applied) {
    try { if ((await sendReceiptEmail(a.receiptId)).sent) emailed++; } catch { /* best-effort */ }
  }
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ids, montos y estados. Ni el nombre del socio, ni el email del pagador, ni
  // la descripción de la suscripción (Ley 25.326).
  await audit({
    userId: actor.actorId, action: "subscription_linked", entity: "mp_subscription", entityId: preapprovalId,
    detail: {
      preapprovalId, memberId, amount: result.amount, status: result.status,
      applied: result.applied.map((a) => a.paymentId), unapplied: result.unapplied, emailed,
    },
    ip,
  });
  // Fuera del try: `redirect` señaliza con una excepción y un catch se la comería.
  redirect(
    `/admin/tesoreria/suscripciones?vinculada=${encodeURIComponent(preapprovalId)}` +
      `&aplicados=${result.applied.length}&pendientes=${result.unapplied}`,
  );
}
