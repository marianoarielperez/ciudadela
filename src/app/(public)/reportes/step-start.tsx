"use client";
// Paso 1 del wizard de Reportes (spec §5.1): qué se reporta y cómo se figura.
// Es el ÚNICO paso que crea algo en la base —el borrador— y por eso el único
// que lleva captcha en el modo público. De acá para adelante manda la llave.
import { Lightbulb, MessageSquareWarning, ShieldCheck, UserRound } from "lucide-react";
import { useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { ChoiceCard, NavButtons } from "../asociate/wizard-ui";
import type { ReportCaptchaProps, ReportDraft, StartState } from "./wizard-shared";

// Un reclamo se PRESENTA ante un organismo; una iniciativa la TRATA la Comisión
// y no sale de la asociación (spec §2). Mientras no haya elección la copia es
// NEUTRA: prometerle un organismo a quien todavía no eligió es la misma mentira,
// sólo que antes.
const IDENTITY_COPY = {
  "": {
    legend: "¿Cómo querés figurar?",
    named: "Tu nombre acompaña el reporte.",
    reserved: "La Asociación siempre sabe quién reporta; tu nombre no sale de la Asociación.",
  },
  claim: {
    legend: "¿Cómo querés figurar en la presentación?",
    named: "Tu nombre acompaña el reporte cuando la asociación lo presenta.",
    reserved:
      "La Asociación siempre sabe quién reporta; lo reservado es la presentación ante el municipio, la SCPL u otro organismo.",
  },
  initiative: {
    legend: "¿Cómo querés figurar ante la Comisión?",
    named: "Tu nombre acompaña la iniciativa cuando la Comisión la trata.",
    reserved:
      "La Asociación siempre sabe quién reporta; tu nombre queda en la Comisión Directiva y no se publica.",
  },
} as const;

type StepStartProps = {
  draft: ReportDraft;
  patch: (values: Partial<ReportDraft>) => void;
  /** Sólo para pedirle un token nuevo a Turnstile en cada respuesta. */
  actionState: StartState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
};

export function StepStart(props: StepStartProps & ReportCaptchaProps) {
  const { draft, patch, actionState, formAction, pending, error } = props;
  // Radios que postean: sin esto, tras un rechazo React 19 los deja en lo que
  // dice el DOM y no en el borrador (ver el comentario de `useFormResetSync`).
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, {
    kind: draft.kind === "claim" ? "reclamo" : draft.kind === "initiative" ? "iniciativa" : "",
    anonymous: draft.anonymous,
  });
  const copy = IDENTITY_COPY[draft.kind];

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">¿Qué querés reportar?</legend>
        <ChoiceCard
          name="kind"
          value="reclamo"
          checked={draft.kind === "claim"}
          onSelect={() => patch({ kind: "claim" })}
          title="Un reclamo"
          icon={<MessageSquareWarning className="size-4" />}
        >
          Un problema en la vía pública: agua, cloacas, luz, residuos, calles, árboles, transporte.
        </ChoiceCard>
        <ChoiceCard
          name="kind"
          value="iniciativa"
          checked={draft.kind === "initiative"}
          onSelect={() => patch({ kind: "initiative" })}
          title="Una iniciativa"
          icon={<Lightbulb className="size-4" />}
        >
          Una propuesta para el barrio, que la Comisión Directiva evalúa (Art. 6 del estatuto).
        </ChoiceCard>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{copy.legend}</legend>
        <ChoiceCard
          name="anonymous"
          value="no"
          checked={draft.anonymous === "no"}
          onSelect={() => patch({ anonymous: "no" })}
          title="Con mi nombre"
          icon={<UserRound className="size-4" />}
        >
          {copy.named}
        </ChoiceCard>
        <ChoiceCard
          name="anonymous"
          value="si"
          checked={draft.anonymous === "si"}
          onSelect={() => patch({ anonymous: "si" })}
          title="De forma reservada"
          icon={<ShieldCheck className="size-4" />}
        >
          {copy.reserved}
        </ChoiceCard>
      </fieldset>

      {/* El socio ya viene con sesión: el captcha es para el vecino anónimo. La
          unión discriminada garantiza que una página pública no pueda montarlo
          sin clave (mismo criterio que `NavNextProps`). */}
      {props.mode === "public" && <TurnstileWidget siteKey={props.siteKey} resetKey={actionState} />}
      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}
      <NavButtons
        submit
        nextLabel="Continuar"
        pending={pending}
        pendingLabel="Un momento…"
        nextDisabled={draft.kind === "" || draft.anonymous === ""}
      />
    </form>
  );
}
