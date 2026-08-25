"use client";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { StreetAutocomplete, type StreetOption } from "@/components/admin/street-autocomplete";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { updateAddressAction, type SelfEditState } from "./actions";

export function AddressForm(props: {
  streets: StreetOption[];
  streetId: number | null;
  streetText: string | null;
  streetNumber: string;
  neighborhood: string;
}) {
  const [state, formAction, pending] = useActionState<SelfEditState, FormData>(
    updateAddressAction,
    {},
  );
  const { field, formRef } = useSyncedForm({
    streetNumber: props.streetNumber,
    neighborhood: props.neighborhood,
  });
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {/* El autocompletado es del panel admin (32px, mouse); acá se opera con el
          pulgar. Las variantes arbitrarias suben input y opciones a 48px sin
          tocar el componente compartido. */}
      <div className="[&_input]:h-12 [&_input]:text-base [&_li>button]:min-h-12">
        <StreetAutocomplete
          streets={props.streets}
          defaultStreetId={props.streetId}
          defaultStreetText={props.streetText}
        />
      </div>
      <TextField label="Altura" field={field("streetNumber")} inputMode="numeric" maxLength={10} className="h-12" />
      <TextField label="Barrio" field={field("neighborhood")} maxLength={60} className="h-12" />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.done && <FormMessage kind="warning">{state.message}</FormMessage>}
      <Button className="min-h-12" disabled={pending}>
        Guardar domicilio
      </Button>
    </form>
  );
}
