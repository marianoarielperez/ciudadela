// Los datos de /admin/salud (spec 4C §8). Prisma INYECTADO: el módulo se prueba
// sin `.env`.
//
// Alcance (D3): tablero de una mirada. Dice QUÉ está mal y DESDE CUÁNDO, con el
// dato mínimo para ir a buscarlo. El diagnóstico fino sigue en `pm2 logs sigev`
// y en las tablas — y eso es un techo real, no una omisión: los ids de lo que
// falló en el reconcile van al log y NO al summary (decisión de
// `mp/reconcile.ts:124-127`, para que la causa sobreviva al recorte).
//
// Sin tablas nuevas: `cron_runs`, `webhook_events`, `audit_log` por acción,
// `notifications` por estado, `receipts` sin sellar y el `LAST_OK` del backup en
// disco.
import type { NotificationType, PrismaClient } from "@/generated/prisma/client";
import { CRON_JOB_LIST, type CronJob } from "@/lib/cron/auth";
import { maskEmails } from "@/lib/log-safe";
import { isCharging, isNotCancelled } from "@/lib/mp/subscription-status";
// Módulo sin dependencias: no rompe la premisa de que este archivo se prueba
// sin `.env` (el mailer del recibo, en cambio, evalúa Prisma al importarse).
import { receiptNumberOf, receiptSummaryOf } from "@/lib/treasury/receipt-summary";

/** Cada cuánto se espera una corrida EFECTIVA de cada job. No es el intervalo
 *  del crontab: `accrual` y `reminder` corren a diario y actúan una vez por mes,
 *  y `digest` no escribe fila los días sin novedades. Medir a los cinco con la
 *  misma vara pintaría de rojo tres crons sanos varias veces por semana. */
export const CRON_EXPECTATION: Record<CronJob, { label: string; everyHours: number }> = {
  reconcile: { label: "Conciliación con Mercado Pago", everyHours: 24 },
  applications: { label: "Mantenimiento de solicitudes", everyHours: 24 },
  // Actúa el día 1; el recordatorio, el último día del mes. Los días que no
  // actúan no abren `CronRun`, así que su antigüedad normal es de un mes.
  accrual: { label: "Devengo de cuotas", everyHours: 24 * 31 },
  reminder: { label: "Recordatorio de vencimiento", everyHours: 24 * 31 },
  // El resumen no se manda los días sin novedades, así que su fila puede faltar
  // varios días seguidos sin que nada esté mal — y para ESTA asociación (160
  // vigentes, el débito alrededor del 10) el día tranquilo es la regla, no la
  // excepción (`api/cron/digest/route.ts`, cabecera). Con el doble del período,
  // el aviso llega recién a los 14 días: una quincena sin UNA sola novedad en
  // todo el sistema sí amerita mirar si el cron sigue instalado.
  digest: { label: "Resumen diario a la Comisión", everyHours: 24 * 7 },
};

export type CronState = "ok" | "errors" | "stale" | "hung" | "never";

/** Una corrida abierta hace menos de esto puede estar corriendo AHORA. */
const RUNNING_GRACE_HOURS = 2;

export function cronState(
  run: { startedAt: Date; finishedAt: Date | null; ok: boolean } | null,
  everyHours: number,
  now: Date,
): CronState {
  if (!run) return "never";
  const ageHours = (now.getTime() - run.startedAt.getTime()) / 3_600_000;
  // `finishedAt IS NULL` con `startedAt` viejo es una corrida que se abrió y
  // nunca cerró: el proceso murió. Es distinto de `ok: false` —que significa
  // "terminó y algo falló"— y hoy son indistinguibles si se mira sólo el
  // booleano, porque `ok` arranca en `false`.
  // Umbral inclusivo: una corrida que lleva DOS horas abierta ya está colgada.
  // Las cinco tardan minutos, y la más pesada —la conciliación— la corta
  // Cloudflare a los ~100 s (docs/11).
  if (run.finishedAt === null) return ageHours >= RUNNING_GRACE_HOURS ? "hung" : "ok";
  if (!run.ok) return "errors";
  // El doble del período esperado: un atraso de una corrida es ruido de
  // calendario; dos seguidas es que dejó de correr.
  return ageHours > everyHours * 2 ? "stale" : "ok";
}

export type CronHealth = {
  job: CronJob;
  label: string;
  everyHours: number;
  state: CronState;
  lastRun: {
    id: string; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; summary: unknown;
  } | null;
};

