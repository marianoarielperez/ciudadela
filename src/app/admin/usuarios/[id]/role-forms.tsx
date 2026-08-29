"use client";
// Otorgar y quitar roles de gestión, cada uno con su Dialog: el efecto se
// redacta ANTES de confirmar, y lo que la guarda del dominio va a rechazar se
// muestra deshabilitado con el mismo motivo (patrón debit-adhesion). El aviso
// del token de 8 h vive en el banner del redirect (?rol=1), no acá.
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
import { grantRoleAction, revokeRoleAction } from "../actions";

export function RoleActionButton(props: {
  userId: number;
  userLabel: string;
  role: "admin" | "superadmin";
  mode: "grant" | "revoke";
  /** Si viene, el botón se deshabilita y este texto se muestra al lado: es el
   *  MISMO motivo por el que la action rechazaría. */
  disabledReason?: string;
}) {
  const action = props.mode === "grant" ? grantRoleAction : revokeRoleAction;
  const [state, formAction, pending] = useActionState(action, {});
  const formId = `role-${props.mode}-${props.role}-${props.userId}`;
  const roleLabel = props.role === "superadmin" ? "Superadmin" : "Admin";
  const verb = props.mode === "grant" ? "Otorgar" : "Quitar";

  if (props.disabledReason) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-11" disabled>{`${verb} ${roleLabel}`}</Button>
        <span className="text-xs text-muted-foreground">{props.disabledReason}</span>
      </span>
    );
  }

  // El Dialog redacta el EFECTO, no repite la acción: qué va a poder (o dejar
  // de poder) la persona, y desde cuándo. Otorgar rige recién al re-login
  // porque el JWT sella los roles al entrar; quitar corta de inmediato porque
  // cada action resuelve contra la fila viva (require-admin.ts).
  const description =
    props.mode === "grant"
      ? props.role === "superadmin"
        ? `${props.userLabel} va a poder gestionar usuarios y roles, la configuración, la salud del sistema, el padrón electoral y todas las acciones sensibles de tesorería. El cambio rige cuando cierre sesión y vuelva a entrar.`
        : `${props.userLabel} va a poder operar el panel de administración (solicitudes, socios, tesorería, actas y contenido). El cambio rige cuando cierre sesión y vuelva a entrar.`
      : props.role === "superadmin"
        ? `${props.userLabel} deja de poder gestionar usuarios, configuración y las acciones de superadmin. El corte es inmediato en cada acción del panel.`
        : `${props.userLabel} deja de poder operar el panel de administración. El corte es inmediato en cada acción del panel.`;

  return (
    <>
      <Dialog>
        {/* DialogContent se monta en un portal, FUERA del árbol del form: el
            botón de confirmar lo referencia por id con `form=` (molde
            DeleteHolidayButton). */}
        <form id={formId} action={formAction} className="hidden">
          <input type="hidden" name="id" value={props.userId} />
          <input type="hidden" name="role" value={props.role} />
        </form>
        <DialogTrigger asChild>
          <Button
            variant={props.mode === "revoke" ? "outline" : "default"}
            className="min-h-11"
            // Sin esto, el lector de pantalla dicta varios botones "Otorgar
            // Admin" idénticos y ninguno dice a quién afectan.
            aria-label={`${verb} el rol ${roleLabel} a ${props.userLabel}`}
          >
            {`${verb} ${roleLabel}`}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`¿${verb} el rol ${roleLabel}?`}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button
              type="submit"
              form={formId}
              variant={props.mode === "revoke" ? "destructive" : "default"}
              disabled={pending}
            >
              {pending
                ? props.mode === "grant" ? "Otorgando…" : "Quitando…"
                : `${verb} ${roleLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* El mismo error, también acá: si el diálogo se cerró con la acción en
          vuelo, el portal ya no existe y esto es lo único que se ve. */}
      {state.error && (
        <FormMessage kind="error" as="span" className="w-full">{state.error}</FormMessage>
      )}
    </>
  );
}
