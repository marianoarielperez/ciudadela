"use client";
// El formulario de reenvío del enlace de retome ("ya tenés una solicitud en
// trámite"). Vivía adentro de `blocked-panel.tsx` y se extrajo cuando el paso
// "Tu DNI" empezó a necesitarlo también: el veredicto `in_progress` del paso 1
// ofrece el mismo reenvío, y duplicar el form duplicaría sus garantías.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resendResumeLinkAction } from "./actions";
import { CONTROL_HEIGHT, type ResendState } from "./wizard-shared";

export function ResendResumeForm({ dni, siteKey }: { dni: string; siteKey: string }) {
  const [state, action, pending] = useActionState<ResendState, FormData>(
    resendResumeLinkAction,
    {},
  );
  if (state.done) {
    // Respuesta única de la action: no confirma ni desmiente que ese DNI tenga
    // una solicitud en trámite. El texto tiene que decir lo mismo.
    return (
      <FormMessage kind="success" box className="mt-6">
        Si hay una solicitud en trámite con ese DNI, te enviamos el enlace para retomarla al email
        que dejaste. Revisá también la carpeta de correo no deseado.
      </FormMessage>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4 rounded-xl border border-border p-4">
      <p className="text-sm">
        Te reenviamos por email el enlace para retomar la solicitud que ya empezaste.
      </p>
      <input type="hidden" name="dni" value={dni} />
      <TurnstileWidget siteKey={siteKey} resetKey={state} />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button
        type="submit"
        disabled={pending}
        className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-6")}
      >
        {pending ? "Enviando…" : "Reenviarme el enlace"}
      </Button>
    </form>
  );
}
