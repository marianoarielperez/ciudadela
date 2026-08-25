"use client";
// Las dos decisiones que la Comisión toma sobre una solicitud VIVA, en la misma
// Card del detalle: corregirle la categoría y rechazarla.
//
// Cliente y con estado propio por lo mismo que `action-form.tsx` del padrón:
// React 19 resetea el <form action> cuando la action termina, y acá el rechazo
// es un caso frecuente (otro admin la resolvió, el número de acta ya existe, MP
// no aceptó el cambio de monto). Sin estado propio, cada error le borraría al
// operador la categoría elegida y los datos del acta que acababa de tipear.
//
// El rechazo va detrás de un <details> cerrado y no a la vista: es
// irreversible, retiene plata del vecino y bloquea su DNI por seis meses. Abrirlo
// es un acto deliberado, no un botón al lado del de guardar.
import { useActionState, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { changesFeeAmount } from "@/lib/applications/decision";
import { categoryAllowedForResidence } from "@/lib/applications/wizard";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import type { MemberCategory } from "@/generated/prisma/client";

type State = { error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

export function DecisionForms(props: {
  recategorize: Action;
  reject: Action;
  applicationId: number;
  currentCategory: MemberCategory;
  /** Las tres categorías que se piden por la web (`WEB_CATEGORIES`) menos la
   *  actual. NO están filtradas por la residencia declarada: la Comisión puede
   *  apartarse de Art. 5 / 5 bis —es su facultad de corrección— y lo que hace
   *  la pantalla es advertirlo, no impedirlo. Cadete, honorario y vitalicio no
   *  entran acá: no se solicitan (REG-01). */
  options: [MemberCategory, string][];
  /** Lo que la solicitud DECLARÓ: `true` si eligió una calle del catastro del
   *  barrio, `false` si declaró calle y barrio de afuera. */
  livesInBarrio: boolean;
  hasSubscription: boolean;
  minutes: MinuteOption[];
}) {
  const [reState, recategorizeAction, recategorizePending] = useActionState(props.recategorize, {});
  const [rjState, rejectAction, rejectPending] = useActionState(props.reject, {});
  const [category, setCategory] = useState<string>(props.options[0]?.[0] ?? "");

  // Un <select> no vuelve solo al valor del estado después del reset de React 19,
  // ni siquiera estando controlado (ver el encabezado del hook).
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, { newCategory: category });

  // El aviso sale del MISMO predicado que decide el viaje a MP en el servidor:
  // adherente ↔ colaborador comparten plan y no lo tocan.
  const willUpdateMp =
    props.hasSubscription && changesFeeAmount(props.currentCategory, category as MemberCategory);

  // La misma regla que el wizard usa para lo que el vecino puede AUTO-declarar
  // (Art. 5 y 5 bis), acá como advertencia y no como guarda: la Comisión puede
  // apartarse, pero no en silencio. El caso caro es "vive fuera del barrio →
  // activo", que da voto y elegibilidad a quien el estatuto no se los da.
  const residenceMismatch =
    category !== ""
    && !categoryAllowedForResidence(category as MemberCategory, props.livesInBarrio);

  return (
    <div className="space-y-6">
      {props.options.length > 0 && (
        <form ref={formRef} action={recategorizeAction} className="space-y-2">
          <input type="hidden" name="applicationId" value={props.applicationId} />
          <Label htmlFor="newCategory">Recategorizar</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="newCategory"
              name="newCategory"
              required
              className={SELECT_CLASS}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {props.options.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Button type="submit" variant="secondary" disabled={recategorizePending}>
              {recategorizePending ? "Guardando…" : "Cambiar categoría"}
            </Button>
          </div>
          {/* El domicilio DECLARADO, acá y no sólo en la tarjeta de datos: es el
              dato contra el que se lee la categoría que se está por elegir.
              `role="none"`: es ayuda estática del campo, no la respuesta a una
              acción, y no tiene que interrumpir al lector de pantalla. */}
          <FormMessage kind="neutral" role="none">
            Domicilio declarado:{" "}
            {props.livesInBarrio ? "en el barrio Ciudadela" : "fuera del barrio"}.
          </FormMessage>
          {residenceMismatch && (
            <FormMessage kind="warning">
              Esa categoría no corresponde al domicilio declarado (Art. 5 y 5 bis:{" "}
              {props.livesInBarrio
                ? "quien vive en el barrio se asocia como activo o adherente"
                : "quien vive fuera del barrio sólo puede ser colaborador"}).
              Podés hacerlo igual: la decisión queda asentada en la auditoría.
            </FormMessage>
          )}
          {willUpdateMp && (
            <FormMessage kind="warning">
              Se actualizará el monto de la suscripción en Mercado Pago.
            </FormMessage>
          )}
          {reState.error && <FormMessage kind="error">{reState.error}</FormMessage>}
        </form>
      )}

      <details className="rounded-md border px-3 pb-3">
        {/* El padding vertical va en el <summary> y no en el <details>: así el
            área clickeable llega a los 44px del shell (20px de línea + 2×12).
            Sin `display:flex` a propósito, que le sacaría el triangulito. */}
        <summary className="cursor-pointer py-3 text-sm font-medium">Rechazar solicitud…</summary>
        <form action={rejectAction} className="mt-3 space-y-3">
          <input type="hidden" name="applicationId" value={props.applicationId} />
          <p className="text-sm text-muted-foreground">
            El rechazo queda asentado en acta. Si hubo cuota de ingreso debitada, se retiene
            (no es reembolsable) y se cancela la suscripción.
          </p>
          <MinutePicker minutes={props.minutes} />
          {rjState.error && <FormMessage kind="error">{rjState.error}</FormMessage>}
          <Button type="submit" variant="destructive" disabled={rejectPending}>
            {rejectPending ? "Rechazando…" : "Rechazar solicitud"}
          </Button>
        </form>
      </details>
    </div>
  );
}
