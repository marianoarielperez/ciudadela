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
import { makeMailBudget } from "@/lib/email/batch-cap";
import { parseForm } from "@/lib/forms";
import { mpErrorLog } from "@/lib/mp/error-log";
import { subscriptionLinker } from "@/lib/mp/link-subscription";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";

type State = { error?: string };

/** Los errores de nodemailer traen `envelope`, `rejected` y el `response` del
 *  SMTP —o sea la dirección del vecino en claro— y el log de PM2 no está
 *  cubierto por los cuidados de docs/08 (Ley 25.326). Al log va el código. */
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

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
    // Acá aterriza, entre otros, el fallo de `getPreapproval` que el vinculador
    // no captura por diseño. El SDK de Mercado Pago NO lanza `Error`: hace
    // `throw await response.json()`, así que un `console.error` crudo imprimiría
    // el cuerpo entero de MP —que puede arrastrar el `payer_email` del vecino—.
    // `mpErrorLog` enmascara y recorta (ver `@/lib/mp/error-log`).
    console.error("[suscripciones] no se pudo vincular —", mpErrorLog("linkSubscription", { preapprovalId, memberId }, e));
    return { error: "No pudimos vincular la suscripción. Reintentá en un momento." };
  }
  if (!result.ok) return { error: result.error };

  // El aviso del recibo es best-effort, como en el webhook: la plata ya está
  // asentada y el recibo se puede reenviar desde su pantalla.
  //
  // Con techo: vincular una suscripción vieja puede recuperar decenas de cobros
  // históricos de una sola persona (el 23/08/2026 fueron 24 recibos a un mismo
  // socio en minutos). Lo que excede el tope NO se pierde: queda sin enviar y la
  // pantalla lo dice, para que el operador los mande desde Recibos. El tope es
  // de CORREOS: los cobros ya los aplicó `link()`, antes de este bucle.
  const mailBudget = makeMailBudget();
  let emailed = 0;
  for (const a of result.applied) {
    if (!mailBudget.take()) continue;
    try {
      if ((await sendReceiptEmail(a.receiptId)).sent) emailed++;
    } catch (e) {
      // Best-effort, pero no invisible: sin esta línea el único rastro del
      // fallo es el `emailed` del asiento, que no dice cuál recibo ni por qué.
      console.error("[suscripciones] no se pudo enviar el recibo", a.receiptId, "code:", codeOf(e));
    }
  }
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ids, montos y estados. Ni el nombre del socio, ni el email del pagador, ni
  // la descripción de la suscripción (Ley 25.326).
  await audit({
    userId: actor.actorId, action: "subscription_linked", entity: "mp_subscription", entityId: preapprovalId,
    detail: {
      preapprovalId, memberId, amount: result.amount, status: result.status, autoDebit: result.autoDebit,
      applied: result.applied.map((a) => a.paymentId), unapplied: result.unapplied, emailed, deferred: mailBudget.deferred,
    },
    ip,
  });
  // Fuera del try: `redirect` señaliza con una excepción y un catch se la comería.
  redirect(
    `/admin/tesoreria/suscripciones?vinculada=${encodeURIComponent(preapprovalId)}` +
      `&aplicados=${result.applied.length}&pendientes=${result.unapplied}&diferidos=${mailBudget.deferred}`,
  );
}
