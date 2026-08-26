"use server";
// La carga PRESENCIAL de una presentación: el vecino se acercó a la sede y el
// operador carga por él los mismos datos y los mismos documentos.
//
// El Art. 9° bis a) admite el re-empadronamiento "en forma presencial o
// electrónica", así que esto no es una comodidad: es la mitad del trámite para
// la parte de la cohorte que no usa internet, que en este padrón es la mayoría.
//
// Dos reglas que gobiernan este archivo:
//
//  1. EL QUE CARGA NO VALIDA EN EL MISMO ACTO. La presentación queda
//     `submitted` y entra a la misma cola que las de la web; la revisa otra
//     persona. Son cuatro ojos, y por eso acá no hay ni un camino que escriba
//     en la ficha del socio.
//  2. EL EMAIL ES OBLIGATORIO TAMBIÉN ACÁ (decisión 4 del diseño). No es una
//     validación de formulario heredada de la web: el re-empadronamiento
//     constituye el domicilio electrónico del Art. 5° ter, que es por donde la
//     asociación notifica una observación y, llegado el caso, la baja. Quien lo
//     hace cumplir es `presentationDataComplete`, la MISMA función pura que usa
//     el wizard — este es justamente el camino que no pasa por el `dataSchema`
//     del formulario público.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { documentStore, MAX_DOCUMENT_BYTES } from "@/lib/documents/storage";
import { mailer } from "@/lib/email";
import { presentationReceivedEmail } from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { PRESENTATIONS_BASE } from "@/lib/admin/presentation-queue";
import { civilTodayAr } from "@/lib/applications/wizard";
import { presentations, PRESENTATION_MAX_ANNEXES } from "@/lib/reregistration/presentation";
import { presentationResumeUrl } from "@/lib/reregistration/resume-link";
import { prisma } from "@/lib/prisma";
import type { DocumentType } from "@/generated/prisma/client";

const BASE = "/admin/reempadronamiento/presencial";
const DOC_TYPES = ["dni_front", "dni_back", "annex"] as const satisfies readonly DocumentType[];
const BAD_BIRTH_DATE = "La fecha de nacimiento no es válida.";

/** El registro exitoso NO vuelve por acá: termina en un `redirect` al buscador
 *  con el resultado en la URL (ver el final de `registerInPersonAction`). Este
 *  estado es sólo para el rechazo. */
export type InPersonState = { error?: string };
export type InPersonUploadState = { error?: string; uploaded?: string };

async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Del error sólo el CÓDIGO: los de nodemailer traen el sobre SMTP con la
// dirección en claro y los del sistema de archivos traen la ruta absoluta de
// UPLOADS_DIR. El log de PM2 no está cubierto por docs/08 (Ley 25.326).
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Documentos
// ─────────────────────────────────────────────────────────────────────────────

