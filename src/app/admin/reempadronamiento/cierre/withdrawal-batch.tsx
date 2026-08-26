"use client";
// Etapa B del cierre: el BORRADOR DEL ACTA DE BAJAS y el lote que las declara.
//
// Lo que se ve acá no es una tabla de socios: es el anexo que el acta necesita
// llevar (REG-23). Para cada convocado, qué notificaciones se le cursaron, por
// qué vía y en qué fecha —y, cuando fue por cartelera, cuándo quedó fehaciente,
// que no es el día en que se colgó el papel—. Eso es lo que hace oponible la
// resolución de la Comisión; sin eso, la baja es un dato en una base.
//
// Mecánica calcada de `ArrearsForm` (el lote de cesantía por mora) y de
// `ApplicationCards`, con sus mismas razones:
//   - la selección se sigue desde el `onChange` del <form> y se re-afirma con
//     `useFormResetSync`, porque React 19 resetea el formulario al terminar la
//     action y el rechazo parcial es el caso ESPERABLE;
//   - la barra de acción va `sticky bottom-0`: la lista puede tener veinticinco
//     tarjetas largas y el botón no puede estar sólo al final del scroll;
//   - la acción tiene DOS pasos, y el primero no da de baja a nadie.
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PresentationStatus } from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { presentationStatusBadgeVariant } from "@/lib/admin/status-badges";
import { formatDateAR } from "@/lib/format";
import { NOTIFICATION_TYPE_LABELS, PRESENTATION_STATUS_LABELS } from "@/lib/members/labels";
// De `close` y NO de `withdrawals`: este es un componente de CLIENTE y
// `withdrawals` arrastra Prisma y el mailer. `close` es puro.
import { WITHDRAWAL_BATCH_MAX, type NoticeTrace } from "@/lib/reregistration/close";
import { cn } from "@/lib/utils";
import { declareWithdrawalsAction } from "./actions";

const NUM = "font-mono tabular-nums";

export type WithdrawalRow = {
  presentationId: number;
  memberId: number;
  fullName: string;
  memberNumber: number | null;
  status: PresentationStatus;
  byEmail: boolean;
  notices: NoticeTrace[];
};

/** Una notificación cursada, redactada como va al anexo del acta.
 *
 *  La distinción que este renglón existe para hacer: por CORREO la notificación
 *  es fehaciente al enviarse; por CARTELERA lo es al cumplirse los veinte días
 *  hábiles, y por eso se dicen las dos fechas. Un cartel sin fijar no notificó a
 *  nadie todavía, y una fila `failed` es el registro de un INTENTO —el correo no
 *  salió—, así que tampoco. Las tres se leen distinto a propósito. */
function NoticeLine({ n }: { n: NoticeTrace }) {
  const label = NOTIFICATION_TYPE_LABELS[n.type];
  if (n.status === "failed") {
    return (
      <li>
        <span className="font-medium">{label}</span> — el correo del{" "}
        <span className={NUM}>{formatDateAR(n.at)}</span>{" "}
        <span className="text-destructive">no salió: no cuenta como notificación</span>.
      </li>
    );
  }
  if (n.via === "board") {
    return (
      <li>
        <span className="font-medium">{label}</span> — cartelera, fijada el{" "}
        <span className={NUM}>{formatDateAR(n.at)}</span>
        {n.effectiveAt === null ? (
          <span className="text-warning"> (todavía sin cumplir el plazo)</span>
        ) : (
          <>
            , fehaciente el <span className={NUM}>{formatDateAR(n.effectiveAt)}</span>
          </>
        )}
        .
      </li>
    );
  }
  return (
    <li>
      <span className="font-medium">{label}</span> — correo enviado el{" "}
      <span className={NUM}>{formatDateAR(n.at)}</span>.
    </li>
  );
}

