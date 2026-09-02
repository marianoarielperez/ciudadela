"use client";
// Paso 3: el reporte. Mosaico de categorías, tipos (con el aviso SCPL), la
// descripción, el mapa + calle, las dos fotos, el consentimiento y el envío.
//
// Lo que apaga "Enviar reporte" son las MISMAS reglas que hace cumplir el
// server (`isLocationRequired`, el catálogo): compartir la función y no
// copiarla es la lección de `coverageFloor`. El botón apagado es cortesía; el
// juez es `validateSubmission`.
//
// FORMA DEL PASO (la misma del paso 2, y por el mismo motivo): las ranuras de
// archivo son `<form>` propios, así que NO pueden ir adentro del form del
// reporte —un form anidado es HTML inválido y el navegador lo desarma; en la
// página de retome, que renderiza este paso en el server, la hidratación se
// rompería—. El form del reporte lleva un `id`; las fotos son un hermano, y
// tanto el checkbox del consentimiento —que va DESPUÉS de las fotos, como manda
// la spec— como el botón de envío se enganchan por `form=`.
import { MessageCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Callout } from "@/components/public/callout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isInsideBoundary } from "@/lib/reports/boundary";
import { findClaimCategory, isScplSubtype, SCPL_WHATSAPP } from "@/lib/reports/catalog";
import { isLocationRequired, MAX_DESCRIPTION } from "@/lib/reports/rules";
import { cn } from "@/lib/utils";
import { StreetPicker } from "../asociate/street-picker";
import { streetLabel } from "../asociate/wizard-shared";
import { ChoiceCard, Field, LegalDetails } from "../asociate/wizard-ui";
import { CategoryGrid } from "./category-grid";
import { FileSlot } from "./file-slot";
import LocationPicker from "./location-picker-loader";
import {
  CONTROL_HEIGHT,
  LINK_TARGET,
  type ReportDraft,
  type StreetOption,
  type UploadedFile,
} from "./wizard-shared";

const FORM_ID = "report-form";

// Enter en un campo de UNA LÍNEA no envía el reporte. El envío es irreversible
// (crea el N° y dispara los correos) y el vecino tiene su botón; el envío
// implícito del navegador lo dispararía desde el buscador de calles o desde la
// referencia sin que nadie lo pidiera. El `<textarea>` conserva Enter —ahí es
// un salto de línea— y el buscador de calles conserva el suyo: su `onKeyDown`
// corre ANTES (esto es el form, que recibe el evento al burbujear), así que
// elegir con Enter una opción de la lista sigue funcionando igual.
function swallowEnter(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter") return;
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type === "submit" || target.type === "button") return;
  e.preventDefault();
}

