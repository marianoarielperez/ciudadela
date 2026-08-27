"use client";
// El formulario del MOSTRADOR: los mismos datos y los mismos documentos que
// carga el vecino en la web, tipeados por el operador con la persona enfrente.
//
// Se arma con los campos sincronizados del panel (`synced-fields`) y no con
// inputs crudos: React 19 resetea el `<form action>` cuando la server action
// termina, y con un `<select>` sin controlar eso le cambia al operador el
// estado civil que eligió cada vez que la action rechaza por otro campo. Es
// deuda conocida en cuatro formularios del panel; acá se nace bien.
//
// PRECARGA: a diferencia del wizard público —que no precarga nada salvo el
// email, porque el DNI no es autenticación y precargar le mostraría datos
// ajenos a quien tipeó un documento que no es suyo— acá SÍ se precarga la ficha
// entera. El operador ya está autenticado y ya puede ver esa ficha en el panel,
// así que no hay nada que revelar; lo que hay es una ficha vacía en el 90% de
// los casos y un mostrador con gente esperando.
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { StreetAutocomplete, type StreetOption } from "@/components/admin/street-autocomplete";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DOCUMENT_TYPE_LABELS } from "@/lib/applications/labels";
import {
  civilStatusOptions, NATIONALITY_OPTIONS, NEIGHBOURHOOD_OPTIONS,
} from "@/lib/members/card-options";
// Las reglas PURAS del re-empadronamiento: se pueden importar desde un
// componente de cliente sin arrastrar el cliente de Prisma al bundle.
import {
  documentSlotFill, PRESENTATION_MAX_ANNEXES,
} from "@/lib/reregistration/presentation-rules";
import type { DocumentType } from "@/generated/prisma/client";
import {
  registerInPersonAction, uploadInPersonDocumentAction,
  type InPersonState, type InPersonUploadState,
} from "./actions";

export type InPersonDraft = {
  birthDate: string;
  civilStatus: string;
  nationality: string;
  occupation: string;
  streetNumber: string;
  neighborhood: string;
  phone: string;
  email: string;
};

