"use client";
// Los tres caminos que tiene una fila abierta: imputarla a un socio, registrarla
// como ingreso no societario, o descartarla.
//
// Son tres formularios y no uno con un switch, porque son tres decisiones
// distintas y de peso distinto: una emite un recibo a nombre de un vecino, otra
// declara que la plata es de la asociación pero de ningún socio, y la última que
// no se le atribuye a nadie. Cada una con su action, su estado y su botón.
//
// Las dos últimas viven juntas al pie, en un mismo bloque cerrado: las dos son
// la respuesta a "esto no es de un socio", y ponerlas una al lado de la otra es
// lo que deja ver que descartar YA NO es la única salida cuando no aparece el
// dueño de la plata.
//
// `useSyncedForm` en el de imputar: React 19 resetea el <form action> cuando la
// action termina, y con un <select> controlado el concepto volvería al primero
// justo cuando el operador está leyendo por qué se rechazó.
import Link from "next/link";
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatARS } from "@/lib/format";
import { INCOME_CONCEPT_HINT, INCOME_CONCEPT_SUGGESTIONS } from "@/lib/treasury/labels";
import { dismissUnmatchedAction, registerAsOtherIncomeAction, resolveUnmatchedAction } from "./actions";

const digits = (v: string) => v.replace(/\D/g, "");

export function ResolveForm({ rowId, memberId, amount, paidAt, pendingCount, withdrawn, feeAmount }: {
  rowId: number;
  memberId: number;
  amount: number;
  /** Ya formateada en es-AR: la fecha del recibo es la del cobro, no la de hoy. */
  paidAt: string;
  pendingCount: number;
  withdrawn: boolean;
  /** Valor vigente de la cuota de la categoría, o null si no paga cuota. */
  feeAmount: number | null;
}) {
  const [state, formAction, pending] = useActionState(resolveUnmatchedAction, {});
  // El default es lo que el monto ya sugiere: cuántas cuotas entran en lo
  // cobrado. No es una adivinanza gratuita —el importe vino de un plan de MP,
  // así que casi siempre es un múltiplo exacto— y el operador lo ve escrito
  // antes de confirmar. Mínimo 1: un monto menor a la cuota se imputa igual a
  // una, y el sistema no cobra de más por eso (las cuotas no llevan monto).
  const suggested = feeAmount ? Math.max(1, Math.min(60, Math.floor(amount / feeAmount))) : 1;
  const { values, formRef, field } = useSyncedForm({
    concept: "fees",
    // Un cesante no devenga: como mucho puede cubrir las que le quedaron.
    count: String(withdrawn ? Math.max(1, Math.min(suggested, pendingCount)) : suggested),
    note: "",
  });
  const concepts: Array<[string, string]> = withdrawn
    ? [["fees", "Cuotas sociales (deuda congelada)"]]
    : [["fees", "Cuotas sociales"], ["voluntary", "Aporte voluntario"]];

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="memberId" value={memberId} />
      <SelectField label="Aplicar como" field={field("concept")} options={concepts} />
      {values.concept === "fees" && (
        <TextField
          label="Cantidad de cuotas"
          field={field("count", digits)}
          inputMode="numeric"
          // El servicio rechaza por encima de 60; el maxLength evita que la
          // pantalla muestre un total de siete cifras antes del rechazo.
          maxLength={2}
          hint={
            withdrawn
              ? `Dado de baja: como máximo ${pendingCount}.`
              : pendingCount > 0
                ? `Debe ${pendingCount}. Se imputan a las más antiguas primero.`
                : "Está al día: se imputa a la primera cuota no cubierta."
          }
        />
      )}
      <TextField label="Nota (opcional)" field={field("note")} maxLength={200} />
      {/* Lo último que se lee antes de confirmar: cuánto y con qué fecha. La
          fecha importa — el recibo lleva el día en que MP cobró, no el día en
          que el operador se dio cuenta. */}
      <p className="text-sm">
        Se registra un pago de{" "}
        <span className="font-mono font-semibold tabular-nums">{formatARS(amount)}</span> con recibo,
        fechado el {paidAt}, que es el día en que Mercado Pago lo cobró.
      </p>
      {/* El duplicado es el único rechazo que trae a dónde ir: el cobro ya tiene
          recibo y el operador necesita verlo para entender qué pasó —sobre todo
          si ese recibo se anuló—. Y el caso "ya estaba bien asentado" viene con
          `kind: "warning"`: no se perdió plata, no corresponde el rojo. */}
      {state.error && (
        <FormMessage kind={state.kind ?? "error"} box>
          {state.error}
          {state.receipt && (
            <>
              {" "}
              <Link
                className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                href={`/admin/tesoreria/recibos/${state.receipt.id}`}
              >
                Ver el recibo N° {state.receipt.number}
              </Link>
            </>
          )}
        </FormMessage>
      )}
      <Button type="submit" disabled={pending}>{pending ? "Aplicando…" : "Aplicar y emitir recibo"}</Button>
    </form>
  );
}

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