export function StepReport({
  claim,
  kind,
  draft,
  patch,
  streets,
  consentText,
  files,
  onUploaded,
  onRemoved,
  formAction,
  pending,
  error,
  onBack,
}: {
  claim: string;
  kind: "claim" | "initiative";
  draft: ReportDraft;
  patch: (values: Partial<ReportDraft>) => void;
  streets: StreetOption[];
  consentText: string | null;
  files: UploadedFile[];
  onUploaded: (file: UploadedFile) => void;
  onRemoved: (fileId: number) => void;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  onBack?: () => void;
}) {
  const [inFlight, setInFlight] = useState(0);
  // El ref cuelga del ENVOLTORIO, no del `<form>`: el consentimiento se postea
  // por `form=` desde afuera (ver más abajo) y `useFormResetSync` recorre
  // `ref.current.querySelectorAll`, así que con el ref en el form el checkbox
  // se quedaba sin re-sincronizar después de un rechazo — que es justo el caso
  // que el hook existe para cubrir.
  const wrapRef = useRef<HTMLDivElement>(null);
  // Radios (categoría y tipo) y el checkbox del consentimiento: un rechazo del
  // server los devolvería a su estado por defecto sin avisar.
  useFormResetSync(wrapRef, {
    category: draft.category,
    subtype: draft.subtype,
    consent: draft.consent ? "on" : "",
  });

  const category = kind === "claim" ? findClaimCategory(draft.category) : null;
  const subtypes = category?.subtypes ?? [];
  const scpl = isScplSubtype(draft.category, draft.subtype);
  const locationRequired = isLocationRequired({ kind, category: draft.category || null });
  const hasPoint = draft.lat !== null && draft.lng !== null;
  const outside = hasPoint && !isInsideBoundary(draft.lat as number, draft.lng as number);
  const photos = files.filter((f) => f.kind === "photo");
  const canSend =
    draft.category !== "" &&
    (subtypes.length === 0 || draft.subtype !== "") &&
    draft.description.trim() !== "" &&
    (!locationRequired || hasPoint) &&
    draft.consent &&
    inFlight === 0;

  return (
    <div ref={wrapRef} className="space-y-8">
      <form id={FORM_ID} action={formAction} onKeyDown={swallowEnter} className="space-y-8">
        <input type="hidden" name="claim" value={claim} />
        {draft.lat !== null && <input type="hidden" name="lat" value={draft.lat} />}
        {draft.lng !== null && <input type="hidden" name="lng" value={draft.lng} />}
        {draft.streetId !== null && <input type="hidden" name="streetId" value={draft.streetId} />}
        {draft.streetName !== "" && <input type="hidden" name="streetName" value={draft.streetName} />}

        <CategoryGrid
          kind={kind}
          value={draft.category}
          // Cambiar de categoría vacía el tipo, y sin tipo no hay SCPL: el N° de
          // reclamo de la SCPL se va con él (si no, viajaría al server un ticket
          // que la pantalla ya no muestra).
          onChange={(slug) => patch({ category: slug, subtype: "", scplTicket: "" })}
        />

        {subtypes.length > 0 && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">¿Qué problema es?</legend>
            {subtypes.map((s) => (
              <ChoiceCard
                key={s.slug}
                name="subtype"
                value={s.slug}
                checked={draft.subtype === s.slug}
                // Sólo un tipo SCPL conserva el N° de reclamo ya tipeado.
                onSelect={() => patch({ subtype: s.slug, scplTicket: s.scpl ? draft.scplTicket : "" })}
                title={s.label}
                aside={
                  s.scpl ? (
                    <span className="rounded-4xl bg-secondary px-2 py-0.5 text-xs font-medium">SCPL</span>
                  ) : undefined
                }
              />
            ))}
          </fieldset>
        )}

        {scpl && (
          <div className="space-y-3">
            <Callout tone="info" icon={MessageCircle}>
              Este reclamo también conviene hacerlo directo a la SCPL por WhatsApp al{" "}
              <a
                href={SCPL_WHATSAPP.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                {SCPL_WHATSAPP.display}
              </a>
              . Nosotros lo tomamos y lo elevamos, pero pedí tu número de reclamo ahí: es lo que
              después permite seguirlo.
            </Callout>
            <Field id="scplTicket" label="N° de reclamo SCPL (opcional)">
              <Input
                id="scplTicket"
                name="scplTicket"
                className={CONTROL_HEIGHT}
                maxLength={40}
                value={draft.scplTicket}
                onChange={(e) => patch({ scplTicket: e.target.value })}
              />
            </Field>
          </div>
        )}

        <Field
          id="description"
          label={kind === "claim" ? "Contanos qué pasa" : "Contanos tu propuesta"}
          hint={`${draft.description.length} / ${MAX_DESCRIPTION}`}
        >
          <Textarea
            id="description"
            name="description"
            rows={5}
            maxLength={MAX_DESCRIPTION}
            required
            aria-describedby="description-hint"
            className="text-base"
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">{locationRequired ? "¿Dónde está?" : "¿Dónde? (opcional)"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tocá el mapa para marcar el punto y arrastralo para ajustarlo. El contorno es el barrio
              Ciudadela.
            </p>
          </div>
          {/* `value` sólo se honra AL MONTAR (ver `location-picker.tsx`): el punto
              del borrador se repone porque este paso remonta el picker entero al
              volver del paso 2, no porque la prop cambie. */}
          <LocationPicker
            value={hasPoint ? { lat: draft.lat as number, lng: draft.lng as number } : null}
            onChange={(v) => patch({ lat: v?.lat ?? null, lng: v?.lng ?? null })}
          />
          {hasPoint && (
            // Decorativo: el dato para el vecino es el pin, no los grados. El
            // lector de pantalla tiene la calle y la referencia, acá abajo.
            <p aria-hidden className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
              {(draft.lat as number).toFixed(5)}, {(draft.lng as number).toFixed(5)}
            </p>
          )}
          {outside && (
            <Callout tone="warning" icon={TriangleAlert}>
              {kind === "claim"
                ? "El punto queda fuera del barrio Ciudadela. Podés enviarlo igual; la Comisión decide si lo canaliza."
                : "El punto queda fuera del barrio Ciudadela. Podés enviarla igual; la Comisión decide si la trata."}
            </Callout>
          )}
          <StreetPicker
            streets={streets}
            streetId={draft.streetId}
            streetName={draft.streetName}
            onPick={(s) => patch({ streetId: s?.id ?? null, streetName: s ? streetLabel(s.name) : "" })}
            notFoundHint="Esa calle no está en el catálogo del barrio. Podés dejar el mapa como referencia y describir el lugar abajo."
          />
          <Field
            id="addressDetail"
            label="Altura o referencia"
            hint="Por ejemplo: al 280, frente a la plaza, esquina Alem."
          >
            <Input
              id="addressDetail"
              name="addressDetail"
              className={CONTROL_HEIGHT}
              maxLength={160}
              aria-describedby="addressDetail-hint"
              value={draft.addressDetail}
              onChange={(e) => patch({ addressDetail: e.target.value })}
            />
          </Field>
        </div>

      </form>

      {/* AFUERA del form del reporte: cada ranura es un `<form>` propio (ver la
          cabecera). Dos ranuras sobre una LISTA, no dos posiciones fijas:
          quitar la primera foto deja la segunda como `photos[0]` y se muestra
          arriba. */}
      <div>
        <p className="text-sm font-medium">Fotos (opcional)</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Hasta dos. Sin metadatos: la ubicación de tu celular no viaja con la foto.
        </p>
        <ul className="mt-3 space-y-3">
          <FileSlot
            claim={claim}
            kind="photo"
            title="Foto 1"
            hint="Lo que se ve desde la calle."
            existing={photos[0] ?? null}
            optional
            onUploaded={onUploaded}
            onRemoved={onRemoved}
            onBusy={(d) => setInFlight((n) => n + d)}
          />
          <FileSlot
            claim={claim}
            kind="photo"
            title="Foto 2"
            hint="Otro ángulo, si ayuda."
            existing={photos[1] ?? null}
            optional
            onUploaded={onUploaded}
            onRemoved={onRemoved}
            onBusy={(d) => setInFlight((n) => n + d)}
          />
        </ul>
      </div>

      {/* El consentimiento va ÚLTIMO —después de las fotos, como manda la spec—
          y por eso también queda afuera del `<form>`: no puede envolverlo sin
          meter adentro las ranuras de archivo, que son `<form>` propios. Se
          postea igual por `form=`, que es HTML válido y conserva `required` y
          la validación nativa del navegador. */}
      <div className="space-y-3 rounded-xl border border-border p-4">
        <LegalDetails title="Consentimiento de datos personales" text={consentText} />
        {/* El área que acepta el clic es toda la fila: 44 px de alto, que es
            el mínimo del proyecto para un target táctil. */}
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            form={FORM_ID}
            name="consent"
            required
            checked={draft.consent}
            onChange={(e) => patch({ consent: e.target.checked })}
            className="size-5 shrink-0 accent-primary"
          />
          <span className="text-sm">Leí y acepto el consentimiento de datos personales.</span>
        </label>
      </div>

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}
      {/* La botonera se arma acá y no con `NavButtons` por el mismo motivo que
          en el paso 2: el envío sale del form del reporte por `form=`, y
          `NavButtons` no admite ese atributo. Las clases son las suyas. */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className={cn(CONTROL_HEIGHT, "sm:w-auto sm:px-6")}
          >
            Volver
          </Button>
        ) : (
          <Link href="/" className={cn(LINK_TARGET, "order-last justify-center sm:order-first")}>
            Volver al inicio
          </Link>
        )}
        <Button
          type="submit"
          form={FORM_ID}
          aria-describedby="submit-note"
          disabled={!canSend || pending}
          className={cn(CONTROL_HEIGHT, "font-semibold sm:w-auto sm:px-8")}
        >
          {pending ? "Enviando…" : "Enviar reporte"}
        </Button>
      </div>
      <p id="submit-note" className="text-xs text-muted-foreground">
        Al enviar, la Comisión Directiva recibe el aviso y vos el acuse por email.
      </p>
    </div>
  );
}
