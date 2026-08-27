"use client";
// Paso 2 del wizard ASOCIATE: dónde vive el solicitante. La respuesta decide la
// rama entera del trámite (REG-01: las categorías dependen de la residencia).
import { FormMessage } from "@/components/admin/form-message";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StreetPicker } from "./street-picker";
import { CONTROL_HEIGHT, streetLabel, type AsociateDraft, type StreetOption } from "./wizard-shared";
import { ChoiceCard, Field, NavButtons } from "./wizard-ui";

export function StepResidence({
  streets,
  draft,
  patch,
  error,
  onError,
  onNext,
}: {
  streets: StreetOption[];
  draft: AsociateDraft;
  patch: (values: Partial<AsociateDraft>) => void;
  error: string | null;
  onError: (message: string) => void;
  onNext: () => void;
}) {
  // Cambiar de rama tiene que limpiar el domicilio Y la categoría: REG-01 ata
  // las categorías al lugar de residencia, y arrastrar un "Socio activo"
  // elegido antes de decir "vivo en otro barrio" sería un dato inválido que el
  // server rechazaría recién en el submit.
  function chooseBranch(value: "si" | "no") {
    if (draft.livesInBarrio === value) return;
    patch({
      livesInBarrio: value,
      streetId: null,
      streetName: "",
      streetText: "",
      neighborhood: "",
      requestedCategory: value === "no" ? "collaborator" : "",
      wantsDebit: "",
    });
  }

  function next() {
    if (!draft.livesInBarrio) return onError("Contanos dónde vivís.");
    if (draft.livesInBarrio === "si" && draft.streetId === null) {
      return onError("Elegí tu calle de la lista del barrio.");
    }
    if (draft.livesInBarrio === "no" && !draft.streetText.trim()) {
      return onError("Ingresá el nombre de tu calle.");
    }
    if (draft.livesInBarrio === "no" && !draft.neighborhood.trim()) {
      return onError("Ingresá el nombre de tu barrio.");
    }
    if (!draft.streetNumber.trim()) return onError("Ingresá la altura de tu domicilio.");
    onNext();
  }

  return (
    <div>
      <fieldset>
        <legend className="sr-only">¿Dónde vivís?</legend>
        <div className="space-y-3">
          <ChoiceCard
            name="residence"
            value="si"
            checked={draft.livesInBarrio === "si"}
            onSelect={() => chooseBranch("si")}
            title="En el Barrio Ciudadela"
          >
            Podés asociarte como socio activo o adherente.
          </ChoiceCard>
          <ChoiceCard
            name="residence"
            value="no"
            checked={draft.livesInBarrio === "no"}
            onSelect={() => chooseBranch("no")}
            title="En otro barrio"
          >
            Podés asociarte como socio colaborador.
          </ChoiceCard>
        </div>
      </fieldset>

      {draft.livesInBarrio === "si" && (
        <div className="mt-6 space-y-4">
          <StreetPicker
            streets={streets}
            streetId={draft.streetId}
            streetName={draft.streetName}
            onPick={(street) =>
              patch({ streetId: street?.id ?? null, streetName: street ? streetLabel(street.name) : "" })
            }
          />
          <StreetNumberField value={draft.streetNumber} onChange={(v) => patch({ streetNumber: v })} />
        </div>
      )}

      {draft.livesInBarrio === "no" && (
        <div className="mt-6 space-y-4">
          <Field id="streetText" label="Calle">
            <Input
              id="streetText"
              className={CONTROL_HEIGHT}
              autoComplete="address-line1"
              maxLength={120}
              value={draft.streetText}
              onChange={(e) => patch({ streetText: e.target.value })}
            />
          </Field>
          <Field id="neighborhood" label="Barrio">
            <Input
              id="neighborhood"
              className={CONTROL_HEIGHT}
              autoComplete="address-level3"
              maxLength={60}
              value={draft.neighborhood}
              onChange={(e) => patch({ neighborhood: e.target.value })}
            />
          </Field>
          <StreetNumberField value={draft.streetNumber} onChange={(v) => patch({ streetNumber: v })} />
        </div>
      )}

      {error && (
        <FormMessage kind="error" box className="mt-6">
          {error}
        </FormMessage>
      )}
      <NavButtons onNext={next} />
    </div>
  );
}

function StreetNumberField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field id="streetNumber" label="Altura" hint="El número de tu casa. Ej.: 1250 o 1250 B.">
      <Input
        id="streetNumber"
        className={cn(CONTROL_HEIGHT, "max-w-40")}
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        aria-describedby="streetNumber-hint"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
