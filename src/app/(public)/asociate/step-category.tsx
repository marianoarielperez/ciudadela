"use client";
// Paso 2 del wizard ASOCIATE: categoría de socio y débito automático.
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { formatARS } from "@/lib/format";
import type { AsociateDraft, FeeAmounts } from "./wizard-shared";
import { Amount, ChoiceCard, NavButtons } from "./wizard-ui";

export function StepCategory({
  draft,
  fees,
  patch,
  error,
  onError,
  onBack,
  onNext,
}: {
  draft: AsociateDraft;
  fees: FeeAmounts | null;
  patch: (values: Partial<AsociateDraft>) => void;
  error: string | null;
  onError: (message: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const inBarrio = draft.livesInBarrio === "si";

  function next() {
    if (!fees) return onError("Todavía no podemos mostrarte el valor de la cuota.");
    if (!draft.requestedCategory) return onError("Elegí tu categoría para seguir.");
    if (draft.requestedCategory === "adherent" && !draft.wantsDebit) {
      return onError("Indicanos si querés adherir al débito automático.");
    }
    onNext();
  }

  // Sin montos no hay categoría que elegir: inventar uno sería mentirle al
  // vecino sobre a qué se compromete (los montos son la fuente de verdad de los
  // planes de MP, ver src/lib/mp/plans.ts).
  if (!fees) {
    return (
      <div>
        <FormMessage kind="error" box>
          No pudimos obtener el valor de la cuota en este momento. Probá de nuevo más tarde.
        </FormMessage>
        <NavButtons onBack={onBack} onNext={next} nextDisabled />
      </div>
    );
  }

  return (
    <div>
      {inBarrio ? (
        <fieldset>
          <legend className="sr-only">Elegí tu categoría</legend>
          <div className="space-y-3">
            <ChoiceCard
              name="category"
              value="active"
              checked={draft.requestedCategory === "active"}
              onSelect={() => patch({ requestedCategory: "active", wantsDebit: "" })}
              title="Socio activo"
              aside={<Amount amount={fees.active} note="por mes · obligatoria" />}
            >
              Voz y voto en las asambleas. Podés ocupar cargos en la Comisión Directiva.
            </ChoiceCard>
            <ChoiceCard
              name="category"
              value="adherent"
              checked={draft.requestedCategory === "adherent"}
              onSelect={() => patch({ requestedCategory: "adherent" })}
              title="Socio adherente"
              aside={<Amount amount={fees.shared} note="por mes · voluntaria" />}
            >
              Voz sin voto en las asambleas. Votás en las elecciones.
            </ChoiceCard>
          </div>
        </fieldset>
      ) : (
        <>
          {/* Una sola categoría posible (Art. 5 bis): no hay elección que
              ofrecer, así que la tarjeta informa y `requestedCategory` ya quedó
              fijada al elegir "En otro barrio" en el paso 1. */}
          <div className="rounded-xl border-2 border-primary bg-primary/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-base font-semibold">Socio colaborador</p>
              <Amount amount={fees.shared} note="por mes · obligatoria" />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Es la categoría que corresponde a quienes viven fuera del barrio.
            </p>
          </div>
          <FormMessage kind="neutral" box className="mt-4">
            Vas a tener que acreditar tu vinculación con el barrio: un inmueble a tu nombre, un
            familiar que viva acá, o un comercio o actividad en la zona. Te lo pedimos en el paso
            de documentación.
          </FormMessage>
        </>
      )}

      {draft.requestedCategory === "adherent" && (
        <div className="mt-6">
          <fieldset>
            <legend className="text-sm font-medium">
              ¿Querés adherir al débito automático de la cuota voluntaria?
            </legend>
            <div className="mt-3 space-y-3">
              <ChoiceCard
                name="wantsDebit"
                value="si"
                checked={draft.wantsDebit === "si"}
                onSelect={() => patch({ wantsDebit: "si" })}
                title="Sí, quiero adherir"
              >
                Se debita todos los meses. Podés darla de baja cuando quieras.
              </ChoiceCard>
              <ChoiceCard
                name="wantsDebit"
                value="no"
                checked={draft.wantsDebit === "no"}
                onSelect={() => patch({ wantsDebit: "no" })}
                title="No por ahora"
              >
                Tu solicitud pasa igual a la Comisión Directiva.
              </ChoiceCard>
            </div>
          </fieldset>

          {draft.wantsDebit === "si" && (
            // Aviso suave de docs/05 §2: informa, no bloquea. Quien va a pagar
            // todos los meses como adherente puede tener voz Y voto por lo
            // mismo, y nadie se lo dijo nunca.
            <FormMessage kind="neutral" box className="mt-4">
              <span className="block">
                Por {formatARS(fees.active)} al mes podés ser <strong>socio activo</strong>, con
                voz y voto en las asambleas y la posibilidad de ocupar cargos.
              </span>
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-11 w-full sm:w-auto sm:px-5"
                onClick={() => patch({ requestedCategory: "active", wantsDebit: "" })}
              >
                Cambiar a socio activo
              </Button>
            </FormMessage>
          )}
        </div>
      )}

      {error && (
        <FormMessage kind="error" box className="mt-6">
          {error}
        </FormMessage>
      )}
      <NavButtons onBack={onBack} onNext={next} />
    </div>
  );
}