export function InPersonForm(props: {
  processId: number;
  memberId: number;
  presentationId: number;
  memberName: string;
  draft: InPersonDraft;
  streets: StreetOption[];
  defaultStreetId: number | null;
  defaultStreetText: string | null;
  /** Cuántos documentos de cada tipo ya están cargados. */
  uploaded: { dni_front: number; dni_back: number; annex: number };
}) {
  const [state, formAction, pending] = useActionState<InPersonState, FormData>(
    registerInPersonAction,
    {},
  );
  const { field, formRef } = useSyncedForm(props.draft);

  return (
    <div className="space-y-6">
      <section aria-labelledby="documentos-title" className="space-y-3">
        <h2 id="documentos-title" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Documentos
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          El frente y el dorso del DNI son obligatorios, igual que en la web: son lo que después le
          permite a quien revise comprobar que la persona es quien dice ser. Los anexos (factura de
          servicios a nombre del socio o certificado policial, Art. 5.3) son opcionales.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <DocumentSlot
            presentationId={props.presentationId}
            docType="dni_front"
            uploaded={props.uploaded.dni_front}
          />
          <DocumentSlot
            presentationId={props.presentationId}
            docType="dni_back"
            uploaded={props.uploaded.dni_back}
          />
          <DocumentSlot
            presentationId={props.presentationId}
            docType="annex"
            uploaded={props.uploaded.annex}
          />
        </div>
      </section>

      <form ref={formRef} action={formAction} className="space-y-4">
        <h2 className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Datos declarados
        </h2>
        <input type="hidden" name="processId" value={props.processId} />
        <input type="hidden" name="memberId" value={props.memberId} />

        <p className="max-w-3xl text-sm text-muted-foreground">
          El nombre no se carga acá: es el ancla de identidad de la ficha y sólo se corrige desde el
          modo carga, con el documento a la vista.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Fecha de nacimiento"
            field={field("birthDate")}
            type="date"
            // Sin el ícono del calendario: en Chrome es una parada de tabulación
            // extra dentro del campo (mismo criterio que el modo carga).
            className="[&::-webkit-calendar-picker-indicator]:hidden"
          />
          <SelectField
            label="Estado civil"
            field={field("civilStatus")}
            options={civilStatusOptions(props.draft.civilStatus || null)}
          />
          <TextField
            label="Nacionalidad"
            field={field("nationality")}
            maxLength={60}
            options={[...NATIONALITY_OPTIONS]}
          />
          <TextField label="Ocupación" field={field("occupation")} maxLength={80} />
          <StreetAutocomplete
            streets={props.streets}
            defaultStreetId={props.defaultStreetId}
            defaultStreetText={props.defaultStreetText}
          />
          <TextField label="Altura" field={field("streetNumber")} inputMode="numeric" maxLength={10} />
          <TextField
            label="Barrio"
            field={field("neighborhood")}
            maxLength={60}
            options={[...NEIGHBOURHOOD_OPTIONS]}
          />
          <TextField label="Teléfono" field={field("phone")} type="tel" inputMode="tel" maxLength={40} />
          <div className="sm:col-span-2">
            <TextField
              label="Email"
              field={field("email")}
              type="email"
              maxLength={191}
              hint="Obligatorio. Es el domicilio electrónico del socio (Art. 5° ter): por ahí le llega la constancia, cualquier observación y, llegado el caso, la baja. Leelo en voz alta antes de guardar."
            />
          </div>
        </div>

        {/* Sólo el rechazo se muestra acá: el registro exitoso NO vuelve a esta
            pantalla —termina en un redirect al buscador con el resultado en la
            URL—, porque al pasar a `submitted` esta ruta deja de renderizar el
            formulario y el mensaje se iría con él. */}
        {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
            {pending ? "Registrando…" : "Registrar presentación"}
          </Button>
          <FormMessage kind="neutral" as="span" role="none">
            Registrar no valida: la revisa otra persona desde la cola.
          </FormMessage>
        </div>
      </form>
    </div>
  );
}

/** Una ranura de documento. Formulario propio por tipo —y no un solo `<form>`
 *  con tres `<input type="file">`— porque cada archivo se guarda por separado y
 *  el operador escanea de a uno: con un envío único, un formato rechazado en el
 *  tercero le haría volver a elegir los tres.
 *
 *  REEMPLAZAR NO ES LO MISMO QUE LLENAR. Acá el campo se apagaba apenas entraba
 *  el frente del DNI, así que el operador que escaneaba el dorso movido —se da
 *  cuenta al ver la vista previa, con el vecino todavía enfrente— se quedaba
 *  sin salida: el server siempre soportó el reemplazo y hasta había una
 *  etiqueta "Reemplazar" que era código inalcanzable. La distinción la decide
 *  `documentSlotFill`, la misma función pura para las tres ranuras, y no un
 *  booleano escrito acá: sólo el anexo se llena. */
function DocumentSlot({ presentationId, docType, uploaded }: {
  presentationId: number;
  docType: DocumentType & ("dni_front" | "dni_back" | "annex");
  uploaded: number;
}) {
  const [state, formAction, pending] = useActionState<InPersonUploadState, FormData>(
    uploadInPersonDocumentAction,
    {},
  );
  const inputId = `file-${docType}`;
  const { full, replaces } = documentSlotFill({ type: docType, uploaded });
  const loaded = uploaded > 0;

  return (
    <form action={formAction} className="space-y-2 rounded-md border p-3">
      <input type="hidden" name="presentationId" value={presentationId} />
      <input type="hidden" name="docType" value={docType} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={inputId}>{DOCUMENT_TYPE_LABELS[docType]}</Label>
        <span className="text-xs text-muted-foreground">
          {uploaded === 0
            ? "sin cargar"
            : replaces
              ? "cargado"
              : `${uploaded} de ${PRESENTATION_MAX_ANNEXES} cargados`}
        </span>
      </div>
      <Input
        id={inputId}
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="min-h-11"
        disabled={full}
      />
      {/* El cartel del tope, sólo cuando de verdad hay uno: un control apagado
          sin explicación es el mismo callejón que había antes, con otra cara. */}
      {full && (
        <FormMessage kind="neutral" role="none">
          Ya hay {PRESENTATION_MAX_ANNEXES} anexos cargados, que es el máximo.
        </FormMessage>
      )}
      {/* Y la salida del escaneo fallado, dicha con todas las letras: el
          operador no tiene por qué adivinar que subir de nuevo pisa lo anterior. */}
      {loaded && replaces && (
        <FormMessage kind="neutral" role="none">
          Si salió mal, elegí otro archivo y reemplazalo: el anterior se borra.
        </FormMessage>
      )}
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.uploaded && <FormMessage kind="success" role="status">Archivo guardado.</FormMessage>}
      <Button type="submit" variant="outline" className="min-h-11" disabled={pending || full}>
        {pending ? "Subiendo…" : loaded && replaces ? "Reemplazar" : "Subir"}
      </Button>
    </form>
  );
}
