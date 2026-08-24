// POST /api/cron/reminder — crontab del VPS, todos los días a las 10:00. ACTÚA
// el ÚLTIMO día civil del mes (`reminderCron.willAct()`): el aviso sale la
// víspera de la mora. Un día que no corresponde no abre `CronRun` — serían 29
// filas vacías por mes tapando la única que importa.
import { audit } from "@/lib/audit";
import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { reminderCron } from "@/lib/treasury/reminder";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  if (!reminderCron.willAct()) return Response.json({ skipped: "not_last_day" });

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.reminder, startedAt: new Date() } });
  try {
    const summary = await reminderCron.run();
    const ok = summary.errors.length === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    // Sin datos personales: contadores, el período y los ids internos que ya
    // vienen recortados en `errors` (docs/08). Ninguna dirección de email.
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
