"use client";
// El formulario que asienta una exención de cuota (Art. 7 inc. a.4).
//
// ── Por qué el resumen previo ───────────────────────────────────────────────
// Es la lección cara del Módulo 6: el cierre del Libro N° 1 quedó asentado con
// el acta de las bajas porque el selector arrancaba preseleccionado y la
// pantalla no NOMBRABA el acta en ningún lado. Acá el acta elegida se lee con
// todas las letras arriba del botón, junto con los meses exactos que se eximen
// — y con el aviso de los que ya están pagos, que quedan pagos (decisión 11: la
// plata que entró no se devuelve y el rango del acta no se corre).
//
// El selector arranca en "Acta existente", que es el default de la casa, y no en
// "Acta nueva" como el cierre del libro: una misma reunión de Comisión puede
// eximir a dos socios, y ahí el acta correcta para el segundo es exactamente la
// que se acaba de usar. Lo que hacía peligrosa esa preselección era no poder
// verla; eso es lo que arregla el resumen.
//
// ── Por qué los meses se calculan acá y no con `exemptionPeriods` ───────────
// El módulo de dominio (`@/lib/treasury/exemptions`) arma su singleton de Prisma
// al importarse, así que no puede cruzar al bundle del cliente. La aritmética se
// rehace con `periodRange`, que es la MISMA función sobre la que está escrito
// `exemptionPeriods` (y el último mes es inclusive en las dos). El tope de meses
// tampoco se copia: llega por prop desde `MAX_EXEMPTION_MONTHS`.
import { useActionState, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker } from "@/components/admin/minute-picker";
import { TextareaField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  describeMinuteChoice,
  initialMinuteChoice,
  type MinuteChoice,
  type MinuteDraftDefaults,
  type MinuteOption,
} from "@/lib/members/minute-choice";
import { addMonths, comparePeriods, periodLabel, periodRange } from "@/lib/treasury/periods";
import { cn } from "@/lib/utils";
import { grantExemptionAction } from "./actions";

