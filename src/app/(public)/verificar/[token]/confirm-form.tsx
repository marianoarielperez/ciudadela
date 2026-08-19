"use client";

import { useActionState } from "react";

import { confirmEmailAction, type VerifyState } from "./actions";
import { Button } from "@/components/ui/button";

export function ConfirmForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<VerifyState, FormData>(confirmEmailAction, {});
  return (
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
  );
}