export type MpHealth = {
  /** El último evento RECIBIDO. Es la señal más importante del panel: un
   *  preapproval ignora `notification_url`, así que si la configuración de
   *  webhooks del panel de MP se rompe, los débitos dejan de avisar sin ninguna
   *  otra señal. */
  lastEventAt: Date | null;
  /** Avisos que quedaron con error y sin procesar en las últimas
   *  `WEBHOOK_ERROR_WINDOW_HOURS`. CON ventana, y el motivo importa: el éxito
   *  limpia `error` y sella `processedAt`, pero el fallo definitivo —cuando MP
   *  agota sus reintentos— deja la fila así PARA SIEMPRE y no hay pantalla ni
   *  acción que la cierre. Sin ventana, un evento envenenado de hace tres meses
   *  deja un `1` permanente en el tablero, que es exactamente la alarma que
   *  ninguna acción apaga. La ventana es la misma que la de la conciliación
   *  (`RECONCILE_WINDOW_MS`, 72 h): dentro de ella el cron todavía es la red;
   *  fuera, el diagnóstico vive en el log y en la tabla, no acá. */
  unprocessedWithError: number;
  /** Firmas rechazadas en las últimas `SIGNATURE_WINDOW_HOURS`. */
  signatureRejections: number;
};

export type AmountMismatch = {
  id: string; createdAt: Date; paymentId: number | null; memberId: number | null;
  memberName: string | null; n: number | null; expected: number | null; amount: number | null;
};

/** Los dos cruces entre estado de suscripción y estado de SOCIO. Ninguna de las
 *  dos preguntas se puede contestar mirando sólo la suscripción, y las dos son
 *  plata: ver `classifyDebits`. */
export type DebitHealth = {
  /** Socios VIGENTES (activos o suspendidos) que tienen débito y del que no
   *  entra plata. */
  stoppedForActive: number;
  /** Socios DADOS DE BAJA con una suscripción que no se puede afirmar muerta:
   *  se les puede seguir cobrando. */
  aliveForWithdrawn: number;
};

export type MoneyHealth = {
  inboxOpen: number;
  /** Cuántas cayeron en la bandeja DESDE SIEMPRE. Es historia, no trabajo
   *  pendiente: sólo puede crecer. Lo pendiente es `inboxOpen`. */
  inboxTotal: number;
  debits: DebitHealth;
  mismatches: AmountMismatch[];
  /** Cuántos asientos `link_amount_mismatch` hay DESDE SIEMPRE. Es HISTORIA, no
   *  una cola: el asiento no tiene estado que resolver y nada lo baja nunca. Se
   *  devuelve sólo para que la lista recortada no mienta sobre su largo — la
   *  pantalla lo redacta como historia ("N registrados"), jamás como alarma. */
  mismatchesEver: number;
};

export type FailedNotification = {
  id: string; sentAt: Date; type: NotificationType; error: string | null;
  payloadSummary: string | null; memberId: number | null; memberName: string | null;
  applicationId: number | null;
  /** Número de recibo si el aviso era un recibo (único camino de reenvío). */
  receiptNumber: string | null;
};

/** Por qué este recibo sigue sin sellar `emailedAt` (spec §8, panel 6). El sello
 *  vacío es AMBIGUO y cada caso se atiende de una manera:
 *
 *    not_attempted — NO hay fila de `Notification` para este recibo. Se llama
 *               así, y no "diferido", porque la ausencia de fila la producen al
 *               menos CUATRO caminos y el sistema no puede distinguirlos: (1) el
 *               diferido por `MAIL_BATCH_CAP`, (2) el bloqueo por
 *               `EMAIL_ALLOWLIST` —el transporte tira ANTES de que el mailer
 *               escriba, y `sendReceiptEmail` se lo come en su catch—, (3)
 *               `readPdf` y `regenerate` fallando los dos, (4) cualquier otra
 *               excepción previa al mailer. Sólo el (1) se arregla reenviando;
 *               con la allowlist puesta —el estado de producción hasta el
 *               checklist de lanzamiento— el (2) es el miembro DOMINANTE, y un
 *               reenvío ahí vuelve a bloquearse sin escribir nada. Por eso el
 *               estado dice lo que se sabe ("no se intentó"), y la acción de
 *               reenvío tiene que MOSTRAR el resultado: `sendReceiptEmail`
 *               devuelve `{ reason: "error", code: "EMAIL_ALLOWLIST" }` en ese
 *               caso, y ése es el código que la pantalla traduce a "este entorno
 *               tiene los envíos restringidos". Un botón que no reporta lo que
 *               pasó es el que miente, no el botón.
 *    failed   — se intentó y el envío se cayó: hay fila `failed` con su código.
 *               Reenviar tiene sentido.
 *    no_email — no hay casilla utilizable. No hay nada que reenviar hasta que el
 *               socio tenga email; ofrecer el botón sería mentir.
 *    sent     — salió (hay fila `sent`) y lo que falló fue el UPDATE del sello
 *               (`receipt-email.ts`, último try/catch). Reenviarlo le duplica el
 *               PDF al socio: se muestra para que se entienda por qué está en la
 *               lista, sin acción. */
