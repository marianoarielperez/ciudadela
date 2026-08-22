"use client";
// Las acciones del recibo: imprimir, (re)enviar por email y anular.
//
// Cliente y con estado propio por lo mismo que las decisiones de una solicitud:
// React 19 resetea el <form action> cuando la server action termina, y acá el
// error es un caso frecuente (el socio no tiene email, el recibo ya está
// anulado, el correo no salió). Sin estado propio, el operador no vería nada.
//
// La anulación va detrás de un <details> cerrado y no a la vista: es
// irreversible —el número no se reutiliza jamás— y devuelve a pendientes cuotas
// ya cobradas. Abrirlo es un acto deliberado, no un botón al lado de imprimir.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emailReceiptAction, voidReceiptAction } from "./actions";

export function ReceiptActions({ receiptId, voided, hasEmail, emailedAt }: {
  receiptId: number;
  voided: boolean;
  hasEmail: boolean;
  /** Ya formateado en el servidor: la fecha se arma en hora argentina y no en
   *  la del navegador del operador. */
  emailedAt: string | null;
}) {
  const [emailState, emailAction, emailPending] = useActionState(emailReceiptAction, {});
  const [voidState, voidAction, voidPending] = useActionState(voidReceiptAction, {});
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* El PDF sale por la ruta autenticada y auditada, en otra pestaña:
            imprimir no puede costarle al operador la pantalla que está mirando. */}
        <Button asChild variant="outline">
          <a href={`/api/admin/recibos/${receiptId}`} target="_blank" rel="noopener">Imprimir / ver PDF</a>
        </Button>
        <form action={emailAction}>
          <input type="hidden" name="receiptId" value={receiptId} />
          <Button type="submit" variant="outline" disabled={emailPending || !hasEmail || voided}>
            {emailPending ? "Enviando…" : emailedAt ? "Reenviar por email" : "Enviar por email"}
          </Button>
        </form>
      </div>
      {emailedAt && <p className="text-sm text-muted-foreground">Enviado por email el {emailedAt}.</p>}
      {/* Por qué el botón está apagado: sin esto parece que la pantalla falló. */}
      {!hasEmail && !voided && (
        <p className="text-sm text-muted-foreground">El socio no tiene email cargado: imprimí el recibo.</p>
      )}
      {voided && <p className="text-sm text-muted-foreground">Un recibo anulado no se envía por email.</p>}
      {emailState.sent && <FormMessage kind="success" box>Recibo enviado por email.</FormMessage>}
      {emailState.error && <FormMessage kind="error" box>{emailState.error}</FormMessage>}

      {!voided && (
        <details className="rounded-md border border-destructive/40 px-3 pb-3">
          {/* El padding vertical va en el <summary> y no en el <details>: así el
              área clickeable llega a los 44px del shell. */}
          <summary className="cursor-pointer py-3 text-sm font-medium text-destructive">Anular este recibo…</summary>
          <form action={voidAction} className="mt-1 space-y-3">
            <input type="hidden" name="receiptId" value={receiptId} />
            <p className="text-sm text-muted-foreground">
              El número no se reutiliza: el recibo queda anulado, con el motivo y quién lo anuló.
              Las cuotas que cubría vuelven a pendientes.
            </p>
            <div className="space-y-1">
              <Label htmlFor="reason">Motivo</Label>
              <Input id="reason" name="reason" maxLength={200} required autoComplete="off" />
            </div>
            {voidState.error && <FormMessage kind="error">{voidState.error}</FormMessage>}
            <Button type="submit" variant="destructive" disabled={voidPending}>
              {voidPending ? "Anulando…" : "Anular recibo"}
            </Button>
          </form>
        </details>
      )}
    </div>
  );
}
