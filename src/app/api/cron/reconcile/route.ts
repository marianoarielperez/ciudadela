// POST /api/cron/reconcile — lo dispara el crontab del VPS a las 03:00
// (docs/11 Parte H). Mismo esquema de autenticación que `/api/cron/applications`
// y estrena el registro en `cron_runs` (spec M4 §8): la última corrida de cada
// cron es lo que `/admin/salud` (4C) va a mostrar.
import { timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/audit";
import { safeMessage } from "@/lib/log-safe";
import { reconcile } from "@/lib/mp/reconcile";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const run = await prisma.cronRun.create({ data: { job: "reconcile", startedAt: new Date() } });
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
