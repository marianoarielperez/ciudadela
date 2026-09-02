"use client";
// Primitivas visuales compartidas por los pasos del wizard ASOCIATE. Viven
// aparte para que los pasos 5 y 6 (Task 13) las hereden sin importar el wizard
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
  icon,
  aside,
  children,
  disabled = false,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  /** Chip decorativo a la izquierda del título. El dato es el título: el ícono
   *  va `aria-hidden` y la tarjeta se lee igual sin él. */
  icon?: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  /** Visible pero no elegible (spec 2026-09-02): el radio NATIVO va `disabled`
   *  —no dispara `onChange`, así que el llamador no necesita otra guarda— y la
   *  tarjeta se atenúa por su SUPERFICIE (borde punteado + fondo apagado) y por
   *  sus controles decorativos (el radio y el chip del ícono). El título y el
   *  `children` quedan a opacidad PLENA a propósito (hallazgo de la revisión,
   *  spec 2026-09-02): el `children` es la única explicación que recibe el
   *  vecino de por qué no puede seguir, y atenuarlo lo dejaba en 2,3:1 en modo
   *  claro, muy por debajo del 4,5:1 de WCAG AA. Es contenido, no adorno.
   *  Prop opcional y aditiva: el paso 3 de ASOCIATE, los dos pasos de REPORTES
   *  y /mi/solicitudes también importan esta tarjeta y sin la prop nada cambia. */
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-xl border-2 p-4 transition-colors",
        // El foco vive en el radio nativo, que está adentro: sin `has-` el
        // recorrido con Tab no marcaría la tarjeta, que es lo que se ve.
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        // La tarjeta deshabilitada se atenúa por superficie, NUNCA con una
        // opacidad sobre todo el `<label>`: adentro va el motivo, y bajarle la
        // opacidad al texto lo saca de AA.
        disabled
          ? "cursor-not-allowed border-dashed border-border bg-muted/40"
          : checked
            ? "cursor-pointer border-primary bg-primary/5"
            : "cursor-pointer border-border hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 size-5 shrink-0 accent-primary disabled:opacity-50"
      />
      {icon && (
        <span
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
            // El chip es decorativo (`aria-hidden`): atenuarlo no le saca
            // información a nadie. El texto de al lado sí, y por eso no se toca.
            disabled && "opacity-50",
          )}
        >
          {icon}
        </span>
      )}
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
  /** El paso 6 no "envía": va a Mercado Pago. El rótulo de espera tiene que
   *  decir lo que está pasando, si no el vecino cree que ya mandó la solicitud. */
  pendingLabel?: string;
  /** Id del texto que explica QUÉ hace el avance (una nota al pie del paso).
   *  Va como `aria-describedby` del botón, no como `aria-label`: el rótulo
   *  sigue siendo el rótulo. */
  nextDescribedBy?: string;
} & NavNextProps;

export function NavButtons(props: NavButtonsProps) {
  const {
    onBack,
    backLabel = "Volver",
    nextLabel = "Continuar",
    nextDisabled,
    pending,
    pendingLabel = "Enviando…",
    nextDescribedBy,
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
        aria-describedby={nextDescribedBy}
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
