"use server";
// Las dos decisiones del panel sobre un reporte (spec §5.3): marcarlo
// PRESENTADO ante un organismo —o TRATADO por la Comisión, si es una
// iniciativa— y DESESTIMARLO. Siete pasos, siempre en este orden:
// requireAdmin → zod → dominio → auditoría → correo best-effort → revalidate.
//
// ── Por qué `requireAdmin()` en la PRIMERA línea ────────────────────────────
// Una server action no se despacha por su URL sino por el id del encabezado
// `Next-Action` contra un manifiesto global del build, así que ni el proxy
// (matcher `/admin/:path*`) ni el layout del panel corren sobre ella: cada
// action es un endpoint público y este chequeo es el único control (el
// comentario largo está en `require-admin.ts`). Acá además se leen datos de
// vecinos que no son socios (Ley 25.326).
//
// ── El acta, y sólo para iniciativas ────────────────────────────────────────
// El acta es el respaldo del Art. 6.2: la Comisión TRATÓ la iniciativa. Un
// reclamo se presenta ante un organismo y no asienta nada en el libro, así que
// los campos `minute*` de un POST de reclamo se ignoran por completo. Y como
// `Report.filedMinuteId` es `Restrict`, un acta que ya respalda un reporte no
// se puede borrar: `discardUnusedMinute` la cuenta como referente.
//
// El acta huérfana se evita con las dos mitades de siempre: las guardas baratas
// —la ficha existe, el organismo del reclamo, la fecha— se miran ANTES de tocar
// el libro, y sólo lo que se sabe adentro del servicio (la carrera contra otro
// admin sobre el mismo reporte) se compensa con `discardUnusedMinute`.
//
// ── Qué se audita ──────────────────────────────────────────────────────────
// Ids y códigos: el reporte, el slug del organismo y el id del acta. NO el
// expediente ni el motivo de la desestimación — son texto libre del operador y
// pueden nombrar a un tercero (Ley 25.326, docs/08). Quedan en la ficha, que la
// lee sólo el panel.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import type { ReportAgency } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { parseForm } from "@/lib/forms";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import { prisma } from "@/lib/prisma";
import { AGENCIES } from "@/lib/reports/catalog";
import { reportNotifier } from "@/lib/reports/notify";
import { MAX_DISMISS_REASON, MIN_DISMISS_REASON, REPORT_MESSAGES } from "@/lib/reports/rules";
import { reports } from "@/lib/reports/service";
import { civilDayOf } from "@/lib/treasury/periods";

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint.
type State = { error?: string; done?: true };

const PATH = "/admin/solicitudes/reportes";

// Los slugs salen del catálogo y no de una lista escrita a mano: `AGENCIES` es
// la fuente que ya usa el <select>, así que un organismo nuevo entra en los dos
// lados de una vez.
const AGENCY_SLUGS = AGENCIES.map((a) => a.slug) as [ReportAgency, ...ReportAgency[]];

const fileSchema = z.object({
  reportId: z.coerce
    .number("No pudimos identificar el reporte.")
    .int("No pudimos identificar el reporte.")
    .positive("No pudimos identificar el reporte."),
  agency: z.enum(AGENCY_SLUGS, "Elegí un organismo de la lista.").optional(),
  agencyOther: z.string().max(80, "El organismo no puede superar los 80 caracteres.").optional(),
  // Sólo la FORMA: el día real —y el tope contra el futuro— los decide
  // `parseCivilDate`, que es la guarda compartida de fechas civiles.
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá la fecha de presentación."),
  reference: z.string().max(80, "El expediente no puede superar los 80 caracteres.").optional(),
});

const dismissSchema = z.object({
  reportId: z.coerce
    .number("No pudimos identificar el reporte.")
    .int("No pudimos identificar el reporte.")
    .positive("No pudimos identificar el reporte."),
  // El mínimo sale del dominio: con un número propio acá, la pantalla y
  // `reports.dismiss` podrían rechazar cosas distintas (lección `coverageFloor`).
  reason: z
    .string()
    .min(MIN_DISMISS_REASON, REPORT_MESSAGES.dismissReason)
    .max(MAX_DISMISS_REASON, `El motivo no puede superar los ${MAX_DISMISS_REASON} caracteres.`),
});

// Sólo X-Real-IP, como el login: el resto de las cabeceras de IP las puede fijar
// el cliente si le pega directo al origen.
async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

type MinuteResult =
  | { ok: true; sel: z.infer<typeof minuteSelectionSchema> | null }
  | { ok: false; error: string };

/** El acta se parsea APARTE y nunca junto con el resto del formulario:
 *  `minuteSelectionSchema` es un `z.union` y `parseForm` sólo sabe reconocer
 *  campos opcionales sobre un ZodObject con `.shape`.
 *
 *  Y es OPCIONAL: el formulario monta el `MinutePicker` recién cuando el
 *  operador tilda "Asentar con acta", así que un POST sin ningún campo
 *  `minute*` significa "sin acta" y no "acta inválida". */
