// POST /api/cron/applications — lo dispara el crontab del VPS (docs/03), una
// vez por día. Es el primer endpoint de cron del proyecto: no hay sesión ni
// cookie, lo único que lo separa de internet es el `CRON_SECRET`.
//
// La guarda (comparación timing-safe; sin secreto configurado el endpoint no
// existe a efectos prácticos) vive desde la 4C en `@/lib/cron/auth`, compartida
// con los otros cuatro crons.
import { ApplicationsCronFailure, applicationsCron, cronPartial } from "@/lib/applications/cron";
import { audit } from "@/lib/audit";
import { CRON_JOBS, checkCronAuth } from "@/lib/cron/auth";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";

// `timingSafeEqual` y `Buffer` exigen Node: en el runtime Edge la guarda no
// existiría (mismo criterio que el webhook de MP).
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  // La corrida se abre ANTES de trabajar: si el proceso muere a mitad, la fila
  // queda con `finishedAt: null` y `ok: false`, que /admin/salud muestra como
  // "colgada" — distinto de "corrió mal". Hasta la 4C este cron no dejaba
  // ninguna huella en `cron_runs` y era el único de los dos que corría en
  // producción sin quedar registrado.
  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.applications, startedAt: new Date() } });
  let result;
  try {
    result = await applicationsCron.run();
  } catch (e) {
    // `run()` ya se come los fallos de cada solicitud: llegar acá significa que
    // se cayó una consulta entera. Al cuerpo no va el mensaje —la respuesta la
    // lee un `curl` que escribe en un log de texto plano—, sólo al log del
    // servidor, y sin el objeto de error. El mensaje pasa por `safeMessage`
    // porque un error de base o de SMTP puede traer la dirección del vecino.
    const reason = e instanceof ApplicationsCronFailure ? e.reason : e;
    console.error("[cron] applications: la corrida falló entera", safeMessage(reason));
    // Aunque falle, la corrida pudo haber mandado recordatorios reales antes de
    // caerse. Sin esto esa mitad no queda registrada en ningún lado.
    const partial = cronPartial(e);
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, summary: partial ?? undefined, error: safeMessage(reason).slice(0, 500) },
    }).catch(() => {});
    await audit({
      action: "applications_cron",
      entity: "application",
      detail: { ...(partial ?? { reminded: 0, expired: 0, errors: 0 }), failed: true },
    });
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }

  // 207 y no 200 cuando hubo errores por ítem: es la única señal de que algo se
  // rompió en una corrida que igual terminó (misma semántica que el reconcile,
  // docs/11 §H).
  const ok = result.errors === 0;
  await prisma.cronRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), ok, summary: result },
  });
  // Sin datos personales: tres contadores (docs/08).
  await audit({ action: "applications_cron", entity: "application", detail: result });
  return Response.json(result, { status: ok ? 200 : 207 });
}
