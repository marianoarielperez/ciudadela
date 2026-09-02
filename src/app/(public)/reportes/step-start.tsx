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
import type { ReportDraft, ReportMode, StartState } from "./wizard-shared";

export function StepStart({
  mode,
  draft,
  patch,
  siteKey,
  actionState,
  formAction,
  pending,
  error,
}: {
  mode: ReportMode;
  draft: ReportDraft;
  patch: (values: Partial<ReportDraft>) => void;
  siteKey: string;
  /** Sólo para pedirle un token nuevo a Turnstile en cada respuesta. */
  actionState: StartState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  // Radios que postean: sin esto, tras un rechazo React 19 los deja en lo que
  // dice el DOM y no en el borrador (ver el comentario de `useFormResetSync`).
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, {
    kind: draft.kind === "claim" ? "reclamo" : draft.kind === "initiative" ? "iniciativa" : "",
    anonymous: draft.anonymous,
  });

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
        <legend className="text-sm font-medium">¿Cómo querés figurar en la presentación?</legend>
        <ChoiceCard
          name="anonymous"
          value="no"
          checked={draft.anonymous === "no"}
          onSelect={() => patch({ anonymous: "no" })}
          title="Con mi nombre"
          icon={<UserRound className="size-4" />}
        >
          Tu nombre acompaña el reporte cuando la asociación lo presenta.
        </ChoiceCard>
        <ChoiceCard
          name="anonymous"
          value="si"
          checked={draft.anonymous === "si"}
          onSelect={() => patch({ anonymous: "si" })}
          title="De forma reservada"
          icon={<ShieldCheck className="size-4" />}
        >
          La Asociación siempre sabe quién reporta; lo reservado es la presentación ante el
          municipio, la SCPL u otro organismo.
        </ChoiceCard>
      </fieldset>

      {/* El socio ya viene con sesión: el captcha es para el vecino anónimo. */}
      {mode === "public" && <TurnstileWidget siteKey={siteKey} resetKey={actionState} />}
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
