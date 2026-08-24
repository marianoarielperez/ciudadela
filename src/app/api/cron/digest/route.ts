// POST /api/cron/digest — crontab del VPS, todos los días a las 07:30.
//
// Dos pasos a propósito: primero se junta la novedad, y sólo si hay algo que
// contar se abre la corrida. Un día tranquilo no deja fila en `cron_runs`
// porque no enviar ES el desenlace sano (spec §6 y §8 D2), y una fila
// `ok: true` que dice "no mandé nada" entrenaría al operador a ignorar el
// tablero. La contracara honesta: si `collect()` se cae, no hay `CronRun` que
// mostrar — el 500 queda en /var/log/sigev-cron.log y /admin/salud lo ve como
// antigüedad (el job pasa a "stale").
//
// Para ESTA asociación el día tranquilo va a ser la REGLA, no la excepción: con
// 160 vigentes y el débito concentrado alrededor del 10, va a haber semanas
// enteras sin una sola novedad. O sea que `digest` puede pasar días sin escribir
// una fila estando perfectamente sano. /admin/salud (Task 13) no puede medirlo
// por antigüedad como a los otros cuatro jobs, o arranca en rojo por diseño.
//
// Sin escotilla `?force=`, a diferencia del devengo y del recordatorio: los dos
// ACTÚAN un día puntual del mes y una corrida perdida no se recuperaba nunca.
// Este corre todos los días y su ventana es el día civil anterior, así que
// "forzarlo" sería volver a mandar el mismo resumen de ayer.
import { audit } from "@/lib/audit";
import { digestCron, hasNews, type DigestData } from "@/lib/admin/digest";
import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  let data: DigestData;
  try {
    data = await digestCron.collect();
  } catch (e) {
    console.error("[cron] digest: no se pudieron juntar las novedades", safeMessage(e));
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
  if (!hasNews(data)) return Response.json({ skipped: "no_news", day: data.label });

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.digest, startedAt: new Date() } });
  try {
    const summary = await digestCron.send(data);
    // `recipients: 0` NO es un fallo: sin la clave cargada no hay a quién
    // mandarle, y la corrida cierra en verde. Tampoco lo es un bloqueo por
    // `EMAIL_ALLOWLIST`, que `send()` cuenta aparte en `allowlistBlocked`: con la
    // lista puesta —el estado de producción hasta el checklist de lanzamiento—
    // esto cerraría en rojo todas las noches con novedades. Lo que pinta de rojo
    // es un envío que se INTENTÓ contra la red y no salió.
    const ok = summary.failed === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    // Sin datos personales: el día, los contadores y los CÓDIGOS de los fallos
    // de envío. Ninguna dirección de la Comisión (docs/08).
    await audit({ action: "digest_cron", entity: "cron", entityId: String(run.id), detail: summary });
    return Response.json(summary, { status: ok ? 200 : 207 });
  } catch (e) {
    // `send()` ya se come el fallo de CADA destinatario: llegar acá es que se
    // cayó el armado del correo entero o la lectura de la configuración.
    console.error("[cron] digest: la corrida falló entera", safeMessage(e));
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, error: safeMessage(e).slice(0, 500) },
    }).catch(() => {});
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
}
