"use client";
// Paso 6 del wizard ASOCIATE: pago y envío (docs/05 §2).
//
// Es el momento en que el vecino se compromete con plata, y la pantalla está
// escrita para eso: antes del botón hay una BOLETA PREVIA —qué se debita ahora,
// qué se debita todos los meses, con los montos reales de los planes de MP— y
// pegado abajo, dentro del mismo recuadro, el aviso de que la cuota de ingreso no
// se devuelve. No es una tarjeta de venta con un botón grande: es un comprobante
// escrito antes del hecho. Nadie tiene que apretar "Ir a Mercado Pago" sin haber
// leído en la misma línea de visión cuánto y por qué.
//
// La rama sin débito (adherente que no adhiere) no tiene boleta: no hay plata de
// por medio, sólo el envío a la Comisión Directiva.
//
// Reparto del estado (regla del wizard): la action que CAMBIA la pantalla del
// wizard —`submitNoDebitAction`, que la lleva a "solicitud recibida"— vive en el
// wizard; la que se va del sitio —`startPaymentAction`— vive acá.
import { useActionState, useEffect } from "react";
import type { MemberCategory } from "@/generated/prisma/client";
import { FormMessage } from "@/components/admin/form-message";
import { formatARS } from "@/lib/format";
import { startPaymentAction } from "./actions";
import type { FeeAmounts, PayState, SubmitState } from "./wizard-shared";
import { NavButtons } from "./wizard-ui";

const CATEGORY_FEE_LABEL: Record<string, string> = {
  active: "Cuota de socio activo",
  adherent: "Cuota de socio adherente",
  collaborator: "Cuota de socio colaborador",
};

export function StepPayment({
  resumeToken,
  category,
  wantsDebit,
  fees,
  submitState,
  submitAction,
  submitting,
  onBack,
}: {
  resumeToken: string;
  category: MemberCategory;
  wantsDebit: boolean;
  fees: FeeAmounts | null;
  submitState: SubmitState;
  submitAction: (formData: FormData) => void;
  submitting: boolean;
  onBack: () => void;
}) {
  if (category === "adherent" && !wantsDebit) {
    return (
      <NoDebitBranch
        resumeToken={resumeToken}
        state={submitState}
        formAction={submitAction}
        pending={submitting}
        onBack={onBack}
      />
    );
  }
  return <DebitBranch resumeToken={resumeToken} category={category} fees={fees} onBack={onBack} />;
}

/* ------------------------------------------------------------------ */
/* Rama con débito: activo, colaborador y adherente que adhirió        */
/* ------------------------------------------------------------------ */

