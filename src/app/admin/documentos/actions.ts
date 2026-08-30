"use server";
// ABM de documentos institucionales. Cada action de este archivo es un endpoint
// HTTP público: Next NO despacha una server action por su URL sino por el id del
// encabezado `Next-Action` contra un manifiesto global del build, así que ni el
// proxy (matcher `/admin/:path*`) ni el chequeo de rol de `admin/layout.tsx`
// corren acá. Ver el encabezado de `@/lib/auth/require-admin`. El
// `requireAdmin()` que abre cada función no es ceremonia: es el único control
// que hay.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { documentFormSchema } from "@/lib/institutional-documents/schema";
import {
  duplicateYearMessage,
  prepareDocumentInput,
  requiresYear,
} from "@/lib/institutional-documents/rules";
import {
  deleteInstitutionalDocument,
  saveInstitutionalDocument,
} from "@/lib/institutional-documents/storage";
// Import de LECTURA: unique-violation.ts sabe que con @prisma/adapter-mariadb
// el nombre del unique violado no viaja en meta.target. No se modifica.
import { isUniqueViolation } from "@/lib/treasury/unique-violation";
import { tabForType } from "@/lib/admin/documentos-tabs";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (es un endpoint).
async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el resto del panel: las demás cabeceras de IP las
  // puede fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Mensajes en castellano a propósito: un `id` ausente, "abc" o "1.5" son
// tráfico esperable en un endpoint público, y el texto que devuelve zod por
// defecto terminaría en pantalla tal cual.
const idSchema = z.object({
  id: z.coerce.number("Documento inválido.").int("Documento inválido.").positive("Documento inválido."),
});

// El File NO pasa por parseForm (descarta no-strings a propósito): se lee
// directo del FormData. Devuelve undefined si el input vino vacío.
function fileFrom(formData: FormData): File | undefined {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return undefined;
  return file;
}

const NOT_FOUND = "El documento no existe.";
const FILE_REQUIRED = "Elegí el archivo PDF.";
const SAVE_FAILED = "No pudimos guardar el archivo. Probá de nuevo en unos minutos.";

// `saveInstitutionalDocument` DEVUELVE `{ok:false,error}` con texto mostrable
// para lo que el operador puede arreglar (archivo vacío, más de 10 MB, no es un
// PDF) y TIRA los errores del filesystem, cuyo `message` lleva la ruta absoluta
// de UPLOADS_DIR: ese va al log, nunca a la pantalla (mismo criterio que
// `asociate/actions.ts`).
async function storeDocument(
  file: File,
): Promise<{ ok: true; fileName: string; size: number } | { ok: false; error: string }> {
  try {
    return await saveInstitutionalDocument(file);
  } catch (err) {
    console.error("[documentos] no se pudo guardar el PDF", err);
    return { ok: false, error: SAVE_FAILED };
  }
}

// Borrado que no puede tumbar el flujo: con la base ya escrita y auditada, un
// EACCES del filesystem solo deja un huérfano benigno en disco, mientras que
// dejar propagar el error le daría al operador un crash por una operación que
// en realidad funcionó, y de paso saltearía el `redirect`.
async function deleteDocBestEffort(fileName: string): Promise<void> {
  try {
    await deleteInstitutionalDocument(fileName);
  } catch (err) {
    console.error("[documentos] no se pudo borrar el archivo", fileName, err);
  }
}

type ActionState = { error?: string };

