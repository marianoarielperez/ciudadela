"use client";

import { useActionState, useState } from "react";

import { recoverAction, type RecoverState } from "./actions";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RecoverForm({ siteKey }: { siteKey: string }) {
  const [state, formAction, pending] = useActionState<RecoverState, FormData>(recoverAction, {});
  // React 19 resetea el <form action> cuando la server action termina: con el
  // input NO controlado, un email mal escrito volvería en blanco y habría que
  // tipearlo entero de nuevo. Controlado, el valor lo pone el estado y sobrevive
  // al reset (mismo criterio que /acceso/[token]/password-form.tsx).
  const [email, setEmail] = useState("");

  // El acuse es DELIBERADAMENTE ambiguo: decir "listo, te lo mandamos" sólo
  // cuando la cuenta existe convertiría esta pantalla en un verificador de qué
  // vecinos están registrados.
  if (state.done) {
    return (
      <p className="rounded border border-primary/40 bg-primary/10 p-3 text-sm" role="status">
        Si el email corresponde a una cuenta, te enviamos un enlace para restablecer la contraseña.
        Vence en 30 minutos. Revisá también la carpeta de correo no deseado.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {/* Adentro del <form>, que es donde el widget inyecta su input oculto
          `cf-turnstile-response`. `resetKey={state}` renueva el token después de
          cada respuesta: es de un solo uso, y si no se renovara, corregir un
          email mal tipeado fallaría por el captcha y no por el tipeo. */}
      <TurnstileWidget
        siteKey={siteKey}
        resetKey={state}
        unavailable="No podemos tomar el pedido ahora por un problema de configuración del sitio. Probá más tarde o escribinos."
      />
      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Enviando…" : "Enviarme el enlace"}
      </Button>
    </form>
  );
}
