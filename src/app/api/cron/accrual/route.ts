// POST /api/cron/accrual — lo dispara el crontab del VPS todos los días a las
// 00:30 (docs/11, crontab final de 6 líneas). ACTÚA sólo el día 1: la decisión
// vive en el módulo (`accrualCron.willAct()`), no acá, y un día que no
// corresponde NO abre fila en `cron_runs` — /admin/salud muestra la última
// corrida EFECTIVA, así que una fila vacía por día sería ruido que tapa la señal.
import { audit } from "@/lib/audit";
import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { accrualCron } from "@/lib/treasury/accrual";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;
  if (!accrualCron.willAct()) return Response.json({ skipped: "not_first_day" });

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.accrual, startedAt: new Date() } });
  try {
    const summary = await accrualCron.run();
    const ok = summary.errors.length === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    // Sin datos personales: contadores, el mes devengado y los ids internos que
    // ya vienen recortados en `errors` (docs/08).
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