export async function uploadInPersonDocumentAction(
  _prev: InPersonUploadState,
  formData: FormData,
): Promise<InPersonUploadState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const presentationId = Number(formData.get("presentationId"));
  if (!Number.isInteger(presentationId) || presentationId <= 0) {
    return { error: "Presentación inválida." };
  }
  // El mismo veredicto que usa el registro: no se acepta un archivo para algo
  // que la Comisión ya resolvió ni para un proceso cuyo plazo venció.
  const open = await presentations.openForCounter(presentationId);
  if (!open.ok) return { error: open.error };

  const docType = String(formData.get("docType") ?? "");
  if (!(DOC_TYPES as readonly string[]).includes(docType)) {
    return { error: "Tipo de documento inválido." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí un archivo." };
  // El tope se chequea acá ADEMÁS de en el store: sin esto, un archivo de 30 MB
  // se lee entero a memoria antes de que nadie lo rechace.
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: "El archivo supera el máximo de 10 MB. Probá con una foto de menor calidad." };
  }

  // El tope de anexos vive acá y no en el store: los otros dos tipos se
  // REEMPLAZAN (volver a subir el frente no acumula versiones). Se cuenta
  // contra la base y no contra una vista previa, por lo mismo que en el wizard:
  // dos subidas simultáneas leen el mismo número.
  if (docType === "annex") {
    const annexes = await prisma.document.count({
      where: { ownerType: "presentation", ownerId: presentationId, type: "annex" },
    });
    if (annexes >= PRESENTATION_MAX_ANNEXES) {
      return { error: `Ya hay ${PRESENTATION_MAX_ANNEXES} anexos cargados en esta presentación.` };
    }
  }

  try {
    await documentStore.savePresentationDocument({
      presentationId,
      type: docType as (typeof DOC_TYPES)[number],
      data: Buffer.from(await file.arrayBuffer()),
    });
  } catch (e) {
    const code = codeOf(e);
    if (code !== "unknown") {
      console.error("[presencial] falló el guardado del documento", presentationId, "code:", code);
      return { error: "No se pudo guardar el archivo. Probá de nuevo en unos minutos." };
    }
    // El store tira mensajes en castellano para lo que SÍ se puede arreglar
    // (formato no admitido, archivo vacío o de más de 10 MB).
    return { error: e instanceof Error ? e.message : "No se pudo guardar el archivo." };
  }

  await audit({
    userId: actor.actorId,
    action: "presentation_document_upload",
    entity: "presentation",
    entityId: presentationId,
    detail: { memberId: open.memberId, type: docType, channel: "in_person" },
    ip: await clientIp(),
  });

  revalidatePath(BASE);
  return { uploaded: docType };
}

// ─────────────────────────────────────────────────────────────────────────────
// El registro
// ─────────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// El schema valida FORMA y ANCHOS (los de las columnas). Qué campos son
// obligatorios lo decide `presentationDataComplete` adentro del dominio, que es
// la regla compartida con el wizard: acá todo entra opcional para que el
// operador pueda ver el mensaje del dominio —"Falta el barrio"— en vez de
// dos validaciones distintas diciendo cosas parecidas.
const registerSchema = z.object({
  processId: z.coerce.number().int().positive(),
  memberId: z.coerce.number().int().positive(),
  birthDate: z.string().regex(ISO_DATE, BAD_BIRTH_DATE).optional(),
  civilStatus: z.string().max(40, "El estado civil no puede superar los 40 caracteres").optional(),
  nationality: z.string().max(60, "La nacionalidad no puede superar los 60 caracteres").optional(),
  occupation: z.string().max(80, "La ocupación no puede superar los 80 caracteres").optional(),
  streetId: z.coerce.number().int().positive("Calle inválida.").optional(),
  streetText: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  streetNumber: z.string().max(10, "La altura no puede superar los 10 caracteres").optional(),
  neighborhood: z.string().max(60, "El barrio no puede superar los 60 caracteres").optional(),
  phone: z.string().max(40, "El teléfono no puede superar los 40 caracteres").optional(),
  email: z.email("El email no es válido.").max(191, "El email es demasiado largo").optional(),
});

