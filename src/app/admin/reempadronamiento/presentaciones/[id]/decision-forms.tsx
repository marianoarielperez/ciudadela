"use client";
// Los cuatro controles de decisión del detalle de una presentación.
//
// El reparto visual no es estético: VALIDAR es lo que el operador hace en la
// enorme mayoría de las fichas, así que va como botón primario y abierto.
// Observar y Rechazar van detrás de un `<details>` cerrado —el mismo patrón que
// el rechazo de altas y el de solicitudes de socios— porque las dos escriben un
// texto que le llega al vecino y ninguna de las dos se aprieta sin leer.
//
// Validar y Rechazar piden confirmación nativa. Validar la pide aunque sea el
// camino normal, y por un motivo que no tiene ninguna otra pantalla del panel:
// es el único acto del sistema que copia a la ficha del socio datos que tipeó
// una persona anónima del otro lado de internet, y no hay "deshacer".
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextareaField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import {
  observePresentationAction, rejectPresentationAction, unrejectPresentationAction,
  validatePresentationAction, type DecisionState,
} from "./actions";

const MAX_NOTE = 500;

/** El mismo bloque de mensajes para las cuatro: `error` es "no se escribió
 *  nada" y `warning` es "se hizo, pero quedó algo para vos". Nunca los dos. */
function Messages({ state }: { state: DecisionState }) {
  return (
    <>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.warning && <FormMessage kind="warning">{state.warning}</FormMessage>}
    </>
  );
}

export function ValidateForm({ presentationId, memberName }: {
  presentationId: number;
  memberName: string;
}) {
  const [state, formAction, pending] = useActionState<DecisionState, FormData>(
    validatePresentationAction,
    {},
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `¿Validar el re-empadronamiento de ${memberName}? Los datos declarados se copian a su ficha del padrón y no se puede deshacer.`,
          )
        ) {
          e.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <input type="hidden" name="presentationId" value={presentationId} />
      <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Validando…" : "Validar y aplicar a la ficha"}
      </Button>
      <Messages state={state} />
    </form>
  );
}

export function ObserveForm({ presentationId, defaultNote }: {
  presentationId: number;
  /** La observación anterior, si la hay: observar de nuevo suele ser corregir o
   *  ampliar la misma, no escribirla de cero. */
  defaultNote: string;
}) {
  const [state, formAction, pending] = useActionState<DecisionState, FormData>(
    observePresentationAction,
    {},
  );
  const { field, formRef } = useSyncedForm({ note: defaultNote });

  return (
    <details className="rounded-md border px-3 pb-3">
      {/* El padding vertical va en el <summary> y no en el <details>: así el
          área clickeable llega a los 44px del shell. */}
      <summary className="cursor-pointer py-3 text-sm font-medium">Observar (pedir una corrección)…</summary>
      <form ref={formRef} action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="presentationId" value={presentationId} />
        <TextareaField
          label="Qué tiene que corregir el socio"
          field={field("note")}
          rows={4}
          maxLength={MAX_NOTE}
          placeholder="Ej.: la foto del dorso del DNI salió movida y no se lee el domicilio."
          hint="Este texto viaja TAL CUAL en el correo que le llega al socio, con el enlace para corregir y la fecha límite. Es lo único que le dice qué arreglar."
        />
        <Messages state={state} />
        <Button type="submit" variant="outline" size="lg" className="min-h-11 px-4" disabled={pending}>
          {pending ? "Enviando…" : "Observar y avisarle"}
        </Button>
      </form>
    </details>
  );
}

export function RejectForm({ presentationId, memberName }: {
  presentationId: number;
  memberName: string;
}) {
  const [state, formAction, pending] = useActionState<DecisionState, FormData>(
    rejectPresentationAction,
    {},
  );
  const { field, formRef } = useSyncedForm({ note: "" });

  return (
    <details className="rounded-md border px-3 pb-3">
      <summary className="cursor-pointer py-3 text-sm font-medium">Rechazar la presentación…</summary>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `¿Rechazar el re-empadronamiento de ${memberName}? Se le avisa por correo. Si no vuelve a presentarse ni revertís el rechazo antes del cierre del libro, queda como no presentado.`,
            )
          ) {
            e.preventDefault();
          }
        }}
        className="mt-3 space-y-3"
      >
        <input type="hidden" name="presentationId" value={presentationId} />
        <TextareaField
          label="Motivo (opcional)"
          field={field("note")}
          rows={3}
          maxLength={MAX_NOTE}
          placeholder="Ej.: la foto del frente es de otra persona."
          hint="Queda guardado, se ve en la cola y viaja TAL CUAL en el correo que le avisa al socio que no se aceptó su re-empadronamiento. Si lo dejás vacío el correo sale igual, pero sin motivo: el socio tiene que venir a la sede a preguntar por qué. Ese correo NO lleva enlace —una presentación rechazada ya no se puede corregir por la web—, así que lo manda a la sede."
        />
        <Messages state={state} />
        <Button type="submit" variant="destructive" size="lg" className="min-h-11 px-4" disabled={pending}>
          {pending ? "Rechazando…" : "Rechazar"}
        </Button>
      </form>
    </details>
  );
}

export function UnrejectForm({ presentationId }: { presentationId: number }) {
  const [state, formAction, pending] = useActionState<DecisionState, FormData>(
    unrejectPresentationAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="presentationId" value={presentationId} />
      <Button type="submit" variant="outline" size="lg" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Revirtiendo…" : "Volver a observada"}
      </Button>
      <FormMessage kind="neutral" role="none">
        Vuelve al estado en el que el socio puede corregir y reenviar. No le avisa nada por sí sola:
        para eso, observala después con el detalle de qué corregir.
      </FormMessage>
      <Messages state={state} />
    </form>
  );
}