function WithdrawalCard({ row, checked }: { row: WithdrawalRow; checked: boolean }) {
  // Sólo las que EFECTIVAMENTE notificaron. Una fila `failed` no acredita nada,
  // y contarla acá haría que el aviso de "sin ninguna notificación" no
  // apareciera justo sobre el vecino al que no se le pudo avisar.
  const served = row.notices.filter((n) => n.status !== "failed");
  return (
    <div className="space-y-2 rounded-md border p-3">
      <label className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
        <input type="checkbox" name="ids" value={row.presentationId} defaultChecked={checked} className="size-4" />
        <span className={`${NUM} text-muted-foreground`}>
          {row.memberNumber !== null ? `N° ${row.memberNumber}` : "Sin número"}
        </span>
        <span className="font-medium">{row.fullName}</span>
        <Badge variant={presentationStatusBadgeVariant(row.status)}>
          {PRESENTATION_STATUS_LABELS[row.status]}
        </Badge>
        <Badge variant="outline">{row.byEmail ? "Se le notifica por correo" : "Va al cartel de la sede"}</Badge>
      </label>

      {served.length === 0 ? (
        // El aviso más importante de la pantalla. Una baja sin ninguna
        // notificación previa acreditada no es oponible: el Art. 9° bis exige el
        // apercibimiento, y sin él el vecino tiene el recurso ganado de entrada.
        <FormMessage kind="error" role="none" as="div">
          No figura ninguna notificación cursada a esta persona en este proceso. Antes de declararle
          la baja, revisá que se le haya notificado la convocatoria y la segunda instancia.
        </FormMessage>
      ) : (
        <ul className="ml-7 list-disc space-y-1 text-sm text-muted-foreground">
          {served.map((n, i) => (
            <NoticeLine key={`${n.type}-${n.via}-${i}`} n={n} />
          ))}
        </ul>
      )}
      {row.notices.some((n) => n.status === "failed") && (
        <ul className="ml-7 list-disc space-y-1 text-sm text-muted-foreground">
          {row.notices
            .filter((n) => n.status === "failed")
            .map((n, i) => (
              <NoticeLine key={`failed-${i}`} n={n} />
            ))}
        </ul>
      )}
    </div>
  );
}

