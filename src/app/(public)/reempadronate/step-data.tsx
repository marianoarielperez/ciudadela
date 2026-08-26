"use client";
// Paso 2 del wizard REEMPADRONATE: la ficha completa, sin el nombre (§5.2).
//
// Por qué se pide TODO esto y no sólo el contacto: de las 278 fichas del padrón
// casi ninguna tiene cargada la fecha de nacimiento, el estado civil, la
// nacionalidad ni la ocupación —el Excel vino vacío en esas columnas— y este
// trámite es la única ocasión en que los adherentes van a pasar por un
// formulario. Es LA oportunidad de completar la ficha (decisión 9).
//
// Dos cosas que esta pantalla NO hace, y las dos son de fondo:
//
//   1. NO pide el nombre. Es el ancla de identidad de la ficha, y con un DNI
//      por toda credencial, dejarlo editar permitiría apropiarse de la ficha de
//      otro. Las correcciones de nombre se hacen en la sede.
//   2. NO precarga nada guardado salvo el EMAIL (decisión 8), cuando se llega
//      por el DNI. Precargar la fecha de nacimiento o el domicilio se los
//      mostraría a quien tipeó un documento ajeno. Por el ENLACE del correo sí
//      se precarga todo: ahí el buzón ya demostró ser suyo (§5.4), y quien
//      decide eso es la página, que arma el borrador.
//
// Y no hay ningún paso de pago en todo el wizard (decisión del operador,
// 25/08/2026): re-empadronarse no ofrece pagar, ni adherir débito, ni cambiar
// montos.
import { useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StreetPicker } from "../asociate/street-picker";
import { Field, NavButtons } from "../asociate/wizard-ui";
import {
  CONTROL_HEIGHT,
  FOCUS_RING,
  type PresentationDraft,
  type StreetOption,
} from "./wizard-shared";

// Las MISMAS opciones que el modo carga del panel (`carga-form.tsx`): lo que el
// vecino elige acá termina, al validarse, en la misma columna que tipea el
// operador. Dos listas distintas darían "Soltero/a" y "Soltero" conviviendo en
// el padrón.
const CIVIL_STATUSES = [
  "Soltero/a",
  "Casado/a",
  "Divorciado/a",
  "Viudo/a",
  "Separado/a",
  "Unión convivencial",
];
const NEIGHBOURHOODS = [
  "Ciudadela",
  "Pueyrredón",
  "Standard",
  "Roca",
  "General Mosconi",
  "Laprida",
];

export function StepData({
  draft,
  patch,
  streets,
  formAction,
  pending,
  error,
  token,
}: {
  draft: PresentationDraft;
  patch: (values: Partial<PresentationDraft>) => void;
  streets: StreetOption[];
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  token: string;
}) {
  // React 19 hace `form.reset()` al terminar la action. Para los campos de
  // TEXTO no se nota: React mantiene sincronizado el atributo `value`. Para los
  // `<select>` SÍ, porque lo que el reset toca ahí no es un atributo que React
  // sincronice sino la *selectedness* de cada `<option>`. Tras un envío
  // rechazado el algoritmo del HTML vuelve a seleccionar la primera opción
  // habilitada, el borrador sigue diciendo otra cosa, nadie ve diferencia, y el
  // reintento persiste un estado civil que el vecino nunca eligió. Se reusa el
  // hook del panel, que es donde el proyecto ya resolvió esto.
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, {
    civilStatus: draft.civilStatus,
    neighborhood: draft.neighborhood,
  });

  const emailMismatch =
    draft.email.trim() !== "" &&
    draft.emailConfirm.trim() !== "" &&
    draft.email.trim().toLowerCase() !== draft.emailConfirm.trim().toLowerCase();

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      {/* La LLAVE, y nunca un id: el cliente no puede apuntar a la presentación
          de otro. Es lo único que dice sobre qué se está operando. */}
      <input type="hidden" name="token" value={token} />
      {/* La calle viaja como id del catálogo. El combo es un control del
          cliente, así que su valor se emite acá. */}
      {draft.streetId !== null && (
        <input type="hidden" name="streetId" value={draft.streetId} />
      )}

      <p className="text-sm text-muted-foreground">
        Confirmá o corregí tus datos. Tu nombre no se edita acá: si figura mal, acercate a la sede
        con tu documento y lo corregimos.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="birthDate" label="Fecha de nacimiento">
          <Input
            id="birthDate"
            name="birthDate"
            type="date"
            className={CONTROL_HEIGHT}
            autoComplete="bday"
            required
            value={draft.birthDate}
            onChange={(e) => patch({ birthDate: e.target.value })}
          />
        </Field>
        <Field id="civilStatus" label="Estado civil">
          {/* `<select>` nativo y no el de Radix: en el celular abre el selector
              del sistema operativo, que es el control que el vecino ya sabe
              usar (y el que su lector de pantalla ya sabe leer). */}
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
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
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
      </div>

      <div className="space-y-5 rounded-xl border border-border p-4">
        <p className="text-sm font-semibold">Tu domicilio</p>
        {/* El catálogo catastral del barrio: los socios adherentes viven en
            Ciudadela (Art. 5), así que la calle sale de la lista y no a mano.
            El aviso de "no está en el barrio" se reescribe porque el de
            ASOCIATE manda a una rama —«En otro barrio»— que este wizard no
            tiene. */}
        <StreetPicker
          streets={streets}
          streetId={draft.streetId}
          streetName={draft.streetName}
          onPick={(street) =>
            patch({ streetId: street?.id ?? null, streetName: street ? street.name : "" })
          }
          notFoundHint="Esa calle no figura en el catálogo del barrio. Revisá cómo la escribiste; si te mudaste fuera de Ciudadela, acercate a la sede vecinal."
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="streetNumber" label="Altura">
            <Input
              id="streetNumber"
              name="streetNumber"
              className={CONTROL_HEIGHT}
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              required
              value={draft.streetNumber}
              onChange={(e) => patch({ streetNumber: e.target.value })}
            />
          </Field>
          <Field id="neighborhood" label="Barrio">
            <select
              id="neighborhood"
              name="neighborhood"
              required
              value={draft.neighborhood}
              onChange={(e) => patch({ neighborhood: e.target.value })}
              className={cn(
                "w-full rounded-lg border border-input bg-background px-3 text-foreground transition-colors",
                CONTROL_HEIGHT,
                FOCUS_RING,
                "focus-visible:border-ring",
                draft.neighborhood === "" && "text-muted-foreground",
              )}
            >
              <option value="" disabled>
                Elegí una opción
              </option>
              {NEIGHBOURHOODS.map((n) => (
                <option key={n} value={n} className="text-foreground">
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

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

      <Field
        id="email"
        label="Email"
        hint="Va a ser tu domicilio electrónico: la vecinal te notifica ahí."
      >
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
          // desaparezca: un `aria-describedby` que apunta a un id ausente es una
          // referencia colgada, y sin él el lector de pantalla anunciaría el
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

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}

      <NavButtons submit nextLabel="Guardar y continuar" pending={pending} pendingLabel="Guardando…" />
    </form>
  );
}
