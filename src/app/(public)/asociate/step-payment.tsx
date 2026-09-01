"use client";
// Paso 6 del wizard ASOCIATE: pago y envío (docs/05 §2).
//
// Es el momento en que el vecino se compromete con plata, y la pantalla está
// escrita para eso: antes del botón hay una BOLETA PREVIA de tres cuerpos, en
// ese orden y dentro del mismo recuadro —(1) la REGLA del trámite: pagar no
// convierte en socio, la admisión la resuelve la Comisión Directiva; (2) los
// IMPORTES: qué se debita ahora y qué se debita todos los meses, con los montos
// reales; (3) la CONDICIÓN DEL DINERO: por qué se cobra antes (Art. 5) y que,
// según los términos aceptados, no se devuelve—. No es una tarjeta de venta con
// un botón grande: es un comprobante escrito antes del hecho. Nadie tiene que
// apretar "Pagar y enviar mi solicitud" sin haber leído en la misma línea de
// visión qué compra, cuánto y por qué.
//
// La regla va primero y va en CELESTE: en este sistema el rojo es error y el
// ámbar es dinero, y ésta es una condición institucional. Además lleva
// `role="note"` con un `id` que el botón referencia por `aria-describedby`, para
// que quien tabula directo al pago también la escuche.
//
// La rama sin débito (adherente que no adhiere) no tiene boleta: no hay plata de
// por medio, sólo el envío a la Comisión Directiva — pero dice igual que todavía
// no es socio/a.
//
// Reparto del estado (regla del wizard): la action que CAMBIA la pantalla del
// wizard —`submitNoDebitAction`, que la lleva a "solicitud recibida"— vive en el
// wizard; la que se va del sitio —`startPaymentAction`— vive acá.
import { Landmark } from "lucide-react";
import { useActionState, useEffect } from "react";
import type { MemberCategory } from "@/generated/prisma/client";
import { FormMessage } from "@/components/admin/form-message";
import { Callout } from "@/components/public/callout";
import { formatARS } from "@/lib/format";
import { startPaymentAction } from "./actions";
import type { FeeAmounts, PayState, SubmitState } from "./wizard-shared";
import { NavButtons } from "./wizard-ui";

const CATEGORY_FEE_LABEL: Record<string, string> = {
  active: "Cuota mensual de la categoría activo",
  adherent: "Cuota mensual de la categoría adherente",
  collaborator: "Cuota mensual de la categoría colaborador",
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
            {/* La regla del trámite, ANTES de los importes (spec §5.4): celeste y no
                rojo — en este sistema el rojo es error y el ámbar es dinero; esto es
                una condición institucional. role="note" + aria-describedby en el botón:
                quien tabula directo al pago también la escucha. */}
            <Callout tone="info" icon={Landmark} inset role="note" id="aviso-admision">
              <p>
                <strong>Pagar no te convierte en socio/a.</strong> La admisión la resuelve la Comisión
                Directiva en su próxima reunión, y puede no hacer lugar a tu solicitud.
              </p>
            </Callout>
            <ul className="divide-y divide-border">
              <FeeRow when="Ahora, al autorizar" what="Cuota de ingreso" amount={fee} emphasis />
              <FeeRow
                when="Después, todos los meses"
                what={CATEGORY_FEE_LABEL[category] ?? "Cuota mensual"}
                amount={fee}
              />
            </ul>
            {/* La condición del dinero: cita el Art. 5 (por qué se cobra antes) y
                atribuye la retención a los términos aceptados — el estatuto no norma el
                reembolso. NO menciona la "mensual adelantada": el flujo no la cobra. */}
            <p className="border-t-2 border-warning/40 bg-warning/10 px-4 py-3.5 text-sm text-warning">
              El estatuto pide abonar la cuota de ingreso —equivale a un mes de cuota— para poder ser
              admitido (Art. 5). Según los términos que aceptaste, <strong>no se devuelve</strong>,
              cualquiera sea el resultado. Luego se debita la cuota mensual.
            </p>
          </div>

          <p className="mt-5 text-sm text-muted-foreground">
            Te llevamos a Mercado Pago para que autorices el débito. Cuando vuelvas te confirmamos que
            el pago entró; el resultado de tu solicitud te lo avisamos por correo cuando la Comisión la
            resuelva.
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
        nextLabel="Pagar y enviar mi solicitud"
        nextDescribedBy="aviso-admision"
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
          Elegiste no adherir al débito automático de la cuota voluntaria, así que no te vamos a cobrar
          nada. <strong>Todavía no sos socio/a</strong>: la Comisión Directiva va a resolver tu
          solicitud en su próxima reunión y te avisamos el resultado por email.
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
