"use server";
// Cesantía por mora en lote (REG-15, Art. 9 inc. c). Misma mecánica que el
// asiento masivo de solicitudes: un acta para todo el lote, una baja por socio,
// éxito parcial reportado POR SOCIO.
//
// Dos cosas que no son detalle:
//
//   1. El umbral (≥4 cuotas pendientes) se REVALIDA acá, socio por socio y al
//      momento de la baja. La pantalla pudo quedar vieja —alguien pagó en la
//      caja mientras el operador miraba la lista— y esta acción expulsa gente
//      de la asociación: el conteo que vale es el de la base, no el del HTML.
//   2. La declaración la decide la Comisión Directiva, no el sistema. Acá no
//      hay ningún camino automático: el sistema propone (los ≥4) y el operador
//      dispone (los que tilda), y todo queda asentado en un acta.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { memberService } from "@/lib/members/service";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import { ARREARS_THRESHOLD } from "@/lib/treasury/rules";

const BASE = "/admin/tesoreria/deudores";

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint.
//
// `failures` lleva el NOMBRE y el motivo de cada socio que no entró, no un
// contador. "2 sin declarar" en un lote de diez no le dice al operador a quién
// tiene que volver a mirar, y acá la diferencia entre un socio y otro es si
// sigue siendo socio.
type State = {
  error?: string;
  declared?: number;
  failures?: Array<{ memberId: number; name: string; error: string }>;
};

export async function declareArrearsAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const actorId = actor.actorId;

  // `getAll` y no `get`: la selección viaja como un campo `ids` por checkbox
  // tildado. Con `get` se declararía la cesantía del PRIMERO nomás y el
  // operador se iría creyendo que dio de baja a todos. El `split` acepta además
  // la lista separada por comas (un POST armado a mano, o un campo oculto).
  const ids = [
    ...new Set(
      formData.getAll("ids")
        .flatMap((v) => String(v).split(","))
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  if (ids.length === 0) return { error: "Seleccioná al menos un socio." };

  // El acta se parsea aparte y nunca combinada con otro schema:
  // `minuteSelectionSchema` es un `z.union` y `parseForm` sólo sabe recorrer un
  // ZodObject con `.shape`.
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }

  // Pre-validación anti acta huérfana: si ninguno de los ids existe, se corta
  // antes de tocar el libro de actas.
  const members = await prisma.member.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
    orderBy: { id: "asc" },
  });
  if (members.length === 0) return { error: "Ninguno de los socios seleccionados existe." };

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  // Sólo X-Real-IP, como en el resto del panel: las demás cabeceras de IP las
  // puede fijar el cliente si le pega directo al origen.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  const failures: NonNullable<State["failures"]> = [];
  let declared = 0;
  // En serie: cada baja es su propia transacción y el operador tiene que poder
  // leer los fallos en el mismo orden en que ve las filas.
  for (const m of members) {
    const pendingCount = await prisma.fee.count({ where: { memberId: m.id, status: "pending" } });
    if (pendingCount < ARREARS_THRESHOLD) {
      // El motivo dice cuántas debe DE VERDAD: "no cumple el umbral" dejaría al
      // operador sin saber si el socio pagó o si la pantalla mintió.
      failures.push({
        memberId: m.id,
        name: m.fullName,
        error: `Debe ${pendingCount} ${pendingCount === 1 ? "cuota" : "cuotas"}: la cesantía requiere ${ARREARS_THRESHOLD} (Art. 9 inc. c).`,
      });
      continue;
    }
    try {
      await memberService.withdraw({
        memberId: m.id, reason: "arrears", minuteId, actorId,
        detail: `Cesantía por mora: ${pendingCount} cuotas adeudadas (Art. 9 inc. c)`,
      });
      declared++;
      // El servicio no audita: eso vive en esta capa, que es la única que ve la
      // IP del operador. Ids y conteos, nunca nombres ni DNIs (Ley 25.326).
      await audit({
        userId: actorId, action: "arrears_declared", entity: "member", entityId: m.id,
        detail: { minuteId, pendingCount }, ip,
      });
    } catch (e) {
      failures.push({
        memberId: m.id,
        name: m.fullName,
        error: e instanceof Error ? e.message : "No se pudo declarar la cesantía.",
      });
    }
  }

  if (declared === 0) {
    // Compensación: un acta sin ningún movimiento es un asiento fantasma en un
    // libro que la asociación presenta ante la IGJ. Sólo se descarta la que
    // creó ESTE lote, y `discardUnusedMinute` chequea que nadie más la haya
    // tomado en el medio.
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    // El motivo de cada uno va en `failures` y no se repite en `error`: con un
    // solo socio fallido se leería dos veces.
    return { error: "No se declaró ninguna cesantía.", failures };
  }

  // Con éxito PARCIAL no se redirige: el querystring no tiene dónde poner los
  // motivos. El `revalidatePath` es lo que hace que la tabla ya no ofrezca a
  // los que sí salieron (dejaron de ser deudores vigentes) y que el contador
  // del botón deje de contarlos.
  if (failures.length > 0) {
    revalidatePath(BASE);
    return { declared, failures };
  }

  // Fuera del try: `redirect` señaliza con una excepción y un catch se la comería.
  redirect(`${BASE}?declaradas=${declared}`);
}