export type PendingReceiptState = "not_attempted" | "failed" | "no_email" | "sent";

export type PendingReceipt = {
  id: number; number: string; issuedAt: Date; state: PendingReceiptState;
  memberId: number | null; applicationId: number | null; memberName: string | null;
  /** Código del fallo cuando `state === "failed"`. Nunca la dirección. */
  error: string | null;
};

export type ReceiptsHealth = { rows: PendingReceipt[]; total: number };

export type HealthSnapshot = {
  now: Date;
  crons: CronHealth[];
  mp: MpHealth;
  money: MoneyHealth;
  failed: FailedNotification[];
  /** Cuántas `Notification.failed` hay DESDE SIEMPRE. Es HISTORIA, no una cola:
   *  las notificaciones no se borran nunca y un reenvío exitoso agrega una fila
   *  `sent` sin tocar la `failed`, así que el número no baja ni cuando el
   *  problema se arregló. Se devuelve sólo para que la lista recortada (las 50
   *  más recientes) no mienta sobre su largo. La pantalla lo redacta como
   *  historia, nunca como trabajo pendiente. */
  failedEver: number;
  receipts: ReceiptsHealth;
};

/** Ventana del contador de firmas rechazadas. */
export const SIGNATURE_WINDOW_HOURS = 24;
/** Ventana del contador de avisos con error sin procesar. Es la misma que la de
 *  la conciliación (`RECONCILE_WINDOW_MS`, 72 h) y por el mismo motivo: dentro
 *  de ella el cron nocturno todavía puede recuperar el pago. La constante se
 *  repite en vez de importarse porque `mp/reconcile.ts` construye su servicio
 *  con `prisma` al evaluarse, y este módulo se prueba sin `.env`. */
export const WEBHOOK_ERROR_WINDOW_HOURS = 72;
const MISMATCH_LIMIT = 20;
const FAILED_LIMIT = 50;
const RECEIPT_LIMIT = 50;

/** Estados de socio que cuentan como VIGENTE: un suspendido sigue siendo socio y
 *  sigue debiendo la cuota (REG-15). La baja es `withdrawn`. */
const CURRENT_MEMBER_STATUSES: readonly string[] = ["active", "suspended"];

export type HealthDb = Pick<
  PrismaClient,
  "cronRun" | "webhookEvent" | "auditLog" | "notification" | "mpUnmatchedPayment" | "mpSubscription" | "member" | "receipt"
>;

/** Las dos formas en que el débito automático y la ficha se desalinean. Función
 *  PURA sobre las filas de `mp_subscriptions` que tienen socio, porque la
 *  pregunta correcta cruza los dos estados y ninguno de los dos alcanza solo:
 *
 *   - **`stoppedForActive`** — socio vigente cuyo débito dejó de cobrar. Mirar
 *     sólo la suscripción dejaba afuera la `cancelled` de un socio VIGENTE, que
 *     es justamente donde la plata deja de entrar EN SILENCIO: el vecino la
 *     canceló desde su app, o MP la dio de baja tras varios rechazos, y hoy eso
 *     se ve una sola noche en `subscriptionsDrifted` (que es un delta de la
 *     corrida) y después desaparece.
 *   - **`aliveForWithdrawn`** — socio dado de baja al que se le puede seguir
 *     cobrando. Mirar sólo la suscripción dejaba afuera la `authorized`, que es
 *     el caso que los tres avisos de `members/auto-debit.ts` anuncian:
 *     `withdrawWithDebits` cancela DESPUÉS del commit y es best-effort, así que
 *     una baja con MP caído deja el débito vivo. La salida existe y la apaga: el
 *     botón «Cancelar el débito» de Tesorería → Suscripciones.
 *
 *  Se cuenta por SOCIO y no por fila: un vecino que rehace su débito deja la
 *  cancelada vieja al lado de la nueva, y contar filas lo dejaría alarmado para
 *  siempre. Las filas sin socio no se miran: una `pending` huérfana es un alta
 *  web que el vecino abandonó antes de autorizar.
 *
 *  Los dos son "para revisar", no "algo se rompió": el socio vigente que se pasó
 *  a efectivo y le cancelaron el débito queda contado en `stoppedForActive` sin
 *  que haya nada que arreglar. Es el único falso positivo conocido y se apaga
 *  como se apaga cualquier otro: mirando la ficha. */
