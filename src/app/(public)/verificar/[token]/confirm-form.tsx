"use client";

import { useActionState } from "react";

import { confirmEmailAction, type VerifyState } from "./actions";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";

// Confirmación de la rama de SOLICITUD. No pasa por acá ningún canje que
// termine en un `redirect`: ni el de FICHA (que va a la creación de contraseña o
// al login) ni el de una solicitud YA ASENTADA, que desde el fix de la
// verificación tardía propaga a la ficha y sale por el mismo redirect. Lo que
// queda son los dos finales que sí se quedan en pantalla.
// Exportado sólo para que el test fije lo que cada rama PUEDE prometer: `closed`
// no puede hablar de altas ni de invitaciones que no van a llegar.
export const VERIFIED = {
  // Solicitud viva: la invitación al portal recién puede existir cuando el
  // asiento en acta cree la ficha (spec §6).
  pending:
    "¡Listo! Confirmaste tu email. Cuando la Comisión Directiva asiente tu alta vas a recibir la invitación para crear tu contraseña.",
  // Solicitud que ya no espera nada (rechazada, vencida, o asentada pero fuera
  // del alcance de este enlace). Confirmar la dirección no le hace daño a nadie
  // —y la marca queda—, pero acá no hay ni alta que anunciar ni invitación que
  // prometer: el texto no puede insinuar ninguna de las dos.
  closed:
    "Listo: registramos que esta dirección de correo es tuya. Si estabas esperando novedades de un trámite con la vecinal, comunicate con la Asociación Vecinal para saber cómo sigue.",
} as const;

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

  if (state.verified) {
    return <FormMessage kind="success" box>{VERIFIED[state.verified]}</FormMessage>;
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
