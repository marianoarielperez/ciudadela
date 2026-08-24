"use server";
// Cancelar el débito automático de un EX socio (spec 4C §10, enmienda del
// operador del 24/08/2026).
//
// Por qué existe: la baja ya cancela sola (`members/withdraw-with-debits.ts`),
// pero es best-effort — si Mercado Pago no contesta, la baja queda asentada y el
// débito vivo. Hasta esta acción el "reintento" era entrar al panel de Mercado
// Pago y buscar la suscripción por el email del vecino. Los tres avisos de fallo
// (baja individual, lote de cesantía, ficha del socio) mandan acá, y acá hay un
// botón.
//
// Por qué es `requireAdmin` y no `requireSuperadmin` como la vinculación: la
// vinculación AUTORIZA un cobro que después se repite solo sobre la tarjeta de
// un vecino; ésta lo CORTA. Es la misma operación que la baja —que es de admin—
// hace sola, y el caso de uso es justamente rematarla cuando falló. Pedir
// superadmin para deshacer lo que un admin ya provocó dejaría el débito vivo
// hasta que aparezca otra persona.
//
// Y como cualquier server action se autoriza a sí misma: Next las despacha por
// el id del encabezado `Next-Action` y no por la URL, así que el proxy de /admin
// no las cubre.
//
// NINGUNA llamada de red adentro de una `$transaction`: acá no hay transacción
// ninguna. Se lee, se llama a MP, se escribe el espejo y se asienta, en ese
// orden y cada cosa por su cuenta.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { describeMpError, mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway } from "@/lib/mp/gateway";
import { isKnownDead } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";

const BASE = "/admin/tesoreria/suscripciones";

type State = { error?: string };

const schema = z.object({
  preapprovalId: z.string("Suscripción inválida.").regex(/^[a-z0-9-]{1,64}$/, "Suscripción inválida."),
});

export async function cancelSubscriptionAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { preapprovalId } = parsed.data;

  // Las tres precondiciones se releen de la base y no del formulario: la
  // pantalla pudo quedar vieja (otra pestaña ya canceló) y un POST armado a mano
  // no puede cortarle el débito a un socio vigente.
  const sub = await prisma.mpSubscription.findUnique({
    where: { preapprovalId },
    select: { status: true, member: { select: { id: true, status: true } } },
  });
  if (!sub) return { error: "Esa suscripción no está vinculada a ningún socio." };
  // Idempotente y sin red: volver a cancelar una cancelada no puede ganar nada y
  // el error de MP que devolvería no significaría nada.
  if (isKnownDead(sub.status)) return { error: "Esa suscripción ya está cancelada." };
  if (!sub.member) return { error: "Esa suscripción no tiene socio: vinculala antes de cancelarla." };
  // REGLA: sólo el débito de quien dejó de ser socio. Es el caso en que la
  // asociación no tiene derecho a seguir cobrando. Al socio vigente se le corta
  // el débito dándolo de baja, que es lo que deja el acta.
  if (sub.member.status !== "withdrawn") {
    return { error: "Ese socio sigue vigente: el débito se cancela al registrar la baja, que es lo que queda asentado en el acta." };
  }

  try {
    await mpGateway.cancelPreapproval(preapprovalId);
  } catch (e) {
    // El SDK de MP no lanza `Error`: `mpErrorLog` desarma el cuerpo y lo
    // enmascara (puede traer el `payer_email` del vecino).
    console.error(
      "[suscripciones] no se pudo cancelar el débito —",
      mpErrorLog("cancelPreapproval", { memberId: sub.member.id, preapprovalId }, e),
    );
    const d = describeMpError(e);
    // Mismo código que el asiento de la baja: MEDIDO contra la API real, un 404
    // llega con `code: null` y `code || "unknown"` borraba lo único que
    // distingue "ese id no existe" de "el token no tiene permiso".
    const code = d.code || (d.status === null ? "unknown" : `http_${d.status}`);
    await audit({
      userId: actor.actorId, action: "subscription_cancel_failed", entity: "mp_subscription", entityId: preapprovalId,
      detail: { preapprovalId, memberId: sub.member.id, code },
      ip: (await headers()).get("x-real-ip") ?? "unknown",
    });
    // El id ENTERO en el mensaje: es el único camino que le queda al operador
    // —buscarla en el panel de Mercado Pago— y la tabla sólo muestra 8
    // caracteres. Es un id de MP, no un dato personal.
    return {
      error: `Mercado Pago no aceptó cancelar el débito (${code}). Reintentá en un momento; si sigue fallando, ` +
        `cancelala en el panel de Mercado Pago: la suscripción es ${preapprovalId}.`,
    };
  }

  // El espejo local va en su PROPIO try y DESPUÉS de MP: si acá falla, el débito
  // ya está cortado y marcarlo como fallido mandaría al operador a cancelar de
  // nuevo algo que ya no cobra. La conciliación diaria endereza el espejo.
  try {
    await prisma.mpSubscription.updateMany({
      where: { preapprovalId },
      data: { status: "cancelled", lastSyncAt: new Date() },
    });
  } catch (e) {
    console.error(
      "[suscripciones] el débito se canceló en MP pero el espejo local no se actualizó",
      preapprovalId,
      e instanceof Error ? e.message : e,
    );
  }

  await audit({
    userId: actor.actorId, action: "subscription_cancelled", entity: "mp_subscription", entityId: preapprovalId,
    // Ids y estados: ni el nombre del socio ni el email del pagador (Ley 25.326).
    detail: { preapprovalId, memberId: sub.member.id, statusBefore: sub.status },
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });

  // Fuera del try: `redirect` señaliza con una excepción y un catch se la comería.
  redirect(`${BASE}?cancelada=${encodeURIComponent(preapprovalId)}`);
}