const NUM = "font-mono tabular-nums";
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function GrantExemptionForm({
  memberId, maxMonths, currentPeriod, suggestedFrom, paidPeriods, minutes, minuteDefaults,
}: {
  memberId: number;
  /** `MAX_EXEMPTION_MONTHS` del dominio: el "hasta veinticuatro (24)" del
   *  artículo se escribe en un solo lugar. */
  maxMonths: number;
  /** El mes corriente resuelto en el SERVIDOR, con el calendario argentino: el
   *  reloj del navegador puede estar en otra zona y correr el piso un mes. */
  currentPeriod: string;
  /** El mes siguiente, que es el que sugiere la decisión 10. */
  suggestedFrom: string;
  /** Los meses ya PAGOS del socio de acá en adelante. Se cruzan con el rango
   *  elegido para poder avisarlo antes de confirmar. */
  paidPeriods: string[];
  minutes: MinuteOption[];
  minuteDefaults: MinuteDraftDefaults;
}) {
  const [state, formAction, pending] = useActionState(grantExemptionAction, {});
  // Controlado: React 19 resetea el <form action> cuando la action termina, y
  // acá el rechazo es esperable (una deuda que entró entre medio, una carrera
  // con el devengo del día 1). Perder los meses y el acta tipeada obligaría a
  // rehacer todo el asiento.
  const { values, formRef, field } = useSyncedForm({
    months: String(maxMonths),
    fromPeriod: suggestedFrom,
    note: "",
  });
  // El estado inicial sale de la MISMA función que usa el selector, así que el
  // resumen no puede nombrar un acta distinta de la que está elegida.
  const [choice, setChoice] = useState<MinuteChoice>(() =>
    initialMinuteChoice({ minutes, newDefaults: minuteDefaults }),
  );
  const minute = describeMinuteChoice(choice);

  const months = Number(values.months);
  const monthsOk = Number.isInteger(months) && months >= 1 && months <= maxMonths;
  const fromOk = PERIOD_RE.test(values.fromPeriod);
  const notPast = fromOk && comparePeriods(values.fromPeriod, currentPeriod) >= 0;
  const periods = monthsOk && fromOk
    ? periodRange(values.fromPeriod, addMonths(values.fromPeriod, months - 1))
    : [];
  const skipped = periods.filter((p) => paidPeriods.includes(p));
  const ready = monthsOk && notPast && minute.ready;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="memberId" value={memberId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={field("months").id}>Meses</Label>
          <Input
            {...field("months")}
            type="number"
            inputMode="numeric"
            min={1}
            max={maxMonths}
            className="w-28"
          />
          <p className="text-xs text-muted-foreground">
            De 1 a <span className={NUM}>{maxMonths}</span>. Lo decide la Comisión.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={field("fromPeriod").id}>Primer mes eximido</Label>
          <Input {...field("fromPeriod")} type="month" min={currentPeriod} className="w-44" />
          <p className="text-xs text-muted-foreground">
            Formato AAAA-MM. No puede ser anterior a {periodLabel(currentPeriod)}.
          </p>
        </div>
      </div>

      <MinutePicker minutes={minutes} newDefaults={minuteDefaults} onChoiceChange={setChoice} />

      <TextareaField
        label="Nota (opcional)"
        field={field("note")}
        rows={2}
        maxLength={300}
        hint="Qué resolvió la Comisión: «contribución en especie: pintura de la sede». Queda en el registro, no en la auditoría."
      />

      {/* Lo último que se lee antes de asentar: con qué acta y qué meses. */}
      <div className="space-y-2 rounded-md border bg-muted/50 p-3 text-sm">
        <p>
          <span className="font-medium">Acta:</span> {minute.text}
        </p>
        {periods.length > 0 ? (
          <>
            <p>
              Se eximen <span className={NUM}>{periods.length}</span>{" "}
              {periods.length === 1 ? "mes" : "meses"}: de{" "}
              <strong>{periodLabel(periods[0])}</strong> a{" "}
              <strong>{periodLabel(periods[periods.length - 1])}</strong>.
            </p>
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                Ver los meses uno por uno
              </summary>
              <p className={cn(NUM, "pt-1 text-xs break-words")}>{periods.join(" · ")}</p>
            </details>
          </>
        ) : (
          <p className="text-muted-foreground">
            Completá los meses y el mes de inicio para ver el rango exacto.
          </p>
        )}
        {skipped.length > 0 && (
          // Decisión 11, dicha con todas las letras: el mes ya pago NO se
          // devuelve, NO se convierte en exento y el rango del acta no se corre.
          <FormMessage kind="warning" role="none">
            {skipped.length === 1 ? (
              <>
                <strong>{periodLabel(skipped[0])}</strong> ya está pago y va a quedar pago.
              </>
            ) : (
              <>
                <span className={NUM}>{skipped.length}</span> meses del rango ya están pagos y van a
                quedar pagos: {skipped.map(periodLabel).join(", ")}.
              </>
            )}{" "}
            La plata que entró no se devuelve y el rango del acta no se corre.
          </FormMessage>
        )}
      </div>

      {/* Pre-validación para el MENSAJE: el dominio revalida las seis guardas
          adentro de su transacción. */}
      {!monthsOk && (
        <FormMessage kind="warning" role="none">
          La exención va de 1 a {maxMonths} meses enteros (Art. 7 inc. a.4: &laquo;hasta
          veinticuatro&raquo;).
        </FormMessage>
      )}
      {monthsOk && !notPast && (
        <FormMessage kind="warning" role="none">
          La exención no puede empezar en un mes pasado: elegí {periodLabel(currentPeriod)} o uno
          posterior.
        </FormMessage>
      )}
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      <Button type="submit" className="min-h-11 px-4" disabled={!ready || pending}>
        {pending ? "Asentando…" : "Asentar la exención"}
      </Button>
    </form>
  );
}
