"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { civilDateUtc } from "@/lib/dates";
import {
  makeMinuteEditor, MinuteEditError, minuteEditAuditDetail, minuteEditSchema,
  parseMinuteDate,
} from "@/lib/members/minute-edit";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (es un endpoint). El editor se arma acá, contra el singleton,
// y la regla vive en `@/lib/members/minute-edit` — testeada sin base.
const minuteEditor = makeMinuteEditor(prisma);

async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el login: el resto de las cabeceras de IP las puede
  // fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

const schema = z.object({
  type: z.enum(["board", "assembly"], { error: "Elegí el tipo de acta." }),
  number: z.coerce.number().int().positive("Número de acta inválido"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  description: z.string().max(500).optional(),
});

export async function createMinuteAction(
  _prev: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { type, number, date, description } = parsed.data;
  const [y, m, d] = date.split("-").map(Number);
  const ip = await clientIp();
  const userId = actor.actorId;
  try {
    const minute = await prisma.minute.create({
      data: { type, number, date: civilDateUtc(y, m, d), description: description ?? null, createdById: userId },
    });
    await audit({ userId, action: "minute_create", entity: "minute", entityId: minute.id, detail: { type, number }, ip });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: `Ya existe el acta N° ${number} de ese tipo.` };
    }
    throw e;
  }
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect("/admin/actas");
}

/** Edición de un acta ya asentada. El QUÉ se puede tocar y por qué está en
 *  `@/lib/members/minute-edit` (fecha bloqueada con movimientos por REG-11,
 *  colisión de `UNIQUE(type, number)` en castellano, y por qué no hay borrado).
 *  Acá quedan la sesión, la auditoría y la navegación. */
export async function updateMinuteAction(
  _prev: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(minuteEditSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { minuteId, type, number, date, description } = parsed.data;

  let result;
  try {
    result = await minuteEditor.update(minuteId, {
      type, number, date: parseMinuteDate(date), description: description ?? null,
    });
  } catch (e) {
    // `MinuteEditError` ya trae el mensaje redactado por la capa que conoce la
    // regla; cualquier otra cosa es un error técnico y sube.
    if (e instanceof MinuteEditError) return { error: e.message };
    throw e;
  }

  // Editar un acta es tocar el libro que la asociación presenta ante la IGJ: el
  // asiento dice quién, cuándo, desde dónde y —campo por campo— de qué a qué.
  // La descripción va sólo por nombre (ver `minuteEditAuditDetail`).
  if (result.changed.length > 0) {
    await audit({
      userId: actor.actorId, action: "minute_update", entity: "minute", entityId: minuteId,
      detail: minuteEditAuditDetail(result.before, result.after, result.changed),
      ip: await clientIp(),
    });
  }
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/actas/${minuteId}`);
}
