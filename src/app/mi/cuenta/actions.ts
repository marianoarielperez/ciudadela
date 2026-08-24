"use server";
// "Pagar ahora" del panel del socio (spec 4B §12): el propio vecino se genera
// el link de Checkout Pro y se va a pagarlo. Es el mismo circuito que el link
// del operador —misma referencia `pago:{memberId}:{n}`, mismo webhook— con una
// diferencia que es la razón de que esta action exista aparte: el socio NO
// elige a quién se le cobra. El `memberId` sale de `requireMember()`, nunca del
// formulario, así que no hay forma de armar un POST que le genere un link a
// otra ficha.
//
// PRIVACIDAD (Ley 25.326): la URL del checkout no va al asiento ni a ningún
// log. El asiento lleva ids, cantidad y monto.
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { memberPayLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import { mpErrorLog } from "@/lib/mp/error-log";
import { PAYMENT_LINK_ERRORS, paymentLinks } from "@/lib/mp/payment-link";
import { MAX_LINK_FEES } from "@/lib/mp/references";
import { prisma } from "@/lib/prisma";

export type PayState = { error?: string; redirectUrl?: string };

const schema = z.object({
  n: z.coerce
    .number("Indicá cuántas cuotas querés pagar.")
    .int("La cantidad tiene que ser un número entero.")
    .min(1, "Al menos una cuota.")
    .max(MAX_LINK_FEES, `Como máximo ${MAX_LINK_FEES} cuotas.`),
});

export async function startMemberPaymentAction(_prev: PayState, formData: FormData): Promise<PayState> {
  // Resuelve contra la fila viva. El SUSPENDIDO sí llega: pagar es la única
  // action que el modo lectura le permite (spec M5 §5 — saldar deuda lo acerca
  // a la rehabilitación). Un socio dado de baja no llega nunca.
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return { error: actor.error };
  // Cada clic crea una preferencia en Mercado Pago. Va antes del parseo: lo que
  // se raciona es el llamado a MP, y un formulario mal armado repetido cinco
  // veces por segundo es igual de sospechoso que uno bien armado.
  if (!memberPayLimiter.check(String(actor.memberId))) {
    return { error: "Demasiados intentos seguidos. Esperá un minuto y volvé a probar." };
  }
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // `findUniqueOrThrow` y no `findUnique`: `requireMember` acaba de leer esa
  // misma fila, así que si no está es un fallo técnico, no un caso de pantalla.
  const member = await prisma.member.findUniqueOrThrow({
    where: { id: actor.memberId },
    select: { id: true, category: true },
  });

  let r;
  try {
    r = await paymentLinks.create({ member, n: parsed.data.n });
  } catch (e) {
    console.error("[mi/cuenta] createPreference —", mpErrorLog("createPreference", { memberId: member.id, n: parsed.data.n }, e));
    return { error: "No pudimos iniciar el pago en Mercado Pago. Probá de nuevo en unos minutos." };
  }
  if (!r.ok) return { error: PAYMENT_LINK_ERRORS[r.error] };

  // La IP también en el canal del socio, y no sólo en los dos del operador: es
  // justo donde la identidad es más débil —una sesión de 8 h en un teléfono—,
  // así que si algún día hay que reconstruir quién generó un cobro, este es el
  // asiento que menos puede permitirse quedar sin origen.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.userId,
    action: "payment_link_create",
    entity: "member",
    entityId: member.id,
    detail: { memberId: member.id, n: parsed.data.n, amount: r.amount, channel: "member" },
    ip,
  });
  return { redirectUrl: r.initPoint };
}
