"use client";
// Botón "enviar verificación + invitación de acceso", compartido por el modo
// carga (`/admin/socios/carga/[numero]`) y la ficha (`/admin/socios/[id]`).
//
// La spec §8 lo pedía en los dos lugares ("desde carga de fichas o ficha") y
// vivía sólo en el modo carga. Se comparte el componente entero —no se copia el
// formulario— para que la action, las guardas y el texto del botón sigan
// teniendo un solo dueño: quien entra por la ficha tiene que ver exactamente lo
// mismo que quien entra por la carga.
//
// Toda la lógica de "¿se puede mandar, y qué se manda?" es de
// `verificationTarget` (@/lib/members/card-edit), que además es la guarda que
// revalida la propia server action. Acá no hay ninguna regla nueva.
import { useActionState, type ReactNode } from "react";
import { sendVerificationAction, type SendState } from "@/app/admin/socios/carga/[numero]/actions";
import { Button } from "@/components/ui/button";
import type { VerificationTarget } from "@/lib/members/card-edit";

export function SendVerificationForm(props: {
  memberId: number;
  target: VerificationTarget;
  /** Muestra el "Email verificado ✓" al lado del botón. */
  verified?: boolean;
  /** Aviso propio de la pantalla (el modo carga avisa que se manda al email
   *  guardado, no al que se está tipeando). */
  note?: ReactNode;
  className?: string;
}) {
  const { memberId, target } = props;
  const [state, formAction, pending] = useActionState<SendState, FormData>(sendVerificationAction, {});

  // El texto del botón dice qué correo va a salir. Con el email ya verificado y
  // sin cuenta creada lo que corresponde es la invitación de contraseña sola:
  // volver a verificar una dirección ya confirmada no aportaría nada y le
  // agregaría un paso al socio.
  const label = target.ok && target.kind === "password_invitation"
    ? "Reenviar invitación de acceso"
    : "Enviar verificación + invitación de acceso";

  return (
    <form action={formAction} className={props.className ?? "flex flex-wrap items-center gap-3"}>
      <input type="hidden" name="memberId" value={memberId} />
      <Button type="submit" variant="outline" disabled={pending || !target.ok}>
        {pending ? "Enviando…" : label}
      </Button>
      {props.verified && (
        <span className="text-sm text-green-700 dark:text-green-500">Email verificado ✓</span>
      )}
      {/* El motivo del rechazo lo redacta `verificationTarget`: repetirlo acá
          fue lo que dejó al operador sin saber que la reinvitación existe. */}
      {!target.ok && <span className="text-sm text-muted-foreground">{target.error}</span>}
      {props.note}
      {state.sent && <span role="status" className="text-sm text-green-700 dark:text-green-500">Enviado ✓</span>}
      {state.error && <span role="alert" className="text-sm text-destructive">{state.error}</span>}
    </form>
  );
}
