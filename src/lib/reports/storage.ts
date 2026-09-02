// Archivos de un reporte (spec §7-§8): las dos caras del DNI y hasta dos fotos.
// FUERA de public/ (UPLOADS_DIR/reports/{reportId}/, cubierta por backup.sh sin
// tocarlo), validados por MAGIC BYTES y re-codificados por sharp ANTES de tocar
// el disco: lo que se escribe es siempre un JPEG sin metadatos.
//
// Tabla propia (`report_files`) y no `Document`: ver el comentario del modelo.
// Este módulo importa node:fs y sharp — NO importarlo desde un client component.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient, ReportFileKind } from "@/generated/prisma/client";
import { uploadsDir } from "@/lib/news/images";
import { prisma } from "@/lib/prisma";
import {
  DNI_MAX_SIDE,
  MAX_IMAGE_BYTES,
  PHOTO_MAX_SIDE,
  processImage,
  sniffImage,
} from "./images";
import { MAX_PHOTOS } from "./rules";

export const REPORT_FILE_MESSAGES = {
  size: "El archivo supera el máximo de 10 MB o está vacío.",
  format: "Formato no admitido: subí una foto JPG, PNG o WebP.",
  photos: `Ya subiste las ${MAX_PHOTOS} fotos permitidas. Quitá una para cambiarla.`,
  broken: "No pudimos leer la imagen. Probá con otra foto.",
} as const;

/** Los rechazos INTENCIONALES del store (los cinco textos de arriba y el id
 *  inválido) viajan con este tipo: el llamador puede mostrarle `userMessage` al
 *  vecino sin adivinar. Un error crudo de fs —que trae la ruta absoluta en el
 *  `message` (Ley 25.326)— NO es de esta clase y se propaga tal cual. */
export class ReportFileError extends Error {
  readonly userMessage: string;
  constructor(message: string) {
    super(message);
    this.name = "ReportFileError";
    this.userMessage = message;
  }
}

/** El texto que se le muestra al vecino: el nuestro si el rechazo fue nuestro,
 *  el genérico si el fallo vino de abajo (nunca una ruta ni un `errno`). */
export function userMessageOf(e: unknown, fallback: string): string {
  return e instanceof ReportFileError ? e.userMessage : fallback;
}

export const REPORTS_FOLDER = "reports";

type Db = Pick<PrismaClient, "reportFile">;

export function makeReportFileStore(deps: { db: Db; rootDir?: string }) {
  const { db } = deps;
  // Por llamada, no al construir: UPLOADS_DIR puede no estar leída todavía.
  const root = () => deps.rootDir ?? uploadsDir();

  function assertId(reportId: number) {
    // La ruta se arma con este número: un NaN o un "../" escaparía de UPLOADS_DIR.
    if (!Number.isInteger(reportId) || reportId <= 0) throw new ReportFileError("Reporte inválido.");
  }

  async function unlinkQuiet(relative: string) {
    try {
      await unlink(path.join(root(), relative));
    } catch {
      /* best-effort: la fila ya no está */
    }
  }

  return {
    async save(input: {
      reportId: number;
      kind: ReportFileKind;
      data: Buffer;
    }): Promise<{ id: number; width: number; height: number }> {
      assertId(input.reportId);
      if (input.data.length === 0 || input.data.length > MAX_IMAGE_BYTES)
        throw new ReportFileError(REPORT_FILE_MESSAGES.size);
      if (!sniffImage(input.data)) throw new ReportFileError(REPORT_FILE_MESSAGES.format);
      if (input.kind === "photo") {
        const photos = await db.reportFile.count({
          where: { reportId: input.reportId, kind: "photo" },
        });
        if (photos >= MAX_PHOTOS) throw new ReportFileError(REPORT_FILE_MESSAGES.photos);
      }

      let processed: { data: Buffer; width: number; height: number };
      try {
        processed = await processImage(input.data, {
          maxSide: input.kind === "photo" ? PHOTO_MAX_SIDE : DNI_MAX_SIDE,
        });
      } catch {
        // sharp tira tanto por un archivo roto como por una bomba de
        // descompresión (su tope de píxeles): las dos son "no la pudimos leer".
        throw new ReportFileError(REPORT_FILE_MESSAGES.broken);
      }

      const relative = path.posix.join(
        REPORTS_FOLDER,
        String(input.reportId),
        `${randomUUID()}.jpg`,
      );
      const absolute = path.join(root(), relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, processed.data);

      // El DNI se REEMPLAZA (una cara por reporte); las fotos acumulan.
      const previous =
        input.kind === "photo"
          ? []
          : await db.reportFile.findMany({
              where: { reportId: input.reportId, kind: input.kind },
            });
      const created = await db.reportFile.create({
        data: {
          reportId: input.reportId,
          kind: input.kind,
          path: relative,
          mime: "image/jpeg",
          size: processed.data.length,
          width: processed.width,
          height: processed.height,
        },
      });
      for (const p of previous) {
        // Best-effort completo (mismo criterio que documents/storage.ts): la
        // fila nueva ya está; un unlink fallido no puede dejar el DNI sin subir.
        try {
          await db.reportFile.deleteMany({ where: { id: p.id } });
          await unlinkQuiet(p.path);
        } catch {
          /* best-effort */
        }
      }
      return { id: created.id, width: processed.width, height: processed.height };
    },

    /** Quitar una foto desde el wizard. El `reportId` en el `where` es la guarda
     *  de pertenencia: nunca borra un archivo de otro reporte. */
    async remove(input: { reportId: number; fileId: number }): Promise<boolean> {
      assertId(input.reportId);
      const file = await db.reportFile.findFirst({
        where: { id: input.fileId, reportId: input.reportId },
      });
      if (!file) return false;
      await db.reportFile.deleteMany({ where: { id: file.id } });
      await unlinkQuiet(file.path);
      return true;
    },

    async read(file: { path: string }): Promise<Buffer> {
      return readFile(path.join(root(), file.path));
    },

    /** Borra los archivos de un reporte (todos, o sólo los de los tipos dados).
     *  Lo usa la purga de retención. Devuelve cuántas filas se borraron. */
    async deleteFiles(reportId: number, kinds?: ReportFileKind[]): Promise<number> {
      assertId(reportId);
      const where = kinds ? { reportId, kind: { in: kinds } } : { reportId };
      const files = await db.reportFile.findMany({ where });
      for (const f of files) await unlinkQuiet(f.path);
      const { count } = await db.reportFile.deleteMany({ where });
      return count;
    },

    async deleteReportDir(reportId: number): Promise<void> {
      assertId(reportId);
      await rm(path.join(root(), REPORTS_FOLDER, String(reportId)), {
        recursive: true,
        force: true,
      });
    },
  };
}

export type ReportFileStore = ReturnType<typeof makeReportFileStore>;

export const reportFileStore = makeReportFileStore({ db: prisma });
