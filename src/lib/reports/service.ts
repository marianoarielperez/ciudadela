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
import { nextReportNumber } from "./number";
import { MAX_DISMISS_REASON, MIN_DISMISS_REASON, REPORT_MESSAGES, validateSubmission } from "./rules";

export type ReportWithFiles = Report & { files: ReportFile[] };
export type Result = { ok: true } | { ok: false; error: string };
/** `id` es lo interno (URL, FK, auditoría) y `number` es lo que se MUESTRA.
 *  Viajan los dos porque el llamador necesita los dos: la pantalla imprime el
 *  N° y el correo/el asiento apuntan al id. */
export type SubmitResult = { ok: true; id: number; number: number } | { ok: false; error: string };

export type ReporterInput = { name: string; dni: string; phone: string; email: string };

type Db = Pick<PrismaClient, "report" | "$transaction">;

/** El "no era borrador" del envío, como EXCEPCIÓN y no como valor de retorno:
 *  es la única forma de abortar la transacción del envío para que el N° que ya
 *  se pidió vuelva atrás con ella. Privada del módulo: afuera se sigue viendo
 *  el mismo `{ ok: false, error: REPORT_MESSAGES.notDraft }` de siempre. */
class NotDraftError extends Error {}

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
     *  wizard sólo apaga botones— y escribe con un updateMany por estado, ahora
     *  adentro de una transacción: es el único momento en que se asigna el N°
     *  público, y el número y la transición tienen que vivir o morir juntos. */
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
      if (!input.consent) return { ok: false, error: REPORT_MESSAGES.consent };

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
      // El N° público se pide TARDE y ADENTRO de la transacción (REG-33, calcado
      // de los recibos): todo lo que se podía validar ya se validó arriba, y el
      // lock de la fila de `report_sequences` se sostiene hasta el commit. Si el
      // `updateMany` no toma la fila —otro POST ganó la carrera y el borrador ya
      // no es `draft`— se TIRA adentro para que la transacción haga rollback y
      // el número NO quede consumido: un hueco en la serie es exactamente lo que
      // esto viene a evitar. Nada de red ni de disco acá adentro.
      try {
        return await db.$transaction(async (tx) => {
          const number = await nextReportNumber(tx);
          const { count } = await tx.report.updateMany({
            where: { id: report.id, status: "draft" },
            data: {
              status: "received",
              submittedAt: at,
              consentAt: at,
              number,
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
          if (count !== 1) throw new NotDraftError();
          return { ok: true as const, id: report.id, number };
        });
      } catch (e) {
        // El rollback ya devolvió el número. Afuera se contesta lo MISMO que
        // contestaba el `updateMany` condicional antes de la transacción, para
        // que la pantalla no cambie de texto por un detalle de implementación.
        if (e instanceof NotDraftError) return { ok: false, error: REPORT_MESSAGES.notDraft };
        throw e;
      }
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
        return { ok: false, error: REPORT_MESSAGES.agencyOther };
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
      if (reason.length < MIN_DISMISS_REASON) return { ok: false, error: REPORT_MESSAGES.dismissReason };
      const { count } = await db.report.updateMany({
        where: { id: input.reportId, status: "received" },
        data: {
          status: "dismissed",
          dismissedAt: now(),
          dismissedById: input.actorId,
          dismissReason: reason.slice(0, MAX_DISMISS_REASON),
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