export function WithdrawalBatch({ processId, rows, minutes, canDeclare, blockedReason }: {
  processId: number;
  rows: WithdrawalRow[];
  minutes: MinuteOption[];
  /** Sólo display: la action vuelve a resolver `requireSuperadmin` y a
   *  revalidar el vencimiento de la segunda instancia contra la base. */
  canDeclare: boolean;
  /** Por qué el botón está apagado, cuando lo está. */
  blockedReason?: string;
}) {
  const [state, formAction, pending] = useActionState(declareWithdrawalsAction, {});
  const [selected, setSelected] = useState<string[]>([]);
  // Qué confirmación descartó el operador con "Volver". Se guarda el objeto y no
  // un booleano: cada corrida de la action devuelve uno nuevo, así que una
  // confirmación posterior se muestra sola sin ningún efecto que resetear.
  const [dismissed, setDismissed] = useState<typeof state.confirm>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  // La selección efectiva se DERIVA de lo que la página sigue ofreciendo: con
  // éxito parcial el `revalidatePath` deja las bajas hechas y esas tarjetas
  // desaparecen, así que sin este filtro el botón seguiría contando diez cuando
  // quedan tres.
  const all = rows.map((r) => String(r.presentationId));
  const effective = selected.filter((id) => all.includes(id));
  useFormResetSync(formRef, { ids: effective.join(",") });
  const batch = all.slice(0, WITHDRAWAL_BATCH_MAX);
  const overCap = effective.length > WITHDRAWAL_BATCH_MAX;
  const allSelected = batch.length > 0 && batch.every((id) => effective.includes(id));

  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.name !== "ids" || el.type !== "checkbox") return;
    setSelected((prev) =>
      el.checked ? [...new Set([...prev, el.value])] : prev.filter((v) => v !== el.value),
    );
    // Tocar la selección invalida lo que el operador acaba de leer.
    setDismissed(state.confirm);
  };

  const confirm = state.confirm && state.confirm !== dismissed ? state.confirm : null;

  // Con la confirmación abierta, el ÚNICO botón de envío que queda es el que da
  // de baja, y el navegador lo asigna al Enter de cualquier campo enfocado —un
  // <select> incluido, en Firefox—. Sin cubrirlo, tabular hasta el acta y
  // apretar Enter declararía las bajas sin haber apretado "Confirmar las bajas".
  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (
      confirm &&
      e.key === "Enter" &&
      (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)
    ) {
      e.preventDefault();
    }
  };

  // El botón que tenía el foco se desmonta apenas aparece el panel, y el foco cae
  // a <body>: sin esto, un lector de pantalla no anuncia nada y el operador tiene
  // que tabular desde el skip link para llegar a confirmar.
  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  if (rows.length === 0) {
    return (
      <EmptyState
        size="list"
        description="No queda ningún convocado sin desenlace: o se re-empadronaron, o su baja ya está declarada."
      />
    );
  }

  return (
    <form ref={formRef} action={formAction} onChange={onChange} onKeyDown={onKeyDown} className="space-y-4">
      <input type="hidden" name="processId" value={processId} />

      {/* Borde destructivo: este bloque no carga datos, le quita a una persona
          su condición de socia. */}
      <div className="flex flex-wrap items-end gap-4 rounded-md border border-destructive/40 p-3">
        <div className="min-w-64 grow">
          <MinutePicker minutes={minutes} />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={allSelected}
            onChange={() => {
              setSelected(allSelected ? [] : batch);
              setDismissed(state.confirm);
            }}
          />
          {all.length > WITHDRAWAL_BATCH_MAX
            ? `Seleccionar los primeros ${WITHDRAWAL_BATCH_MAX}`
            : "Seleccionar todos"}
        </label>
      </div>

      {overCap && (
        // `role="status"` y no `role="none"`: esto es la reacción a tildar una
        // casilla y explica un control que se acaba de apagar. Cortés y no
        // `alert`: no interrumpe mientras se sigue tildando.
        <FormMessage kind="warning" role="status">
          {`Tenés ${effective.length} convocados tildados y el lote acepta hasta ${WITHDRAWAL_BATCH_MAX} por vez. ` +
            "Destildá los que sobren y declaralos en una segunda tanda: cada baja cancela además el " +
            "débito automático en Mercado Pago y eso lleva su tiempo."}
        </FormMessage>
      )}

      {/* Padding extra cuando la barra está montada: `sticky` reserva su lugar en
          el flujo, pero se superpone a las tarjetas de más arriba mientras se
          hace scroll. */}
      <div className="space-y-3 pb-4">
        {rows.map((r) => (
          <WithdrawalCard
            key={r.presentationId}
            row={r}
            checked={effective.includes(String(r.presentationId))}
          />
        ))}
      </div>

      {confirm && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          className="space-y-3 rounded-md border border-destructive bg-destructive/5 p-3 outline-hidden focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          role="group"
          aria-labelledby="withdrawal-confirm-title"
        >
          {confirm.changed && (
            <FormMessage kind="warning">
              La selección o el acta cambiaron después de confirmar: revisá de nuevo la lista.
            </FormMessage>
          )}
          <p id="withdrawal-confirm-title" className="font-medium">
            {`Vas a declarar la baja de ${confirm.targets.length} ${
              confirm.targets.length === 1 ? "socio" : "socios"
            }. Dejan de ser socios de la asociación y les empiezan a correr 30 días para recurrir.`}
          </p>
          <p className="text-sm text-muted-foreground">
            {"Se asienta en el acta: "}
            <span className="font-medium text-foreground">{confirm.minuteLabel}</span>
          </p>
          <ul className="space-y-1 text-sm">
            {confirm.targets.map((t) => (
              <li key={t.presentationId} className="flex flex-wrap items-baseline gap-x-2">
                <span className={`${NUM} text-muted-foreground`}>
                  {t.memberNumber !== null ? `N° ${t.memberNumber}` : "Sin número"}
                </span>
                <span className="font-medium">{t.name}</span>
                <span className="text-muted-foreground">
                  {t.byEmail ? "se le avisa por correo" : "va al cartel de la sede"}
                </span>
                {t.noticeCount === 0 && (
                  <FormMessage kind="error" as="span" role="none">
                    Sin ninguna notificación cursada.
                  </FormMessage>
                )}
              </li>
            ))}
          </ul>
          {/* La huella de lo que se está confirmando: si para cuando se envía ya
              no es la misma selección ni la misma acta, la acción vuelve a pedir
              confirmación en vez de dar de baja a ciegas. */}
          <input type="hidden" name="confirmToken" value={confirm.token} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="confirmar" value="1" variant="destructive" disabled={pending} className="min-h-11">
              {pending ? "Declarando…" : "Confirmar las bajas"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className="min-h-11"
              onClick={() => setDismissed(confirm)}
            >
              Volver sin declarar
            </Button>
          </div>
        </div>
      )}

      {/* La barra de acción, pegada abajo: la lista puede tener veinticinco
          tarjetas largas. Con la confirmación en pantalla desaparece — hay un
          solo botón que da de baja, y es el del panel de confirmación. */}
      {!confirm && (
        <div className="sticky bottom-0 z-40 -mx-4 border-t bg-background/95 p-3 shadow-[0_-4px_16px_rgb(0_0_0_/_0.08)] backdrop-blur lg:-mx-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium">
              {effective.length} {effective.length === 1 ? "seleccionado" : "seleccionados"}
            </p>
            <Button
              type="submit"
              variant="destructive"
              className="min-h-11"
              disabled={pending || effective.length === 0 || overCap || !canDeclare}
            >
              {pending ? "Revisando…" : "Declarar bajas seleccionadas"}
            </Button>
            {blockedReason && (
              <FormMessage kind="neutral" as="span" role="none">
                {blockedReason}
              </FormMessage>
            )}
          </div>
        </div>
      )}

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      {/* Los cuatro desenlaces se distinguen por color antes de leerlos: verde lo
          que salió, ámbar lo que quedó pendiente, rojo lo que sigue haciendo
          daño ahora mismo. Por eso la buena noticia va sola en su caja. */}
      {state.declared !== undefined && state.declared > 0 && (
        <FormMessage kind="success" box>
          {`${state.declared} ${state.declared === 1 ? "baja declarada" : "bajas declaradas"}.`}
          {state.notices && (
            <>
              {" "}
              {state.notices.emailed > 0 && `${state.notices.emailed} por correo. `}
              {state.notices.board > 0 &&
                `${state.notices.board} sin casilla: generá el cartel de la sede acá abajo. `}
            </>
          )}
        </FormMessage>
      )}

      {state.failures && state.failures.length > 0 && (
        <FormMessage kind="warning" box as="div">
          <p className="font-medium">
            {`${state.failures.length} ${state.failures.length === 1 ? "quedó" : "quedaron"} sin declarar:`}
          </p>
          <ul className="mt-1 space-y-1">
            {state.failures.map((f) => (
              <li key={f.memberId}>
                <Link className={INLINE_LINK} href={`/admin/socios/${f.memberId}`}>{f.name}</Link>
                {` — ${f.error}`}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}

      {/* La baja salió y la notificación no. Es el aviso que no puede perderse:
          sin notificación no hay ventana de recurso corriendo, y esa persona
          perdió la condición de socia sin enterarse.
          Los BLOQUEADOS van acá y no en la caja verde de arriba, que es donde
          estaban: un bloqueo de `EMAIL_ALLOWLIST` no es un fallo de entrega
          —es la guarda del entorno andando— pero deja exactamente a la misma
          persona sin notificar, y esa lista sigue definida en producción hasta
          el lanzamiento (docs/07), así que hoy es el camino ESPERABLE. */}
      {state.notices &&
        (state.notices.failed.length > 0 ||
          state.notices.blocked.length > 0 ||
          state.notices.deferred > 0) && (
        <FormMessage kind="error" box as="div">
          <p className="font-medium">
            Estas personas quedaron dadas de baja y SIN NOTIFICAR:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {state.notices.failed.map((n) => (
              <li key={`f-${n}`}>{n} — el correo no salió.</li>
            ))}
            {state.notices.blocked.map((n) => (
              <li key={`b-${n}`}>
                {n} — el correo no salió: lo bloqueó la lista de direcciones permitidas del entorno.
              </li>
            ))}
            {state.notices.deferred > 0 && (
              <li>{`${state.notices.deferred} quedaron fuera del tope de correos de la corrida.`}</li>
            )}
          </ul>
          <p className="mt-1">
            Mientras no se les notifique no les corre la ventana de recurso y la resolución no es
            oponible. Reintentá desde{" "}
            <Link className={INLINE_LINK} href="#sin-notificar">
              Bajas declaradas sin notificar
            </Link>
            , más abajo en esta pantalla — esa lista queda ahí hasta que se les notifique. Si el
            bloqueo es de la lista de direcciones del entorno, el reintento va a volver a bloquearse
            hasta que esa lista se borre.
          </p>
        </FormMessage>
      )}

      {state.unstamped && state.unstamped.length > 0 && (
        <FormMessage kind="error" box as="div">
          <p className="font-medium">
            Estas bajas se asentaron pero el sistema no pudo marcar su presentación:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {state.unstamped.map((u) => (
              <li key={u.memberId}>{u.name}</li>
            ))}
          </ul>
          <p className="mt-1">
            No van a entrar al cartel de bajas ni se les va a notificar por esa vía. Avisale a quien
            mantiene el sistema antes de cerrar el libro.
          </p>
        </FormMessage>
      )}

      {state.debitFailures && state.debitFailures.length > 0 && (
        <FormMessage kind="error" box as="div">
          <p className="font-medium">
            Se declaró la baja, pero Mercado Pago no aceptó cancelar el débito automático:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {state.debitFailures.map((f) => (
              <li key={f.memberId}>
                {f.name} — {f.count === 1 ? "1 débito sigue vivo" : `${f.count} débitos siguen vivos`}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Mientras sigan vivos se les va a seguir cobrando:{" "}
            <Link className={cn(INLINE_LINK, "font-medium")} href="/admin/tesoreria/suscripciones">
              cancelalos desde Suscripciones
            </Link>
            .
          </p>
        </FormMessage>
      )}
    </form>
  );
}
