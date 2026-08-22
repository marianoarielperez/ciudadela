// Envío del recibo por email con el PDF adjunto. Best-effort: nunca tira; el
// llamador decide qué mostrar. Queda acreditado como Notification `receipt`.
import type { PrismaClient } from "@/generated/prisma/client";
import { mailer } from "@/lib/email";
import { receiptEmail } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";
import { readReceiptPdf, receiptRelativePath } from "./receipts-dir";
import { treasuryService } from "./service";

type Mailer = Pick<typeof mailer, "sendToMember">;

export type ReceiptEmailResult = { sent: true } | { sent: false; reason: "no_email" | "error"; code?: string };

// Solo `code`: el error de nodemailer trae la dirección en claro (docs/08).
function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : "unknown";
}

export function makeReceiptEmailer(deps: {
  db: Pick<PrismaClient, "receipt">;
  mailer: Mailer;
  readPdf: (relPath: string) => Promise<Buffer>;
  regenerate: (receiptId: number) => Promise<Uint8Array>;
}) {
  return {
    async sendReceiptEmail(receiptId: number): Promise<ReceiptEmailResult> {
      const r = await deps.db.receipt.findUnique({
        where: { id: receiptId },
        include: {
          payment: {
            include: { member: { select: { id: true, fullName: true, email: true, emailStatus: true } } },
          },
        },
      });
      if (!r) return { sent: false, reason: "error", code: "not_found" };
      // Un recibo anulado no se manda: el PDF que saldría ya no representa nada
      // cobrado, y el socio no tiene cómo saberlo desde el adjunto.
      if (r.voidedAt) return { sent: false, reason: "error", code: "voided" };
      const member = r.payment.member;
      if (!member?.email || member.emailStatus === "bounced") return { sent: false, reason: "no_email" };
      try {
        let pdf: Buffer;
        try {
          pdf = await deps.readPdf(r.pdfPath ?? receiptRelativePath(r.number));
        } catch {
          // El PDF vive fuera de la base (disco del VPS). Si no está —restore
          // parcial, emisión que falló después de numerar— se rehace: el
          // contenido es determinístico a partir de la fila.
          pdf = Buffer.from(await deps.regenerate(r.id));
        }
        // El concepto sale de la fila del recibo, congelado al emitir: no se
        // recalcula desde `payment.fees`, que al anular quedan despegadas.
        const message = receiptEmail({
          name: member.fullName,
          number: r.number,
          concept: r.concept,
          amount: Number(r.payment.amount),
        });
        await deps.mailer.sendToMember({
          memberId: member.id,
          to: member.email,
          type: "receipt",
          message: {
            ...message,
            attachments: [{ filename: `recibo-${r.number}.pdf`, content: pdf, contentType: "application/pdf" }],
          },
          summary: `recibo ${r.number}`,
        });
        await deps.db.receipt.update({ where: { id: r.id }, data: { emailedAt: new Date() } });
        return { sent: true };
      } catch (e) {
        console.error("[treasury] no se pudo enviar el recibo por email", receiptId, codeOf(e));
        return { sent: false, reason: "error", code: codeOf(e) };
      }
    },
  };
}

export const { sendReceiptEmail } = makeReceiptEmailer({
  db: prisma,
  mailer,
  readPdf: readReceiptPdf,
  regenerate: (id) => treasuryService.regenerateReceiptPdf(id),
});
