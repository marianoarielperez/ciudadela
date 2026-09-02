"use server";
// El borrador de un SOCIO (spec §5.2): sin Turnstile (hay sesión), con cupo por
// socio, y la identidad copiada de la ficha. El suspendido puede reportar —es
// vecino igual, y el reporte no es un trámite societario como la baja o el
// cambio de categoría (spec §5.2 y su criterio de aceptación 2)—, así que acá
// va `allowSuspended: true` y no el `requireMember()` pelado de
// `/mi/solicitudes/actions.ts`.
//
// Desde acá en adelante el wizard usa las actions PÚBLICAS, dirigidas por la
// llave: este módulo tiene una sola action a propósito. Y como aquéllas,
// NINGUNA revalida rutas (el wizard estampa la llave con `history.replaceState`;
// ver el comentario largo de `report-wizard.tsx`).
import { headers } from "next/headers";
import { z } from "zod";

import { reportMemberLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { reports } from "@/lib/reports/service";

type StartState = { error?: string; started?: { claim: string } };

const RATE_MSG = "Demasiados reportes en un día. Probá mañana.";
const NO_MEMBER = "No encontramos tu ficha del padrón. Comunicate con la vecinal.";

const startSchema = z.object({
  kind: z.enum(["reclamo", "iniciativa"], { error: "Elegí qué querés reportar." }),
  anonymous: z.enum(["si", "no"], { error: "Contanos cómo querés figurar." }),
});

export async function startMemberReportAction(
  _prev: StartState,
  formData: FormData,
): Promise<StartState> {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return { error: actor.error };
  // El cupo va por `memberId` y no por IP: la pantalla está autenticada, así
  // que hay una identidad mejor que la conexión (rate-limiter.ts). Y se parte
  // en `allows` + `record` como en `startReportAction`: MIRAR el cupo antes de
  // todo (un bucle no puede ser gratis) pero GASTARLO recién cuando el intento
  // iba a crear un borrador. Con `check` a secas, cinco envíos con un `kind`
  // roto —o cinco con la ficha caída— le quemaban al socio las cinco del día
  // sin que existiera un solo reporte.
  const quotaKey = String(actor.memberId);
  if (!reportMemberLimiter.allows(quotaKey)) return { error: RATE_MSG };
  const parsed = parseForm(startSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const member = await prisma.member.findUnique({
    where: { id: actor.memberId },
    select: { fullName: true, dni: true, phone: true, email: true },
  });
  if (!member) return { error: NO_MEMBER };
  reportMemberLimiter.record(quotaKey);
  const h = await headers();
  // Las tres columnas opcionales de la ficha viajan como cadena vacía y no como
  // `null`: `saveReporter` guarda lo que le llega y el wizard del socio no tiene
  // paso 2 donde completarlo. Una ficha sin teléfono deja el campo vacío, no una
  // fila a medio tipar.
  const { claim } = await reports.startDraft({
    kind: parsed.data.kind === "reclamo" ? "claim" : "initiative",
    anonymous: parsed.data.anonymous === "si",
    memberId: actor.memberId,
    reporter: {
      name: member.fullName,
      dni: member.dni ?? "",
      phone: member.phone ?? "",
      email: member.email ?? "",
    },
    ip: h.get("x-real-ip") ?? "unknown",
    userAgent: (h.get("user-agent") ?? "").slice(0, 255),
  });
  return { started: { claim } };
}
