// POST /api/cron/accrual — lo dispara el crontab del VPS todos los días a las
// 00:30 (docs/11, crontab final de 6 líneas). ACTÚA sólo el día 1: la decisión
// vive en el módulo (`accrualCron.willAct()`), no acá, y un día que no
// corresponde NO abre fila en `cron_runs` — /admin/salud muestra la última
// corrida EFECTIVA, así que una fila vacía por día sería ruido que tapa la señal.
//
// Escotilla de re-disparo (enmienda del operador, 24/08/2026): `?force=1` saltea
// la guarda del día 1 y `?upTo=YYYY-MM` elige hasta qué mes devengar. Sin la
// escotilla, una corrida fallida del 01/10 (VPS caído, un hipo de la base) recién
// se recuperaba el 01/11, y durante todo octubre los socios al día se mostraban
// "al día" debiendo septiembre. No hay barrera nueva: los dos parámetros viajan
// detrás del mismo `CRON_SECRET` que ya protege el endpoint.
import { audit } from "@/lib/audit";
import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { accrualCron } from "@/lib/treasury/accrual";
import { addMonths, comparePeriods, currentPeriod, isPeriod, type Period } from "@/lib/treasury/periods";
import { IMPORT_COVERAGE_FLOOR } from "@/lib/treasury/rules";

export const runtime = "nodejs";

/** Los dos valores que cuentan como "sí" en `?force=`. Es una allowlist y no un
 *  `!== null`: `?force=0` leído como fuerza sería exactamente lo contrario de lo
 *  que escribió el operador. Cualquier otro valor es un 400, no un silencio. */
const FORCE_VALUES = new Set(["1", "true"]);

/** El techo y el piso de `?upTo=`, los DOS derivados y ninguno literal.
 *
 *  Techo = el mes VENCIDO (mes corriente − 1). La fila de la cuota del mes M nace
 *  el 01/M+1, cuando ya es mora (decisión del operador, 23/08/2026); devengar el
 *  mes corriente le crearía a los 35 devengantes una `pending` que todavía no
 *  vence, y los 21 puntos que cuentan `pending` a secas —Deudores, niveles de
 *  mora, cesantía— la leerían como atraso. Es plata mal cobrada, no un no-op.
 *
 *  Piso = `IMPORT_COVERAGE_FLOOR` (el primer mes que la foto de deuda NO cubre).
 *  Por debajo de ahí `periodsToAccrue` devuelve vacío para TODOS los socios, así
 *  que la corrida no podría crear nada: un `upTo` viejo es un typo del operador y
 *  rebotarlo es más honesto que devolverle un summary en cero.
 *
 *  Hasta el 01/10/2026 el piso queda POR ENCIMA del techo y la ventana está
 *  vacía: es correcto, porque hasta esa fecha no hay ningún mes que este cron
 *  pueda devengar (la foto cubre hasta agosto y septiembre recién vence el 01/10).
 *  La corrida sin `upTo` sigue andando en esa ventana y no crea nada. */
function upToBounds(now: Date): { min: Period; max: Period } {
  return { min: IMPORT_COVERAGE_FLOOR, max: addMonths(currentPeriod(now), -1) };
}

type Params =
  | { ok: true; force: boolean; upTo?: Period }
  | { ok: false; response: Response };

/** Se valida ANTES de mirar el calendario y ANTES de abrir el `CronRun`: un
 *  parámetro basura no toca la base ni deja rastro de corrida. Los crons no
 *  lanzan por regla de negocio — esto es un 400 con el rango en el cuerpo, no un
 *  500 en un log que nadie mira. */
function parseParams(req: Request, now: Date): Params {
  const q = new URL(req.url).searchParams;
  const bad = (error: string, message: string) => ({
    ok: false as const,
    response: Response.json({ error, message }, { status: 400 }),
  });

  const rawForce = q.get("force");
  if (rawForce !== null && !FORCE_VALUES.has(rawForce)) {
    return bad("bad_force", "El parámetro force sólo acepta 1 o true. Omitilo para la corrida automática.");
  }

  const rawUpTo = q.get("upTo");
  if (rawUpTo === null) return { ok: true, force: rawForce !== null };
  if (!isPeriod(rawUpTo)) {
    return bad("bad_up_to", "El parámetro upTo tiene que ser un período con formato AAAA-MM.");
  }
  const { min, max } = upToBounds(now);
  if (comparePeriods(rawUpTo, min) < 0 || comparePeriods(rawUpTo, max) > 0) {
    return bad("up_to_out_of_range", `El parámetro upTo tiene que estar entre ${min} y ${max} inclusive.`);
  }
  return { ok: true, force: rawForce !== null, upTo: rawUpTo };
}

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  const params = parseParams(req, new Date());
  if (!params.ok) return params.response;
  const { force, upTo } = params;

  if (!force && !accrualCron.willAct()) return Response.json({ skipped: "not_first_day" });

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.accrual, startedAt: new Date() } });
  try {
    // Una corrida forzada ES una corrida: escribe su `CronRun` como cualquier
    // otra, y `forced` la distingue en /admin/salud. El campo va SIEMPRE, también
    // en `false`: si sólo apareciera al forzar, la pantalla no podría separar
    // "corrida automática" de "fila vieja sin el campo".
    const summary = { ...(await accrualCron.run({ upTo })), forced: force };
    const ok = summary.errors.length === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    // Sin datos personales: contadores, el mes devengado y los ids internos que
    // ya vienen recortados en `errors` (docs/08). Los parámetros usados quedan
    // asentados en el mismo objeto: `forced`, y `upTo`, que es el efectivo —el
    // que mandó el operador cuando mandó uno—.
    await audit({ action: "accrual_cron", entity: "cron", entityId: String(run.id), detail: summary });
    return Response.json(summary, { status: ok ? 200 : 207 });
  } catch (e) {
    // `run()` ya se come el fallo de cada socio: llegar acá es que se cayó una
    // consulta entera. Al cuerpo no va el mensaje (lo lee un curl en un log).
    console.error("[cron] accrual: la corrida falló entera", safeMessage(e));
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, error: safeMessage(e).slice(0, 500) },
    }).catch(() => {});
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
}
