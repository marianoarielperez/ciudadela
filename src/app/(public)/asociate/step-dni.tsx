"use client";
// Paso 1 del wizard ASOCIATE: el DNI primero (spec 2026-08-27). El vecino que
// no puede asociarse por la web —vigente, con trámite, con deuda, expulsado—
// se entera ACÁ, antes de cargar un solo dato, y no al final del formulario
// más largo. El molde es el DniForm de REEMPADRONATE.
import { FormMessage } from "@/components/admin/form-message";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Input } from "@/components/ui/input";
import { CONTROL_HEIGHT, type AsociateDraft, type DniCheckState } from "./wizard-shared";
import { Field, NavButtons } from "./wizard-ui";

export function StepDni({
  draft,
  patch,
  siteKey,
  actionState,
  formAction,
  pending,
  error,
}: {
  draft: AsociateDraft;
  patch: (values: Partial<AsociateDraft>) => void;
  siteKey: string;
  /** Se le pasa entero a Turnstile: cada respuesta del server es un objeto
   *  nuevo, y cada respuesta significa que el token anterior ya se gastó. */
  actionState: DniCheckState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <form action={formAction} className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Con tu DNI verificamos si ya estás asociado o si tenés un trámite pendiente.
      </p>

      <Field id="dni" label="DNI" hint="Sin puntos ni espacios.">
        <Input
          id="dni"
          name="dni"
          className={CONTROL_HEIGHT}
          inputMode="numeric"
          // Sin autocompletado ni autoFocus, por las razones que el DniForm de
          // REEMPADRONATE dejó escritas: el documento no es un dato del
          // navegador, y el foco automático tapa el texto en el celular y le
          // roba el foco al encabezado en el camino de vuelta del veredicto.
          autoComplete="off"
          maxLength={9}
          required
          aria-describedby="dni-hint"
          value={draft.dni}
          onChange={(e) => patch({ dni: e.target.value.replace(/\D/g, "") })}
        />
      </Field>

      <TurnstileWidget
        siteKey={siteKey}
        resetKey={actionState}
        unavailable="El formulario no está disponible por un problema de configuración del sitio. Acercate a la sede vecinal para asociarte."
      />

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}

      <NavButtons submit nextLabel="Continuar" pending={pending} pendingLabel="Verificando…" />
    </form>
  );
}
