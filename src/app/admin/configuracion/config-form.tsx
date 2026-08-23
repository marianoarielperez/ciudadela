"use client";
// Formulario de Configuración.
//
// El campo delicado es el checkbox del botón ASOCIATE: React 19 resetea el
// <form action> cuando la server action termina, y un checkbox destildado por
// ese reset no lo corrige React (ver el comentario largo de
// use-form-reset-sync.ts). Acá el daño sería del peor tipo: el superadmin cierra
// el alta de socios, la action rechaza por otro campo, el reset vuelve a
// mostrarlo abierto y él se va creyendo que lo cerró. Por eso el estado del
// checkbox vive en `useSyncedForm` bajo la misma clave que su `name`, con el
// "on"/"" que manda el navegador: el hook lo re-tilda después de cada render.
import { useActionState, type ReactNode } from "react";
import { updateConfigAction } from "./actions";
import { useSyncedForm, TextField, TextareaField } from "@/components/admin/synced-fields";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Mismo tratamiento visual que los grupos de la lateral y de las tarjetas de
// Inicio: la pantalla ya no es una lista corta de tres campos y sin cortes el
// superadmin tiene que leerla entera para encontrar los ids de plan de MP.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t pt-4 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ConfigForm({
  initial,
}: {
  initial: {
    asociateActivo: boolean;
    contactPhone: string;
    contactEmail: string;
    termsText: string;
    privacyConsentText: string;
    mpPlanActiveId: string;
    mpPlanSharedId: string;
  };
}) {
  const [state, formAction, pending] = useActionState(updateConfigAction, {});
  const { values, setValue, formRef, field } = useSyncedForm({
    asociateActivo: initial.asociateActivo ? "on" : "",
    contactPhone: initial.contactPhone,
    contactEmail: initial.contactEmail,
    termsText: initial.termsText,
    privacyConsentText: initial.privacyConsentText,
    mpPlanActiveId: initial.mpPlanActiveId,
    mpPlanSharedId: initial.mpPlanSharedId,
  });

  return (
    <form ref={formRef} action={formAction} className="max-w-2xl space-y-6">
      <Section title="Sitio público">
        <div className="space-y-1">
          <Label htmlFor="asociateActivo" className="flex items-center gap-2 text-sm">
            <input
              id="asociateActivo"
              type="checkbox"
              name="asociateActivo"
              value="on"
              checked={values.asociateActivo === "on"}
              onChange={(e) => setValue("asociateActivo", e.target.checked ? "on" : "")}
            />
            Botón ASOCIATE habilitado en el sitio público
          </Label>
          <p className="text-xs text-muted-foreground">
            Apagado, el sitio muestra el aviso de asociaciones suspendidas. Se prende recién con el
            wizard del Módulo 3 funcionando.
          </p>
        </div>
        <TextField
          label="Teléfono de contacto"
          field={field("contactPhone")}
          type="tel"
          maxLength={40}
          hint="Se muestra en la página Ubicación. Dejalo vacío para ocultarlo."
        />
        <TextField
          label="Email de contacto"
          field={field("contactEmail")}
          type="email"
          maxLength={191}
          hint="Se muestra en la página Ubicación. Dejalo vacío para ocultarlo."
        />
      </Section>
      <Section title="ASOCIATE — Módulo 3">
        {/* Texto PLANO a propósito: el wizard lo muestra con `whitespace-pre-line`,
            así que los saltos de línea se respetan pero nada de lo que se escriba
            acá llega al navegador como HTML. Ver el comentario de getLegalTexts. */}
        <TextareaField
          label="Términos y condiciones de la solicitud"
          field={field("termsText")}
          rows={10}
          maxLength={20000}
          hint="Texto plano: los saltos de línea se respetan, el HTML no se interpreta. Lo acepta el solicitante en el paso final del wizard."
        />
        <TextareaField
          label="Consentimiento de datos personales (Ley 25.326)"
          field={field("privacyConsentText")}
          rows={10}
          maxLength={20000}
          hint="Texto plano. Se muestra junto al tilde de consentimiento antes de enviar la solicitud."
        />
        <TextField
          label="Id del plan de MP — SOCIO ACTIVO"
          field={field("mpPlanActiveId")}
          maxLength={64}
          placeholder="2c93808491…"
          hint="Opcional. Los montos salen de la tabla de valores de cuota, no de acá: el alta web, el ajuste por recategorización y el lote de actualización leen de ahí. Cargado, la conciliación diaria avisa si el plan de MP quedó con otro monto. Se obtiene del panel de MP."
        />
        <TextField
          label="Id del plan de MP — SOCIO ADHERENTE/COLABORADOR"
          field={field("mpPlanSharedId")}
          maxLength={64}
          placeholder="2c93808491…"
          hint="Opcional, igual que el anterior; es el plan compartido por las dos categorías."
        />
      </Section>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
