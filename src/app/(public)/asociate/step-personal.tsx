"use client";
// Paso 3 del wizard ASOCIATE: los datos personales y el envío que CREA la
// solicitud en la base. Es el único paso que postea a una server action.
import { useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CONTROL_HEIGHT, FOCUS_RING, type AsociateDraft, type CreateState, type LegalTexts } from "./wizard-shared";
import { Field, LegalDetails, NavButtons } from "./wizard-ui";

const CIVIL_STATUSES = [
  "Soltero/a",
  "Casado/a",
  "Divorciado/a",
  "Viudo/a",
  "Unión convivencial",
];
export function StepPersonal({
  draft,
  patch,
  legal,
  siteKey,
  actionState,
  formAction,
  pending,
  error,
  onBack,
}: {
  draft: AsociateDraft;
  patch: (values: Partial<AsociateDraft>) => void;
  legal: LegalTexts;
  siteKey: string;
  /** Se le pasa entero a Turnstile: cada respuesta del server es un objeto
   *  nuevo, y cada respuesta significa que el token anterior ya se gastó. */
  actionState: CreateState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  onBack: () => void;
}) {
  // React 19 hace `form.reset()` al terminar la action. Para los campos de
  // TEXTO no se nota: React mantiene sincronizado el atributo `value`, y el
  // reset devuelve cada input al valor de ese atributo, o sea a lo tipeado.
  // Para el `<select>` y el checkbox SÍ se nota, porque lo que el reset toca
  // ahí no es un atributo que React sincronice sino la *selectedness* de cada
  // `<option>` y el `checked` del input — propiedades del DOM que React deja
  // como están, porque desde su punto de vista ninguna prop cambió y no hay
  // nada que actualizar.
  //
  // El daño no es cosmético. Tras un envío rechazado el algoritmo del HTML
  // vuelve a seleccionar la primera opción no deshabilitada del select, o sea
  // "Soltero/a": `draft.civilStatus` sigue diciendo "Viudo/a", nadie ve
  // diferencia, y el reintento persiste un estado civil que el vecino nunca
  // eligió. Con el checkbox el efecto es el inverso y más visible (pierde la
  // aceptación de los términos y el navegador frena el envío).
  //
  // Se reusa `useFormResetSync`, que es donde el panel ya resolvió esto para
  // toda la familia (select + radio + checkbox), en vez de arreglar un control
  // por vez con refs. La convención del hook: el checkbox se expresa como "on"
  // / "" — igual que lo que manda el navegador.
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, {
    civilStatus: draft.civilStatus,
    acceptTerms: draft.acceptTerms ? "on" : "",
  });

  const emailMismatch =
    draft.email.trim() !== "" &&
    draft.emailConfirm.trim() !== "" &&
    draft.email.trim().toLowerCase() !== draft.emailConfirm.trim().toLowerCase();

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      {/* Los pasos 1 y 2 viajan acá, con los nombres exactos del schema de
          createApplicationAction. Los campos de la rama que el vecino NO eligió
          se omiten en vez de emitirse vacíos: no porque el server no los banque
          —`parseForm` traduce el "" a `undefined` para todo campo `.optional()`,
          así que un `streetId=""` pasaría igual— sino porque el POST tiene que
          decir una sola cosa sobre el domicilio. Lo que no se eligió no se
          manda. */}
      <input type="hidden" name="livesInBarrio" value={draft.livesInBarrio} />
      {draft.livesInBarrio === "si" && draft.streetId !== null && (
        <input type="hidden" name="streetId" value={draft.streetId} />
      )}
      {draft.livesInBarrio === "no" && (
        <>
          <input type="hidden" name="streetText" value={draft.streetText} />
          <input type="hidden" name="neighborhood" value={draft.neighborhood} />
        </>
      )}
      <input type="hidden" name="streetNumber" value={draft.streetNumber} />
      <input type="hidden" name="requestedCategory" value={draft.requestedCategory} />
      {draft.requestedCategory === "adherent" && (
        <input type="hidden" name="wantsDebit" value={draft.wantsDebit} />
      )}

      <Field id="fullName" label="Nombre y apellido">
        <Input
          id="fullName"
          name="fullName"
          className={CONTROL_HEIGHT}
          autoComplete="name"
          maxLength={160}
          required
          value={draft.fullName}
          onChange={(e) => patch({ fullName: e.target.value })}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="dni" label="DNI" hint="Sin puntos ni espacios.">
          <Input
            id="dni"
            name="dni"
            className={CONTROL_HEIGHT}
            inputMode="numeric"
            autoComplete="off"
            maxLength={9}
            required
            aria-describedby="dni-hint"
            value={draft.dni}
            onChange={(e) => patch({ dni: e.target.value.replace(/\D/g, "") })}
          />
        </Field>
        <Field id="birthDate" label="Fecha de nacimiento" hint="Tenés que ser mayor de 18 años.">
          <Input
            id="birthDate"
            name="birthDate"
            type="date"
            className={CONTROL_HEIGHT}
            autoComplete="bday"
            required
            aria-describedby="birthDate-hint"
            value={draft.birthDate}
            onChange={(e) => patch({ birthDate: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="civilStatus" label="Estado civil">
          {/* `<select>` nativo y no el de Radix: en el celular abre el selector
              del sistema operativo, que es el control que el vecino ya sabe
              usar (y el que su lector de pantalla ya sabe leer). Los colores y
              la altura van explícitos para que quede igual que los `Input` de
              al lado, que traen los suyos del componente. */}
          <select
            id="civilStatus"
            name="civilStatus"
            required
            value={draft.civilStatus}
            onChange={(e) => patch({ civilStatus: e.target.value })}
            className={cn(
              "w-full rounded-lg border border-input bg-background px-3 text-foreground transition-colors",
              CONTROL_HEIGHT,
              FOCUS_RING,
              "focus-visible:border-ring",
              draft.civilStatus === "" && "text-muted-foreground",
            )}
          >
            <option value="" disabled>
              Elegí una opción
            </option>
            {CIVIL_STATUSES.map((s) => (
              <option key={s} value={s} className="text-foreground">
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field id="nationality" label="Nacionalidad">
          <Input
            id="nationality"
            name="nationality"
            className={CONTROL_HEIGHT}
            autoComplete="country-name"
            maxLength={60}
            required
            value={draft.nationality}
            onChange={(e) => patch({ nationality: e.target.value })}
          />
        </Field>
      </div>

      <Field id="occupation" label="Ocupación">
        <Input
          id="occupation"
          name="occupation"
          className={CONTROL_HEIGHT}
          autoComplete="organization-title"
          maxLength={80}
          required
          value={draft.occupation}
          onChange={(e) => patch({ occupation: e.target.value })}
        />
      </Field>

      <Field id="phone" label="Teléfono">
        <Input
          id="phone"
          name="phone"
          type="tel"
          className={CONTROL_HEIGHT}
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          required
          value={draft.phone}
          onChange={(e) => patch({ phone: e.target.value })}
        />
      </Field>

      <Field id="email" label="Email" hint="Acá te mandamos todo lo de tu solicitud.">
        <Input
          id="email"
          name="email"
          type="email"
          className={CONTROL_HEIGHT}
          inputMode="email"
          autoComplete="email"
          maxLength={191}
          required
          aria-describedby="email-hint"
          value={draft.email}
          onChange={(e) => patch({ email: e.target.value })}
        />
      </Field>

      <Field id="emailConfirm" label="Repetí tu email">
        <Input
          id="emailConfirm"
          name="emailConfirm"
          type="email"
          className={CONTROL_HEIGHT}
          inputMode="email"
          autoComplete="off"
          maxLength={191}
          required
          aria-invalid={emailMismatch || undefined}
          // El contenedor existe siempre aunque el mensaje aparezca y
          // desaparezca: un `aria-describedby` que apunta a un id ausente es
          // una referencia colgada, y sin él el lector de pantalla anunciaba el
          // campo como inválido sin decir por qué.
          aria-describedby="emailConfirm-error"
          value={draft.emailConfirm}
          onChange={(e) => patch({ emailConfirm: e.target.value })}
        />
        <div id="emailConfirm-error">
          {emailMismatch && (
            <FormMessage kind="warning" role="none" className="text-xs">
              Los dos emails no coinciden: revisá el tipeo.
            </FormMessage>
          )}
        </div>
      </Field>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <LegalDetails title="Términos y condiciones" text={legal.terms} />
        <LegalDetails title="Consentimiento de datos personales" text={legal.privacyConsent} />
        <label className="flex cursor-pointer items-start gap-3 py-1.5">
          <input
            type="checkbox"
            name="acceptTerms"
            required
            checked={draft.acceptTerms}
            onChange={(e) => patch({ acceptTerms: e.target.checked })}
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span className="text-sm">
            Leí y acepto los términos y condiciones y el consentimiento de datos personales.
          </span>
        </label>
      </div>

      <TurnstileWidget siteKey={siteKey} resetKey={actionState} />

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}

      <NavButtons
        onBack={onBack}
        submit
        nextLabel="Guardar y continuar"
        pending={pending}
      />
    </form>
  );
}
