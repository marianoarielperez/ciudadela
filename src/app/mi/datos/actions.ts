"use server";
// Edición de los datos PROPIOS del socio (spec M5 §8). Tres invariantes:
//  - El memberId sale de requireMember(), nunca del formulario.
//  - El suspendido no edita (REG-20): requireMember() SIN allowSuspended.
//  - La lista blanca de campos vive en @/lib/members/self-edit; la escritura
//    pasa por memberWriter.updateMember, que arrastra las invariantes de
//    tokens y de la cuenta de acceso.
// Auditoría (Ley 25.326): nombres de campo y flags, nunca los valores.
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { memberEditLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import { accountEmailNotice } from "@/lib/members/account-email-notice";
import {
  buildSelfAddressPatch,
  selfAddressSchema,
  selfContactSchema,
  selfEmailSchema,
} from "@/lib/members/self-edit";
import { MemberWriteError, memberWriter, sameAddress } from "@/lib/members/write";
import { prisma } from "@/lib/prisma";

export type SelfEditState = { error?: string; done?: boolean; message?: string; warning?: string };

const RATE_MSG = "Demasiados cambios seguidos. Esperá un minuto y volvé a probar.";

async function auditSelf(
  userId: number,
  memberId: number,
  fields: string[],
  extra?: Record<string, unknown>,
) {
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId,
    action: "member_self_update",
    entity: "member",
    entityId: memberId,
    detail: { fields, ...extra },
    ip,
  });
}

export async function updateContactAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfContactSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  await memberWriter.updateMember(actor.memberId, { phone: parsed.data.phone?.trim() || null });
  await auditSelf(actor.userId, actor.memberId, ["phone"]);
  return { done: true, message: "Teléfono guardado." };
}

export async function updateAddressAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfAddressSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const patch = buildSelfAddressPatch(parsed.data);
  if (patch.streetId !== null) {
    // El id viaja oculto desde el autocompletado, pero una action es un
    // endpoint: un id fuera del catálogo no se escribe.
    const street = await prisma.street.findUnique({
      where: { id: patch.streetId },
      select: { id: true },
    });
    if (!street) return { error: "Elegí una calle del catálogo o escribila como texto." };
  }
  await memberWriter.updateMember(actor.memberId, patch);
  await auditSelf(actor.userId, actor.memberId, ["street", "streetNumber", "neighborhood"], {
    addressPendingReview: true,
  });
  return {
    done: true,
    message: "Domicilio guardado. La Comisión va a constatar el cambio (queda anotado en tu ficha).",
  };
}

export async function changeEmailAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfEmailSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const email = parsed.data.email.toLowerCase().trim();

  const before = await prisma.member.findUniqueOrThrow({
    where: { id: actor.memberId },
    select: { email: true },
  });
  if (sameAddress(before.email, email)) return { error: "Ese ya es tu email actual." };

  // memberWriter arrastra las invariantes: revoca los enlaces viejos y le lleva
  // la dirección a la cuenta de acceso (User.email) en la misma transacción.
  let result;
  try {
    result = await memberWriter.updateMember(actor.memberId, {
      email,
      emailStatus: "declared", // REG-08: toda dirección nueva se re-verifica
      emailVerifiedAt: null,
    });
  } catch (e) {
    if (e instanceof MemberWriteError) {
      // El texto de write.ts habla en voz de operador; acá se traduce a voz de
      // vecino sin revelar de quién es la otra cuenta (criterio de access.ts).
      return {
        error:
          e.reason === "email_conflict"
            ? "Ese email ya está en uso en el sistema. Escribí otra dirección o consultá en la sede."
            : "No se pudo guardar el email. Consultá en la sede.",
      };
    }
    throw e;
  }

  // Post-commit: el aviso a la casilla anterior + la verificación a la nueva.
  // announce() decide solo, con los mismos cupos que el botón del panel admin.
  let warning: string | undefined;
  if (result.accountEmailMove) {
    const fresh = await prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: { id: true, status: true, email: true, emailStatus: true, userId: true },
    });
    const outcome = await accountEmailNotice.announce({
      member: fresh,
      previousEmail: result.accountEmailMove.from,
      actorId: actor.userId,
    });
    if (!outcome.verificationSent) {
      warning = outcome.throttled
        ? "El cambio se guardó, pero ya te mandamos varios correos en la última hora: la verificación te va a llegar cuando la pidas de nuevo más tarde."
        : "El cambio se guardó, pero no pudimos mandarte el correo de verificación. Probá más tarde o consultá en la sede.";
    }
  }
  await auditSelf(actor.userId, actor.memberId, ["email"], {
    accountEmailUpdated: result.accountEmailUpdated,
  });
  return {
    done: true,
    message:
      "Email guardado. A partir de ahora ingresás con la dirección nueva; te mandamos un correo para verificarla.",
    warning,
  };
}
