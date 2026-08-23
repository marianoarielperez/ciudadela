"use client";
// Los formularios de Otros ingresos: registrar, filtrar, corregir y anular.
//
// Los que reciben datos van controlados con `useSyncedForm` — React 19 resetea
// el <form action> cuando la action termina, y acá el rechazo es frecuente (una
// fecha futura, un concepto de dos letras) con alguien esperando del otro lado
// del mostrador: perder lo tipeado es el error que importa.
import Link from "next/link";
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatARS } from "@/lib/format";
import {
  INCOME_CONCEPT_HINT,
  INCOME_CONCEPT_SUGGESTIONS,
  INCOME_METHOD_LABELS,
} from "@/lib/treasury/labels";
import { editOtherIncomeAction, registerOtherIncomeAction, voidOtherIncomeAction } from "./actions";

const digitsOnly = (v: string) => v.replace(/\D/g, "");

export function RegisterIncomeForm({ today, autoFocus }: {
  /** "AAAA-MM-DD" del día civil argentino, calculado en el servidor: el reloj
   *  del navegador puede estar en otra zona y fechar el ingreso un día antes. */
  today: string;
  /** Falso cuando la pantalla llegó con un aviso arriba (el redirect desde la
   *  bandeja, o el de la propia corrección): mover el foco al monto se lleva por
   *  delante el mensaje que el operador todavía no leyó. */
  autoFocus?: boolean;
}) {
  const [state, formAction, pending] = useActionState(registerOtherIncomeAction, {});
  const { values, formRef, field } = useSyncedForm({
    amount: "",
    receivedAt: today,
    concept: "",
    note: "",
  });
  const amount = Number(values.amount);
  const total = Number.isInteger(amount) && amount > 0 ? amount : null;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <TextField
        label="Monto ($)"
        // Sólo dígitos, como el mostrador: dejar entrar la coma o el punto
        // obliga a adivinar si "2500,50" son dos mil quinientos con cincuenta o
        // doscientos cincuenta mil.
        field={field("amount", digitsOnly)}
        inputMode="numeric"
        maxLength={8}
        placeholder="45000"
        autoFocus={autoFocus}
      />
      <TextField
        label="Fecha del ingreso"
        field={field("receivedAt")}
        type="date"
        hint="El día en que entró la plata, no el día en que se carga."
      />
      <TextField
        label="Concepto"
        field={field("concept")}
        maxLength={200}
        placeholder="Alquiler del salón"
        options={INCOME_CONCEPT_SUGGESTIONS}
        hint={INCOME_CONCEPT_HINT}
      />
      <TextField label="Nota (opcional)" field={field("note")} maxLength={200} />
      {/* Lo último que se lee antes de registrar, como en el mostrador: cuánto
          es y qué NO hace. Que no haya recibo es la mitad de esta pantalla. */}
      <p className="text-sm">
        {total !== null ? (
          <>
            Se registra un ingreso de{" "}
            <span className="font-mono font-semibold tabular-nums">{formatARS(total)}</span>.{" "}
          </>
        ) : null}
        <span className="text-muted-foreground">
          No emite recibo ni toca la cuenta de ningún socio: la serie numerada es de las cuotas
          sociales.
        </span>
      </p>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar el ingreso"}</Button>
    </form>
  );
}

// Los filtros van por GET plano —quedan en la URL, se comparten y se recargan—,
// así que no hay action ni reset de React 19 que sincronizar. Es cliente igual
// porque el <select> del medio pasa por `SelectField`: un <select> crudo se ve
// plano en modo oscuro (la deuda que anota CLAUDE.md).
//
// Por qué NO hay campo de texto: el concepto y la nota son texto libre del
// operador, y un `?q=…` en la URL queda escrito en el access log de Nginx y de
// Cloudflare, que no están cubiertos por la retención de `audit_logs`.
export function IncomeFilterForm({ desde, hasta, medio, filtered, base }: {
  desde: string;
  hasta: string;
  medio: string;
  filtered: boolean;
  base: string;
}) {
  const { formRef, field } = useSyncedForm({ desde, hasta, medio });
  return (
    <form ref={formRef} className="flex flex-wrap items-end gap-3" method="get">
      <TextField label="Desde" field={field("desde")} type="date" className="w-40" />
      <TextField label="Hasta" field={field("hasta")} type="date" className="w-40" />
      <div className="w-44">
        <SelectField
          label="Medio"
          field={field("medio")}
          options={[
            ["", "Todos"],
            ["cash", INCOME_METHOD_LABELS.cash],
            ["mp", INCOME_METHOD_LABELS.mp],
          ]}
        />
      </div>
      <Button type="submit" variant="secondary">Filtrar</Button>
      {filtered && (
        <Button asChild variant="ghost"><Link href={base}>Limpiar</Link></Button>
      )}
    </form>
  );
}

