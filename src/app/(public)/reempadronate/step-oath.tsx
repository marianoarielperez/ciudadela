"use client";
// Paso 4 del wizard REEMPADRONATE: el resumen y la declaración jurada (§5.3).
//
// Es el único paso que ASIENTA algo institucional: al enviarlo se escribe
// `submittedAt`, que es la ÚNICA prueba de que el socio se presentó dentro de
// los treinta días del Art. 9° bis. De ahí las dos decisiones de esta pantalla:
//
//   1. Antes del botón va el RESUMEN de todo lo cargado. Lo que se firma es una
//      declaración jurada, así que el vecino tiene que poder leer qué está
//      declarando sin volver atrás a buscarlo. El domicilio, el email y los
//      documentos son los tres que más se equivocan, y los tres están acá.
//   2. La declaración es un checkbox OBLIGATORIO con el texto adentro, no un
//      "al enviar aceptás…" al pie. El server la revalida: sin el tilde no hay
//      envío, porque sin declaración no hay nada que la Comisión pueda tener
//      por jurado.
//
// Y no hay ningún paso de pago acá ni en ninguna parte del wizard (decisión del
// operador, 25/08/2026): el adherente sólo ratifica su condición de socio.
import { useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { formatDateAR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NavButtons } from "../asociate/wizard-ui";
import { streetLabel } from "../asociate/wizard-shared";
import { FOCUS_RING, type PresentationDraft } from "./wizard-shared";
import type { DocumentType } from "@/generated/prisma/client";

export function StepOath({
  draft,
  uploaded,
  accepted,
  onAccepted,
  token,
  formAction,
  pending,
  error,
  onBack,
}: {
  draft: PresentationDraft;
  uploaded: DocumentType[];
  accepted: boolean;
  onAccepted: (value: boolean) => void;
  token: string;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  onBack: () => void;
}) {
  // React 19 hace `form.reset()` al terminar la action, y lo que el reset toca
  // en un checkbox es la propiedad `checked` del DOM, que React no sincroniza
  // porque desde su punto de vista ninguna prop cambió. Tras un envío rechazado
  // el tilde desaparecía y el navegador frenaba el reintento por el `required`.
  // La convención del hook: el checkbox se expresa como "on" / "", igual que lo
  // que manda el navegador.
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, { oath: accepted ? "on" : "" });

  const annexes = uploaded.filter((t) => t === "annex").length;

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />

      <p className="text-sm text-muted-foreground">
        Revisá lo que vas a declarar. Si algo no está bien, volvé y corregilo antes de enviar.
      </p>

      <dl className="divide-y divide-border rounded-xl border border-border">
        <Row label="Fecha de nacimiento" value={formatBirth(draft.birthDate)} />
        <Row label="Estado civil" value={draft.civilStatus} />
        <Row label="Nacionalidad" value={draft.nationality} />
        <Row label="Ocupación" value={draft.occupation} />
        <Row
          label="Domicilio"
          value={`${streetLabel(draft.streetName)} ${draft.streetNumber}, ${draft.neighborhood}`}
        />
        <Row label="Teléfono" value={draft.phone} />
        <Row label="Email" value={draft.email} />
        <Row
          label="Documentación"
          value={`Frente y dorso del DNI${
            annexes > 0 ? ` y ${annexes === 1 ? "1 comprobante" : `${annexes} comprobantes`}` : ""
          }`}
        />
      </dl>

      <div className="rounded-xl border-2 border-primary bg-primary/5 p-4">
        <label className="flex cursor-pointer items-start gap-3 py-1.5">
          <input
            type="checkbox"
            name="oath"
            required
            checked={accepted}
            onChange={(e) => onAccepted(e.target.checked)}
            className={cn("mt-0.5 size-5 shrink-0 accent-primary", FOCUS_RING)}
          />
          <span className="text-sm">
            Declaro bajo juramento que los datos que cargué son verdaderos y que la documentación
            que subí me corresponde. Pido a la Comisión Directiva que me mantenga como socio/a de la
            Asociación Vecinal del Barrio Ciudadela, y acepto que la vecinal me notifique al email
            que declaré, que pasa a ser mi domicilio electrónico.
          </span>
        </label>
      </div>

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}

      <NavButtons
        onBack={onBack}
        submit
        nextLabel="Enviar mi re-empadronamiento"
        nextDisabled={!accepted}
        pending={pending}
      />
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium [overflow-wrap:anywhere]">{value || "—"}</dd>
    </div>
  );
}

/** La fecha del `<input type="date">` es "AAAA-MM-DD" y el vecino la lee en
 *  DD/MM/AAAA. Se arma el mediodía UTC del día civil —el mismo criterio con el
 *  que el proyecto guarda toda fecha civil— para que el formateo a hora
 *  argentina no la corra un día. */
function formatBirth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return formatDateAR(new Date(Date.UTC(y, m - 1, d, 12)));
}
