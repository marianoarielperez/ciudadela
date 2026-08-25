// Aviso al socio cuando su solicitud (baja o cambio de categoría) se resuelve:
// aceptada — Task 9, piggyback del flujo con acta en
// `admin/socios/[id]/actions.ts` — o rechazada — Task 8,
// `rejectRequestAction`—.
//
// Best-effort, mismo criterio que `withdrawWithDebits` y `accountEmailNotice`:
// corre DESPUÉS de que el acto que importa (el asiento, el acta, el
// `markAccepted`, el `reject`) ya commiteó, así que un fallo de correo NUNCA
// puede deshacerlo ni tumbar la action que lo llama. Se traga cualquier error
// y lo loguea con el CÓDIGO —nunca la dirección del socio (Ley 25.326)—: no
// hay pantalla que cuente este envío en particular, así que el log de PM2 es
// el único rastro.
import type { MemberRequestType } from "@/generated/prisma/client";
import { mailer } from "@/lib/email";
import { memberRequestDecided } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";

function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code !== "") return code.slice(0, 200);
  return e instanceof Error ? e.message.slice(0, 200) : "unknown";
}

export async function notifyRequestDecided(input: {
  memberId: number;
  type: MemberRequestType;
  accepted: boolean;
  note?: string | null;
}): Promise<void> {
  try {
    const member = await prisma.member.findUnique({
      where: { id: input.memberId },
      select: { email: true, emailStatus: true },
    });
    // Sin dirección utilizable no hay nada que mandar. Una casilla `bounced`
    // no es un domicilio electrónico vigente (mismo criterio que el resto del
    // proyecto) y una ficha sin email es el caso esperado del padrón
    // importado, no un fallo que loguear.
    if (!member?.email || member.emailStatus === "bounced") return;

    const { message, summary } = memberRequestDecided({
      type: input.type,
      accepted: input.accepted,
      note: input.note ?? null,
    });
    await mailer.sendToMember({
      memberId: input.memberId,
      to: member.email,
      type: input.accepted ? "request_accepted" : "request_rejected",
      message,
      summary,
    });
  } catch (e) {
    console.error("[solicitudes] no se pudo avisar la decisión al socio —", {
      memberId: input.memberId, type: input.type, accepted: input.accepted, code: codeOf(e),
    });
  }
}
