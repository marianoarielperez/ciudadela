// Retención de Reportes (spec §2 y §9, docs/08): las imágenes del DNI de un
// vecino se conservan 360 días después de que el reporte se presenta o se
// desestima, y después se borran; un borrador que nunca se envió se borra a
// las 48 h con su carpeta. Corre como paso del cron del digest (todos los días).
//
// Un fallo de disco en un reporte se cuenta y se sigue: la purga de los demás
// no puede depender de un archivo que ya no está. Se audita SÓLO cuando hubo
// algo que purgar: la auditoría es el rastro de un hecho, no un latido.
import type { PrismaClient } from "@/generated/prisma/client";
import { audit as auditReal, type AuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { DNI_RETENTION_DAYS, DRAFT_TTL_HOURS } from "./rules";
import { reportFileStore, type ReportFileStore } from "./storage";

export type RetentionSummary = { dniPurged: number; draftsPurged: number; errors: number };

/** Tope de filas por corrida y por paso. La purga es IDEMPOTENTE y corre todos
 *  los días (`dniPurgedAt` estampado y el borrador borrado no vuelven a
 *  aparecer), así que un atraso se drena solo en noches consecutivas. El tope
 *  existe por tiempo: esto corre ANTES del digest, dentro de la ventana de 60 s
 *  del proxy, y cada fila son varios unlink más un update. */
export const PURGE_BATCH = 200;

// El log lleva el id numérico y el CÓDIGO del fallo, nunca la ruta: los errores
// de fs traen la ruta absoluta en `message` (Ley 25.326).
function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code !== "" ? code : e instanceof Error ? e.name : "unknown";
}

export function makeReportRetention(deps: {
  db: Pick<PrismaClient, "report">;
  store: Pick<ReportFileStore, "deleteFiles" | "deleteReportDir">;
  audit: (entry: AuditEntry) => Promise<void>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return {
    async purge(): Promise<RetentionSummary> {
      const at = now();
      const summary: RetentionSummary = { dniPurged: 0, draftsPurged: 0, errors: 0 };

      // `dniPurgedAt: null` no es cosmética: sin ese filtro una fila ya purgada
      // se volvería a mirar en cada corrida diaria, para siempre.
      const dniCutoff = new Date(at.getTime() - DNI_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const expired = await deps.db.report.findMany({
        where: {
          status: { in: ["filed", "dismissed"] },
          dniPurgedAt: null,
          OR: [{ filedAt: { lte: dniCutoff } }, { dismissedAt: { lte: dniCutoff } }],
        },
        select: { id: true },
        take: PURGE_BATCH,
      });
      for (const r of expired) {
        try {
          await deps.store.deleteFiles(r.id, ["dni_front", "dni_back"]);
          await deps.db.report.updateMany({ where: { id: r.id }, data: { dniPurgedAt: at } });
          summary.dniPurged++;
        } catch (e) {
          summary.errors++;
          console.error("[reports] no se pudo purgar el DNI del reporte", r.id, "code:", codeOf(e));
        }
      }

      const draftCutoff = new Date(at.getTime() - DRAFT_TTL_HOURS * 60 * 60 * 1000);
      const drafts = await deps.db.report.findMany({
        where: { status: "draft", createdAt: { lte: draftCutoff } },
        select: { id: true },
        take: PURGE_BATCH,
      });
      for (const r of drafts) {
        try {
          await deps.store.deleteReportDir(r.id);
          await deps.db.report.delete({ where: { id: r.id } }); // Cascade borra report_files
          summary.draftsPurged++;
        } catch (e) {
          summary.errors++;
          console.error("[reports] no se pudo purgar el borrador", r.id, "code:", codeOf(e));
        }
      }

      if (summary.dniPurged > 0 || summary.draftsPurged > 0 || summary.errors > 0) {
        await deps.audit({ action: "report_retention_purge", entity: "cron", detail: summary });
      }
      return summary;
    },
  };
}

export const reportRetention = makeReportRetention({
  db: prisma,
  store: reportFileStore,
  audit: auditReal,
});