function parseOptionalMinute(formData: FormData): MinuteResult {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && v.trim() !== "" && k.startsWith("minute")) raw[k] = v.trim();
  }
  // `minuteMode` es el radio del selector y viaja siempre que el picker está
  // montado; solo con él no hay acta elegida que resolver.
  if (Object.keys(raw).length === 0 || (Object.keys(raw).length === 1 && "minuteMode" in raw)) {
    return { ok: true, sel: null };
  }
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { ok: false, error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }
  return { ok: true, sel: sel.data };
}

export async function fileReportAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(fileSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;

  // El TIPO manda sobre qué campos son obligatorios, y sale de la base: el
  // formulario lo dibuja, pero un POST puede decir cualquier cosa.
  const report = await prisma.report.findUnique({
    where: { id: d.reportId },
    select: { id: true, kind: true, status: true },
  });
  if (!report) return { error: REPORT_MESSAGES.notPending };
  // La guarda barata y frecuente ANTES de crear un acta: una pestaña vieja o un
  // doble envío llegan acá con el reporte ya resuelto, y sin este corte el
  // segundo POST crearía (y después descartaría) un acta nueva, o chocaría con
  // el unique (tipo, número) y le contaría al operador un problema de numeración
  // que no existe. El servicio revalida igual con su `updateMany` por estado.
  if (report.status !== "received") return { error: REPORT_MESSAGES.notPending };
  // Un reclamo se presenta ANTE alguien: sin organismo el asiento no dice nada.
  // Una iniciativa la trata la Comisión, así que ahí el organismo es opcional.
  if (report.kind === "claim" && !d.agency) return { error: REPORT_MESSAGES.agencyOther };
  if (d.agency === "other" && !d.agencyOther?.trim()) return { error: REPORT_MESSAGES.agencyOther };

  const date = parseCivilDate(d.filedAt, {
    invalidError: "La fecha de presentación no es válida.",
    maxDate: civilDayOf(),
    rangeError: "La fecha de presentación no puede ser futura.",
  });
  if (!date.ok) return { error: date.error };

  // ── El acta, recién acá: después de TODAS las guardas baratas ──────────────
  let minuteId: number | null = null;
  let createdMinute = false;
  if (report.kind === "initiative") {
    const m = parseOptionalMinute(formData);
    if (!m.ok) return { error: m.error };
    if (m.sel) {
      createdMinute = createsNewMinute(m.sel);
      try {
        minuteId = await resolveMinuteId(prisma, m.sel, actor.actorId);
      } catch (e) {
        // `resolveMinuteId` tira en castellano ("Ya existe el acta N° 12 de ese
        // tipo.", "El acta seleccionada no existe."): ese texto va al formulario.
        return { error: e instanceof Error ? e.message : "No pudimos resolver el acta." };
      }
    }
  }

  const result = await reports.file({
    reportId: report.id,
    actorId: actor.actorId,
    agency: d.agency ?? null,
    agencyOther: d.agencyOther ?? null,
    filedAt: date.value,
    reference: d.reference ?? null,
    minuteId,
  });
  if (!result.ok) {
    // Sólo si la creamos NOSOTROS en esta corrida: un acta existente es del
    // libro y la eligió el operador.
    if (createdMinute && minuteId !== null) await discardUnusedMinute(prisma, minuteId);
    return { error: result.error };
  }

  await audit({
    userId: actor.actorId,
    action: "report_filed",
    entity: "report",
    entityId: report.id,
    detail: { agency: d.agency ?? null, minuteId },
    ip: await clientIp(),
  });
  // DESPUÉS del asiento y best-effort: el notificador se traga sus propios
  // errores (un SMTP caído no puede deshacer una presentación ya registrada).
  await reportNotifier.sendFiled(report.id);
  // La lista y la ficha son `force-dynamic`, así que esto no invalida ningún
  // caché de datos: lo que limpia es el Router Cache del cliente, para que
  // volver a la cola no muestre por 30 s la fila con el estado viejo.
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${report.id}`);
  return { done: true };
}

export async function dismissReportAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(dismissSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { reportId, reason } = parsed.data;

  const result = await reports.dismiss({ reportId, actorId: actor.actorId, reason });
  if (!result.ok) return { error: result.error };

  // `detail: {}` y no el motivo: el texto queda en la ficha, no en el registro.
  await audit({
    userId: actor.actorId,
    action: "report_dismissed",
    entity: "report",
    entityId: reportId,
    detail: {},
    ip: await clientIp(),
  });
  // Sin correo a propósito (spec §9): desestimar no se le avisa al vecino.
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${reportId}`);
  return { done: true };
}
