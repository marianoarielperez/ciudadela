// Guarda de los endpoints de cron. No hay sesión ni cookie: lo único que los
// separa de internet es el `CRON_SECRET`.
//
// Vivía duplicada palabra por palabra en `applications/route.ts` y
// `reconcile/route.ts`; con los tres crons de la 4C serían cinco copias de una
// comparación criptográfica, que es exactamente el tipo de código que no se
// puede permitir divergir.
//
// `timingSafeEqual` y `Buffer` exigen Node: toda ruta que la use declara
// `export const runtime = "nodejs"` (en el runtime Edge la guarda no existiría).
import { timingSafeEqual } from "node:crypto";

/** Los cinco `CronRun.job` del sistema. Es un `Record` con clave = valor para
 *  que un typo no compile: sin esto, un `job: "acrual"` deja a /admin/salud
 *  mostrando una corrida fantasma y la buena "nunca corrió". */
export const CRON_JOBS = {
  reconcile: "reconcile",
  applications: "applications",
  accrual: "accrual",
  reminder: "reminder",
  digest: "digest",
} as const;

export type CronJob = (typeof CRON_JOBS)[keyof typeof CRON_JOBS];

/** El orden es el de la pantalla de salud: primero los que ya corren. */
export const CRON_JOB_LIST: readonly CronJob[] = [
  CRON_JOBS.reconcile, CRON_JOBS.applications, CRON_JOBS.accrual, CRON_JOBS.reminder, CRON_JOBS.digest,
];

export type CronAuthResult = { ok: true } | { ok: false; response: Response };

/** Orden de las guardas, idéntico al que ya tenían los dos crons:
 *  1. sin `CRON_SECRET` configurado → 503 (el endpoint no existe a efectos
 *     prácticos, que es lo que corresponde donde nadie debería llamarlo);
 *  2. bearer que no coincide → 401.
 *  El largo se compara antes porque `timingSafeEqual` tira si difiere: filtra el
 *  largo del secreto y nada más, que no es un secreto. */
export function checkCronAuth(req: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, response: Response.json({ error: "not_configured" }, { status: 503 }) };
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}
