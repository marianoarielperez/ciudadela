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
import {
  buildSelfAddressPatch,
  selfAddressSchema,
  selfContactSchema,
} from "@/lib/members/self-edit";
import { memberWriter } from "@/lib/members/write";
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
