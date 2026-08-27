"use server";
// Las dos acciones de la exención de cuota (Art. 7 inc. a.4): asentarla y
// anularla. Las dos son actos de la Comisión, así que las dos llevan acta,
// movimiento en la ficha y asiento de auditoría.
//
// ── Por qué `requireSuperadmin()` en la PRIMERA línea ────────────────────────
// Una server action no se invoca por su URL: Next la despacha por el id del
// encabezado `Next-Action` contra un manifiesto global del build, así que ni el
// proxy ni el layout de /admin la protegen (el comentario largo está en
// `require-admin.ts`). Y lo que estas dos hacen no es poca cosa: una exención le
// perdona al socio hasta 24 cuotas, y su anulación se asienta UNA sola vez con
// su acta. Mismo doble nivel que Valores de cuota (decisión 12 de la spec): el
// admin común ve la pestaña, pero asentar y anular es del superadmin, y la
// pantalla sólo decide qué se dibuja.
//
// ── El acta huérfana ────────────────────────────────────────────────────────
// El servicio abre su propia transacción y revalida las seis guardas del §5. Si
// acá creáramos el acta primero y el servicio rechazara después (deuda, débito
// vivo, otra exención vigente), el acta quedaría asentada sin ningún movimiento:
// basura en el libro que la asociación presenta ante la IGJ. La resolución es la
// misma que la de las acciones societarias de la ficha (`socios/[id]/actions.ts`):
// pre-validar lo que se pueda ANTES de tocar el acta, y compensar con
// `discardUnusedMinute` si aun así falla — que borra sólo si el acta era nueva y
// no la está usando nadie.
//
// ── Qué se audita ───────────────────────────────────────────────────────────
// Ids, períodos y conteos. La NOTA no: es texto libre del operador y puede
// nombrar a un tercero (Ley 25.326, docs/08). Queda en el registro, que lo lee
// sólo el panel.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import { prisma } from "@/lib/prisma";
import { exemptions, exemptionToPeriod, MAX_EXEMPTION_MONTHS } from "@/lib/treasury/exemptions";

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint.
type State = { error?: string };

const BASE = "/admin/tesoreria/exenciones";

const RANGE_MESSAGE =
  `La exención va de 1 a ${MAX_EXEMPTION_MONTHS} meses enteros (Art. 7 inc. a.4: "hasta veinticuatro").`;

// Todo mensaje explícito y en castellano, incluida la COERCIÓN: sin mensaje
// propio, un valor que no es número llega a zod como NaN y el operador lee
// "Invalid input: expected number, received NaN" en pantalla.
const grantSchema = z.object({
  memberId: z.coerce
    .number("Elegí al socio que se exime.")
    .int("Elegí al socio que se exime.")
    .positive("Elegí al socio que se exime."),
  months: z.coerce
    .number("Ingresá por cuántos meses.")
    .int(RANGE_MESSAGE)
    .min(1, RANGE_MESSAGE)
    .max(MAX_EXEMPTION_MONTHS, RANGE_MESSAGE),
  // El mismo regex que `isPeriod` en `periods.ts` y no un `\d{2}` suelto: un
  // "2026-13" que pasara de acá se rechazaría recién adentro de la transacción,
  // después de haber creado el acta.
  fromPeriod: z
    .string("Elegí el mes en que empieza la exención.")
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes de inicio tiene que tener el formato AAAA-MM."),
  note: z.string().max(300, "La nota no puede superar los 300 caracteres.").optional(),
});

const revokeSchema = z.object({
  exemptionId: z.coerce
    .number("No pudimos identificar la exención.")
    .int("No pudimos identificar la exención.")
    .positive("No pudimos identificar la exención."),
});

type MinuteResult =
  | { ok: true; data: z.infer<typeof minuteSelectionSchema> }
  | { ok: false; error: string };

/** El acta se parsea APARTE y nunca junto con el resto del formulario:
 *  `minuteSelectionSchema` es un `z.union` y `parseForm` sólo sabe reconocer
 *  campos opcionales sobre un ZodObject con `.shape`. Fusionarlos deja a los
 *  campos del acta sin sus mensajes en castellano. */
function parseMinuteSelection(formData: FormData): MinuteResult {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { ok: false, error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }
  return { ok: true, data: sel.data };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Error inesperado.";
}