function DebitBranch({
  resumeToken,
  category,
  fees,
  onBack,
}: {
  resumeToken: string;
  category: MemberCategory;
  fees: FeeAmounts | null;
  onBack: () => void;
}) {
  // `blocked` no viaja en el `PayState` exportado de `wizard-shared.ts` (ese tipo
  // se replica a mano del lado del server, ver el comentario de allá): se ensancha
  // acá nomás, sólo para esta pantalla, en vez de tocar el tipo compartido.
  const [state, formAction, pending] = useActionState<PayState & { blocked?: true }, FormData>(
    startPaymentAction,
    {},
  );
  const fee = fees ? (category === "active" ? fees.active : fees.shared) : null;

  // Irse del sitio ES un efecto sobre un sistema externo: acá el efecto está
  // bien puesto. `assign` y no `replace`: el botón "atrás" del navegador tiene
  // que devolver al vecino a esta pantalla si se arrepiente en el checkout.
  useEffect(() => {
    if (state.redirectUrl) window.location.assign(state.redirectUrl);
  }, [state.redirectUrl]);
  const leaving = Boolean(state.redirectUrl);
  // Terminal: reintentar acá crearía una segunda suscripción en MP (ver el catch
  // de persistencia en `actions.ts`). El botón queda inerte, no sólo mientras
  // `pending` — a diferencia de los demás errores de esta pantalla, que sí
  // admiten reintento.
  const blocked = Boolean(state.blocked);

  return (
    <form action={formAction}>
      <input type="hidden" name="resumeToken" value={resumeToken} />

      {fee !== null ? (
        <>
          <div className="overflow-hidden rounded-xl border-2 border-border">
            <ul className="divide-y divide-border">
              <FeeRow when="Ahora, al autorizar" what="Cuota de ingreso" amount={fee} emphasis />
              <FeeRow
                when="Después, todos los meses"
                what={CATEGORY_FEE_LABEL[category] ?? "Cuota mensual"}
                amount={fee}
              />
            </ul>
            {/* Texto de docs/05 §2, palabra por palabra: es lo que el vecino acepta
                y lo que el email de rechazo va a citar si la CD no hace lugar. */}
            <p className="border-t-2 border-warning/40 bg-warning/10 px-4 py-3.5 text-sm text-warning">
              El primer débito corresponde a la <strong>cuota de ingreso</strong> (equivale a un mes de
              cuota). <strong>No es reembolsable</strong>, cualquiera sea el resultado de tu solicitud.
              Luego se debitará la cuota mensual.
            </p>
          </div>

          <p className="mt-5 text-sm text-muted-foreground">
            Te llevamos a Mercado Pago para que autorices el débito automático. Cuando vuelvas, te
            confirmamos el resultado acá mismo.
          </p>
        </>
      ) : (
        // Sin valor de cuota vigente, `startPaymentAction` corta antes de crear
        // la suscripción (REG-34: cobrar mal es peor que no cobrar) — mismo
        // criterio que `step-category`: mensaje honesto y el botón de avance no
        // se puede disparar, en vez de prometer un checkout que no va a pasar.
        <FormMessage kind="error" box>
          El valor de la cuota todavía no está configurado. Probá más tarde o consultá en la sede.
        </FormMessage>
      )}

      {state.error && (
        <FormMessage kind="error" box className="mt-5">
          {state.error}
        </FormMessage>
      )}

      <NavButtons
        onBack={onBack}
        backLabel="Volver a la documentación"
        nextLabel="Ir a Mercado Pago"
        submit
        nextDisabled={blocked || fee === null}
        pending={pending || leaving}
        pendingLabel={leaving ? "Abriendo Mercado Pago…" : "Preparando el pago…"}
      />
    </form>
  );
}

function FeeRow({
  when,
  what,
  amount,
  emphasis,
}: {
  when: string;
  what: string;
  amount: number;
  emphasis?: boolean;
}) {
  return (
    <li className="flex items-baseline justify-between gap-4 px-4 py-3.5">
      <span className="min-w-0">
        <span className="block text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {when}
        </span>
        <span className="mt-0.5 block text-sm font-medium">{what}</span>
      </span>
      <span
        className={
          emphasis
            ? "shrink-0 text-lg font-bold tabular-nums text-primary"
            : "shrink-0 text-lg font-semibold tabular-nums"
        }
      >
        {formatARS(amount)}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Rama sin débito: adherente que eligió no adherir                    */
/* ------------------------------------------------------------------ */

function NoDebitBranch({
  resumeToken,
  state,
  formAction,
  pending,
  onBack,
}: {
  resumeToken: string;
  state: SubmitState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  onBack: () => void;
}) {
  return (
    <form action={formAction}>
      <input type="hidden" name="resumeToken" value={resumeToken} />

      <div className="rounded-xl border-2 border-border p-4">
        <p className="text-base font-semibold">Tu solicitud se envía sin pago</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Elegiste no adherir al débito automático de la cuota voluntaria, así que no te vamos a
          cobrar nada. La Comisión Directiva va a tratar tu solicitud en su próxima reunión y te
          avisamos el resultado por email.
        </p>
      </div>

      <p className="mt-5 text-sm text-muted-foreground">
        Si más adelante querés adherir al débito automático, avisanos en la sede vecinal.
      </p>

      {state.error && (
        <FormMessage kind="error" box className="mt-5">
          {state.error}
        </FormMessage>
      )}

      <NavButtons
        onBack={onBack}
        backLabel="Volver a la documentación"
        nextLabel="Enviar solicitud"
        submit
        pending={pending}
      />
    </form>
  );
}
