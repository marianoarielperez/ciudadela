"use server";
// Rechazo de una solicitud de socio (baja o cambio de categoría) desde la
// bandeja del panel. La única guarda de negocio —sólo actúa sobre `pending`—
// vive en `memberRequests.reject` (Task 4): esta action parsea, llama, audita
// y revalida. El "Aplicar" no tiene action propia: es un link al flujo con
// acta existente (`/admin/socios/{id}/baja` o `/categoria`), que la Task 9
// cablea para que lea `?solicitud=` y marque la solicitud aceptada.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { notifyRequestDecided } from "@/lib/members/member-requests/notify";
import { memberRequests } from "@/lib/members/member-requests/service";

export type RejectState = { error?: string; done?: boolean };

const SOCIOS_REQUESTS_PATH = "/admin/solicitudes/socios";

const rejectSchema = z.object({
  requestId: z.coerce.number().int().positive(),
  note: z.string().max(500, "La nota no puede superar los 500 caracteres").optional(),
});

export async function rejectRequestAction(_prev: RejectState, formData: FormData): Promise<RejectState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(rejectSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const result = await memberRequests.reject({
    requestId: parsed.data.requestId,
    decidedById: actor.actorId,
    note: parsed.data.note,
  });
  if (!result.ok) return { error: result.error };

  // La nota NUNCA va al asiento (Ley 25.326): sólo ids y el tipo, igual que el
  // resto de las auditorías de solicitudes (createWithdrawalRequestAction,
  // cancelRequestAction en /mi/solicitudes/actions.ts).
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "member_request_reject",
    entity: "member",
    entityId: result.memberId,
    detail: { requestId: parsed.data.requestId, type: result.type },
    ip,
  });

  // Best-effort, después de que el asiento de auditoría ya quedó escrito
  // —igual que el resto de los envíos del proyecto, nunca bloquea la
  // escritura principal—: `notifyRequestDecided` traga cualquier error propio.
  await notifyRequestDecided({
    memberId: result.memberId, type: result.type,
    accepted: false, note: parsed.data.note,
  });

  revalidatePath(SOCIOS_REQUESTS_PATH);
  return { done: true };
}
