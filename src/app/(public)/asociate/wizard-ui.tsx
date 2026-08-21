"use client";
// Primitivas visuales compartidas por los pasos del wizard ASOCIATE. Viven
// aparte para que los pasos 4 y 5 (Task 13) las hereden sin importar el wizard
// entero: la tarjeta de opción, el envoltorio de campo, la botonera de
// navegación, el monto de la cuota y el desplegable de los textos legales.
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatARS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CONTROL_HEIGHT, FOCUS_RING, LINK_TARGET } from "./wizard-shared";

export function ChoiceCard({
  name,
  value,
  checked,
  onSelect,
  title,
  aside,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors",
        // El foco vive en el radio nativo, que está adentro: sin `has-` el
        // recorrido con Tab no marcaría la tarjeta, que es lo que se ve.
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-base font-semibold">{title}</span>
          {aside}
        </span>
        {children && <span className="mt-1.5 block text-sm text-muted-foreground">{children}</span>}
      </span>
    </label>
  );
}
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
// El botón de avance es UNA de dos cosas, nunca las dos: o envía el `<form>`
// que lo envuelve (`submit`), o corre un callback en el cliente (`onNext`).
// La unión discriminada lo vuelve imposible por tipos, y eso NO es prolijidad:
// `type="submit"` + `onClick` juntos son exactamente la forma del bug que se
// tragó 11 de 12 subidas en producción (ver la cabecera de `step-documents`).
// Si el `onClick` toca estado, React flushea el render SINCRÓNICAMENTE dentro
// del despacho del clic —entre el handler y la activation behavior—, el botón
// puede quedar `disabled` en ese render, y el navegador entonces NO dispara el
// submit: el clic se pierde sin un solo request y sin un solo mensaje.
type NavNextProps =
  | {
      /** Envía el `<form>` que envuelve al botón. Sin callback de clic. */
      submit: true;
      onNext?: undefined;
    }
  | {
      submit?: false;
      /** Avance del lado del cliente: no hay formulario que enviar. */
      onNext: () => void;
    };

type NavButtonsProps = {
  onBack?: () => void;
  backLabel?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  pending?: boolean;
  /** El paso 5 no "envía": va a Mercado Pago. El rótulo de espera tiene que
   *  decir lo que está pasando, si no el vecino cree que ya mandó la solicitud. */
  pendingLabel?: string;
} & NavNextProps;

export function NavButtons(props: NavButtonsProps) {
  const {
    onBack,
    backLabel = "Volver",
    nextLabel = "Continuar",
    nextDisabled,
    pending,
    pendingLabel = "Enviando…",
  } = props;
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className={cn(CONTROL_HEIGHT, "sm:w-auto sm:px-6")}
        >
          {backLabel}
        </Button>
      ) : (
        <Link href="/" className={cn(LINK_TARGET, "order-last justify-center sm:order-first")}>
          Volver al inicio
        </Link>
      )}
      <Button
        type={props.submit ? "submit" : "button"}
        onClick={props.submit ? undefined : props.onNext}
        disabled={nextDisabled || pending}
        className={cn(CONTROL_HEIGHT, "font-semibold sm:w-auto sm:px-8")}
      >
        {pending ? pendingLabel : nextLabel}
      </Button>
    </div>
  );
}
export function Amount({ amount, note }: { amount: number; note: string }) {
  return (
    <span className="text-right">
      <span className="block text-lg font-bold text-primary">{formatARS(amount)}</span>
      <span className="block text-xs text-muted-foreground">{note}</span>
    </span>
  );
}
export function LegalDetails({ title, text }: { title: string; text: string | null }) {
  return (
    <details className="rounded-lg border border-border">
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-medium",
          FOCUS_RING,
        )}
      >
        {title}
      </summary>
      {/* Texto PLANO desde `configuration` (ver getLegalTexts): se renderiza con
          whitespace-pre-line, nunca como HTML. */}
      <div className="max-h-64 overflow-y-auto border-t border-border px-3 py-3 text-sm whitespace-pre-line text-muted-foreground">
        {text ?? "El texto todavía no está publicado. Consultalo en la sede vecinal."}
      </div>
    </details>
  );
}
