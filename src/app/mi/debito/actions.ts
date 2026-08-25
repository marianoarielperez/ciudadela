"use server";
// Adhesión y cancelación del débito automático desde el panel del socio (5B,
// Task 13). El memberId sale de requireMember(), nunca del formulario, igual
// que "Pagar ahora" (mi/cuenta/actions.ts).
//
// LAS DOS actions llaman a requireMember() SIN `allowSuspended`: el suspendido
// no adhiere NI cancela (REG-20). Es la PRIMERA barrera — `memberDebit` trae su
// propia defensa en profundidad (chequea `member.status === "active"` antes de
// llamar a MP), pero acá se corta antes, sin tocar el servicio ni la red.
//
// PRIVACIDAD (Ley 25.326): la URL del checkout de Mercado Pago NUNCA va al
// asiento ni a ningún log — mismo precedente que `payment_link_create`
// (mi/cuenta/actions.ts). El asiento de adhesión lleva sólo el memberId; el de
// cancelación, el preapprovalId (no es dato personal, es el id del mandato).
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { memberPayLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import { memberDebit } from "@/lib/members/member-debit";

export type DebitState = { error?: string; redirectUrl?: string; done?: boolean };

const DEBITO_PATH = "/mi/debito";
const RATE_MSG = "Demasiados intentos seguidos. Esperá un minuto y volvé a probar.";

async function auditDebit(userId: number, memberId: number, action: string, detail: Record<string, unknown>) {
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({ userId, action, entity: "member", entityId: memberId, detail, ip });
}

// La firma variádica de `(prev, formData)` la exige `useActionState`, pero acá
// no hay ningún campo que parsear (el memberId sale de `requireMember()`, no
// del form): los dos parámetros existen para tipar, no para leerse.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ver comentario de arriba
export async function startDebitAction(_prev: DebitState, _formData: FormData): Promise<DebitState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  // Cada intento crea un preapproval en MP: mismo criterio que "Pagar ahora"
  // (memberPayLimiter, no un limiter nuevo — es el mismo presupuesto de
  // llamadas a Mercado Pago del socio).
  if (!memberPayLimiter.check(String(actor.memberId))) {
    return { error: RATE_MSG };
  }

  const r = await memberDebit.start({ memberId: actor.memberId });
  if (!r.ok) return { error: r.error };

  await auditDebit(actor.userId, actor.memberId, "member_debit_adhesion", { memberId: actor.memberId });
  return { redirectUrl: r.checkoutUrl };
}

const cancelSchema = z.object({
  preapprovalId: z.string().regex(/^[A-Za-z0-9]{1,64}$/, "Suscripción inválida."),
});

export async function cancelDebitAction(_prev: DebitState, formData: FormData): Promise<DebitState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  // Cancelar también llama a MP: mismo presupuesto.
  if (!memberPayLimiter.check(String(actor.memberId))) {
    return { error: RATE_MSG };
  }
  const parsed = parseForm(cancelSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const r = await memberDebit.cancel({ memberId: actor.memberId, preapprovalId: parsed.data.preapprovalId });
  if (!r.ok) return { error: r.error };

  await auditDebit(actor.userId, actor.memberId, "member_debit_cancel", {
    preapprovalId: parsed.data.preapprovalId,
  });
  revalidatePath(DEBITO_PATH);
  return { done: true };
}
