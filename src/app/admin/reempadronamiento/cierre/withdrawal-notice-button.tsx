"use client";
// El botón que arma el cartel de bajas de la sede.
//
// No asienta ninguna fijación y no corre ningún plazo: sólo crea el papel que
// hay que imprimir, con los declarados de baja que no tienen casilla utilizable.
// La fecha de fijación —de la que sí cuelgan los veinte días hábiles y, al
// cumplirse, la ventana de recurso de todo el lote— se asienta desde el tablero
// del proceso, que es donde vive esa acción desde la fase 6B.
//
// Cuántos entran no se dice acá antes de apretar: la nómina del cartel es VIVA
// hasta que se fija (`board/notice.ts`), así que el único número honesto es el
// que devuelve la acción al armarlo.
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { openWithdrawalNoticeAction } from "./actions";

export function WithdrawalNoticeButton({ processId }: { processId: number }) {
  const [state, formAction, pending] = useActionState(openWithdrawalNoticeAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="processId" value={processId} />
      <Button type="submit" variant="outline" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Armando…" : "Generar aviso de cartelera de bajas"}
      </Button>
      {state.error && <FormMessage kind="warning" box>{state.error}</FormMessage>}
      {state.ok && <FormMessage kind="success" box>{state.ok}</FormMessage>}
    </form>
  );
}
