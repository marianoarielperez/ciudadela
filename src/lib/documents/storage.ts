// Documentos personales del wizard (DNI, anexos). Guardado FUERA de public/
// (UPLOADS_DIR, docs/08); el archivo se valida por MAGIC BYTES, nunca por
// extensión ni por el Content-Type que declare el cliente. Se sirve solo por
// la ruta autenticada de admin (Task 16).
//
// Este módulo importa node:fs — NO lo importes desde un client component.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DocumentType, PrismaClient } from "@/generated/prisma/client";
// Misma raíz que las portadas de noticias: `uploadsDir()` ya resuelve
// UPLOADS_DIR (dev: ./uploads) y es el único lugar donde vive ese default.
import { uploadsDir } from "@/lib/news/images";
import { prisma } from "@/lib/prisma";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB (spec M3 §2)

export function sniffDocument(
  buf: Buffer,
): { ext: "jpg" | "png" | "webp" | "pdf"; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: "png", mime: "image/png" };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { ext: "pdf", mime: "application/pdf" };
  }
  return null;
}

export function makeDocumentStore(db: Pick<PrismaClient, "document">, rootDir?: string) {
  // Se resuelve por llamada, no al construir: el store es un singleton de
  // módulo y UPLOADS_DIR puede no estar leída todavía cuando se evalúa.
  const root = () => rootDir ?? uploadsDir();
  // El cuerpo COMPARTIDO por los dos dueños de documentos que hoy existen: la
  // solicitud de alta y la presentación de re-empadronamiento (M6). Las dos
  // guardan igual —mismos magic bytes, mismo tope, misma regla de reemplazo—
  // y lo único que cambia es la carpeta, el `ownerType` y cómo se llama el id
  // en el mensaje de error.
  //
  // Se factorizó en vez de copiarse: la parte delicada es el reemplazo
  // best-effort de más abajo (la carrera de dos subidas del mismo tipo), y de
  // esa clase de código no puede haber dos versiones que diverjan en silencio.
  async function saveOwned(input: {
    ownerType: "application" | "presentation";
    ownerId: number;
    folder: string;
    /** Cómo nombrar al dueño en el mensaje del id inválido. */
    ownerLabel: string;
    type: DocumentType;
    data: Buffer;
  }): Promise<{ id: number }> {
    if (input.data.length === 0 || input.data.length > MAX_DOCUMENT_BYTES) {
      throw new Error("El archivo supera el máximo de 10 MB o está vacío.");
    }
    // La ruta se arma con este id: un NaN o un string con "../" escaparía de
    // UPLOADS_DIR. El tipo `number` es promesa de compilación, no garantía de
    // runtime (un caller en JS puro, un `as any`, un Number(searchParams)).
    if (!Number.isInteger(input.ownerId) || input.ownerId <= 0) {
      throw new Error(`${input.ownerLabel} inválida.`);
    }
    const kind = sniffDocument(input.data);
    if (!kind) throw new Error("Formato no admitido: subí una foto JPG/PNG/WebP o un PDF.");

    const relative = path.posix.join(
      input.folder,
      String(input.ownerId),
      `${randomUUID()}.${kind.ext}`,
    );
    const absolute = path.join(root(), relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.data);

    const previous =
      input.type === "annex"
        ? null
        : await db.document.findFirst({
            where: {
              ownerType: input.ownerType,
              ownerId: input.ownerId,
              type: input.type,
            },
          });
    const created = await db.document.create({
      data: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        type: input.type,
        path: relative,
        mime: kind.mime,
        size: input.data.length,
      },
    });
    if (previous) {
      // Best-effort COMPLETO: si dos subidas del mismo tipo entran a la vez,
      // las dos leen el mismo `previous` y la segunda encuentra la fila ya
      // borrada (P2025). Eso no puede convertirse en "no pudimos guardar el
      // archivo" para un documento que sí quedó guardado: `deleteMany` no
      // falla si no hay nada que borrar, y el unlink de un archivo ya borrado
      // tampoco importa.
      //
      // Lo que esto NO hace es serializar: de esa carrera pueden quedar DOS
      // filas del mismo `type` (las dos con foto nueva, así que el admin ve
      // duplicado, nunca un documento viejo resucitado). El arreglo de fondo
      // es un unique sobre `(ownerType, ownerId, type)` para los tipos que no
      // son `annex` —los anexos son varios a propósito—, y eso pide migración.
      try {
        await db.document.deleteMany({ where: { id: previous.id } });
        await unlink(path.join(root(), previous.path));
      } catch {
        /* best-effort: la fila nueva ya está */
      }
    }
    return { id: created.id };
  }

  return {
    // Reemplaza el documento anterior del mismo tipo: re-subir el frente del
    // DNI no acumula versiones (el vecino corrigió una foto movida). Los
    // anexos NO se reemplazan: son hasta 2 documentos distintos bajo el mismo
    // `type` (el tope lo aplica la action del wizard). El borrado del archivo
    // viejo es best-effort: un unlink fallido no puede dejar la solicitud sin
    // su documento nuevo.
    saveApplicationDocument(input: {
      applicationId: number;
      type: DocumentType;
      data: Buffer;
    }): Promise<{ id: number }> {
      return saveOwned({
        ownerType: "application",
        ownerId: input.applicationId,
        folder: "applications",
        ownerLabel: "Solicitud",
        type: input.type,
        data: input.data,
      });
    },

    /** La misma operación para el re-empadronamiento del Art. 9° bis (M6): los
     *  documentos cuelgan de la PRESENTACIÓN y no de la ficha del socio, porque
     *  hasta que la Comisión valide, lo que el vecino subió es una declaración
     *  suya y no un dato del padrón. */
    savePresentationDocument(input: {
      presentationId: number;
      type: DocumentType;
      data: Buffer;
    }): Promise<{ id: number }> {
      return saveOwned({
        ownerType: "presentation",
        ownerId: input.presentationId,
        folder: "presentations",
        ownerLabel: "Presentación",
        type: input.type,
        data: input.data,
      });
    },

    async readDocumentFile(doc: { path: string }): Promise<Buffer> {
      return readFile(path.join(root(), doc.path));
    },
  };
}

export const documentStore = makeDocumentStore(prisma);
