"use client";
// Paso 3: el reporte. Mosaico de categorías, tipos (con el aviso SCPL), la
// descripción, el mapa + calle, las dos fotos, el consentimiento y el envío.
//
// Lo que apaga "Enviar reporte" son las MISMAS reglas que hace cumplir el
// server (`isLocationRequired`, el catálogo): compartir la función y no
// copiarla es la lección de `coverageFloor`. El botón apagado es cortesía; el
// juez es `validateSubmission`.
import { MessageCircle, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Callout } from "@/components/public/callout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isInsideBoundary } from "@/lib/reports/boundary";
import { findClaimCategory, isScplSubtype, SCPL_WHATSAPP } from "@/lib/reports/catalog";
import { isLocationRequired, MAX_DESCRIPTION } from "@/lib/reports/rules";
import { StreetPicker } from "../asociate/street-picker";
import { streetLabel } from "../asociate/wizard-shared";
import { ChoiceCard, Field, LegalDetails, NavButtons } from "../asociate/wizard-ui";
import { CategoryGrid } from "./category-grid";
import { FileSlot } from "./file-slot";
import LocationPicker from "./location-picker-loader";
import {
  CONTROL_HEIGHT,
  type ReportDraft,
  type StreetOption,
  type UploadedFile,
} from "./wizard-shared";

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
  const formRef = useRef<HTMLFormElement>(null);
  // Radios (categoría y tipo) y el checkbox del consentimiento: un rechazo del
  // server los devolvería a su estado por defecto sin avisar.
  useFormResetSync(formRef, {
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
    <form ref={formRef} action={formAction} className="space-y-8">
      <input type="hidden" name="claim" value={claim} />
      {draft.lat !== null && <input type="hidden" name="lat" value={draft.lat} />}
      {draft.lng !== null && <input type="hidden" name="lng" value={draft.lng} />}
      {draft.streetId !== null && <input type="hidden" name="streetId" value={draft.streetId} />}
      {draft.streetName !== "" && <input type="hidden" name="streetName" value={draft.streetName} />}

      <CategoryGrid
        kind={kind}
        value={draft.category}
        onChange={(slug) => patch({ category: slug, subtype: "" })}
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
              onSelect={() => patch({ subtype: s.slug })}
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
            El punto queda fuera del barrio Ciudadela. Podés enviarlo igual; la Comisión decide si lo
            canaliza.
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

      <div>
        <p className="text-sm font-medium">Fotos (opcional)</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Hasta dos. Sin metadatos: la ubicación de tu celular no viaja con la foto.
        </p>
        {/* Dos ranuras sobre una LISTA, no dos posiciones fijas: quitar la
            primera foto deja la segunda como `photos[0]` y se muestra arriba. */}
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

      <div className="space-y-3 rounded-xl border border-border p-4">
        <LegalDetails title="Consentimiento de datos personales" text={consentText} />
        <label className="flex cursor-pointer items-start gap-3 py-1.5">
          <input
            type="checkbox"
            name="consent"
            required
            checked={draft.consent}
            onChange={(e) => patch({ consent: e.target.checked })}
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span className="text-sm">Leí y acepto el consentimiento de datos personales.</span>
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
        nextLabel="Enviar reporte"
        pending={pending}
        pendingLabel="Enviando…"
        nextDisabled={!canSend}
        nextDescribedBy="submit-note"
      />
      <p id="submit-note" className="text-xs text-muted-foreground">
        Al enviar, la Comisión Directiva recibe el aviso y vos el acuse por email.
      </p>
    </form>
  );
}
