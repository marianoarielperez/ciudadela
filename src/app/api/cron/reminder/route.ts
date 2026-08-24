// POST /api/cron/reminder — crontab del VPS, todos los días a las 10:00. ACTÚA
// el ÚLTIMO día civil del mes (`reminderCron.willAct()`): el aviso sale la
// víspera de la mora. Un día que no corresponde no abre `CronRun` — serían 29
// filas vacías por mes tapando la única que importa.
//
// Escotilla de re-disparo (enmienda del operador, 24/08/2026): `?force=1` saltea
// la guarda del último día, con la MISMA forma que la del devengo
// (`api/cron/accrual/route.ts`) — misma allowlist de valores, mismo 400, mismo
// `forced` en el summary y en el asiento—. Sin la escotilla, una corrida perdida
// el 30 (VPS caído, o el operador que se entera el 1° a la mañana) no se
// recuperaba nunca: ese mes nadie recibía el aviso. La ventana útil pasó, pero el
// aviso sigue sirviendo — y el correo lo dice: `run()` compara el período avisado
// contra el día civil de la corrida y manda "venció y quedó impaga" en lugar de
// "vence mañana". No hay barrera nueva: el parámetro viaja detrás del mismo
// `CRON_SECRET` que ya protege el endpoint.
import { audit } from "@/lib/audit";
import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { reminderCron } from "@/lib/treasury/reminder";

export const runtime = "nodejs";

/** Los dos valores que cuentan como "sí" en `?force=`, idénticos a los del
 *  devengo. Es una allowlist y no un `!== null`: `?force=0` leído como fuerza
 *  sería exactamente lo contrario de lo que escribió el operador. Cualquier otro
 *  valor es un 400, no un silencio. */
const FORCE_VALUES = new Set(["1", "true"]);

type Params = { ok: true; force: boolean } | { ok: false; response: Response };

/** Se valida ANTES de mirar el calendario y ANTES de abrir el `CronRun`: un
 *  parámetro basura no toca la base ni deja rastro de corrida. Los crons no
 *  lanzan por regla de negocio — esto es un 400 con el motivo en el cuerpo, no
 *  un 500 en un log que nadie mira. */
function parseParams(req: Request): Params {
  const rawForce = new URL(req.url).searchParams.get("force");
  if (rawForce !== null && !FORCE_VALUES.has(rawForce)) {
    return {
      ok: false,
      response: Response.json(
        { error: "bad_force", message: "El parámetro force sólo acepta 1 o true. Omitilo para la corrida automática." },
        { status: 400 },
      ),
    };
  }
  return { ok: true, force: rawForce !== null };
}

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  const params = parseParams(req);
  if (!params.ok) return params.response;
  const { force } = params;

  if (!force && !reminderCron.willAct()) return Response.json({ skipped: "not_last_day" });

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.reminder, startedAt: new Date() } });
  try {
    // Una corrida forzada ES una corrida: escribe su `CronRun` como cualquier
    // otra, y `forced` la distingue en /admin/salud. El campo va SIEMPRE, también
    // en `false`: si sólo apareciera al forzar, la pantalla no podría separar
    // "corrida automática" de "fila vieja sin el campo".
    const summary = { ...(await reminderCron.run()), forced: force };
    const ok = summary.errors.length === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    // Sin datos personales: contadores, el período y los ids internos que ya
    // vienen recortados en `errors` (docs/08). Ninguna dirección de email. Los
    // parámetros usados quedan en el mismo objeto (`forced`), y `expired` deja
    // asentado con qué texto salió el aviso.
    await audit({ action: "reminder_cron", entity: "cron", entityId: String(run.id), detail: summary });
    return Response.json(summary, { status: ok ? 200 : 207 });
  } catch (e) {
    // `run()` ya se come el fallo de cada socio: llegar acá es que se cayó una
    // consulta entera. Al cuerpo no va el mensaje (lo lee un curl en un log).
    console.error("[cron] reminder: la corrida falló entera", safeMessage(e));
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, error: safeMessage(e).slice(0, 500) },
    }).catch(() => {});
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
}
