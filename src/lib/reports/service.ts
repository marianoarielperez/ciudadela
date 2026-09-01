// Única puerta de escritura de `reports` (spec §4, §5). Sin mutex: no hay
// invariante "una viva por vecino"; lo que hay son TRANSICIONES, y cada una es
// un `updateMany` condicional por estado (patrón `tokens.consume`): dos POST
// simultáneos escriben uno solo. Las reglas viven en `rules.ts`; acá sólo se
// resuelven datos reales (los archivos que hay, el borrador que existe).
//
// `db` inyectado y singleton al final, como el resto de los servicios de
// dominio: `@/lib/prisma` tira al evaluarse si falta `DATABASE_URL`, así que un
// test que quiera ejercitar esto no puede depender del import (CLAUDE.md).
import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient, Report, ReportAgency, ReportFile, ReportKind } from "@/generated/prisma/client";
import { currentYearAR } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { isInsideBoundary } from "./boundary";
import { hashClaim, isClaimShaped, mintClaim } from "./claim";
import { REPORT_MESSAGES, validateSubmission } from "./rules";

export type ReportWithFiles = Report & { files: ReportFile[] };
export type Result = { ok: true } | { ok: false; error: string };
export type SubmitResult = { ok: true; id: number } | { ok: false; error: string };

export type ReporterInput = { name: string; dni: string; phone: string; email: string };

type Db = Pick<PrismaClient, "report" | "reportFile">;

/** Los estados que ya no son borrador: lo que el socio ve en su panel y lo que
 *  cuenta la landing como "enviado". Un solo lugar, no un `in` por consulta. */
const SUBMITTED_STATUSES = ["received", "filed", "dismissed"] as const;

/** Inicio del año civil argentino como instante UTC (00:00 AR = 03:00 UTC). */
function yearRangeUtc(now: Date): { gte: Date; lt: Date } {
  const year = currentYearAR(now);
  return { gte: new Date(Date.UTC(year, 0, 1, 3)), lt: new Date(Date.UTC(year + 1, 0, 1, 3)) };
}