// Del error se loguea SÓLO el código o el nombre: el `message` de Prisma vuelca
// los argumentos de la consulta, y ahí va el texto libre del operador (mismo
// criterio que `other-income` y `notify`).
function errCode(e: unknown): string {
  const o = e as { code?: unknown; name?: unknown } | null;
  if (typeof o?.code === "string") return o.code;
  if (typeof o?.name === "string") return o.name;
  return "unknown";
}

// La IP la escribe la action y no el servicio: es la única capa que ve las
// cabeceras. Sólo X-Real-IP, como en el login — el resto de las cabeceras de IP
// las puede fijar el cliente si le pega directo al origen.
async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

export async function grantExemptionAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(grantSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { memberId, months, fromPeriod } = parsed.data;

  const sel = parseMinuteSelection(formData);
  if (!sel.ok) return { error: sel.error };

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actor.actorId);
  } catch (e) {
    // `resolveMinuteId` redacta sus propios errores en castellano ("Ya existe el
    // acta N° 47 de ese tipo", "La fecha del acta no existe").
    return { error: messageOf(e) };
  }

  let result;
  try {
    result = await exemptions.grant({
      memberId,
      fromPeriod,
      months,
      minuteId,
      note: parsed.data.note ?? null,
      actorId: actor.actorId,
    });
  } catch (e) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    console.error("[exenciones] el asiento falló", errCode(e));
    return { error: "No se pudo asentar la exención. Reintentá en un momento." };
  }
  if (!result.ok) {
    // Las seis guardas vuelven redactadas en es-AR desde el dominio, con el
    // camino para resolver cada una. El acta recién creada se descarta.
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: result.error };
  }

  await audit({
    userId: actor.actorId,
    action: "fee_exemption_create",
    entity: "member",
    entityId: memberId,
    detail: {
      exemptionId: result.exemptionId,
      fromPeriod,
      // Con la MISMA regla pura que usó la transacción para escribir la fila: si
      // el asiento calculara el último mes por su cuenta, el libro podría decir
      // un mes distinto del que se eximió.
      toPeriod: exemptionToPeriod(fromPeriod, months),
      months,
      minuteId,
      // Los meses del rango que ya estaban pagos y quedan pagos (decisión 11).
      // Es lo único que explica por qué se crearon menos filas que meses.
      skippedPaid: result.skippedPaid,
    },
    ip: await clientIp(),
  });

  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`${BASE}?asentada=1`);
}

export async function revokeExemptionAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(revokeSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { exemptionId } = parsed.data;

  const sel = parseMinuteSelection(formData);
  if (!sel.ok) return { error: sel.error };

  // La fila se lee ANTES de tocar el acta por dos motivos, y ninguno es
  // cosmético: en el camino frecuente de rechazo —la pantalla quedó abierta y
  // otro admin ya anuló— el acta nunca llega a crearse; y el asiento de
  // auditoría es `entity: "member"`, pero `revoke` devuelve un conteo, no la
  // ficha. El cerrojo del dominio (`updateMany` con `revokedAt: null`) sigue
  // siendo la defensa real contra la carrera: esto es pre-validación.
  const target = await prisma.feeExemption.findUnique({
    where: { id: exemptionId },
    select: { memberId: true, revokedAt: true },
  });
  if (!target) return { error: "La exención no existe." };
  if (target.revokedAt !== null) {
    return { error: "Esa exención ya está anulada: la anulación se asienta una sola vez, con su acta." };
  }

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actor.actorId);
  } catch (e) {
    return { error: messageOf(e) };
  }

  let result;
  try {
    result = await exemptions.revoke({ exemptionId, revokeMinuteId: minuteId, actorId: actor.actorId });
  } catch (e) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    console.error("[exenciones] la anulación falló", errCode(e));
    return { error: "No se pudo anular la exención. Reintentá en un momento." };
  }
  if (!result.ok) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: result.error };
  }

  await audit({
    userId: actor.actorId,
    action: "fee_exemption_revoke",
    entity: "member",
    entityId: target.memberId,
    // `removedFuture` es cuántos meses futuros vuelven a devengar: el mes
    // corriente y los pasados quedan exentos (decisión 9), así que este número
    // es la única huella de qué se deshizo.
    detail: { exemptionId, revokeMinuteId: minuteId, removedFuture: result.removedFuture },
    ip: await clientIp(),
  });

  redirect(`${BASE}?anulada=1`);
}
