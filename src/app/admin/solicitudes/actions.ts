"use server";
// Acciones de la bandeja de solicitudes. Mismo esqueleto que
// `src/app/admin/socios/[id]/actions.ts`: guarda propia, el acta parseada
// aparte, la compensación del acta huérfana, auditoría con IP y `redirect`
// fuera de todo `try`.
//
// ── El acta huérfana, en versión masiva ───────────────────────────────────────
// El asiento corre en la transacción del recorder, así que el acta se crea
// ANTES y podría quedar sin ningún movimiento colgando (basura en un libro que
// la asociación presenta ante la IGJ). La resolución es la misma de dos partes:
//   1. Pre-validación: si NINGUNA de las solicitudes elegidas está en un estado
//      asentable, se corta antes de tocar el acta. Es el caso frecuente —dos
//      admins mirando la misma bandeja, un lote ya asentado que se reenvía.
//   2. Compensación: si aun así no se asentó ninguna, `discardUnusedMinute`
//      borra el acta recién creada siempre que no la esté usando nadie.
// Con éxitos parciales el acta SÍ queda: tiene asientos reales adentro.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { mailer } from "@/lib/email";
import { portalInvite } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import { applicationRecorder, RECORDABLE_STATUSES } from "@/lib/applications/record";
import type { RecordResult } from "@/lib/applications/record";

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint.
type State = { error?: string };

async function clientIp(): Promise<string> {
  // Sólo X-Real-IP, como en el login: el resto de las cabeceras de IP las puede
  // fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

/** La invitación de acceso al portal, después de que el asiento ya está firme.
 *
 *  Sólo a las fichas con el email VERIFICADO y sin cuenta: la invitación crea la
 *  contraseña de quien tenga ese buzón, así que no puede caer en una dirección
 *  sin confirmar (es la misma regla que `verificationTarget` en el circuito de
 *  socios). La ficha que nace `declared` recibe la invitación recién cuando el
 *  vecino canjea su enlace de verificación (`/verificar`, Task 15).
 *
 *  Best-effort a propósito: el asiento societario ya está commiteado y un hipo
 *  del SMTP no puede deshacerlo ni romperle la pantalla al operador. Del error
 *  se conserva sólo el código: los de nodemailer traen el sobre SMTP, o sea
 *  datos del socio en claro (docs/08, Ley 25.326).
 */
async function inviteRecordedMembers(memberIds: number[]): Promise<void> {
  for (const id of memberIds) {
    try {
      const member = await prisma.member.findUnique({ where: { id } });
      if (!member?.email || member.emailStatus !== "verified" || member.userId !== null) continue;
      // Un enlace vivo por socio: si el asiento se repitiera, el anterior muere.
      await tokens.revokeForMember(member.id, ["password_invitation"]);
      const raw = await tokens.issue({ purpose: "password_invitation", memberId: member.id });
      const { message, summary } = portalInvite({
        kind: "password_invitation",
        name: member.fullName,
        baseUrl: process.env.AUTH_URL ?? "http://localhost:3000",
        token: raw,
      });
      await mailer.sendToMember({
        memberId: member.id, to: member.email, type: "password_invitation", message, summary,
      });
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
      console.error("[solicitudes] no se pudo enviar la invitación de acceso", id, code);
    }
  }
}

export async function recordApplicationsAction(_p: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const actorId = actor.actorId;

  const ids = [
    ...new Set(
      formData.getAll("ids")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  if (ids.length === 0) return { error: "Elegí al menos una solicitud para asentar." };

  // El acta se parsea aparte y NUNCA se combina con otro schema:
  // `minuteSelectionSchema` es un `z.union` y `parseForm` sólo sabe reconocer
  // campos opcionales sobre un ZodObject con `.shape`.
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }

  // Pre-validación anti acta huérfana (ver la cabecera).
  const recordable = await prisma.application.count({
    where: { id: { in: ids }, status: { in: [...RECORDABLE_STATUSES] } },
  });
  if (recordable === 0) {
    return { error: "Ninguna de las solicitudes elegidas está lista para asentar." };
  }

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  // En serie y no en paralelo: cada alta numera con el `max + 1` del libro
  // abierto, y dos transacciones concurrentes leerían el mismo máximo y
  // chocarían contra el índice único de (libro, número).
  const results: RecordResult[] = [];
  for (const applicationId of ids) {
    results.push(await applicationRecorder.recordOne({ applicationId, minuteId, actorId }));
  }
  const done = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  if (done.length === 0) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: failed[0]?.error ?? "No se pudo asentar ninguna solicitud." };
  }

  await inviteRecordedMembers(done.map((r) => r.memberId));

  // El detalle lleva ids y nada más: ni nombres ni DNIs (docs/08, Ley 25.326).
  await audit({
    userId: actorId, action: "application_record", entity: "application",
    detail: {
      minuteId,
      recorded: done.map((r) => r.applicationId),
      reentries: done.filter((r) => r.reentry).map((r) => r.applicationId),
      failed: failed.map((r) => r.applicationId),
    },
    ip: await clientIp(),
  });

  // Fuera del try: `redirect` señaliza con una excepción y un catch se la comería.
  const qs = new URLSearchParams({ asentadas: String(done.length) });
  if (failed.length > 0) qs.set("fallidas", String(failed.length));
  redirect(`/admin/solicitudes?${qs.toString()}`);
}
