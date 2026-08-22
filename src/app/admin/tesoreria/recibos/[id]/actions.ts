"use server";
// Las dos acciones del recibo (spec §6.4): reenviarlo por email y anularlo.
//
// La regla vive en el servicio; acá se valida la forma, se traduce el resultado
// a una frase para el operador y se AUDITA. La auditoría es de esta capa a
// propósito: `treasuryService.voidReceipt` y `sendReceiptEmail` no ven los
// encabezados del request, así que no pueden asentar la IP — y una acción que
// mueve plata cobrada sin asiento no se puede reconstruir después.
//
// En los asientos van ids, códigos y contadores. Ni el nombre del socio ni su
// email: el `receiptId` alcanza para llegar a todo lo demás desde la base
// (Ley 25.326, docs/08).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";

type State = { error?: string; sent?: boolean };

// Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el módulo
// realip y la sobrescribe, así que no se puede falsear desde el cliente.
async function ip(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Todo mensaje de zod se muestra tal cual en pantalla, así que va en castellano
// —el de la coerción incluido: un `receiptId` que no es número llega como NaN y
// sin mensaje propio el operador leería el texto en inglés de la librería.
const receiptIdField = z.coerce
  .number("No pudimos identificar el recibo.")
  .int("No pudimos identificar el recibo.")
  .positive("No pudimos identificar el recibo.");

const voidSchema = z.object({
  receiptId: receiptIdField,
  // El mensaje va también en el constructor: un POST a mano sin el campo deja a
  // `reason` en undefined, y ahí `.min(1)` ni siquiera llega a correr — sin
  // esto, el operador leería el texto en inglés de zod.
  reason: z
    .string("Indicá el motivo de la anulación.")
    .min(1, "Indicá el motivo de la anulación.")
    .max(200, "El motivo no puede superar los 200 caracteres."),
});

// Anular no borra ni renumera: el recibo queda con motivo, fecha y quién; las
// cuotas que cubría vuelven a pendientes (las futuras se borran).
export async function voidReceiptAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(voidSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  let result;
  try {
    result = await treasuryService.voidReceipt({
      receiptId: parsed.data.receiptId,
      actorId: actor.actorId,
      reason: parsed.data.reason,
    });
  } catch (e) {
    // Las reglas de negocio ya vienen redactadas en es-AR desde el servicio
    // ("El recibo ya está anulado."); lo demás es un error nuestro y no se le
    // muestra crudo al operador.
    if (e instanceof TreasuryError) return { error: e.message };
    console.error("[treasury] voidReceipt", e instanceof Error ? e.message : e);
    return { error: "No se pudo anular el recibo. Reintentá en un momento." };
  }
  await audit({
    userId: actor.actorId,
    action: "receipt_void",
    entity: "receipt",
    entityId: parsed.data.receiptId,
    // `periodsReverted` es lo que REALMENTE se devolvió a pendiente (o se
    // borró), no lo que el recibo decía cubrir: una cuota reimputada a otro
    // pago no se toca, y el asiento tiene que dejarlo ver.
    detail: { number: result.number, paymentId: result.paymentId, periodsReverted: result.periodsReverted },
    ip: await ip(),
  });
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/tesoreria/recibos/${parsed.data.receiptId}?anulado=1`);
}

const emailSchema = z.object({ receiptId: receiptIdField });

// Una frase por cada motivo de `ReceiptEmailResult`. `voided` tiene la suya: es
// una negativa de negocio y mandar al operador a "revisar la configuración de
// correo" por un recibo anulado lo haría perder la tarde.
const EMAIL_ERRORS = {
  no_email: "El socio no tiene un email válido en su ficha.",
  voided: "El recibo está anulado: no se puede enviar por email.",
  error: "No se pudo enviar el email. Revisá la configuración de correo y reintentá.",
} as const;

export async function emailReceiptAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(emailSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  // `sendReceiptEmail` está documentado como best-effort y pensado para no
  // tirar nunca, pero su primer statement (el findUnique del recibo) vive
  // AFUERA de su try interno: un timeout del pool ahí se escapa igual y
  // rompería la server action entera, dejando al operador sin saber si el
  // recibo salió o no. Se degrada al mismo "error" que un envío fallido.
  let result: Awaited<ReturnType<typeof sendReceiptEmail>>;
  try {
    result = await sendReceiptEmail(parsed.data.receiptId);
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    console.error("[treasury] sendReceiptEmail lanzó", typeof code === "string" ? code : "unknown");
    result = { sent: false, reason: "error" };
  }
  await audit({
    userId: actor.actorId,
    action: "receipt_email",
    entity: "receipt",
    entityId: parsed.data.receiptId,
    // El motivo, nunca la dirección: el reenvío se audita para poder responder
    // "¿cuántas veces se le mandó este recibo?", no para guardar el email.
    detail: { result: result.sent ? "sent" : result.reason },
    ip: await ip(),
  });
  if (!result.sent) return { error: EMAIL_ERRORS[result.reason] };
  return { sent: true };
}
