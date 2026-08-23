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
import { incomeListHref } from "@/lib/treasury/income-nav";
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
      {/* Los cuatro campos en una fila y no en una columna: la carga es un
          renglón de mostrador, y apilada empujaba el resumen del ejercicio
          fuera de la pantalla, que es justo lo que el operador vino a mirar. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>
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

// El único filtro que queda es el MEDIO. Las fechas se fueron: el año lo da la
// barra de ejercicios y el mes lo da la cinta, así que ya no hay bordes que
// tipear. El año y el mes vigentes viajan como campos ocultos para que filtrar
// por medio no devuelva al operador al ejercicio en curso.
//
// GET plano —queda en la URL, se comparte y se recarga—, así que no hay action
// ni reset de React 19 que sincronizar. Es cliente igual porque el <select> del
// medio pasa por `SelectField`: un <select> crudo se ve plano en modo oscuro
// (la deuda que anota CLAUDE.md).
//
// Por qué NO hay campo de texto: el concepto y la nota son texto libre del
// operador, y un `?q=…` en la URL queda escrito en el access log de Nginx y de
// Cloudflare, que no están cubiertos por la retención de `audit_logs`.
export function MethodFilterForm({ year, currentYear, month, medio }: {
  year: number;
  /** El ejercicio en curso vive en la URL limpia: su `anio` no se manda. */
  currentYear: number;
  month: number | null;
  medio: string;
}) {
  const { formRef, field } = useSyncedForm({ medio });
  return (
    <form ref={formRef} className="flex flex-wrap items-end gap-3" method="get">
      {year !== currentYear && <input type="hidden" name="anio" value={year} />}
      {month !== null && <input type="hidden" name="mes" value={month} />}
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
      {medio !== "" && (
        <Button asChild variant="ghost">
          <Link href={incomeListHref({ year, month }, currentYear)}>Todos los medios</Link>
        </Button>
      )}
    </form>
  );
}

/** De dónde salió el operador, para volver ahí después de corregir o anular.
 *  Sólo enteros y el enum del medio: nada de texto libre a la URL. */
export type IncomeBackParams = {
  anio?: string;
  mes?: string;
  medio?: string;
  ingreso?: string;
};

/** Los campos ocultos que reconstruyen esa vista del otro lado. */
function BackFields({ back }: { back: IncomeBackParams }) {
  return (
    <>
      {(["anio", "mes", "medio", "ingreso"] as const).map((k) =>
        back[k] ? <input key={k} type="hidden" name={k} value={back[k]} /> : null,
      )}
    </>
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
export function EditIncomeForm({ incomeId, concept, note, back }: {
  incomeId: number;
  concept: string;
  note: string | null;
  /** La vista de la que salió: se corrige y se vuelve al mismo ejercicio, mes y
   *  medio. Sin esto, guardar el texto devolvía siempre al año en curso. */
  back: IncomeBackParams;
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
        <BackFields back={back} />
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

export function VoidIncomeForm({ incomeId, concept, fromMercadoPago, back }: {
  incomeId: number;
  concept: string;
  /** El ingreso vino de la bandeja sin conciliar: su `mpPaymentId` es único y no
   *  se libera al anular, así que la anulación es de ida. */
  fromMercadoPago: boolean;
  /** La vista de la que salió: se anula y se vuelve al mismo ejercicio. */
  back: IncomeBackParams;
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
        <BackFields back={back} />
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