export async function registerInPersonAction(
  _prev: InPersonState,
  formData: FormData,
): Promise<InPersonState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(registerSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;

  // El día civil ARGENTINO, no el UTC del server: a las 21:30 de acá el server
  // ya está en el día siguiente y una fecha de hoy se rechazaría por futura.
  // `parseCivilDate` es además la guarda compartida contra el "31/02" que
  // `civilDateUtc` rodaría en silencio a otro día.
  const birth = d.birthDate
    ? parseCivilDate(d.birthDate, {
        minYear: 1900,
        maxDate: civilTodayAr(),
        invalidError: BAD_BIRTH_DATE,
        rangeError: "La fecha de nacimiento tiene que estar entre 1900 y hoy.",
      })
    : ({ ok: true, value: null } as const);
  if (!birth.ok) return { error: birth.error };

  if (d.streetId) {
    const street = await prisma.street.findUnique({ where: { id: d.streetId }, select: { id: true } });
    if (!street) return { error: "La calle elegida no existe en el catálogo." };
  }

  const result = await presentations.registerInPerson({
    processId: d.processId,
    memberId: d.memberId,
    actorId: actor.actorId,
    data: {
      birthDate: birth.value,
      civilStatus: d.civilStatus ?? null,
      nationality: d.nationality ?? null,
      occupation: d.occupation ?? null,
      streetId: d.streetId ?? null,
      // Con calle del catálogo el texto libre sobra: dejar los dos daría un
      // domicilio con dos fuentes de verdad (mismo criterio que `buildPatch`).
      streetText: d.streetId ? null : d.streetText ?? null,
      streetNumber: d.streetNumber ?? null,
      neighborhood: d.neighborhood ?? null,
      phone: d.phone ?? null,
      email: d.email?.toLowerCase() ?? null,
    },
  });
  if (!result.ok) return { error: result.error };

  // La constancia, con la misma llave y el mismo orden acuñar → ENVIAR →
  // persistir que el envío por la web. Va también acá porque el enlace es la
  // única forma que tiene el vecino de volver a su presentación si después la
  // Comisión le pide una corrección, y porque el correo es la constancia del
  // plazo. Best-effort: la presentación YA está asentada y `submittedAt` ya es
  // la prueba; un SMTP caído no puede convertir eso en "no se pudo registrar".
  //
  // En una subsanación en el mostrador no se manda nada: la llave que el vecino
  // ya tiene en el buzón sigue viva y una segunda constancia con la fecha
  // original confunde más de lo que aclara.
  let mailed = false;
  if (result.firstSubmission) {
    try {
      const { raw, hash } = presentations.mintResumeToken();
      await mailer.sendToMember({
        memberId: result.memberId,
        to: result.email,
        type: "presentation_received",
        message: presentationReceivedEmail({
          url: presentationResumeUrl(raw),
          submittedAt: result.submittedAt,
        }),
        summary: "constancia de re-empadronamiento",
      });
      await presentations.commitResumeToken(result.presentationId, hash);
      mailed = true;
    } catch (e) {
      console.error("[presencial] falló la constancia", result.presentationId, "code:", codeOf(e));
    }
  }

  await audit({
    userId: actor.actorId,
    action: "presentation_submit",
    entity: "presentation",
    entityId: result.presentationId,
    // Ids y banderas (Ley 25.326): ni el email declarado, ni el domicilio, ni
    // el teléfono que el operador acaba de tipear.
    detail: { memberId: result.memberId, channel: "in_person", mailed, amended: !result.firstSubmission },
    ip: await clientIp(),
  });

  revalidatePath(BASE);
  revalidatePath(PRESENTATIONS_BASE);
  revalidatePath("/admin/reempadronamiento");

  // ── Por qué esto termina en un `redirect` y no en un `{ ok: true }` ────────
  // Al pasar a `submitted`, ESTA ruta deja de mostrar el formulario: su estado
  // vacío pasa a decir "ya está presentada". Y toda server action devuelve el
  // árbol re-renderizado de la ruta actual, así que el mensaje de éxito que
  // viviera en el formulario se iría con él en el mismo instante en que la
  // carga sale bien: el operador leería algo que parece un rechazo justo
  // después de acertar (medido en el navegador, 26/08/2026).
  //
  // Así que se vuelve al BUSCADOR, que es donde el operador tiene que estar
  // —atrás hay otro vecino esperando— con el resultado en la URL. `registrada`
  // lleva el id para poder enlazar la presentación; `correo=falla` es el aviso
  // de que la constancia no salió, que es accionable (la dirección puede estar
  // mal tipeada y es el domicilio electrónico del socio).
  //
  // Fuera de cualquier `try`: `redirect()` señaliza con una excepción.
  const query = new URLSearchParams({ registrada: String(result.presentationId) });
  if (result.firstSubmission && !mailed) query.set("correo", "falla");
  redirect(`${BASE}?${query.toString()}`);
}
