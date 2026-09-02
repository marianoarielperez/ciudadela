"use client";
// Los tres formularios de /mi/solicitudes: presentar la baja, pedir el cambio
// de categoría y retirar una solicitud pendiente. La página sólo los renderiza
// cuando `canAct` es true (el suspendido no llega acá), así que no repiten esa
// guarda — es display, la real vive en las tres actions.
import { useActionState, useState } from "react";
import { ArrowLeftRight, Send, UserMinus } from "lucide-react";

import { ChoiceCard } from "@/app/(public)/asociate/wizard-ui";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { TextareaField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MemberCategory } from "@/generated/prisma/client";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import {
  cancelRequestAction,
  createCategoryRequestAction,
  createWithdrawalRequestAction,
  type RequestState,
} from "./actions";

export function WithdrawalRequestForm({ hasPending }: { hasPending: boolean }) {
  const [state, formAction, pending] = useActionState<RequestState, FormData>(
    createWithdrawalRequestAction,
    {},
  );
  const { field, formRef } = useSyncedForm({ message: "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <UserMinus className="size-4 text-primary" aria-hidden />
          Baja por renuncia
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasPending ? (
          <EmptyState
            size="card"
            description="Ya tenés una baja pendiente. Podés retirarla desde la tarjeta de arriba si querés volver a presentarla."
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Presentás tu renuncia a la Asociación. Es efectiva cuando la Comisión la acepte con
              acta; mientras esté pendiente, la podés retirar vos mismo desde acá.
            </p>
            <form ref={formRef} action={formAction} className="space-y-3">
              <TextareaField
                label="Motivo (opcional)"
                field={field("message")}
                rows={3}
                maxLength={500}
                placeholder="Contanos por qué, si querés."
              />
              {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
              {state.done && <FormMessage kind="success">{state.message}</FormMessage>}
              <Button className="min-h-12 w-full" disabled={pending}>
                <Send aria-hidden />
                {pending ? "Enviando…" : "Presentar la baja"}
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CategoryRequestForm({
  currentCategory,
  hasPending,
  requestable,
}: {
  currentCategory: MemberCategory;
  hasPending: boolean;
  /** Lo que la página armó con `requestableCategories(llave)`: con
   *  `colaborador_habilitado` apagada no viene colaborador (spec 2026-09-02).
   *  Display; la guarda real está en el servicio. */
  requestable: readonly MemberCategory[];
}) {
  const [state, formAction, pending] = useActionState<RequestState, FormData>(
    createCategoryRequestAction,
    {},
  );
  const options = requestable.filter((c) => c !== currentCategory);
  const [selected, setSelected] = useState<MemberCategory | "">("");
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <ArrowLeftRight className="size-4 text-primary" aria-hidden />
          Cambio de categoría
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasPending ? (
          <EmptyState
            size="card"
            description="Ya tenés un cambio de categoría pendiente. Podés retirarlo desde la tarjeta de arriba si querés pedir otro."
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Vas a necesitar estar al día con la cuota y que no haya elecciones en curso (Art. 5°
              ter). Es efectivo cuando la Comisión lo acepte con acta.
            </p>
            <form action={formAction} className="space-y-3">
              <fieldset className="space-y-3">
                <legend className="sr-only">Elegí la categoría nueva</legend>
                {options.map((category) => (
                  <ChoiceCard
                    key={category}
                    name="requestedCategory"
                    value={category}
                    checked={selected === category}
                    onSelect={() => setSelected(category)}
                    title={CATEGORY_LABELS[category]}
                  />
                ))}
              </fieldset>
              {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
              {state.done && <FormMessage kind="success">{state.message}</FormMessage>}
              <Button className="min-h-12 w-full" disabled={pending || !selected}>
                <Send aria-hidden />
                {pending ? "Enviando…" : "Pedir el cambio"}
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CancelRequestForm({ requestId }: { requestId: number }) {
  const [state, formAction, pending] = useActionState<RequestState, FormData>(
    cancelRequestAction,
    {},
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // Confirmación nativa: sin modal propio, es una acción de un solo botón
        // y de bajo riesgo (retirar no borra nada, se puede volver a presentar).
        if (!window.confirm("¿Retirar esta solicitud? Podés volver a presentarla cuando quieras.")) {
          e.preventDefault();
        }
      }}
      className="mt-3 space-y-2"
    >
      <input type="hidden" name="requestId" value={requestId} />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.done && <FormMessage kind="success">{state.message}</FormMessage>}
      <Button type="submit" variant="outline" className="min-h-12 w-full sm:w-auto" disabled={pending}>
        {pending ? "Retirando…" : "Retirar solicitud"}
      </Button>
    </form>
  );
}