export function classifyDebits(
  rows: ReadonlyArray<{ memberId: number | null; status: string; member: { status: string } | null }>,
): DebitHealth {
  const stopped = new Set<number>();
  const charging = new Set<number>();
  const alive = new Set<number>();
  for (const r of rows) {
    if (r.memberId === null || r.member === null) continue;
    if (CURRENT_MEMBER_STATUSES.includes(r.member.status)) {
      (isCharging(r.status) ? charging : stopped).add(r.memberId);
    } else if (isNotCancelled(r.status)) {
      // Lista NEGRA acá: contra un socio dado de baja, un estado que MP invente
      // cuenta como débito posible. No saber es peor que avisar de más.
      alive.add(r.memberId);
    }
  }
  for (const id of charging) stopped.delete(id);
  return { stoppedForActive: stopped.size, aliveForWithdrawn: alive.size };
}

/** La casilla a la que iría el recibo, con la MISMA condición que usa
 *  `sendReceiptEmail` para elegir destinatario: la ficha manda sobre la
 *  solicitud, y un socio con la casilla rebotada no recibe nada (su recibo NO se
 *  desvía a la dirección de la solicitud vieja). Replicarla acá es lo que separa
 *  "no tiene a dónde ir" de "no se intentó". */
function hasUsableTarget(
  member: { email: string | null; emailStatus: string } | null,
  application: { email: string } | null,
): boolean {
  if (member) return member.email !== null && member.email !== "" && member.emailStatus !== "bounced";
  // `Application.email` es NOT NULL en el esquema, pero "existe la solicitud" no
  // es lo mismo que "hay a dónde mandarlo": una cadena vacía no es una casilla.
  return application !== null && application.email.trim() !== "";
}

/** Tope de anidamiento del enmascarado: un summary es plano, y un ciclo o un
 *  JSON absurdo no pueden colgar la pantalla. */
const SUMMARY_MAX_DEPTH = 6;

/** Un identificador largo —un `preapproval_id`, un id de MP— NUNCA sale entero
 *  de este módulo, ni siquiera dentro del texto de un error: el mensaje de la
 *  API de Mercado Pago lo trae en claro ("The preapproval with id 5eed…0001 does
 *  not exist") y cualquier consumidor lo imprimiría tal cual.
 *
 *  Se recorta a los primeros 8 caracteres, que es exactamente la forma en que lo
 *  muestra Tesorería → Suscripciones: alcanza para reconocer de qué débito habla
 *  el error y para buscarlo ahí, sin publicar el identificador completo.
 *
 *  No vive en `@/lib/log-safe` a propósito, aunque sea de la misma familia que
 *  `maskEmails`: el LOG necesita el id entero —es donde el reconcile manda a
 *  propósito los ids de lo que falló, para que la causa sobreviva al recorte del
 *  summary (cabecera de este archivo)—. Esto es el recorte de lo que se PUBLICA
 *  en una pantalla, no higiene de log. */
export function maskLongIds(text: string): string {
  return text.replace(/\b[0-9a-f]{24,}\b/gi, (id) => `${id.slice(0, 8)}…`);
}

/** El saneado de TODO texto libre que sale del tablero: direcciones tapadas
 *  (Ley 25.326, docs/08) e identificadores largos recortados. Las dos cosas
 *  juntas y en la capa de DATOS, no en la pantalla: el próximo consumidor —el
 *  resumen diario, un export— no tiene por qué acordarse de repetirlas. */
function safeText(raw: string): string {
  return maskLongIds(maskEmails(raw));
}

/** Enmascarado EN PROFUNDIDAD del `summary` de una corrida.
 *
 *  `CronRun.error` ya venía limpio de las cinco rutas (`safeMessage`) y aun así
 *  se re-enmascara. `summary` es lo contrario: JSON de texto libre escrito por
 *  cinco crons distintos, que la pantalla renderiza entero. Hoy sus cadenas son
 *  códigos (`errors: ["EAUTH"]`) porque cada cron se cuidó de que lo fueran,
 *  pero el tipo es `unknown` y no lo obliga — y el argumento del enmascarado es
 *  precisamente el escritor futuro que no lee este archivo. Devolverlo con un
 *  `{ ...r }` dejaba crudo el único campo donde una dirección puede aparecer
 *  sin que nadie lo note. */
