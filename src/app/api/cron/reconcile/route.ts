// POST /api/cron/reconcile — lo dispara el crontab del VPS a las 03:17
// (docs/11 Parte H). Mismo esquema de autenticación que `/api/cron/applications`
// y estrena el registro en `cron_runs` (spec M4 §8): la última corrida de cada
// cron es lo que `/admin/salud` (4C) va a mostrar.
import { audit } from "@/lib/audit";
import { CRON_JOBS, checkCronAuth } from "@/lib/cron/auth";
import { safeMessage } from "@/lib/log-safe";
import { reconcile } from "@/lib/mp/reconcile";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.reconcile, startedAt: new Date() } });
  try {
    const summary = await reconcile.run();
    const ok = summary.errors.length === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    // Sin datos personales: contadores y códigos (docs/08).
    await audit({ action: "reconcile_cron", entity: "cron", entityId: String(run.id), detail: summary });
    return Response.json(summary, { status: ok ? 200 : 207 });
  } catch (e) {
    // `run()` ya se come los fallos por paso: llegar acá es que se cayó la base
    // antes de empezar. Al cuerpo no va el mensaje (lo lee un curl en un log).
    console.error("[cron] reconcile: la corrida falló entera", safeMessage(e));
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error: safeMessage(e).slice(0, 500) } }).catch(() => {});
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
}
