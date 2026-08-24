"use server";
// Reenvío POR ENTIDAD de un aviso que no salió (spec 4C §7.5).
//
// No hay cola genérica de reintentos, y no es una omisión: `payloadSummary` es
// texto de 300 caracteres, no un payload re-armable, así que "reintentar" un
// aviso cualquiera significaría re-generar el mensaje desde cero con datos que
// la fila no guarda. El único camino que existe es el del RECIBO, que ya tiene
// su reenvío probado (`sendReceiptEmail` lee el recibo, regenera el PDF si hace
// falta y vuelve a mandar). Los demás avisos se muestran con su error y con la
// entidad de la que vienen, para rehacerlos desde su propia pantalla.
//
// Son DOS acciones porque son dos puertas al mismo envío y la diferencia está en
// cómo se llega al recibo: el panel 5 parte de una `Notification` fallida y tiene
// que sacar el número del `payloadSummary`; el panel 6 parte del `Receipt` y ya
// tiene el id en la mano.
//
// Superadmin y no admin: la pantalla entera lo es, y una server action se
// autoriza a sí misma (Next la despacha por el id del encabezado `Next-Action`,
// no por su URL).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { receiptNumberOf } from "@/lib/admin/health";
import { describeResendResult, type ResendOutcome } from "@/lib/admin/receipt-resend";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { sendReceiptEmail, type ReceiptEmailResult } from "@/lib/treasury/receipt-email";

type State = ResendOutcome;

const notificationSchema = z.object({
  // BigInt: no entra en un Number, así que se valida como cadena de dígitos.
  notificationId: z.string("Aviso inválido.").regex(/^\d{1,19}$/, "Aviso inválido."),
});

const receiptSchema = z.object({
  receiptId: z.coerce
    .number("No pudimos identificar el recibo.")
    .int("No pudimos identificar el recibo.")
    .positive("No pudimos identificar el recibo."),
});

// Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el módulo
// realip y la sobrescribe, así que no se puede falsear desde el cliente.
async function ip(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

/** `sendReceiptEmail` está documentado como best-effort y pensado para no tirar
 *  nunca, pero su primer statement —el `findUnique` del recibo— vive AFUERA de
 *  su try interno: un timeout del pool ahí se escapa igual y rompería la action,
 *  dejando al operador sin saber si el recibo salió. Se degrada al mismo "error"
 *  que un envío fallido, con el código a la vista. */
async function send(receiptId: number): Promise<ReceiptEmailResult> {
  try {
    return await sendReceiptEmail(receiptId);
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    console.error("[salud] sendReceiptEmail lanzó", typeof code === "string" ? code : "unknown");
    return { sent: false, reason: "error", code: typeof code === "string" ? code : "unknown" };
  }
}

/** Un envío que SALIÓ deja su propia fila `sent`, que es la que acredita
 *  (Art. 5° quater). La fila `failed` era el registro de un intento anterior y
 *  dejarla sería una alarma permanente sobre algo ya resuelto: el criterio de
 *  aceptación §14.7 pide, textualmente, que «Reenviar» la saque de la lista. */
async function clearFailedNotices(number: string): Promise<void> {
  await prisma.notification.deleteMany({
    where: { type: "receipt", status: "failed", payloadSummary: `recibo ${number}` },
  });
}

/** Panel 5: una `Notification` que quedó `failed`. */
export async function resendNotificationAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(notificationSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const id = BigInt(parsed.data.notificationId);

  const row = await prisma.notification.findUnique({
    where: { id },
    select: { id: true, status: true, type: true, payloadSummary: true },
  });
  if (!row) return { error: "El aviso no existe." };
  if (row.status !== "failed") return { error: "Ese aviso ya no figura como fallido." };
  const number = row.type === "receipt" ? receiptNumberOf(row.payloadSummary) : null;
  if (number === null) {
    return { error: "Este aviso no se puede reenviar desde acá: rehacelo desde la pantalla que lo origina." };
  }
  const receipt = await prisma.receipt.findFirst({ where: { number }, select: { id: true } });
  if (!receipt) return { error: `No se encontró el recibo ${number}.` };

  const result = await send(receipt.id);
  await audit({
    userId: actor.actorId,
    action: "notification_resent",
    entity: "notification",
    entityId: String(id),
    // Ids, número de recibo y el desenlace. Nunca la dirección.
    detail: {
      notificationId: String(id), type: row.type, receiptId: receipt.id,
      sent: result.sent, reason: result.sent ? null : result.reason,
    },
    ip: await ip(),
  });
  if (!result.sent) {
    // La fila se queda: sigue siendo un aviso que no salió, y borrarla dejaría
    // el hueco sin rastro justo cuando el problema persiste.
    return describeResendResult(result, number);
  }
  await prisma.notification.deleteMany({ where: { id, status: "failed" } });
  revalidatePath("/admin/salud");
  return describeResendResult(result, number);
}

/** Panel 6: un `Receipt` que nunca se selló como enviado. El id viene directo,
 *  sin pasar por `payloadSummary`. */
export async function resendReceiptAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(receiptSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const receiptId = parsed.data.receiptId;

  // El número se lee ANTES para poder nombrarlo en el mensaje y en el asiento:
  // sin él, un fallo diría "no se pudo enviar el recibo" sin decir cuál.
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId }, select: { number: true } });
  if (!receipt) return { error: "El recibo no existe." };

  const result = await send(receiptId);
  await audit({
    userId: actor.actorId,
    action: "receipt_email",
    entity: "receipt",
    entityId: receiptId,
    // `from` distingue este reenvío del botón de la pantalla del recibo: es el
    // mismo envío, pero no el mismo motivo para haberlo disparado.
    detail: { from: "health", number: receipt.number, result: result.sent ? "sent" : result.reason },
    ip: await ip(),
  });
  if (!result.sent) return describeResendResult(result, receipt.number);
  // Salió: `sendReceiptEmail` ya selló `emailedAt`, así que la fila se va sola
  // de este panel. Lo que no se va solo es su gemela del panel 5.
  await clearFailedNotices(receipt.number);
  revalidatePath("/admin/salud");
  return describeResendResult(result, receipt.number);
}
