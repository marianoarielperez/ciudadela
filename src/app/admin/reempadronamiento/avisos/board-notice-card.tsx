"use client";
// La tarjeta de un aviso de cartelera. UNA tarjeta por aviso, nunca una fila por
// socio: la unidad de trabajo del operador es el cartel (decisión 6 del
// diseño). Cargar cien socios de a uno en el mostrador de una vecinal no es una
// pantalla, es una tarde perdida.
//
// La tarjeta tiene dos estados y son distintos de verdad:
//
//   · SIN FIJAR — el cartel todavía no se colgó. Se ofrece imprimirlo y
//     asentar la fecha de fijación. El asentado pide confirmación porque de esa
//     fecha cuelgan los veinte días hábiles de cien vecinos y se registra UNA
//     SOLA VEZ: no hay pantalla para corregirla.
//   · FIJADO — la fecha ya está asentada, la nómina quedó congelada y lo que se
//     muestra es el plazo. "Cumplido" es un DERIVADO de pantalla (`now >= dueAt`
//     resuelto en el servidor, spec §8): no hay ningún cron que lo prenda, y no
//     hace falta, porque lo único que cambia ese día es cómo se lee la fecha.
//
// El PDF está SIEMPRE disponible, en los dos estados: una hoja se rompe, se
// moja o se la lleva el viento, y la reimpresión de un aviso fijado sale con su
// plazo impreso.
//
// El mapa ícono→Lucide vive acá, en el componente de cliente, como el resto del
// panel.
import { Pin, Printer } from "lucide-react";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { addToBoardNoticeAction, postBoardNoticeAction } from "./actions";

const NUM = "font-mono tabular-nums";

export type BoardNoticeCardData = {
  id: number;
  /** Etiqueta del `kind` ya resuelta (`BOARD_NOTICE_KIND_LABELS`). */
  kindLabel: string;
  /** Cuántos destinatarios: los congelados si ya se fijó, los vivos si no. */
  recipients: number;
  /** Fechas ya formateadas en el servidor: el navegador del operador puede
   *  tener cualquier zona horaria y de estas fechas cuelga una baja. */
  postedAtLabel: string | null;
  dueAtLabel: string | null;
  /** `now >= dueAt`, resuelto en el SERVIDOR por el mismo motivo. */
  fulfilled: boolean;
};