export function makeReports(deps: { db: Db; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async startDraft(input: {
      kind: ReportKind;
      anonymous: boolean;
      memberId?: number | null;
      reporter?: ReporterInput | null;
      ip: string;
      userAgent: string;
    }): Promise<{ id: number; claim: string }> {
      const { raw, hash } = mintClaim();
      const created = await db.report.create({
        data: {
          kind: input.kind,
          status: "draft",
          anonymous: input.anonymous,
          memberId: input.memberId ?? null,
          reporterName: input.reporter?.name ?? null,
          reporterDni: input.reporter?.dni ?? null,
          reporterPhone: input.reporter?.phone ?? null,
          reporterEmail: input.reporter?.email ?? null,
          claimTokenHash: hash,
          ip: input.ip,
          userAgent: input.userAgent,
        },
      });
      return { id: created.id, claim: raw };
    },

    /** Por el hash de la llave. Devuelve también los enviados: la pantalla del
     *  retome decide qué mostrar según el estado. Una llave sin forma no llega
     *  a la base. */
    async findByClaim(raw: string): Promise<ReportWithFiles | null> {
      if (!isClaimShaped(raw)) return null;
      return db.report.findUnique({ where: { claimTokenHash: hashClaim(raw) }, include: { files: true } });
    },

    async saveReporter(input: { reportId: number } & ReporterInput): Promise<Result> {
      const { count } = await db.report.updateMany({
        where: { id: input.reportId, status: "draft" },
        data: {
          reporterName: input.name.trim(),
          reporterDni: input.dni.trim(),
          reporterPhone: input.phone.trim(),
          reporterEmail: input.email.trim().toLowerCase(),
        },
      });
      return count === 1 ? { ok: true } : { ok: false, error: REPORT_MESSAGES.notDraft };
    },

    /** El envío. Revalida TODO contra la base con `validateSubmission` —el
     *  wizard sólo apaga botones— y escribe con un updateMany por estado. */
    async submit(input: {
      reportId: number;
      category: string | null;
      subtype: string | null;
      description: string;
      lat: number | null;
      lng: number | null;
      streetId: number | null;
      streetName: string | null;
      addressDetail: string | null;
      scplTicket: string | null;
      consent: boolean;
    }): Promise<SubmitResult> {
      const report = await db.report.findUnique({ where: { id: input.reportId }, include: { files: true } });
      if (!report || report.status !== "draft") return { ok: false, error: REPORT_MESSAGES.notDraft };
      if (!input.consent) return { ok: false, error: "Tenés que aceptar el consentimiento de datos personales." };

      const verdict = validateSubmission({
        kind: report.kind,
        category: input.category,
        subtype: input.subtype,
        description: input.description,
        lat: input.lat,
        lng: input.lng,
        isMember: report.memberId !== null,
        reporter: {
          name: report.reporterName,
          dni: report.reporterDni,
          phone: report.reporterPhone,
          email: report.reporterEmail,
        },
        files: {
          dniFront: report.files.some((f) => f.kind === "dni_front"),
          dniBack: report.files.some((f) => f.kind === "dni_back"),
          photos: report.files.filter((f) => f.kind === "photo").length,
        },
      });
      if (!verdict.ok) return verdict;

      const hasCoords = input.lat !== null && input.lng !== null;
      const at = now();
      const { count } = await db.report.updateMany({
        where: { id: report.id, status: "draft" },
        data: {
          status: "received",
          submittedAt: at,
          consentAt: at,
          category: input.category,
          // La misma normalización que hizo `validateSubmission` para juzgar: una
          // categoría sin tipos guarda NULL, no el `""` de un `<select>` sin elegir.
          subtype: input.subtype?.trim() || null,
          description: input.description.trim(),
          lat: hasCoords ? new Prisma.Decimal(input.lat as number) : null,
          lng: hasCoords ? new Prisma.Decimal(input.lng as number) : null,
          outsideBoundary: hasCoords ? !isInsideBoundary(input.lat as number, input.lng as number) : false,
          streetId: input.streetId,
          streetName: input.streetName?.trim() || null,
          addressDetail: input.addressDetail?.trim() || null,
          scplTicket: input.scplTicket?.trim() || null,
        },
      });
      return count === 1 ? { ok: true, id: report.id } : { ok: false, error: REPORT_MESSAGES.notDraft };
    },

    async file(input: {
      reportId: number;
      actorId: number;
      agency: ReportAgency | null;
      agencyOther: string | null;
      filedAt: Date;
      reference: string | null;
      minuteId: number | null;
    }): Promise<Result> {
      if (input.agency === "other" && !input.agencyOther?.trim()) {
        return { ok: false, error: "Indicá ante qué organismo se presentó." };
      }
      const { count } = await db.report.updateMany({
        where: { id: input.reportId, status: "received" },
        data: {
          status: "filed",
          filedAt: input.filedAt,
          filedById: input.actorId,
          filedAgency: input.agency,
          filedAgencyOther: input.agency === "other" ? (input.agencyOther?.trim() ?? null) : null,
          filedReference: input.reference?.trim() || null,
          filedMinuteId: input.minuteId,
        },
      });
      return count === 1 ? { ok: true } : { ok: false, error: REPORT_MESSAGES.notPending };
    },

    async dismiss(input: { reportId: number; actorId: number; reason: string }): Promise<Result> {
      const reason = input.reason.trim();
      if (reason.length < 3) return { ok: false, error: "Escribí el motivo (al menos 3 caracteres)." };
      const { count } = await db.report.updateMany({
        where: { id: input.reportId, status: "received" },
        data: {
          status: "dismissed",
          dismissedAt: now(),
          dismissedById: input.actorId,
          dismissReason: reason.slice(0, 300),
        },
      });
      return count === 1 ? { ok: true } : { ok: false, error: REPORT_MESSAGES.notPending };
    },

    async listForMember(memberId: number): Promise<ReportWithFiles[]> {
      return db.report.findMany({
        where: { memberId, status: { in: [...SUBMITTED_STATUSES] } },
        orderBy: { id: "desc" },
        take: 20,
        include: { files: true },
      });
    },

    /** El número de la pestaña y del tablero: la COLA (spec §5.3), no un histórico. */
    pendingCount(): Promise<number> {
      return db.report.count({ where: { status: "received" } });
    },

    /** Los contadores de transparencia de la landing (spec §5.1). */
    async yearStats(at: Date = now()): Promise<{ received: number; filed: number }> {
      const range = yearRangeUtc(at);
      const [received, filed] = await Promise.all([
        db.report.count({ where: { status: { in: [...SUBMITTED_STATUSES] }, submittedAt: range } }),
        db.report.count({ where: { status: "filed", submittedAt: range } }),
      ]);
      return { received, filed };
    },
  };
}

export type ReportsService = ReturnType<typeof makeReports>;

export const reports = makeReports({ db: prisma });
