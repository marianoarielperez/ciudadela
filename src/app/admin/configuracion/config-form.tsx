"use client";
// Formulario de Configuración.
//
// El campo delicado es el switch del botón ASOCIATE: React 19 resetea el
// <form action> cuando la server action termina, y un checkbox destildado por
// ese reset no lo corrige React (ver el comentario largo de
// use-form-reset-sync.ts). Acá el daño sería del peor tipo: el superadmin cierra
// el alta de socios, la action rechaza por otro campo, el reset vuelve a
// mostrarlo abierto y él se va creyendo que lo cerró. Por eso el estado del
// switch vive en `useSyncedForm` bajo la misma clave que su `name`, con el
// "on"/"" que manda el navegador: el hook lo re-tilda después de cada render.
// El switch es un checkbox NATIVO con piel de switch: mismo name, mismo
// value="on", misma semántica de formulario que el checkbox que reemplaza.
import { useActionState } from "react";
import { Globe, Mail, UserPlus } from "lucide-react";

import { updateConfigAction } from "./actions";
import { useSyncedForm, TextField, TextareaField } from "@/components/admin/synced-fields";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { PanelHeader } from "@/components/admin/panel-header";

export type ConfigFormInitial = {
  asociateActivo: boolean;
  contactPhone: string;
  contactEmail: string;
  termsText: string;
  privacyConsentText: string;
  mpPlanActiveId: string;
  mpPlanSharedId: string;
  digestRecipients: string;
};

// Qué claves viven en qué pestaña, para que la barra diga DÓNDE quedaron los
// cambios sin guardar. Mismo orden que las pestañas.
const GROUPS: Array<{ label: string; keys: Array<keyof ConfigFormInitial & string> }> = [
  { label: "Sitio público", keys: ["asociateActivo", "contactPhone", "contactEmail"] },
  { label: "ASOCIATE", keys: ["termsText", "privacyConsentText", "mpPlanActiveId", "mpPlanSharedId"] },
  { label: "Avisos", keys: ["digestRecipients"] },
];

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

function AsociateSwitch({ checked, onChange }: {
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor="asociateActivo" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium select-none">
        <input
          id="asociateActivo"
          type="checkbox"
          role="switch"
          name="asociateActivo"
          value="on"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="relative inline-flex h-6 w-10 shrink-0 rounded-full bg-muted ring-1 ring-inset ring-border transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-background after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
        />
        Botón ASOCIATE habilitado en el sitio público
      </label>
      <p className="text-xs text-muted-foreground">
        Apagado, el sitio muestra el aviso de asociaciones suspendidas. Se prende recién con el
        wizard del Módulo 3 funcionando.
      </p>
    </div>
  );
}

export function ConfigForm({ initial }: { initial: ConfigFormInitial }) {
  const [state, formAction, pending] = useActionState(updateConfigAction, {});
  const initialValues = {
    asociateActivo: initial.asociateActivo ? "on" : "",
    contactPhone: initial.contactPhone,
    contactEmail: initial.contactEmail,
    termsText: initial.termsText,
    privacyConsentText: initial.privacyConsentText,
    mpPlanActiveId: initial.mpPlanActiveId,
    mpPlanSharedId: initial.mpPlanSharedId,
    digestRecipients: initial.digestRecipients,
  };
  const { values, setValue, formRef, field } = useSyncedForm(initialValues);
  // El sucio se deriva de TODAS las claves y no de GROUPS: GROUPS sólo le pone
  // nombre a las pestañas, así que una novena clave que alguien olvide agregar
  // ahí igual levanta la barra — si no, quedaría sin botón para guardarse.
  // Y compara TRIMEADO de los dos lados porque `parseForm` trima antes de
  // validar: el servidor guarda `value.trim()`, así que un pegado con espacios
  // al final dejaría la barra prendida para siempre (ni re-guardando se apaga).
  const configKeys = Object.keys(initialValues) as Array<keyof ConfigFormInitial & string>;
  const isDirtyKey = (k: keyof ConfigFormInitial & string) =>
    values[k].trim() !== initialValues[k].trim();
  const dirty = configKeys.some(isDirtyKey);
  const dirtyGroups = GROUPS.filter((g) => g.keys.some(isDirtyKey)).map((g) => g.label);

  return (
    <form ref={formRef} action={formAction} className="max-w-2xl">
      <TabsContent value="sitio" forceMount className="space-y-4 pt-2 data-[state=inactive]:hidden">
        <PanelHeader
          icon={Globe}
          title="Sitio público"
          description="Lo que ve el vecino: el botón de alta y los datos de contacto."
        />
        <Card>
          <CardContent className="space-y-4">
            <AsociateSwitch
              checked={values.asociateActivo === "on"}
              onChange={(on) => setValue("asociateActivo", on ? "on" : "")}
            />
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
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="asociate" forceMount className="space-y-4 pt-2 data-[state=inactive]:hidden">
        <PanelHeader
          icon={UserPlus}
          title="ASOCIATE"
          description="Los textos legales del wizard de alta y los planes de referencia de Mercado Pago."
        />
        <Card>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
      </TabsContent>
      {/* Tercer bloque, y el primero que NO mira al sitio público: acá se
          configura a quién le habla el sistema puertas adentro. El título lo
          dice para que nadie busque estos destinatarios entre los datos de
          contacto que ve el vecino. */}
      <TabsContent value="avisos" forceMount className="space-y-4 pt-2 data-[state=inactive]:hidden">
        <PanelHeader
          icon={Mail}
          title="Avisos internos"
          description="A quién le habla el sistema puertas adentro."
        />
        <Card>
          <CardContent className="space-y-4">
            <TextField
              label="Destinatarios del resumen diario"
              field={field("digestRecipients")}
              maxLength={500}
              placeholder="comision@vecinalciudadela.ar, tesoreria@vecinalciudadela.ar"
              hint="Direcciones separadas por comas. Reciben todas las mañanas las novedades del día anterior: pagos, altas, cobros sin conciliar, avisos que no salieron y tareas automáticas con problemas. Un día sin novedades no genera correo. Vacío, el resumen no se envía a nadie."
            />
          </CardContent>
        </Card>
      </TabsContent>
      {/* La barra vive DENTRO del form (el submit no necesita form=) y es
          `fixed`: sigue visible aunque el operador esté mirando Tesorería o
          Feriados con cambios pendientes en las pestañas del form. Tras el
          redirect exitoso la página re-renderiza con valores frescos y la
          barra desaparece sola. z-40: debajo de los diálogos (z-50).
          Se muestra por `dirty` SOLO: el estado de `useActionState` sobrevive al
          redirect exitoso, así que colgarla también del error dejaba reaparecer
          el error viejo —abajo del cartel de guardado— tras fallar, corregir y
          guardar bien. El error se sigue leyendo DENTRO de la barra. */}
      {dirty && (
        <>
          <div aria-hidden className="h-24" />
          <div className="fixed inset-x-4 bottom-4 z-40 sm:left-1/2 sm:right-auto sm:w-full sm:max-w-xl sm:-translate-x-1/2">
            <div className="space-y-2 rounded-xl bg-card p-3 shadow-lg ring-1 ring-foreground/10">
              {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {dirtyGroups.length > 0 ? (
                    <>
                      Tenés cambios sin guardar en{" "}
                      <span className="font-medium text-foreground">{listNames(dirtyGroups)}</span>.
                    </>
                  ) : (
                    "Tenés cambios sin guardar."
                  )}
                </p>
                <Button type="submit" disabled={pending}>
                  {pending ? "Guardando…" : "Guardar"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
