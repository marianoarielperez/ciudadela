"use server";
// Link de pago de Checkout Pro desde la ficha (spec 4B §12). Dos actions:
// generar y reenviar por email. Están separadas a propósito — el link ya
// generado sigue siendo válido aunque el SMTP falle, así que el envío no puede
// ser un efecto secundario de la creación: sería un link perdido por cada
// hipo de Brevo.
//
// PRIVACIDAD (Ley 25.326, docs/08): la URL del checkout NO va al asiento de
// auditoría ni a ningún log. Lleva la referencia `pago:{memberId}:{n}` y es un
// enlace de cobro: lo que queda asentado son ids, cantidad y monto. El email
// del socio tampoco sale por ningún lado.
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { mailer } from "@/lib/email";
import { paymentLinkEmail } from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { mpErrorLog } from "@/lib/mp/error-log";
import { PAYMENT_LINK_ERRORS, paymentLinks } from "@/lib/mp/payment-link";
import { isPaymentLinkSealValid, sealPaymentLink } from "@/lib/mp/payment-link-seal";
import { MAX_LINK_FEES } from "@/lib/mp/references";
import { prisma } from "@/lib/prisma";
import { countPendingFees } from "@/lib/treasury/account";
import { activeExemption, adminExemptionNotice } from "@/lib/treasury/exemptions";

export type LinkState = {
  error?: string;
  /** `seal` ata la tupla al socio: el reenvío por email lo verifica antes de
   *  mandar nada (ver `payment-link-seal.ts`). No es un secreto — se deriva de
   *  datos que ya están en el DOM— y por eso puede viajar en un `hidden`. */
  link?: { url: string; amount: number; n: number; expiresAt: Date; seal: string };
  emailed?: true;
};

const createSchema = z.object({
  memberId: z.coerce.number("Socio inválido.").int("Socio inválido.").positive("Socio inválido."),
  n: z.coerce
    .number("Indicá cuántas cuotas.")
    .int("La cantidad tiene que ser un número entero.")
    .min(1, "Al menos una cuota.")
    .max(MAX_LINK_FEES, `Como máximo ${MAX_LINK_FEES} cuotas.`),
});

