"use server";
// Solicitudes del socio (M5B, spec §7.1). El memberId sale de requireMember(),
// nunca del formulario; el suspendido no presenta ni retira (REG-20,
// requireMember() SIN allowSuspended en las tres). La regla "una pendiente
// por tipo" y el resto de las guardas de negocio viven en el SERVICIO, bajo
// su mutex — acá solo se parsea, se llama y se audita (ids y flags, nunca el
// texto que escribió el socio, Ley 25.326).
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { MemberCategory } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { memberEditLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import { REQUESTABLE_CATEGORIES } from "@/lib/members/member-requests/rules";
import { memberRequests } from "@/lib/members/member-requests/service";

export type RequestState = { error?: string; done?: boolean; message?: string };

const RATE_MSG = "Demasiados intentos seguidos. Esperá un minuto y volvé a probar.";
const SOLICITUDES_PATH = "/mi/solicitudes";

async function auditRequest(
  userId: number,
  memberId: number,
  action: string,
  detail: Record<string, unknown>,
) {
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({ userId, action, entity: "member", entityId: memberId, detail, ip });
}

// El servicio no valida el largo del motivo y la columna admite 500
// caracteres: el tope vive acá, en el schema, para que un texto largo no
// reviente en Prisma (aviso de la revisión de la tarea anterior).
const messageSchema = z
  .string()
  .max(500, "El motivo no puede superar los 500 caracteres")
  .optional();

const withdrawalSchema = z.object({ message: messageSchema });

export async function createWithdrawalRequestAction(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(withdrawalSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const result = await memberRequests.create({
    memberId: actor.memberId,
    type: "withdrawal",
    message: parsed.data.message,
  });
  if (!result.ok) return { error: result.error };

  await auditRequest(actor.userId, actor.memberId, "member_request_create", {
    type: "withdrawal",
    requestId: result.requestId,
  });
  revalidatePath(SOLICITUDES_PATH);
  return {
    done: true,
    message:
      "Tu solicitud de baja quedó presentada. Es efectiva cuando la Comisión la acepte con acta; mientras tanto podés retirarla.",
  };
}

// REQUESTABLE_CATEGORIES es la única fuente de qué categorías puede pedir un
// socio para sí (rules.ts): el enum del formulario se arma desde ahí para que
// no puedan divergir. El cast es al tipo tupla que z.enum exige para inferir
// literales — el array en sí sigue viniendo de rules.ts.
const categorySchema = z.object({
  requestedCategory: z.enum(REQUESTABLE_CATEGORIES as [MemberCategory, ...MemberCategory[]], {
    error: "Elegí la categoría nueva.",
  }),
  message: messageSchema,
});

export async function createCategoryRequestAction(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(categorySchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const result = await memberRequests.create({
    memberId: actor.memberId,
    type: "category_change",
    requestedCategory: parsed.data.requestedCategory,
    message: parsed.data.message,
  });
  if (!result.ok) return { error: result.error };

  await auditRequest(actor.userId, actor.memberId, "member_request_create", {
    type: "category_change",
    requestId: result.requestId,
  });
  revalidatePath(SOLICITUDES_PATH);
  return {
    done: true,
    message:
      "Tu solicitud de cambio de categoría quedó presentada. Es efectiva cuando la Comisión la acepte con acta; mientras tanto podés retirarla.",
  };
}

const cancelSchema = z.object({ requestId: z.coerce.number().int().positive() });

export async function cancelRequestAction(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(cancelSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const result = await memberRequests.cancel({
    memberId: actor.memberId,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return { error: result.error };

  await auditRequest(actor.userId, actor.memberId, "member_request_cancel", {
    requestId: parsed.data.requestId,
  });
  revalidatePath(SOLICITUDES_PATH);
  return { done: true, message: "Solicitud retirada." };
}
