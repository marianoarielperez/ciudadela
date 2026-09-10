"use client";
// Las DOS salidas de una fila abierta que NO son un socio: registrarla como
// ingreso no societario, o descartarla.
//
// Son dos formularios y no uno con un switch, porque son dos decisiones
// distintas y de peso distinto: una declara que la plata es de la asociación
// pero de ningún socio, y la otra que no se le atribuye a nadie. Cada una con su
// action, su estado y su botón.
//
// Viven juntas al pie de la pantalla, en un mismo bloque cerrado: las dos son
// la respuesta a "esto no es de un socio", y ponerlas una al lado de la otra es
// lo que deja ver que descartar YA NO es la única salida cuando no aparece el
// dueño de la plata.
//
// La primera salida —imputarle la plata a socios— es el REPARTO, y vive en
// `split-form.tsx`: desde la spec 2026-09-10 un cobro se puede partir entre
// hasta cinco socios, con su confirmación en dos pasos, y eso ya no cabe al lado
// de estos dos <details>.
import Link from "next/link";
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatARS } from "@/lib/format";
import { INCOME_CONCEPT_HINT, INCOME_CONCEPT_SUGGESTIONS } from "@/lib/treasury/labels";
import { dismissUnmatchedAction, registerAsOtherIncomeAction } from "./actions";

export function DismissForm({ rowId }: { rowId: number }) {
  const [state, formAction, pending] = useActionState(dismissUnmatchedAction, {});
  return (
    // Sin borde propio: el marco lo pone el bloque que la agrupa con el registro
    // de ingreso no societario.
    <details className="px-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        Descartar este pago
      </summary>
      <form action={formAction} className="space-y-3 pb-3">
        <input type="hidden" name="rowId" value={rowId} />
        {/* Campo NO controlado a propósito: el <details> se cierra cuando la
            action termina, así que no hay valor que preservar del reset de
            React 19. Sin `useSyncedForm`, pero con su <label> real. */}
        <div className="space-y-1">
          <Label htmlFor="dismiss-reason">Motivo</Label>
          <Input
            id="dismiss-reason"
            name="reason"
            maxLength={200}
            autoComplete="off"
            className="max-w-md"
            placeholder="Por qué esta plata no se le imputa a nadie"
          />
          <p className="text-xs text-muted-foreground">
            Queda escrito en la fila. Descartar es para lo que <strong>no</strong> es plata de la
            vecinal: un cobro de prueba, un error de Mercado Pago. Si la plata entró y es de la
            asociación —un alquiler, una rifa—, registrala arriba como ingreso no societario.
          </p>
        </div>
        {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Descartando…" : "Descartar"}
        </Button>
      </form>
    </details>
  );
}

// La tercera salida. Cerrada como el descarte y arriba de él: es la más
// probable de las dos —una vecinal alquila su salón todos los meses— y la que
// conserva la plata en los registros.
export function OtherIncomeForm({ rowId, amount, paidAt }: {
  rowId: number;
  amount: number;
  /** Ya formateada en es-AR: el ingreso lleva el día en que MP cobró. */
  paidAt: string;
}) {
  const [state, formAction, pending] = useActionState(registerAsOtherIncomeAction, {});
  return (
    <details className="px-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        Registrar como ingreso no societario
      </summary>
      {/* Campos NO controlados, igual que el descarte: el <details> se cierra al
          terminar la action (redirige a Otros ingresos), así que no hay valor
          que preservar del reset de React 19. */}
      <form action={formAction} className="space-y-3 pb-3">
        <input type="hidden" name="rowId" value={rowId} />
        <div className="space-y-1">
          <Label htmlFor="income-concept">Concepto</Label>
          <Input
            id="income-concept"
            name="concept"
            maxLength={200}
            autoComplete="off"
            className="max-w-md"
            placeholder="Alquiler del salón, rifa, evento…"
            list="income-concept-opciones"
          />
          {/* Las sugerencias salen de la MISMA constante que el formulario de
              Otros ingresos: dos listas escritas a mano divergen. Y llevan la
              misma aclaración, porque un desplegable sin explicación es lo más
              fácil de leer como lista cerrada — y esto es texto libre. */}
          <datalist id="income-concept-opciones">
            {INCOME_CONCEPT_SUGGESTIONS.map((o) => <option key={o} value={o} />)}
          </datalist>
          <p className="text-xs text-muted-foreground">{INCOME_CONCEPT_HINT}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="income-note">Nota (opcional)</Label>
          <Input id="income-note" name="note" maxLength={200} autoComplete="off" className="max-w-md" />
        </div>
        <p className="text-sm">
          Se registra un ingreso de{" "}
          <span className="font-mono font-semibold tabular-nums">{formatARS(amount)}</span>, fechado
          el {paidAt}, que es el día en que Mercado Pago lo cobró.{" "}
          <span className="text-muted-foreground">
            No emite recibo: la serie numerada es de las cuotas sociales.
          </span>
        </p>
        {/* El rechazo por un registro anterior anulado ya no es un callejón:
            lleva al ingreso del que habla, donde el concepto se corrige sin
            anular. Viaja el id, nunca el texto que escribió el operador. */}
        {state.error && (
          <FormMessage kind="error">
            {state.error}
            {state.income && (
              <>
                {" "}
                <Link
                  className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/admin/tesoreria/otros-ingresos?ingreso=${state.income.id}`}
                >
                  Ver ese ingreso en Otros ingresos
                </Link>
              </>
            )}
          </FormMessage>
        )}
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Registrando…" : "Registrar el ingreso"}
        </Button>
      </form>
    </details>
  );
}