export async function createPaymentLinkAction(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(createSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const member = await prisma.member.findUnique({
    where: { id: parsed.data.memberId },
    select: { id: true, category: true, status: true },
  });
  if (!member) return { error: "El socio no existe." };
  // EXENCIÓN DE CUOTA (Art. 7 inc. a.4): mientras esté vigente no se le genera
  // ningún link. Misma clase de guarda que la del cesante de acá abajo —y por el
  // mismo motivo: la pantalla se puede saltear escribiendo la URL— pero con un
  // desenlace peor si se cuela, porque acá el link SÍ cobra: la plata entraría
  // contra un acta que la perdona y el recibo saldría numerado.
  const exemption = await activeExemption(prisma, member.id);
  if (exemption) return { error: adminExemptionNotice(exemption) };
  // Un cesante no devenga (REG-16): lo único que se le puede cobrar es la deuda
  // congelada al momento de la baja. Sin esta guarda el link se generaba igual,
  // el vecino pagaba, `registerPayment` devolvía `no_pending_withdrawn` y la
  // plata caía en la bandeja de sin conciliar sin recibo, esperando que alguien
  // la resolviera a mano o la devolviera. Se chequea ACÁ y no sólo en la
  // pantalla porque la pantalla se puede saltear escribiendo la URL.
  if (member.status === "withdrawn") {
    // `countPendingFees` y no un `count` propio: la pantalla decide con
    // `fetchMemberAccount().pendingCount` y ésta con esto, y las dos cuentas
    // TIENEN que dar lo mismo — si divergen, el `EmptyState` ofrece un link que
    // el servidor rechaza, o al revés. Una sola definición de "cuántas debe".
    const pending = await countPendingFees(prisma, member.id);
    if (pending === 0) {
      return { error: "El socio está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle." };
    }
    if (parsed.data.n > pending) {
      return {
        error: `El socio está dado de baja: sólo se le puede cobrar la deuda que quedó (${pending} ${pending === 1 ? "cuota" : "cuotas"}).`,
      };
    }
  }

  let r;
  try {
    r = await paymentLinks.create({ member, n: parsed.data.n });
  } catch (e) {
    // Los errores del SDK de MP no son `Error`: `mpErrorLog` los desarma.
    console.error("[payment-link] createPreference —", mpErrorLog("createPreference", { memberId: member.id, n: parsed.data.n }, e));
    return { error: "No pudimos crear el link en Mercado Pago. Probá de nuevo en unos minutos." };
  }
  if (!r.ok) return { error: PAYMENT_LINK_ERRORS[r.error] };

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ids, cantidad y monto. El link NO va al asiento.
  await audit({
    userId: actor.actorId,
    action: "payment_link_create",
    entity: "member",
    entityId: member.id,
    detail: { memberId: member.id, n: parsed.data.n, amount: r.amount, channel: "admin" },
    ip,
  });
  const link = { url: r.initPoint, amount: r.amount, n: parsed.data.n };
  return { link: { ...link, expiresAt: r.expiresAt, seal: sealPaymentLink({ memberId: member.id, ...link }) } };
}

// La URL viaja en un hidden y vuelve del navegador, así que se valida como
// entrada hostil: sin esta `refine`, la action sería un relé de spam con el
// membrete de la vecinal (se manda a la casilla del socio, pero el texto del
// enlace lo elegiría quien arme el POST). Sólo se reenvían links de MP.
const MP_LINK_PREFIXES = [
  "https://www.mercadopago.com",
  "https://mpago.la",
  "https://sandbox.mercadopago.com",
] as const;

const emailSchema = z.object({
  memberId: z.coerce.number("Socio inválido.").int("Socio inválido.").positive("Socio inválido."),
  url: z
    .url("Link inválido.")
    .max(500, "Link inválido.")
    .refine((u) => MP_LINK_PREFIXES.some((p) => u.startsWith(p)), "Link inválido."),
  n: z.coerce.number("Cantidad inválida.").int("Cantidad inválida.").min(1, "Cantidad inválida.").max(MAX_LINK_FEES, "Cantidad inválida."),
  amount: z.coerce.number("Monto inválido.").positive("Monto inválido."),
  expiresAt: z.coerce.date("Link inválido."),
  seal: z.string().length(64, "Link inválido."),
});

export async function emailPaymentLinkAction(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(emailSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;
  // La `refine` de arriba dice que la URL es de Mercado Pago; el sello dice que
  // es la que ESTE servidor generó para ESTE socio por ESTE monto. Sin él, un
  // POST armado a mano le manda al socio A un enlace cuya referencia acredita
  // al socio B. Se verifica antes de tocar la base y antes de tocar el mailer.
  if (!isPaymentLinkSealValid({ memberId: d.memberId, n: d.n, amount: d.amount, url: d.url }, d.seal)) {
    return { error: "Link inválido." };
  }
  const member = await prisma.member.findUnique({
    where: { id: d.memberId },
    select: { id: true, fullName: true, email: true, emailStatus: true },
  });
  if (!member) return { error: "El socio no existe." };
  // El reenvío se corta TAMBIÉN, y no por simetría: el link vive 72 h y la
  // Comisión puede asentar la exención en el medio. Un enlace generado ayer
  // sigue cobrando hoy, así que sin esta guarda el operador le mandaría por
  // email un cobro a quien la pantalla le está diciendo que no se le cobra.
  //
  // Va ANTES de la guarda del email, y el orden es el mensaje: a un eximido sin
  // casilla cargada, "no tiene un email válido" lo manda a cargarle el email
  // para poder mandarle un cobro que no corresponde. El motivo que importa es
  // que está eximido — el email es lo de menos.
  const exemption = await activeExemption(prisma, member.id);
  if (exemption) return { error: adminExemptionNotice(exemption) };
  if (!member.email || member.emailStatus === "bounced") {
    return { error: "El socio no tiene un email válido cargado." };
  }

  try {
    await mailer.sendToMember({
      memberId: member.id,
      to: member.email,
      type: "fee_reminder",
      message: paymentLinkEmail({ name: member.fullName, count: d.n, amount: d.amount, url: d.url, expiresAt: d.expiresAt }),
      summary: `link de pago × ${d.n}`,
    });
  } catch (e) {
    // Sólo el código del fallo SMTP: la dirección del socio no va al log.
    const code = (e as { code?: unknown } | null)?.code;
    console.error("[payment-link] email", typeof code === "string" ? code : "unknown");
    // El link se devuelve intacto: sigue siendo válido y el operador puede
    // copiarlo y mandarlo por WhatsApp.
    return {
      error: "No se pudo enviar el email. El link sigue siendo válido: copialo y mandalo por otro medio.",
      link: { url: d.url, amount: d.amount, n: d.n, expiresAt: d.expiresAt, seal: d.seal },
    };
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "payment_link_create",
    entity: "member",
    entityId: member.id,
    detail: { memberId: member.id, n: d.n, amount: d.amount, channel: "email" },
    ip,
  });
  return { link: { url: d.url, amount: d.amount, n: d.n, expiresAt: d.expiresAt, seal: d.seal }, emailed: true };
}
