"use client";

import { useActionState } from "react";

import { confirmEmailAction, type VerifyState } from "./actions";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";

// Confirmación de la rama de SOLICITUD. El canje de FICHA no pasa nunca por
// acá: ese termina en un `redirect` (a la creación de contraseña o al login) y
// la pantalla se va. Una solicitud todavía no tiene cuenta que crear —la
// invitación sale cuando la Comisión Directiva asienta el alta y nace la ficha
// (spec §6)—, así que lo único que corresponde es decirle a la persona que ya
// está y qué sigue.
const APPLICATION_VERIFIED =
  "¡Listo! Confirmaste tu email. Cuando la Comisión Directiva asiente tu alta vas a recibir la invitación para crear tu contraseña.";

// El texto que rodea al botón entra como `children`/`footer` en vez de quedar en
// la página, porque al confirmar hay que reemplazarlo TODO: el pie dice "sin tu
// confirmación no queda registrada ninguna dirección", que después de confirmar
// sería falso. Mientras no haya confirmación, esto renderiza exactamente los
// mismos nodos que antes —un fragmento no crea elemento, así que el `space-y-4`
// de la tarjeta sigue viendo los mismos hijos—.
export function ConfirmForm({ token, children, footer }: {
  token: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<VerifyState, FormData>(confirmEmailAction, {});

  if (state.verified === "application") {
    return <FormMessage kind="success" box>{APPLICATION_VERIFIED}</FormMessage>;
  }

  return (
    <>
      {children}
      <form action={formAction} className="space-y-3">
        {/* El token viaja en un hidden y no se lee de la URL en el cliente: la
            action es un endpoint y tiene que recibir todo lo que necesita. */}
        <input type="hidden" name="token" value={token} />
        {state.error && (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Confirmando…" : "Confirmar mi email"}
        </Button>
      </form>
      {footer}
    </>
  );
}
