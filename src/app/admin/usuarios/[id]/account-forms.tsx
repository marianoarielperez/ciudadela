"use client";
// Estado de la cuenta (activar / desactivar) e invitación (reenviar / revocar).
// Misma regla que en los roles: lo que la guarda del dominio va a rechazar nace
// deshabilitado y con SU texto (USER_GUARD_MESSAGES), nunca con uno reescrito
// acá.
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { resendInvitationAction, revokeInvitationAction, setActiveAction } from "../actions";

/** El botón que la pantalla no ofrece, con el motivo al lado. Misma forma que
 *  la rama deshabilitada de `RoleActionButton`. */
function DisabledAction({ label, reason }: { label: string; reason: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button variant="outline" className="min-h-11" disabled>{label}</Button>
      <span className="text-xs text-muted-foreground">{reason}</span>
    </span>
  );
}

export function SetActiveButton(props: {
  userId: number;
  userLabel: string;
  active: boolean; // estado ACTUAL de la cuenta
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(setActiveAction, {});
  const formId = `set-active-${props.userId}`;
  const disabling = props.active;
  const verb = disabling ? "Desactivar cuenta" : "Reactivar cuenta";

  if (props.disabledReason) {
    return <DisabledAction label={verb} reason={props.disabledReason} />;
  }

  return (
    <>
      <Dialog>
        {/* El form vive fuera del portal del diálogo; el botón lo referencia
            con `form=` (molde DeleteHolidayButton). */}
        <form id={formId} action={formAction} className="hidden">
          <input type="hidden" name="id" value={props.userId} />
          <input type="hidden" name="active" value={disabling ? "0" : "1"} />
        </form>
        <DialogTrigger asChild>
          <Button
            variant={disabling ? "outline" : "default"}
            className="min-h-11"
            aria-label={`${verb} de ${props.userLabel}`}
          >
            {verb}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`¿${verb}?`}</DialogTitle>
            <DialogDescription>
              {disabling
                ? `${props.userLabel} no va a poder ingresar más, con ningún rol, desde el próximo intento. Se puede reactivar cuando haga falta.`
                : `${props.userLabel} vuelve a poder ingresar con los roles que tiene.`}
            </DialogDescription>
          </DialogHeader>
          {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button
              type="submit"
              form={formId}
              variant={disabling ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? (disabling ? "Desactivando…" : "Reactivando…") : verb}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* También en la fila: si el diálogo se cerró con la acción en vuelo, el
          portal ya no existe y el error se perdería. */}
      {state.error && (
        <FormMessage kind="error" as="span" className="w-full">{state.error}</FormMessage>
      )}
    </>
  );
}

export function InvitationButtons(props: {
  userId: number;
  userLabel: string;
  /** Motivo por el que `resendInvitation` rechazaría hoy (cuenta desactivada),
   *  con el texto del dominio. */
  resendDisabledReason?: string;
  /** Ídem `revokeInvitation` (no hay invitación viva que revocar). */
  revokeDisabledReason?: string;
}) {
  const [resendState, resendAction, resendPending] = useActionState(resendInvitationAction, {});
  const [revokeState, revokeAction, revokePending] = useActionState(revokeInvitationAction, {});
  // Sin Dialog a propósito: ninguna de las dos es irreversible —reenviar emite
  // un enlace nuevo y revocar se deshace reenviando— y el efecto ya está
  // escrito arriba de los botones.
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {props.resendDisabledReason ? (
          <DisabledAction label="Reenviar invitación" reason={props.resendDisabledReason} />
        ) : (
          <form action={resendAction}>
            <input type="hidden" name="id" value={props.userId} />
            <Button
              type="submit"
              variant="secondary"
              className="min-h-11"
              disabled={resendPending}
              aria-label={`Reenviar la invitación a ${props.userLabel}`}
            >
              {resendPending ? "Reenviando…" : "Reenviar invitación"}
            </Button>
          </form>
        )}
        {props.revokeDisabledReason ? (
          <DisabledAction label="Revocar invitación" reason={props.revokeDisabledReason} />
        ) : (
          <form action={revokeAction}>
            <input type="hidden" name="id" value={props.userId} />
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              disabled={revokePending}
              aria-label={`Revocar la invitación de ${props.userLabel}`}
            >
              {revokePending ? "Revocando…" : "Revocar invitación"}
            </Button>
          </form>
        )}
      </div>
      {resendState.error && <FormMessage kind="error" box>{resendState.error}</FormMessage>}
      {revokeState.error && <FormMessage kind="error" box>{revokeState.error}</FormMessage>}
    </div>
  );
}