export function BoardNoticeCard({ notice, todayIso, canPost, coverageWarning }: {
  notice: BoardNoticeCardData;
  /** "YYYY-MM-DD" del día civil argentino de hoy: valor por defecto del campo y
   *  tope del input. */
  todayIso: string;
  /** Sólo display: la action vuelve a resolver `requireSuperadmin` contra la
   *  fila viva de `User`. */
  canPost: boolean;
  /** Aviso preventivo si la tabla de feriados no alcanza para computar el plazo
   *  (`coverageNotice`). No bloquea: el que corta es el dominio. */
  coverageWarning: string | null;
}) {
  const [state, formAction, pending] = useActionState(postBoardNoticeAction, {});
  const posted = notice.postedAtLabel !== null;

  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{notice.kindLabel}</span>
            <span className="text-muted-foreground">
              · <span className={NUM}>{notice.recipients}</span>{" "}
              {notice.recipients === 1 ? "destinatario" : "destinatarios"}
            </span>
            {posted ? (
              notice.fulfilled ? (
                <Badge variant="success">Cumplido</Badge>
              ) : (
                <Badge variant="secondary">En cartelera</Badge>
              )
            ) : (
              <Badge variant="outline">Sin fijar</Badge>
            )}
          </p>
          {/* Link y no botón: abre un archivo en otra pestaña. `min-h-11` es el
              target táctil de 44px — en la sede esto se toca desde el celular. */}
          <Button asChild variant="outline" className="min-h-11 px-4">
            <a
              href={`/api/admin/reempadronamiento/avisos/${notice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Printer aria-hidden="true" className="size-4" />
              Imprimir PDF
            </a>
          </Button>
        </div>

        {posted ? (
          <p className="text-muted-foreground">
            Fijado el <span className={NUM}>{notice.postedAtLabel}</span>
            {notice.dueAtLabel && (
              <>
                {" · "}
                {notice.fulfilled ? "quedó fehaciente el " : "queda fehaciente el "}
                <span className={NUM}>{notice.dueAtLabel}</span>
              </>
            )}
            {" — veinte días hábiles (Art. 5° ter)."}
          </p>
        ) : (
          <form
            action={formAction}
            onSubmit={(e) => {
              // El input entrega "AAAA-MM-DD" y la UI del proyecto es es-AR: el
              // diálogo tiene que decir la fecha como la lee el operador. Se da
              // vuelta el string y no se construye un `Date`, que en el
              // navegador interpretaría el ISO como UTC y podría mostrar el día
              // anterior.
              const iso = String(new FormData(e.currentTarget).get("postedAt") ?? "");
              const [y, m, d] = iso.split("-");
              const shown = d ? `${d}/${m}/${y}` : iso;
              if (
                !window.confirm(
                  `¿Asentar que este aviso se fijó el ${shown}? La fecha se registra una sola ` +
                    `vez: de ella salen los veinte días hábiles de ${notice.recipients} ` +
                    `${notice.recipients === 1 ? "socio" : "socios"} y no se puede corregir después.`,
                )
              ) {
                e.preventDefault();
              }
            }}
            className="space-y-3 border-t pt-3"
          >
            <input type="hidden" name="noticeId" value={notice.id} />
            {coverageWarning && (
              <FormMessage kind="warning" box role="none">{coverageWarning}</FormMessage>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-xs font-medium">Fijado el</span>
                <input
                  type="date"
                  name="postedAt"
                  defaultValue={todayIso}
                  max={todayIso}
                  required
                  className="min-h-11 rounded-md border border-input bg-background px-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <Button type="submit" size="lg" className="min-h-11 px-4" disabled={!canPost || pending}>
                {pending ? "Asentando…" : "Asentar fijación"}
              </Button>
              {!canPost && (
                <FormMessage kind="neutral" as="span" role="none">
                  Solo el superadmin puede asentar la fijación.
                </FormMessage>
              )}
            </div>
            <p className="max-w-2xl text-muted-foreground">
              Asentala el MISMO día que colgás el cartel: la nómina se congela en ese momento, y a
              quien mientras tanto le carguen el correo queda fuera del lote aunque su nombre esté
              impreso en la pared.
            </p>
            {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
            {state.ok && <FormMessage kind="success" box>{state.ok}</FormMessage>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// El caso borde individual: el rebote POSTERIOR al envío masivo
// ─────────────────────────────────────────────────────────────────────────────

/** El único control del módulo que opera sobre UN socio, y sólo porque el hecho
 *  que atiende es de a uno: a este convocado le salió el correo y la casilla
 *  rebotó después, así que no entró en ningún cartel y hoy no está notificado
 *  por ninguna vía.
 *
 *  Lo que hace es sumarlo al cartel complementario del proceso —abriéndolo si no
 *  existe—; imprimirlo y fijarlo sigue siendo trabajo del aviso, en el tablero.
 *  No pide confirmación: sumar a un cartel sin fijar no mueve ningún plazo y es
 *  reversible sin más que no fijarlo. */
export function AddToBoardChip({ processId, memberId, memberName }: {
  processId: number;
  memberId: number;
  memberName: string;
}) {
  const [state, formAction, pending] = useActionState(addToBoardNoticeAction, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="processId" value={processId} />
      <input type="hidden" name="memberId" value={memberId} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="min-h-11 px-3"
        disabled={pending}
        // El nombre no se dibuja en el botón —la fila ya lo tiene al lado— pero
        // sí en el nombre accesible: sin él, una lista de cien filas le dicta al
        // lector de pantalla cien botones idénticos.
        aria-label={`Pasar a cartelera a ${memberName}`}
      >
        <Pin aria-hidden="true" className="size-4" />
        {pending ? "Sumando…" : "Pasar a cartelera"}
      </Button>
      {state.error && <FormMessage kind="error" as="span">{state.error}</FormMessage>}
      {state.ok && <FormMessage kind="success" as="span">{state.ok}</FormMessage>}
    </form>
  );
}
