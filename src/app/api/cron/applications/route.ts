// POST /api/cron/applications — lo dispara el crontab del VPS (docs/03), una
// vez por día. Es el primer endpoint de cron del proyecto: no hay sesión ni
// cookie, lo único que lo separa de internet es el `CRON_SECRET`.
//
// Autenticación por comparación timing-safe; sin secreto configurado el
// endpoint no existe a efectos prácticos (503), que es lo que corresponde en un
// entorno donde nadie debería estar llamándolo.
import { timingSafeEqual } from "node:crypto";
import { ApplicationsCronFailure, applicationsCron, cronPartial } from "@/lib/applications/cron";
import { audit } from "@/lib/audit";
import { safeMessage } from "@/lib/mp/webhook-processor";

// `timingSafeEqual` y `Buffer` exigen Node: en el runtime Edge la guarda no
// existiría (mismo criterio que el webhook de MP).
export const runtime = "nodejs";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  // `timingSafeEqual` tira si los largos difieren, así que el largo se compara
  // antes. Filtra el largo del secreto y nada más, que no es un secreto.
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

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
    // caerse. Sin este asiento esa mitad no queda registrada en ningún lado: el
    // 500 sólo dice que algo se rompió, no qué alcanzó a hacer.
    const partial = cronPartial(e);
    await audit({
      action: "applications_cron",
      entity: "application",
      detail: { ...(partial ?? { reminded: 0, expired: 0, errors: 0 }), failed: true },
    });
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }

  // Sin datos personales: tres contadores (docs/08).
  await audit({ action: "applications_cron", entity: "application", detail: result });
  return Response.json(result);
}