export async function createDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(documentFormSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const prepared = prepareDocumentInput({
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description,
    year: parsed.data.year,
    featured: parsed.data.featured === "on",
  });
  if (!prepared.ok) return { error: prepared.error };
  const file = fileFrom(formData);
  if (!file) return { error: FILE_REQUIRED };
  const saved = await storeDocument(file);
  if (!saved.ok) return { error: saved.error };

  const ip = await clientIp();
  const d = prepared.data;
  let docId: number;
  try {
    // La transacción hace que apagar la destacada anterior y crear la nueva
    // sean un solo commit: no hay estado intermedio visible con dos destacadas,
    // ni queda una norma apagada si el INSERT falla. Lo que NO cubre es la
    // carrera: `updateMany` no bloquea el insert fantasma de una transacción
    // concurrente, así que dos altas simultáneas de norma destacada podrían
    // terminar las dos en `true`. Es inherente a sostener la invariante sin un
    // unique —imposible en MySQL: `false` no es `NULL`— y con el volumen real
    // (un alta ocasional desde el panel) esa ventana es inalcanzable.
    // Sin llamadas de red adentro (regla del proyecto).
    docId = await prisma.$transaction(async (tx) => {
      if (d.featured) {
        await tx.institutionalDocument.updateMany({
          where: { type: "norm", featured: true },
          data: { featured: false },
        });
      }
      const doc = await tx.institutionalDocument.create({
        data: {
          type: d.type,
          title: d.title,
          description: d.description,
          year: d.year,
          yearKey: d.yearKey,
          fileName: saved.fileName,
          // El tamaño que se persiste es el que DEVOLVIÓ el store (bytes
          // realmente escritos): `file.size` lo declara el caller y puede mentir.
          size: saved.size,
          featured: d.featured,
          uploadedById: actor.actorId,
        },
      });
      return doc.id;
    });
  } catch (e) {
    // El PDF ya está en disco: si el INSERT falló, no dejar el huérfano.
    // Best-effort a propósito: si el unlink fallara (EACCES), su excepción
    // reemplazaría al error de acá y el operador vería un crash genérico en
    // lugar de "ya hay una Memoria 2025 cargada", que es lo accionable.
    await deleteDocBestEffort(saved.fileName);
    if (isUniqueViolation(e) && requiresYear(d.type) && d.year !== null) {
      return { error: duplicateYearMessage(d.type, d.year) };
    }
    throw e;
  }
  // El asiento va FUERA del try: adentro, un error suyo caería en el catch de
  // arriba y borraría el archivo de una fila que quedó creada — justo la
  // corrupción que ese catch previene.
  await audit({
    userId: actor.actorId,
    action: "institutional_document_create",
    entity: "institutional_document",
    entityId: docId,
    detail: { type: d.type, title: d.title, year: d.year, featured: d.featured },
    ip,
  });
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/documentos?tab=${tabForType(d.type)}`);
}

export async function updateDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsedId = parseForm(idSchema, formData);
  if (!parsedId.ok) return { error: parsedId.error };
  const parsed = parseForm(documentFormSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const existing = await prisma.institutionalDocument.findUnique({
    where: { id: parsedId.data.id },
  });
  if (!existing) return { error: NOT_FOUND };

  // El tipo es inmutable en edición: cambiar una memoria a norma reescribiría
  // título y unicidad por atrás. Se ignora el `type` posteado y manda la fila.
  const prepared = prepareDocumentInput({
    type: existing.type,
    title: parsed.data.title,
    description: parsed.data.description,
    year: parsed.data.year,
    featured: parsed.data.featured === "on",
  });
  if (!prepared.ok) return { error: prepared.error };
  const d = prepared.data;

  // Archivo: uno nuevo reemplaza; sin archivo, queda el actual.
  let fileName = existing.fileName;
  let size = existing.size;
  let newFile: string | null = null;
  const file = fileFrom(formData);
  if (file) {
    const saved = await storeDocument(file);
    if (!saved.ok) return { error: saved.error };
    newFile = saved.fileName;
    fileName = saved.fileName;
    size = saved.size;
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (d.featured && !existing.featured) {
        await tx.institutionalDocument.updateMany({
          where: { type: "norm", featured: true, id: { not: existing.id } },
          data: { featured: false },
        });
      }
      await tx.institutionalDocument.update({
        where: { id: existing.id },
        data: {
          title: d.title,
          description: d.description,
          year: d.year,
          yearKey: d.yearKey,
          fileName,
          size,
          featured: d.featured,
        },
      });
    });
  } catch (e) {
    if (newFile) await deleteDocBestEffort(newFile);
    if (isUniqueViolation(e) && requiresYear(d.type) && d.year !== null) {
      return { error: duplicateYearMessage(d.type, d.year) };
    }
    throw e;
  }
  // Fuera del try, por lo mismo que en el alta: un error del asiento no puede
  // caer en el catch que borra el archivo nuevo.
  await audit({
    userId: actor.actorId,
    action: "institutional_document_update",
    entity: "institutional_document",
    entityId: existing.id,
    detail: {
      type: d.type,
      title: d.title,
      year: d.year,
      featured: d.featured,
      replacedFile: newFile !== null,
    },
    ip: await clientIp(),
  });
  // Recién acá, con la fila actualizada y auditada, se borra el PDF anterior:
  // al revés, un UPDATE fallido dejaría la fila apuntando a un archivo que ya
  // no está.
  if (newFile && existing.fileName !== fileName) {
    await deleteDocBestEffort(existing.fileName);
  }
  redirect(`/admin/documentos?tab=${tabForType(existing.type)}`);
}

export async function deleteDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.institutionalDocument.findUnique({
    where: { id: parsed.data.id },
  });
  if (!existing) return { error: NOT_FOUND };
  await prisma.institutionalDocument.delete({ where: { id: existing.id } });
  // El asiento va ANTES de tocar el disco: `deleteInstitutionalDocument`
  // propaga lo que no sea ENOENT, y con el orden al revés esa excepción se
  // llevaría puesto el asiento de un borrado que ya ocurrió en la base. El
  // orden garantiza que el asiento se INTENTE, no que exista: `audit()` es
  // best-effort y se traga sus errores.
  await audit({
    userId: actor.actorId,
    action: "institutional_document_delete",
    entity: "institutional_document",
    entityId: existing.id,
    detail: { type: existing.type, title: existing.title, year: existing.year },
    ip: await clientIp(),
  });
  // Recién con la fila borrada se saca el archivo: al revés dejaría un
  // documento vivo apuntando a un PDF que no está.
  await deleteDocBestEffort(existing.fileName);
  redirect(`/admin/documentos?tab=${tabForType(existing.type)}`);
}
