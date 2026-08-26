"use client";
// LAS BAJAS QUE QUEDARON SIN NOTIFICAR, y el único control que existe para
// sacarlas de ahí.
//
// ── Por qué esta lista tiene que estar en la pantalla ────────────────────────
// Una baja no notificada es una baja que el socio puede impugnar y que la
// asociación no puede sostener: la ventana de recurso del Art. 9° bis d) corre
// desde la notificación FEHACIENTE, así que sin notificación no hay plazo
// corriendo ni resolución oponible.
//
// Y el camino por el que una baja queda sin notificar no es raro: hoy es el
// esperable. `EMAIL_ALLOWLIST` sigue definida en producción hasta el
// lanzamiento (docs/07), un bloqueo suyo NO escribe fila de notificación, y la
// persona ya dejó de ser socia vigente — así que desaparece de la lista de
// convocados en cuanto la pantalla se recarga. Sin esta sección, el nombre de
// quien quedó de baja sin notificar no queda en ningún lado: ni en la base, ni
// en la pantalla de salud, ni en el estado del formulario.
//
// Por eso se llega acá ENTRANDO a la pantalla y no sólo en el instante
// posterior al lote: no puede depender de que el operador se acuerde.
//
// ── Qué hace el botón, y qué no ──────────────────────────────────────────────
// Reintenta el MISMO camino del post-lote (`notifyWithdrawal`), así que al
// lograrlo estampa la fecha fehaciente y la ventana de recurso exactamente
// igual. Lo que no hace: notificar a quien no tiene casilla utilizable —esos van
// al cartel de la sede, y su plazo arranca al cumplirse los veinte días
// hábiles— ni desbloquear la lista de direcciones del entorno. Las dos cosas se
// dicen acá antes de apretar y se vuelven a decir en el resultado: prometer una
// salida que no existe es peor que decir que no hay ninguna, porque el operador
// cierra el libro creyendo que lo resolvió.
import Link from "next/link";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { retryWithdrawalNoticesAction } from "./actions";

const NUM = "font-mono tabular-nums";

export type UnnotifiedRow = {
  presentationId: number;
  memberId: number;
  fullName: string;
  memberNumber: number | null;
  /** Tiene casilla utilizable: es a quien el reintento le puede cambiar algo. */
  byEmail: boolean;
};

function Person({ row }: { row: UnnotifiedRow }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className={`${NUM} text-muted-foreground`}>
        {row.memberNumber !== null ? `N° ${row.memberNumber}` : "Sin número"}
      </span>
      <Link className={INLINE_LINK} href={`/admin/socios/${row.memberId}`}>
        {row.fullName}
      </Link>
    </li>
  );
}

export function UnnotifiedWithdrawals({ processId, rows }: {
  processId: number;
  rows: UnnotifiedRow[];
}) {
  const [state, formAction, pending] = useActionState(retryWithdrawalNoticesAction, {});
  const byEmail = rows.filter((r) => r.byEmail);
  const byBoard = rows.filter((r) => !r.byEmail);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="processId" value={processId} />

      <FormMessage kind="error" box as="div">
        <p className="font-medium">
          {rows.length === 1
            ? "Hay 1 baja declarada y todavía sin notificar."
            : `Hay ${rows.length} bajas declaradas y todavía sin notificar.`}
        </p>
        <p className="mt-1">
          Mientras no se les notifique no les corre la ventana de recurso del Art. 9° bis inciso d) y
          la resolución de la Comisión no es oponible. Salen de esta lista solas cuando queda
          estampada su fecha fehaciente, por cualquiera de las dos vías.
        </p>
      </FormMessage>

      {byEmail.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {byEmail.length === 1
              ? "Con casilla utilizable: se le puede reintentar el correo."
              : "Con casilla utilizable: se les puede reintentar el correo."}
          </p>
          <ul className="space-y-1 text-sm">
            {byEmail.map((r) => (
              <Person key={r.presentationId} row={r} />
            ))}
          </ul>
        </div>
      )}

      {byBoard.length > 0 && (
        // No entran al reintento y hay que decirlo: su vía es el papel de la
        // pared, y su plazo arranca recién al cumplirse los veinte días hábiles
        // desde la fijación.
        <FormMessage kind="warning" as="div" role="none">
          {byBoard.length === 1
            ? "1 no tiene casilla utilizable: se notifica por el cartel de la sede. "
            : `${byBoard.length} no tienen casilla utilizable: se notifican por el cartel de la sede. `}
          Armalo en{" "}
          <Link className={INLINE_LINK} href="#cartel-de-bajas">
            Cartel de bajas para la sede
          </Link>{" "}
          y asentá la fijación desde el tablero: ahí queda estampada su fecha fehaciente.
        </FormMessage>
      )}

      <Button
        type="submit"
        variant="outline"
        className="min-h-11 px-4"
        disabled={pending || byEmail.length === 0}
      >
        {pending ? "Reintentando…" : "Reintentar la notificación por correo"}
      </Button>
      {byEmail.length === 0 && (
        <FormMessage kind="neutral" as="p" role="none">
          Ninguna de estas personas tiene casilla utilizable, así que no hay correo que reintentar.
        </FormMessage>
      )}

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      {state.ok && <FormMessage kind="success" box>{state.ok}</FormMessage>}

      {state.emailed !== undefined && state.emailed > 0 && (
        <FormMessage kind="success" box>
          {state.emailed === 1
            ? "1 baja quedó notificada por correo: desde hoy le corren los 30 días para recurrir."
            : `${state.emailed} bajas quedaron notificadas por correo: desde hoy les corren los 30 días para recurrir.`}
        </FormMessage>
      )}

      {((state.blocked?.length ?? 0) > 0 ||
        (state.failed?.length ?? 0) > 0 ||
        (state.deferred ?? 0) > 0) && (
        <FormMessage kind="error" box as="div">
          <p className="font-medium">El reintento no alcanzó a estas personas:</p>
          <ul className="mt-1 list-disc pl-5">
            {state.failed?.map((n) => (
              <li key={`f-${n}`}>{n} — el correo no salió.</li>
            ))}
            {state.blocked?.map((n) => (
              <li key={`b-${n}`}>
                {n} — lo bloqueó la lista de direcciones permitidas del entorno.
              </li>
            ))}
            {(state.deferred ?? 0) > 0 && (
              <li>{`${state.deferred} quedaron fuera del tope de correos de la corrida.`}</li>
            )}
          </ul>
          {(state.blocked?.length ?? 0) > 0 && (
            // La honestidad que le faltaba a esta pantalla: reintentar de nuevo
            // no cambia nada mientras la causa siga puesta.
            <p className="mt-1">
              El bloqueo es del entorno, no de la casilla del vecino: mientras la lista de
              direcciones permitidas siga definida, reintentar va a dar lo mismo. Se borra al lanzar
              (docs/07); hasta entonces, estas bajas siguen sin notificar.
            </p>
          )}
        </FormMessage>
      )}
    </form>
  );
}
