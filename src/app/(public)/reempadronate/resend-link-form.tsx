"use client";
// "Reenviame el enlace": el camino de vuelta de quien ya se re-empadronó y
// perdió el correo (§5.4).
//
// Vive en su propio archivo porque lo usan DOS pantallas distintas: la de
// "tu presentación ya está" del paso 1 y la del enlace muerto
// (`/reempadronate/retomar/[token]` con un token que no abre nada). Una copia en
// cada una se separaría el día que alguien ajuste el texto de una sola.
//
// Lleva Turnstile, y eso NO contradice que las rutas con token no lo lleven: acá
// no hay token. Es un formulario público y ANÓNIMO con un DNI adentro que
// dispara un correo hacia afuera — exactamente la forma del reenvío de ASOCIATE
// y del recupero de contraseña, que también lo llevan. Lo que se abre con una
// llave de un solo uso no necesita captcha porque la llave ya es la barrera; acá
// no hay ninguna.
//
// La respuesta es SIEMPRE la misma, exista o no la presentación, y no nombra la
// dirección ni siquiera enmascarada: en la pantalla del enlace muerto el DNI se
// tipea de cero, así que una dirección parcial sería justo el dato que la
// anti-enumeración no puede entregar.
import { useActionState, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Field } from "../asociate/wizard-ui";
import { resendPresentationLinkAction } from "./actions";
import { CONTROL_HEIGHT, type ResendState } from "./wizard-shared";

export function ResendLinkForm({ siteKey, dni: initialDni = "" }: { siteKey: string; dni?: string }) {
  const [state, formAction, pending] = useActionState<ResendState, FormData>(
    resendPresentationLinkAction,
    {},
  );
  const [dni, setDni] = useState(initialDni);

  if (state.done) {
    return (
      <FormMessage kind="success" box className="mt-4">
        Si ese documento tiene un re-empadronamiento presentado, ya salió el correo con el enlace.
        Revisá también la carpeta de correo no deseado.
      </FormMessage>
    );
  }

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <Field id="resend-dni" label="Tu DNI" hint="Sin puntos ni espacios.">
        <Input
          id="resend-dni"
          name="dni"
          className={CONTROL_HEIGHT}
          inputMode="numeric"
          autoComplete="off"
          maxLength={9}
          required
          aria-describedby="resend-dni-hint"
          value={dni}
          onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))}
        />
      </Field>

      {/* Se le pasa el estado entero: cada respuesta del server es un objeto
          nuevo, y cada respuesta significa que el token anterior ya se gastó. */}
      <TurnstileWidget
        siteKey={siteKey}
        resetKey={state}
        unavailable="El reenvío no está disponible por un problema de configuración del sitio. Acercate a la sede vecinal."
      />

      {state.error && (
        <FormMessage kind="error" box>
          {state.error}
        </FormMessage>
      )}

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