// La corrección vive en la celda del CONCEPTO y no en la columna de acciones:
// es el texto que edita, y ahí no compite con "Anular", que es la salida
// terminal de la fila.
//
// Sólo el texto. El monto, la fecha y el medio no se editan — para cambiar
// cualquiera de esos hay que anular y registrar de nuevo. Existe porque para un
// ingreso venido de Mercado Pago ese camino no existe: la unique de
// `mpPaymentId` no se libera al anular, así que un concepto mal escrito dejaba
// al operador con dos salidas falsas y ninguna verdadera.
export function EditIncomeForm({ incomeId, concept, note }: {
  incomeId: number;
  concept: string;
  note: string | null;
}) {
  const [state, formAction, pending] = useActionState(editOtherIncomeAction, {});
  // Un formulario por fila: sin prefijo, los `id` de "concept" y "note" se
  // repiten en toda la tabla y cada <label> apunta al primero.
  const { formRef, field } = useSyncedForm(
    { concept, note: note ?? "" },
    { idPrefix: `income-${incomeId}` },
  );
  return (
    <details className="w-fit">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        Editar
        {/* Una columna entera de "Editar" son destinos idénticos para un lector
            de pantalla: el sufijo oculto dice cuál es cuál. */}
        <span className="sr-only"> el concepto del ingreso de {concept}</span>
      </summary>
      <form ref={formRef} action={formAction} className="space-y-2 py-2">
        <input type="hidden" name="incomeId" value={incomeId} />
        <TextField
          label="Concepto"
          field={field("concept")}
          maxLength={200}
          options={INCOME_CONCEPT_SUGGESTIONS}
          className="w-72"
          hint={INCOME_CONCEPT_HINT}
        />
        <TextField label="Nota (opcional)" field={field("note")} maxLength={200} className="w-72" />
        <p className="text-xs text-muted-foreground">
          Sólo el texto. El monto, la fecha y el medio no se corrigen: para eso hay que anular y
          registrar de nuevo.
        </p>
        {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar el texto"}
        </Button>
      </form>
    </details>
  );
}

export function VoidIncomeForm({ incomeId, concept, fromMercadoPago }: {
  incomeId: number;
  concept: string;
  /** El ingreso vino de la bandeja sin conciliar: su `mpPaymentId` es único y no
   *  se libera al anular, así que la anulación es de ida. */
  fromMercadoPago: boolean;
}) {
  const [state, formAction, pending] = useActionState(voidOtherIncomeAction, {});
  return (
    <details className="w-fit">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        Anular
        {/* Una columna entera de "Anular" son destinos idénticos para un lector
            de pantalla: el sufijo oculto dice cuál es cuál. */}
        <span className="sr-only"> el ingreso de {concept}</span>
      </summary>
      {/* Campo NO controlado: la action redirige al terminar, así que no hay
          valor que preservar del reset de React 19. */}
      <form action={formAction} className="space-y-2 py-2">
        <input type="hidden" name="incomeId" value={incomeId} />
        <div className="space-y-1">
          <Label htmlFor={`void-reason-${incomeId}`}>Motivo</Label>
          <Input
            id={`void-reason-${incomeId}`}
            name="reason"
            maxLength={200}
            autoComplete="off"
            className="w-64"
            placeholder="Por qué se anula"
          />
          <p className="text-xs text-muted-foreground">
            No borra el ingreso: queda tachado con el motivo y deja de sumar. Si vino de Mercado
            Pago, su fila vuelve a Pendientes en la bandeja.
          </p>
          {/* El aviso va acá y no en un cartel de la pantalla: es la decisión que
              lo dispara. Anular un ingreso de MP es de ida —el cobro no se puede
              volver a registrar— y el error que lleva a anular casi siempre es un
              concepto mal escrito, que se arregla con Editar. */}
          {fromMercadoPago && (
            <FormMessage kind="warning">
              Este cobro entró por Mercado Pago y no se va a poder volver a registrar. Si lo que
              está mal es el concepto o la nota, corregilos con Editar.
            </FormMessage>
          )}
        </div>
        {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Anulando…" : "Anular"}
        </Button>
      </form>
    </details>
  );
}
