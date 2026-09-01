// Correos de un reporte (spec §9). Best-effort, DESPUÉS del commit: un SMTP
// caído no puede convertir "tu reporte entró" en "no pudimos recibirlo". Se
// loguea el CÓDIGO del fallo, nunca la dirección (Ley 25.326). Un bloqueo por
// EMAIL_ALLOWLIST no es un fallo y se cuenta como no enviado sin ruido.
import type { PrismaClient } from "@/generated/prisma/client";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { mailer } from "@/lib/email";
import { reportBoardAlertEmail, reportFiledEmail, reportReceivedEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { prisma } from "@/lib/prisma";
import { AGENCY_LABELS, categoryLabel, subtypeLabel } from "./catalog";

function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code !== "" ? code.slice(0, 200) : "unknown";
}

export function makeReportNotifier(deps: {
  db: Pick<PrismaClient, "report">;
  mailer: Pick<typeof mailer, "sendToReport">;
  baseUrl: () => string;
  contactEmail: () => Promise<string | null>;
}) {
  async function load(reportId: number) {
    return deps.db.report.findUnique({ where: { id: reportId } });
  }

  function streetOf(r: { streetName: string | null; addressDetail: string | null }): string | null {
    const parts = [r.streetName, r.addressDetail].filter((p): p is string => Boolean(p && p.trim()));
    return parts.length ? parts.join(" ") : null;
  }

  return {
    async sendReceived(reportId: number): Promise<void> {
      try {
        const r = await load(reportId);
        if (!r?.reporterEmail) return;
        await deps.mailer.sendToReport({
          reportId, to: r.reporterEmail, type: "report_received",
          message: reportReceivedEmail({
            number: r.id, kind: r.kind, categoryLabel: categoryLabel(r.kind, r.category),
            contactEmail: await deps.contactEmail(),
          }),
          summary: "acuse de reporte recibido",
        });
      } catch (e) {
        if (codeOf(e) !== ALLOWLIST_BLOCK_CODE) console.error("[reports] falló el acuse del reporte", reportId, "code:", codeOf(e));
      }
    },

    async sendFiled(reportId: number): Promise<void> {
      try {
        const r = await load(reportId);
        if (!r?.reporterEmail || !r.filedAt) return;
        const agencyLabel =
          r.filedAgency === "other" ? r.filedAgencyOther : r.filedAgency ? AGENCY_LABELS[r.filedAgency] : null;
        await deps.mailer.sendToReport({
          reportId, to: r.reporterEmail, type: "report_filed",
          message: reportFiledEmail({ number: r.id, kind: r.kind, agencyLabel, filedAt: r.filedAt, reference: r.filedReference }),
          summary: r.kind === "claim" ? "aviso de reporte presentado" : "aviso de iniciativa tratada",
        });
      } catch (e) {
        if (codeOf(e) !== ALLOWLIST_BLOCK_CODE) console.error("[reports] falló el aviso de presentado", reportId, "code:", codeOf(e));
      }
    },

    /** Una fila por destinatario, como el digest. Devuelve conteos para el log
     *  de la action; nunca direcciones. */
    async sendBoardAlert(reportId: number, recipients: string[]): Promise<{ sent: number; failed: number }> {
      const out = { sent: 0, failed: 0 };
      const r = await load(reportId);
      if (!r) return out;
      const message = reportBoardAlertEmail({
        number: r.id, kind: r.kind,
        categoryLabel: categoryLabel(r.kind, r.category),
        subtypeLabel: r.kind === "claim" ? subtypeLabel(r.category, r.subtype) || null : null,
        street: streetOf(r),
        description: r.description ?? "",
        reporter: {
          name: r.reporterName, dni: r.reporterDni, phone: r.reporterPhone, email: r.reporterEmail, anonymous: r.anonymous,
        },
        panelUrl: `${deps.baseUrl()}/admin/solicitudes/reportes/${r.id}`,
      });
      for (const to of recipients) {
        try {
          await deps.mailer.sendToReport({ reportId, to, type: "report_board_alert", message, summary: "alerta de reporte nuevo a la Comisión" });
          out.sent++;
        } catch (e) {
          if (codeOf(e) === ALLOWLIST_BLOCK_CODE) continue;
          out.failed++;
          console.error("[reports] falló la alerta a la Comisión", reportId, "code:", codeOf(e));
        }
      }
      return out;
    },
  };
}

export const reportNotifier = makeReportNotifier({
  db: prisma,
  mailer,
  baseUrl: () => process.env.AUTH_URL ?? "http://localhost:3000",
  contactEmail: () => configReader.getString(CONFIG_KEYS.contactEmail),
});