export function safeSummary(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) {
    return depth >= SUMMARY_MAX_DEPTH ? [] : value.map((v) => safeSummary(v, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    if (depth >= SUMMARY_MAX_DEPTH) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, safeSummary(v, depth + 1)]),
    );
  }
  return value;
}

export async function fetchHealth(db: HealthDb, now: Date): Promise<HealthSnapshot> {
  const since = new Date(now.getTime() - SIGNATURE_WINDOW_HOURS * 3_600_000);
  const sinceWebhookError = new Date(now.getTime() - WEBHOOK_ERROR_WINDOW_HOURS * 3_600_000);
  const [
    runs, lastEvent, unprocessedWithError, signatureRejections, inboxOpen, inboxTotal,
    subscriptionRows, mismatchRows, mismatchesEver, failedRows, failedEver, receiptRows, receiptsTotal,
  ] = await Promise.all([
    // Una consulta por job y no un groupBy: son cinco, el índice
    // `[job, startedAt]` está hecho para esto y el groupBy no puede traer la
    // fila entera de la última corrida.
    Promise.all(CRON_JOB_LIST.map((job) =>
      db.cronRun.findFirst({
        where: { job }, orderBy: { startedAt: "desc" },
        select: { id: true, startedAt: true, finishedAt: true, ok: true, error: true, summary: true },
      }).then((r) => [job, r] as const),
    )),
    db.webhookEvent.findFirst({ where: { origin: "mp" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    // Con ventana: la tabla NO es chica a largo plazo (una fila por cada aviso
    // de MP, reintentos incluidos), y sin acotar el contador sólo puede crecer.
    // El `receivedAt` entra por el índice `webhook_events(origin, received_at)`.
    db.webhookEvent.count({
      where: { origin: "mp", processedAt: null, error: { not: null }, receivedAt: { gte: sinceWebhookError } },
    }),
    db.auditLog.count({ where: { action: "webhook_rejected_signature", createdAt: { gte: since } } }),
    db.mpUnmatchedPayment.count({ where: { status: "open" } }),
    db.mpUnmatchedPayment.count(),
    // Las filas y no un `count`: la pregunta cruza estado de suscripción con
    // estado de SOCIO y se agrupa por socio (`classifyDebits`), y eso no se
    // escribe como un `where`. El lote está acotado por el padrón —una fila por
    // débito conocido, no una por cobro—, así que son decenas.
    db.mpSubscription.findMany({
      where: { memberId: { not: null } },
      select: { memberId: true, status: true, member: { select: { status: true } } },
    }),
    db.auditLog.findMany({
      where: { action: "link_amount_mismatch" },
      orderBy: { id: "desc" }, take: MISMATCH_LIMIT,
      select: { id: true, createdAt: true, detail: true },
    }),
    db.auditLog.count({ where: { action: "link_amount_mismatch" } }),
    db.notification.findMany({
      where: { status: "failed" },
      orderBy: { sentAt: "desc" }, take: FAILED_LIMIT,
      select: {
        id: true, sentAt: true, type: true, error: true, payloadSummary: true,
        memberId: true, applicationId: true,
      },
    }),
    db.notification.count({ where: { status: "failed" } }),
    // Panel 6: los recibos que nunca se sellaron. Un anulado no cuenta —no se
    // manda por diseño (`receipt-email.ts`)— y quedaría para siempre en la lista.
    db.receipt.findMany({
      where: { emailedAt: null, voidedAt: null },
      orderBy: { issuedAt: "desc" }, take: RECEIPT_LIMIT,
      select: {
        id: true, number: true, issuedAt: true,
        payment: {
          select: {
            member: { select: { id: true, fullName: true, email: true, emailStatus: true } },
            application: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    }),
    db.receipt.count({ where: { emailedAt: null, voidedAt: null } }),
  ]);

  // El `detail` de un asiento es JSON libre: se acepta el número y nada más.
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  // Los nombres de socio se resuelven por id al renderizar (mismo criterio que
  // `fee_value_applied`): el `detail` del asiento nunca los guarda. Va por el
  // MISMO `num()` que arma la fila: `Number("14")` daba 14 y buscaba el nombre
  // de un socio que después la fila descartaba por no ser un número.
  const memberIds = [
    ...new Set([
      ...mismatchRows
        .map((r) => num((r.detail as { memberId?: unknown } | null)?.memberId))
        .filter((v): v is number => v !== null),
      ...failedRows.map((r) => r.memberId).filter((v): v is number => v !== null),
    ]),
  ];
  // El aviso del recibo se busca por `payloadSummary` porque la fila de
  // `Notification` no guarda el id del recibo: el mailer escribe ahí
  // `recibo ${número}` y el número es único. La consulta va acotada al lote que
  // se muestra, no a la tabla entera.
  const summaries = receiptRows.map((r) => receiptSummaryOf(r.number));
  const [members, receiptNotes] = await Promise.all([
    memberIds.length === 0 ? [] : db.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, fullName: true } }),
    summaries.length === 0 ? [] : db.notification.findMany({
      where: { type: "receipt", payloadSummary: { in: summaries } },
      select: { payloadSummary: true, status: true, error: true },
    }),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.fullName]));
  const notesOf = new Map<string, Array<{ status: string; error: string | null }>>();
  for (const n of receiptNotes) {
    if (n.payloadSummary === null) continue;
    const list = notesOf.get(n.payloadSummary) ?? [];
    list.push({ status: n.status, error: n.error });
    notesOf.set(n.payloadSummary, list);
  }
  // El `error` de la corrida ya sale enmascarado de la ruta del cron
  // (`safeMessage`), pero acá se vuelve a pasar: es lo único de todo el tablero
  // que arrastra el texto de una excepción, y un escritor nuevo que se olvide no
  // puede terminar publicando la casilla de un vecino en pantalla (docs/08). El
  // `safeMessage` del cron, además, deja los ids largos enteros a propósito
  // —está pensado para el log—: `safeText` es el que los recorta.
  const safeError = (raw: string | null) => (raw === null ? null : safeText(raw));

  return {
    now,
    crons: runs.map(([job, r]) => ({
      job,
      label: CRON_EXPECTATION[job].label,
      everyHours: CRON_EXPECTATION[job].everyHours,
      state: cronState(r, CRON_EXPECTATION[job].everyHours, now),
      lastRun: r
        ? { ...r, id: String(r.id), error: safeError(r.error), summary: safeSummary(r.summary) }
        : null,
    })),
    mp: { lastEventAt: lastEvent?.receivedAt ?? null, unprocessedWithError, signatureRejections },
    money: {
      inboxOpen, inboxTotal, debits: classifyDebits(subscriptionRows), mismatchesEver,
      mismatches: mismatchRows.map((r) => {
        const d = (r.detail ?? {}) as Record<string, unknown>;
        const memberId = num(d.memberId);
        return {
          id: String(r.id), createdAt: r.createdAt,
          paymentId: num(d.paymentId), memberId,
          memberName: memberId === null ? null : nameOf.get(memberId) ?? null,
          n: num(d.n), expected: num(d.expected), amount: num(d.amount),
        };
      }),
    },
    failed: failedRows.map((r) => ({
      ...r, id: String(r.id),
      memberName: r.memberId === null ? null : nameOf.get(r.memberId) ?? null,
      receiptNumber: receiptNumberOf(r.payloadSummary),
    })),
    failedEver,
    receipts: {
      total: receiptsTotal,
      rows: receiptRows.map((r) => {
        const member = r.payment.member;
        const application = r.payment.application;
        const notes = notesOf.get(receiptSummaryOf(r.number)) ?? [];
        const failedNote = notes.find((n) => n.status === "failed");
        // El orden importa: una fila `sent` gana sobre todo (el recibo salió), y
        // "no tiene casilla" sólo se afirma cuando NO hubo ningún intento —si
        // hubo uno fallido, el dato útil es el código del fallo—.
        const state: PendingReceiptState = notes.some((n) => n.status === "sent")
          ? "sent"
          : failedNote
            ? "failed"
            : hasUsableTarget(member, application)
              ? "not_attempted"
              : "no_email";
        return {
          id: r.id, number: r.number, issuedAt: r.issuedAt, state,
          memberId: member?.id ?? null,
          applicationId: member ? null : application?.id ?? null,
          memberName: member?.fullName ?? application?.fullName ?? null,
          error: state === "failed" ? safeError(failedNote?.error ?? null) : null,
        };
      }),
    },
  };
}
