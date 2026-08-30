// Los siete paneles de /admin/salud (spec 4C §8, más el de §7.3 de la
// invitación perdida) + el veredicto que los encabeza.
//
// Viven fuera de `page.tsx` por una razón práctica: la página abre sesión, lee
// Prisma y toca `node:fs`, así que no se puede renderizar en un test. Acá no hay
// nada de eso —entran datos, sale marcado— y `tests/admin-health-screen.test.ts`
// los renderiza con `renderToStaticMarkup`, que es la única verificación visual
// posible en este proyecto (el operador no puede abrir el navegador con sesión
// desde acá).
//
// El botón de reenvío NO se importa desde este archivo: llega por `renderResend`.
// Es un componente cliente que arrastra la server action y con ella el cliente de
// Prisma; inyectarlo mantiene los paneles puros y deja que el test verifique la
// POLÍTICA (a qué fila se le ofrece reenviar y a cuál no) sin levantar nada.
import { Banknote, CircleCheck, Clock, Info, KeyRound, Mail, Receipt, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { PanelHeader } from "@/components/admin/panel-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CronHealth, CronState, FailedNotification, MoneyHealth, MpHealth, PendingReceiptState, ReceiptsHealth, StuckAccessRow } from "@/lib/admin/health";
import { INVITE_FRESH_HOURS, maskLongIds, SIGNATURE_WINDOW_HOURS, WEBHOOK_ERROR_WINDOW_HOURS } from "@/lib/admin/health";
import type { HealthAlerts } from "@/lib/admin/health-alerts";
import { BACKUP_FRESH_HOURS, type BackupHealth, type BackupState } from "@/lib/admin/health-backup";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { alertHrefFor } from "@/lib/admin/salud-tabs";
import { backupStateBadgeVariant, cronStateBadgeVariant, pendingReceiptBadgeVariant } from "@/lib/admin/status-badges";
import { formatARS, formatDateAR, formatDateTimeAR, formatRelativeAgo } from "@/lib/format";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/members/labels";
import { cn } from "@/lib/utils";

/** Cómo la pantalla pide el botón de reenvío de una fila. La política de a quién
 *  se le ofrece vive en los paneles; qué hace el botón, en la página. */
export type ResendRenderer = (args: {
  kind: "notification" | "receipt";
  /** `Notification.id` (BigInt serializado) o `Receipt.id`. */
  id: string;
  /** Lo que el botón reenvía, para el nombre accesible. */
  label: string;
}) => React.ReactNode;

const NUM = "font-mono tabular-nums";

// El recorte del `preapproval_id` vive en la capa de datos (`maskLongIds`, que
// `safeSummary` y `safeError` ya aplican): así lo hereda cualquier consumidor
// nuevo —el resumen diario, un export— y no sólo esta pantalla.
//
// Los llamados que quedan acá abajo son defensa en profundidad, y se justifican:
// estos paneles son puros y reciben sus props de quien sea —el test los
// construye a mano— así que la última línea antes del HTML no puede ser la que
// confíe. Es la MISMA función importada, no una copia: no hay dos expresiones
// que puedan derivar.

/** Encabezado común de las secciones ancladas. El `id` es el ancla a la que
 *  apunta el veredicto (via `?tab=X#id`); el `<h2>` lo emite PanelHeader y el
 *  `aria-labelledby` lo referencia por `titleId`. */
function Section({ id, icon, title, hint, children }: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-3">
      <PanelHeader icon={icon} title={title} description={hint} titleId={`${id}-title`} />
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Veredicto
// ─────────────────────────────────────────────────────────────────────────────

/** Lo primero y —el martes que todo anda— lo único que el operador necesita leer.
 *
 *  Un tablero que obliga a recorrer siete paneles para descubrir que no pasa nada
 *  se deja de mirar a la semana. Acá arriba está la respuesta: si no hay nada
 *  para atender, lo dice en una línea verde y el resto de la pantalla queda como
 *  consulta.
 *
 *  Es un BANNER, no un FormMessage: el estado del sistema es el héroe de esta
 *  pantalla. La semántica no cambió — mismos titulares, mismos umbrales de kind,
 *  mismo role="none" (no es la respuesta a una acción) — y los `#ancla` se
 *  traducen a `?tab=X#ancla` vía alertHrefFor: activan la pestaña del panel y
 *  scrollean hasta él. health-alerts.ts sigue emitiendo anclas peladas. */
/** El link de una alerta. Un ancla se traduce a `?tab=X#ancla` y navega con un
 *  `<a>` NATIVO —navegación de documento—: el SSR ya renderiza la pestaña
 *  correcta (SaludTabs lee `?tab=` también en el server) y el navegador
 *  scrollea solo al fragmento. Con `Link` de Next el manejo de scroll de la
 *  transición cliente corre ANTES de que Radix monte el panel y el fragmento
 *  se pierde — medido en la verificación en vivo, no supuesto. Las rutas
 *  absolutas sí navegan con `Link`, como siempre. */
function VerdictLink({ rawHref, children }: { rawHref: string; children: React.ReactNode }) {
  if (!rawHref.startsWith("#")) {
    return <Link className={INLINE_LINK} href={rawHref}>{children}</Link>;
  }
  return <a className={INLINE_LINK} href={alertHrefFor(rawHref)}>{children}</a>;
}

const VERDICT_STYLE = {
  error: { icon: TriangleAlert, border: "border-l-destructive", tone: "text-destructive", bg: "bg-destructive/5" },
  neutral: { icon: Info, border: "border-l-border", tone: "text-foreground", bg: "bg-muted/40" },
  success: { icon: CircleCheck, border: "border-l-success", tone: "text-success", bg: "bg-success/5" },
} as const;

export function HealthVerdict({ alerts, now }: { alerts: HealthAlerts; now: Date }) {
  const { act, review } = alerts;
  const kind = act.length > 0 ? "error" : review.length > 0 ? "neutral" : "success";
  const headline = act.length > 0
    ? act.length === 1 ? "Hay una cosa para atender" : `Hay ${act.length} cosas para atender`
    : review.length > 0
      ? "No hay nada roto"
      : "Todo en orden";
  const style = VERDICT_STYLE[kind];
  const Icon = style.icon;
  return (
    // `role="none"`: es el estado de la pantalla al abrirla, no la respuesta a
    // una acción. Un `alert` acá interrumpiría al lector de pantalla en cada
    // recarga (misma regla que la ayuda estática de los formularios).
    <div role="none" className={cn("rounded-xl border border-l-4 p-4", style.border, style.bg)}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden className={cn("mt-0.5 size-6 shrink-0", style.tone)} />
        <div className="min-w-0 flex-1 text-sm">
          <p className={cn("text-base font-semibold", style.tone)}>{headline}</p>
          {act.length > 0 && (
            <ul className="mt-2 space-y-1">
              {act.map((a) => (
                <li key={a.key}>
                  <VerdictLink rawHref={a.href}>{a.label}</VerdictLink>
                </li>
              ))}
            </ul>
          )}
          {review.length > 0 && (
            <div className="mt-2 text-muted-foreground">
              <p className="text-xs font-semibold tracking-widest uppercase">Para revisar</p>
              <ul className="mt-1 space-y-1">
                {review.map((a) => (
                  <li key={a.key}>
                    <VerdictLink rawHref={a.href}>{a.label}</VerdictLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {act.length === 0 && review.length === 0 && (
            <p className="mt-1 text-muted-foreground">
              Las tareas automáticas corrieron cuando tenían que correr, el backup está al día, Mercado Pago
              sigue avisando y no quedó ningún email sin salir.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Estado al {formatDateTimeAR(now)}.</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tareas automáticas
// ─────────────────────────────────────────────────────────────────────────────

const CRON_STATE_LABEL: Record<CronState, string> = {
  ok: "Al día",
  errors: "Terminó con errores",
  stale: "Hace mucho que no corre",
  hung: "Quedó colgada",
  never: "Nunca corrió",
};

/** Cada cuánto se ESPERA una corrida efectiva, en palabras. `everyHours` viene de
 *  `CRON_EXPECTATION` y no del crontab: el devengo corre todos los días y actúa
 *  una vez por mes. Decirlo en la tabla es lo que evita que "hace 20 días" se
 *  lea como un atraso. */
function expectationLabel(everyHours: number): string {
  if (everyHours <= 24) return "una vez por día";
  if (everyHours <= 24 * 7) return "cuando hay novedades";
  return "una vez por mes";
}

function formatDuration(startedAt: Date, finishedAt: Date | null): string {
  if (finishedAt === null) return "sin cerrar";
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** El `summary` es JSON libre escrito por cinco crons distintos y ya viene
 *  enmascarado (`safeSummary`). Se muestra como pares clave/valor sin asumir
 *  ninguna forma: lo que no sea un objeto plano cae al JSON crudo. */
function summaryPairs(summary: unknown): Array<[string, string]> | null {
  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) return null;
  return Object.entries(summary as Record<string, unknown>).map(([k, v]) => [k, scalarText(v)]);
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(scalarText).join(", ");
  if (typeof value === "object") return maskLongIds(JSON.stringify(value));
  return maskLongIds(String(value));
}

function CronResult({ run }: { run: NonNullable<CronHealth["lastRun"]> }) {
  if (run.error) {
    // El texto del error va completo: es lo único que explica qué se rompió, y
    // viene ya acotado a 500 caracteres y con las direcciones enmascaradas desde
    // la ruta del cron.
    return <code className="block text-xs break-words text-destructive">{maskLongIds(run.error)}</code>;
  }
  const pairs = summaryPairs(run.summary);
  if (pairs === null) {
    return run.summary === null || run.summary === undefined
      ? <span className="text-muted-foreground">Sin detalle</span>
      : <code className="block text-xs break-words">{maskLongIds(JSON.stringify(run.summary))}</code>;
  }
  if (pairs.length === 0) return <span className="text-muted-foreground">Sin novedades</span>;
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {pairs.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-1">
          <dt className="shrink-0 text-muted-foreground">{k}</dt>
          {/* Los contadores son números y se leen alineados; los `errors` del
              reconcile son frases enteras y tienen que poder cortar. */}
          <dd className={`min-w-0 break-words ${NUM}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CronsPanel({ crons, now }: { crons: CronHealth[]; now: Date }) {
  return (
    <Section
      id="tareas"
      icon={Clock}
      title="Tareas automáticas"
      hint={
        <>
          Se muestra la última corrida <strong>efectiva</strong>. Una tarea que decide no actuar —el devengo
          un día que no es 1, el resumen sin novedades— no deja registro, y eso es lo normal: cada una se
          mide con la frecuencia que le corresponde, no con la del crontab.
        </>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tarea</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Última corrida</TableHead>
            <TableHead>Duración</TableHead>
            <TableHead>Resultado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {crons.map((c) => (
            <TableRow key={c.job}>
              <TableCell className="align-top">
                <span className="font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">
                  <code>{c.job}</code> · se espera {expectationLabel(c.everyHours)}
                </span>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={cronStateBadgeVariant(c.state)}>{CRON_STATE_LABEL[c.state]}</Badge>
              </TableCell>
              <TableCell className="align-top">
                {c.lastRun ? (
                  <>
                    {formatRelativeAgo(c.lastRun.startedAt, now)}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTimeAR(c.lastRun.startedAt)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className={`align-top ${NUM} text-xs`}>
                {c.lastRun ? formatDuration(c.lastRun.startedAt, c.lastRun.finishedAt) : "—"}
              </TableCell>
              {/* `whitespace-normal` pisa el `nowrap` del componente: el summary
                  del reconcile trae quince contadores y, cuando algo falló, el
                  mensaje de la API. Sin envolver, la tabla se va de pantalla. */}
              <TableCell className="max-w-md align-top whitespace-normal">
                {c.lastRun ? <CronResult run={c.lastRun} /> : <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Backup   ·   3. Mercado Pago
// ─────────────────────────────────────────────────────────────────────────────

const BACKUP_STATE_LABEL: Record<BackupState, string> = {
  fresh: "Al día",
  stale: "Atrasado",
  missing: "Sin rastro",
  unreadable: "No se puede leer",
  unconfigured: "Sin configurar",
};

const BACKUP_EXPLANATION: Record<BackupState, string> = {
  fresh: "",
  stale: "El script dejó de terminar bien en algún momento. El detalle está en el log del cron del servidor.",
  missing: "No hay ningún sello de backup correcto. Puede que el script no esté instalado o que la carpeta configurada no sea la que él escribe.",
  unreadable: "El sello existe pero el panel no tiene permiso para leerlo. Lo que hay que arreglar son los permisos de la carpeta, no el backup.",
  unconfigured: "Falta BACKUP_DIR en el .env del servidor. Mientras no esté, esta pantalla no puede decir nada sobre el backup.",
};

export function BackupPanel({ backup, now }: { backup: BackupHealth; now: Date }) {
  return (
    // `section` + `h2` reales aunque el panel sea una tarjeta: son dos de los
    // siete bloques de la pantalla y quien la recorre por encabezados tiene que
    // encontrarlos. El `id` es además el ancla a la que apunta el veredicto.
    <section id="backup" aria-labelledby="backup-title" className="scroll-mt-4">
      <Card className="h-full">
        <CardHeader><CardTitle as="h2" id="backup-title">Backup nocturno</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Badge variant={backupStateBadgeVariant(backup.state)}>{BACKUP_STATE_LABEL[backup.state]}</Badge>
          <p>
            {backup.lastOkAt
              ? <>Último backup correcto {formatRelativeAgo(backup.lastOkAt, now)}, el {formatDateTimeAR(backup.lastOkAt)}.</>
              : BACKUP_EXPLANATION[backup.state]}
          </p>
          {backup.lastOkAt && backup.state !== "fresh" && (
            <p className="text-muted-foreground">{BACKUP_EXPLANATION[backup.state]}</p>
          )}
          <p className="text-xs text-muted-foreground">
            El script corre a las 04:00 y sólo deja rastro cuando termina bien, así que lo que se mide es
            la antigüedad del último éxito. Se considera al día hasta las {BACKUP_FRESH_HOURS} horas.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

export function MpPanel({ mp, now }: { mp: MpHealth; now: Date }) {
  return (
    <section id="mercado-pago" aria-labelledby="mp-title" className="scroll-mt-4">
      <Card className="h-full">
        <CardHeader><CardTitle as="h2" id="mp-title">Mercado Pago</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            {mp.lastEventAt
              ? <>Último aviso recibido {formatRelativeAgo(mp.lastEventAt, now)}, el {formatDateTimeAR(mp.lastEventAt)}.</>
              : <strong>Nunca llegó ningún aviso de Mercado Pago.</strong>}
          </p>
          <p className="text-xs text-muted-foreground">
            Es la señal más importante de este panel. Una suscripción no usa la URL de aviso de la
            preferencia: si la configuración de webhooks del panel de Mercado Pago se rompe, los débitos
            dejan de avisar sin ninguna otra señal, y la única red que queda es la conciliación de las
            03:17.
          </p>
          <ul className="space-y-1">
            <li>
              <span className={NUM}>{mp.unprocessedWithError}</span>{" "}
              {mp.unprocessedWithError === 1 ? "aviso quedó" : "avisos quedaron"} con error y sin procesar
              en las últimas {WEBHOOK_ERROR_WINDOW_HOURS} horas
            </li>
            <li>
              <span className={NUM}>{mp.signatureRejections}</span>{" "}
              {mp.signatureRejections === 1 ? "aviso se rechazó" : "avisos se rechazaron"} por firma
              inválida en las últimas {SIGNATURE_WINDOW_HOURS} horas
            </li>
            <li>
              <span className={NUM}>{mp.legacyIpns}</span>{" "}
              {mp.legacyIpns === 1 ? "aviso llegó" : "avisos llegaron"} en formato viejo (IPN) en las
              últimas {SIGNATURE_WINDOW_HOURS} horas
            </li>
          </ul>
          {/* Dato, no alarma: por cada pago de Checkout Pro, Mercado Pago manda
              cuatro notificaciones y sólo una está en el formato que atendemos.
              El número puede ser grande y estar todo bien; se escribe para que
              el operador no lo confunda con el renglón de arriba, que es el que
              sí importa. */}
          <p className="text-xs text-muted-foreground">
            Los avisos en formato viejo son notificaciones legítimas de Mercado Pago que el sistema
            descarta a propósito: no hay nada que hacer con ellos. Se cuentan aparte de las firmas
            inválidas justamente para no confundirlos con un problema.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Dinero sin resolver
// ─────────────────────────────────────────────────────────────────────────────

/** Un renglón del panel de dinero. En cero se apaga: sin link y sin la
 *  explicación de qué hacer, porque no hay nada que hacer. Un "0" enlazado con
 *  su instructivo al lado es ruido que el operador aprende a saltear. */
function MoneyLine({ count, href, label, zero, todo, always }: {
  count: number; href: string; label: string; zero: string;
  /** Qué hacer con esto. Sólo aparece cuando hay algo. */
  todo?: string;
  /** Contexto que vale siempre (los acumulados históricos). */
  always?: React.ReactNode;
}) {
  return (
    <li>
      {count === 0 ? (
        <span className="text-muted-foreground">{zero}</span>
      ) : (
        <>
          <Link className={INLINE_LINK} href={href}>
            <span className={NUM}>{count}</span> {label}
          </Link>
          {todo && <span className="text-muted-foreground"> — {todo}</span>}
        </>
      )}
      {always && <span className="text-muted-foreground"> · {always}</span>}
    </li>
  );
}

export function MoneyPanel({ money }: { money: MoneyHealth }) {
  const { inboxOpen, inboxTotal, debits } = money;
  return (
    <Section id="dinero" icon={Banknote} title="Dinero sin resolver">
      <ul className="space-y-2 text-sm">
        <MoneyLine
          count={inboxOpen}
          href="/admin/tesoreria/sin-conciliar"
          label={`${inboxOpen === 1 ? "cobro espera" : "cobros esperan"} una decisión`}
          zero="Ningún cobro de Mercado Pago quedó esperando una decisión"
          // `inboxTotal` es HISTORIA: sólo puede crecer y no hay nada que
          // resolverle. Va como contexto de la cola, nunca como la cola.
          always={<>por la bandeja pasaron <span className={NUM}>{inboxTotal}</span> desde que existe</>}
        />
        <MoneyLine
          count={debits.aliveForWithdrawn}
          href="/admin/tesoreria/suscripciones"
          label={`${debits.aliveForWithdrawn === 1 ? "socio dado de baja tiene" : "socios dados de baja tienen"} el débito todavía vivo`}
          zero="Ningún socio dado de baja quedó con el débito automático vivo"
          todo="se les puede seguir cobrando; el botón «Cancelar el débito» lo cierra"
        />
        <MoneyLine
          count={debits.stoppedForActive}
          href="/admin/tesoreria/suscripciones"
          label={`${debits.stoppedForActive === 1 ? "socio vigente dejó" : "socios vigentes dejaron"} de pagar por débito`}
          zero="Todos los débitos de socios vigentes siguen cobrando"
          // No es un error: el socio que se pasó a efectivo y canceló su débito
          // cae acá y no hay nada que arreglar. Por eso se enuncia como algo
          // para mirar en la ficha, y nunca en rojo.
          todo="para revisar en la ficha: puede que hayan pasado a pagar en efectivo"
        />
      </ul>

      <h3 className="pt-2 text-sm font-medium">Links de pago cobrados por un importe distinto al vigente</h3>
      {money.mismatches.length === 0 ? (
        <EmptyState size="card" description="Ningún link cobró un importe distinto al que correspondía." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuándo</TableHead>
                <TableHead>Socio</TableHead>
                <TableHead className="text-right">Cuotas</TableHead>
                <TableHead className="text-right">Se esperaba</TableHead>
                <TableHead className="text-right">Se cobró</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {money.mismatches.map((m) => {
                const diff = m.expected !== null && m.amount !== null ? m.amount - m.expected : null;
                return (
                  <TableRow key={m.id}>
                    <TableCell>{formatDateTimeAR(m.createdAt)}</TableCell>
                    <TableCell>
                      {m.memberId ? (
                        <Link className={INLINE_LINK} href={`/admin/socios/${m.memberId}?tab=cuenta`}>
                          {m.memberName ?? `Socio ${m.memberId}`}
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className={`text-right ${NUM}`}>{m.n ?? "—"}</TableCell>
                    <TableCell className={`text-right ${NUM}`}>{m.expected === null ? "—" : formatARS(m.expected)}</TableCell>
                    <TableCell className={`text-right ${NUM}`}>{m.amount === null ? "—" : formatARS(m.amount)}</TableCell>
                    <TableCell className={`text-right ${NUM}`}>
                      {/* El signo importa: cobró de menos (hay que reclamar) o de
                          más (hay que devolver) son dos problemas distintos. */}
                      {diff === null ? "—" : <Badge variant={diff < 0 ? "destructive" : "secondary"}>{formatARS(diff)}</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {money.mismatchesEver > money.mismatches.length && (
            <p className="text-xs text-muted-foreground">
              Se listan los <span className={NUM}>{money.mismatches.length}</span> más recientes de{" "}
              <span className={NUM}>{money.mismatchesEver}</span> registrados.
            </p>
          )}
          <p className="max-w-3xl text-xs text-muted-foreground">
            Cada uno de estos cobros se imputó igual. Lo que queda es una decisión de la Comisión —reclamar
            la diferencia o perdonarla— y el asiento no tiene manera de cerrarse: es un registro histórico,
            no una cola de trabajo. La lista sale de la auditoría, que es best-effort: muestra lo que se
            pudo asentar.
          </p>
        </>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Avisos por email que no salieron
// ─────────────────────────────────────────────────────────────────────────────

export function FailedNoticesPanel({ failed, failedEver, renderResend }: {
  failed: FailedNotification[];
  failedEver: number;
  renderResend: ResendRenderer;
}) {
  return (
    <Section id="avisos" icon={Mail} title="Avisos por email que no salieron">
      {failed.length === 0 ? (
        <EmptyState description="Todos los avisos salieron. Un envío bloqueado por la lista de prueba del entorno no cuenta como fallido y no aparece acá." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuándo se intentó</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>De quién</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead>Error</TableHead>
                <TableHead><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>{formatDateTimeAR(n.sentAt)}</TableCell>
                  <TableCell>{NOTIFICATION_TYPE_LABELS[n.type]}</TableCell>
                  <TableCell>
                    {n.memberId ? (
                      <Link className={INLINE_LINK} href={`/admin/socios/${n.memberId}`}>
                        {n.memberName ?? `Socio ${n.memberId}`}
                      </Link>
                    ) : n.applicationId ? (
                      <Link className={INLINE_LINK} href={`/admin/solicitudes/${n.applicationId}`}>
                        {`Solicitud ${n.applicationId}`}
                      </Link>
                    ) : (
                      // La dirección NO se muestra ni se guarda: la fila dice de
                      // qué entidad viene, no a qué casilla iba (docs/08).
                      <span className="text-muted-foreground">Aviso interno</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal">{n.payloadSummary ?? "—"}</TableCell>
                  <TableCell><code className="text-xs">{n.error ? maskLongIds(n.error) : "—"}</code></TableCell>
                  <TableCell>
                    {n.receiptNumber
                      ? renderResend({ kind: "notification", id: n.id, label: `el recibo ${n.receiptNumber}` })
                      : <span className="text-xs text-muted-foreground">Rehacer desde su pantalla</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {failedEver > failed.length && (
            <p className="text-xs text-muted-foreground">
              Se listan los <span className={NUM}>{failed.length}</span> más recientes de{" "}
              <span className={NUM}>{failedEver}</span> intentos fallidos registrados.
            </p>
          )}
          <p className="max-w-3xl text-xs text-muted-foreground">
            Sólo los recibos se reenvían desde acá: son los únicos que el sistema puede volver a armar solo.
            El resto se vuelve a mandar desde la pantalla que lo origina.
          </p>
        </>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Recibos sin enviar
// ─────────────────────────────────────────────────────────────────────────────

const RECEIPT_STATE_LABEL: Record<PendingReceiptState, string> = {
  not_attempted: "No se intentó",
  failed: "Falló el envío",
  no_email: "Sin casilla",
  sent: "Salió, falta el sello",
};

const RECEIPT_STATE_HELP: Record<PendingReceiptState, string> = {
  not_attempted: "No hay ningún registro de intento. Reenviar puede resolverlo o volver a chocar contra el mismo límite: el resultado se muestra al apretar.",
  failed: "Se intentó y el envío se cayó.",
  no_email: "No hay una casilla a la que mandarlo. Se resuelve cargándole el email a la ficha.",
  sent: "El recibo salió: lo que falló fue el sello en la base. Volver a mandarlo le duplicaría el PDF al socio.",
};

/** Sólo dos de los cuatro estados admiten reenvío. `sent` no, porque el socio ya
 *  lo tiene; `no_email`, porque no hay a dónde mandarlo y el botón mentiría. */
function canResend(state: PendingReceiptState): boolean {
  return state === "failed" || state === "not_attempted";
}

export function PendingReceiptsPanel({ receipts, renderResend }: {
  receipts: ReceiptsHealth;
  renderResend: ResendRenderer;
}) {
  return (
    <Section
      id="recibos"
      icon={Receipt}
      title="Recibos sin enviar por email"
      hint={
        <>
          Recibos emitidos que nunca se sellaron como enviados. El sello vacío es ambiguo, así que cada fila
          dice por qué está acá. Con <code>EMAIL_ALLOWLIST</code> puesta —el estado de este sitio hasta el
          lanzamiento— los envíos ni se intentan, y esta lista se llena sola: se vacía al sacar la variable,
          no reenviando uno por uno.
        </>
      }
    >
      {receipts.rows.length === 0 ? (
        <EmptyState description="Todos los recibos emitidos salieron por email." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recibo</TableHead>
                <TableHead>Emitido</TableHead>
                <TableHead>De quién</TableHead>
                <TableHead>Por qué sigue acá</TableHead>
                <TableHead>Error</TableHead>
                <TableHead><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link className={`${INLINE_LINK} ${NUM}`} href={`/admin/tesoreria/recibos/${r.id}`}>
                      {r.number}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDateTimeAR(r.issuedAt)}</TableCell>
                  <TableCell>
                    {r.memberId ? (
                      <Link className={INLINE_LINK} href={`/admin/socios/${r.memberId}`}>
                        {r.memberName ?? `Socio ${r.memberId}`}
                      </Link>
                    ) : r.applicationId ? (
                      <Link className={INLINE_LINK} href={`/admin/solicitudes/${r.applicationId}`}>
                        {r.memberName ?? `Solicitud ${r.applicationId}`}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-sm align-top whitespace-normal">
                    <Badge variant={pendingReceiptBadgeVariant(r.state)}>{RECEIPT_STATE_LABEL[r.state]}</Badge>
                    <span className="mt-1 block text-xs text-muted-foreground">{RECEIPT_STATE_HELP[r.state]}</span>
                  </TableCell>
                  <TableCell><code className="text-xs">{r.error ? maskLongIds(r.error) : "—"}</code></TableCell>
                  <TableCell>
                    {canResend(r.state)
                      ? renderResend({ kind: "receipt", id: String(r.id), label: `el recibo ${r.number}` })
                      : <span className="text-xs text-muted-foreground">Nada que hacer</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {receipts.total > receipts.rows.length && (
            <p className="text-xs text-muted-foreground">
              Se listan los <span className={NUM}>{receipts.rows.length}</span> más recientes de{" "}
              <span className={NUM}>{receipts.total}</span> sin enviar.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Verificaron su email y siguen sin cuenta (§7.3 de la invitación perdida)
// ─────────────────────────────────────────────────────────────────────────────

export function StuckAccessPanel({ rows }: { rows: StuckAccessRow[] }) {
  return (
    <Section id="accesos" icon={KeyRound} title="Verificaron su email y siguen sin cuenta">
      {rows.length === 0 ? (
        <EmptyState description="Nadie quedó a mitad de camino: quien verificó su email creó su cuenta o tiene la invitación fresca en su casilla." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Socio</TableHead>
                <TableHead>Verificó su email</TableHead>
                <TableHead>Invitación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.memberId}>
                  <TableCell>
                    <Link className={INLINE_LINK} href={`/admin/socios/${r.memberId}?tab=acceso`}>
                      {r.memberName}
                    </Link>
                  </TableCell>
                  <TableCell>{r.verifiedAt ? formatDateTimeAR(r.verifiedAt) : "—"}</TableCell>
                  <TableCell>
                    {/* La invitación `stale` está VIVA: el badge dice cuándo vence
                        y no finge urgencia, porque todavía le quedan días. Lo que
                        la trajo a esta lista es que nadie la usó. */}
                    {r.invite === "none" || r.inviteExpiresAt === null ? (
                      <Badge variant="secondary">Sin enlace vivo</Badge>
                    ) : (
                      <Badge variant="secondary">{`Vence el ${formatDateAR(r.inviteExpiresAt)}`}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="max-w-3xl text-xs text-muted-foreground">
            Confirmaron su casilla y nunca crearon la contraseña: el correo con el enlace no les llegó, se
            les perdió, o la invitación lleva más de <span className={NUM}>{INVITE_FRESH_HOURS}</span> horas
            sin usarse. Con <code>EMAIL_ALLOWLIST</code> puesta —el estado de este sitio hasta el
            lanzamiento— ese correo ni siquiera sale, así que esta lista se llena sola y el reenvío también
            se bloquea: se vacía al sacar la variable. La salida es el
            botón de envío de su ficha (pestaña Acceso), que revoca el enlace anterior y manda uno nuevo por
            correo. Si esa casilla ya es la cuenta de acceso de otro socio, el reenvío no lo destraba: ahí
            la salida es cargarle otro email a la ficha. Quien tiene una invitación viva emitida hace menos
            de <span className={NUM}>{INVITE_FRESH_HOURS}</span> horas no aparece acá: todavía no hay nada
            que destrabar.
          </p>
        </>
      )}
    </Section>
  );
}
