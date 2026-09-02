"use client";
// "Marcar presentado" (reclamo) / "Marcar tratada" (iniciativa).
//
// Dos cosas que no son adorno:
//
// 1. El organismo viene SUGERIDO por el catálogo (SCPL cuando el tipo es de la
//    SCPL, MCR para el resto), pero la frase viva de abajo dice con todas las
//    letras qué se va a asentar. Es la lección del `MinutePicker`: un control
//    preseleccionado es una decisión que nadie tomó, salvo que la pantalla la
//    nombre.
// 2. El acta arranca APAGADA, y cuando se enciende el selector abre en "acta
//    nueva" (`defaultMode="new"`). Abrir en "existente" preselecciona la más
//    reciente —la lista viene por fecha descendente—, que es exactamente el
//    error del simulacro del cierre del Libro N° 1.
//
// El mensaje de éxito repite el asiento entero, acta incluida: quien acaba de
// confirmar tiene que poder leer qué quedó registrado sin recargar la ficha.
import { useActionState, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import {
  MinutePicker, type MinuteDraftDefaults, type MinuteOption,
} from "@/components/admin/minute-picker";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { parseCivilDate } from "@/lib/dates";
import { formatDateAR } from "@/lib/format";
import { minuteName } from "@/lib/members/labels";
import {
  describeMinuteChoice, initialMinuteChoice, type MinuteChoice,
} from "@/lib/members/minute-choice";
import { AGENCIES, AGENCY_LABELS, type AgencySlug, type ReportKindSlug } from "@/lib/reports/catalog";
import { fileReportAction } from "../actions";

/** Cómo se NOMBRA el acta elegida una vez que el asiento ya ocurrió. No sirve
 *  `describeMinuteChoice`, que habla en futuro ("se creará …"): eso es lo
 *  correcto ANTES de confirmar y una mentira después. El nombre sale de
 *  `minuteName` —tipo + número, nunca el id— como en todo el panel. */
function filedMinuteName(choice: MinuteChoice): string | null {
  if (choice.mode === "existing") return choice.option?.label ?? null;
  const number = Number(choice.draft.number);
  if (!Number.isInteger(number) || number <= 0) return null;
  return minuteName({ type: choice.draft.type, number });
}

export function FileForm({ reportId, kind, suggested, today, minutes, minuteDefaults }: {
  reportId: number;
  kind: ReportKindSlug;
  suggested: AgencySlug | null;
  /** "YYYY-MM-DD" del día civil argentino, calculado en el servidor. */
  today: string;
  minutes: MinuteOption[];
  minuteDefaults: MinuteDraftDefaults;
}) {
  const [state, action, pending] = useActionState(fileReportAction, {});
  const { values, formRef, field } = useSyncedForm({
    agency: suggested ?? "",
    agencyOther: "",
    filedAt: today,
    reference: "",
  });
  const [withMinute, setWithMinute] = useState(false);
  // El estado inicial se calcula con la MISMA función que usa el picker, así
  // que la frase viva y el selector no pueden arrancar diciendo cosas distintas.
  const [choice, setChoice] = useState<MinuteChoice>(() =>
    initialMinuteChoice({ minutes, defaultMode: "new", newDefaults: minuteDefaults }),
  );

  const day = parseCivilDate(values.filedAt, { invalidError: "no" });
  const dayText = day.ok ? formatDateAR(day.value) : "…";
  const agencyText = values.agency === "other"
    ? values.agencyOther.trim() || "…"
    : values.agency
      ? AGENCY_LABELS[values.agency as AgencySlug]
      : null;
  const minuteDraft = withMinute ? describeMinuteChoice(choice) : null;
  const minuteReady = !withMinute || minuteDraft?.ready === true;

  const isClaim = kind === "claim";
  const beforeText = isClaim
    ? `Se va a asentar como presentado ante ${agencyText ?? "…"} el ${dayText}.`
    : `Se va a asentar como tratada por la Comisión Directiva el ${dayText}`
      + (agencyText ? `, y presentada ante ${agencyText}` : "")
      + (withMinute ? `, con acta: ${minuteDraft?.text ?? "…"}` : ", sin acta")
      + ".";

  if (state.done) {
    const acta = withMinute ? filedMinuteName(choice) : null;
    const afterText = isClaim
      ? `Asentado: presentado ante ${agencyText ?? "—"} el ${dayText}.`
      : `Asentado: tratada por la Comisión Directiva el ${dayText}`
        + (agencyText ? `, y presentada ante ${agencyText}` : "")
        + (acta ? `, con ${acta}` : ", sin acta")
        + ".";
    return <FormMessage kind="success" box>{afterText}</FormMessage>;
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="reportId" value={reportId} />
      <SelectField
        label={isClaim ? "Organismo" : "Organismo (opcional)"}
        field={field("agency")}
        options={[
          ["", isClaim ? "Elegí un organismo" : "Comisión Directiva (sin organismo)"],
          ...AGENCIES.map((a) => [a.slug, a.label] as [string, string]),
        ]}
      />
      {values.agency === "other" && (
        <TextField label="¿Cuál?" field={field("agencyOther")} maxLength={80} />
      )}
      <TextField
        label={isClaim ? "Fecha de presentación" : "Fecha de tratamiento"}
        field={field("filedAt")}
        type="date"
      />
      <TextField
        label="N° de expediente o trámite (opcional)"
        field={field("reference")}
        maxLength={80}
        hint="Queda en la ficha y viaja en el aviso al vecino."
      />
      {!isClaim && (
        <div className="space-y-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={withMinute}
              onChange={(e) => setWithMinute(e.target.checked)}
            />
            Asentar con acta
          </label>
          {/* Desmontado, el picker no renderiza ningún campo `minute*`, así que
              el POST no lleva acta y la action lo lee como "sin acta". */}
          {withMinute && (
            <MinutePicker
              minutes={minutes}
              defaultMode="new"
              newDefaults={minuteDefaults}
              onChoiceChange={setChoice}
            />
          )}
        </div>
      )}
      {/* `role="status"`: la frase cambia mientras el operador tipea y es lo
          único que dice qué se va a asentar. */}
      <p role="status" className="text-sm font-medium">{beforeText}</p>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button
        type="submit"
        className="min-h-11"
        disabled={
          pending
          || (isClaim && !values.agency)
          || (values.agency === "other" && values.agencyOther.trim() === "")
          || !minuteReady
        }
      >
        {pending ? "Asentando…" : isClaim ? "Marcar presentado" : "Marcar tratada"}
      </Button>
    </form>
  );
}
