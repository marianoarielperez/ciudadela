"use client";
// Paso 4 del wizard ASOCIATE: documentación (docs/05 §2, REG-03).
//
// Criterio de la pantalla: es una lista de RANURAS, no tres campos de archivo.
// Cada ranura es una cosa física que el vecino tiene en la mano —el frente del
// DNI, el dorso, el comprobante— y lleva su estado a la izquierda: un anillo
// vacío mientras falta, un tilde macizo cuando entró. Al quedar subida, la
// ranura se PLIEGA a una línea. Lo que sigue ocupando pantalla es exactamente
// lo que falta, que es la única pregunta que hay que poder contestar de un
// vistazo en un celular, con el trámite a medio hacer y el DNI en la otra mano.
//
// REGLA DE ESTADO DE ESTA PANTALLA (no volver atrás, se pagó caro):
//
//   Cada ranura tiene su PROPIO estado de envío —su `useActionState`, o sea su
//   respuesta, su `pending` y su `formAction`— y ninguna sabe nada de las otras.
//
// Hasta el 21/08/2026 las tres ranuras compartían UN `useActionState` en el
// wizard más un puntero `activeSlot` que se marcaba en el `onClick` del botón
// para adivinar de quién era la respuesta. Eso no era frágil: estaba roto
// siempre. React flushea el update de un evento discreto de forma SÍNCRONA
// dentro del despacho del clic, o sea entre el `onClick` y la activation
// behavior del `<button type="submit">`; en ese render el puntero ya apuntaba a
// la ranura nueva y `pending` seguía en `false` (la action ni había arrancado),
// así que la ranura se comía como propia la respuesta ajena —o el `{}` inicial
// de `useActionState`, también truthy—, apagaba `hasFile`, y el navegador
// encontraba el botón `disabled` y NO disparaba el submit. Se perdía el primer
// clic de toda ranura y todo clic que movía el puntero: 11 de 12 subidas en
// producción, en silencio y sin un solo request.
//
// Con un estado por ranura ese error deja de ser posible por construcción: la
// respuesta de una ranura sólo puede cambiar cuando SU action termina, nunca en
// medio de un clic. Un clic no toca ningún estado, así que no puede apagar nada.
//
// Lo único que sube de una ranura al paso es QUÉ documento entró (`onUploaded`),
// porque de eso depende habilitar "Continuar" — y esa lista vive todavía más
// arriba, en el wizard, para que ir al paso 5 y volver no la borre.
import { CheckIcon } from "lucide-react";
import { useActionState, useId, useState } from "react";
import type { DocumentType, MemberCategory } from "@/generated/prisma/client";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MAX_ANNEXES, requiredDocsComplete } from "@/lib/applications/documents-rules";
import { cn } from "@/lib/utils";
import { uploadDocumentAction } from "./actions";
import { CONTROL_HEIGHT, FOCUS_RING, type UploadState } from "./wizard-shared";
import { NavButtons } from "./wizard-ui";

// Los mismos cuatro formatos que sniffea `documentStore` por magic bytes. El
// `accept` es una comodidad del selector, no un control: el que decide es el
// server (una extensión se renombra en dos segundos).
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export function StepDocuments({
  resumeToken,
  category,
  uploaded,
  onUploaded,
  onNext,
}: {
  resumeToken: string;
  category: MemberCategory;
  uploaded: DocumentType[];
  onUploaded: (type: DocumentType) => void;
  onNext: () => void;
}) {
  // Lo ÚNICO que el paso sabe del conjunto de ranuras: cuántas subidas hay en
  // vuelo. No es el estado de ninguna —no dice cuál ni con qué resultado—, es un
  // contador, y sólo existe para no dejar "Continuar" encendido mientras un
  // archivo viaja.
  const [inFlight, setInFlight] = useState(0);

  // El único camino de una ranura al resto de la pantalla. La ranura corre ESTO
  // dentro de su propio `useActionState`, así que la respuesta que vuelve es
  // suya y de nadie más.
  async function upload(formData: FormData): Promise<UploadState> {
    setInFlight((n) => n + 1);
    try {
      const result = await uploadDocumentAction({}, formData);
      if (result.uploaded) onUploaded(result.uploaded.type as DocumentType);
      return result;
    } finally {
      setInFlight((n) => n - 1);
    }
  }

  const annexes = uploaded.filter((t) => t === "annex").length;
  const complete = requiredDocsComplete(
    uploaded.map((type) => ({ type })),
    category,
  );
  const needsAnnex = category === "collaborator";

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Sacá las fotos con el documento apoyado y bien iluminado, o subí el archivo si ya lo tenés
        escaneado. Un archivo por vez, hasta 10 MB, en JPG, PNG, WebP o PDF.
      </p>

      <ul className="mt-5 space-y-3">
        {/* Sin `capture="environment"` en ninguna ranura, tampoco en las del DNI
            (decisión posterior al brief, que sí lo pedía): en iOS Safari
            `capture` no es una sugerencia sino una RESTRICCIÓN —fuerza la cámara
            y esconde la galería—, y el vecino que ya tiene la foto o el escaneo
            del DNI en el celular, que es el caso más común, se queda sin camino.
            El `accept` solo ya ofrece "Sacar foto" en el selector nativo, así que
            no se pierde nada. No reponerlo. */}
        <DocumentSlot
          resumeToken={resumeToken}
          docType="dni_front"
          upload={upload}
          title="Frente del DNI"
          hint="La cara con tu foto y tu número de documento."
          done={uploaded.includes("dni_front")}
        />
        <DocumentSlot
          resumeToken={resumeToken}
          docType="dni_back"
          upload={upload}
          title="Dorso del DNI"
          hint="La cara de atrás, con el domicilio y el código de barras."
          done={uploaded.includes("dni_back")}
        />
        <DocumentSlot
          resumeToken={resumeToken}
          docType="annex"
          upload={upload}
          title={needsAnnex ? "Comprobante de vinculación con el barrio" : "Otros documentos"}
          hint={
            needsAnnex
              ? "Escritura o boleta de un inmueble en el barrio, una factura de servicios a tu nombre, o algo que acredite tu comercio o actividad en la zona."
              : "Opcional. Si querés sumar algo a tu solicitud, este es el lugar."
          }
          optional={!needsAnnex}
          done={annexes > 0}
          doneLabel={annexes === 1 ? "1 archivo" : `${annexes} archivos`}
          full={annexes >= MAX_ANNEXES}
          fullLabel={`Llegaste a los ${MAX_ANNEXES} archivos permitidos.`}
          reopenLabel={annexes > 0 ? "Agregar otro" : undefined}
        />
      </ul>

      {!complete.ok && (
        // Ayuda estática, no respuesta a una acción: `neutral` no anuncia nada
        // y el estado real ya está en cada ranura. Existe para que el botón
        // apagado no sea un misterio.
        <FormMessage kind="neutral" className="mt-5">
          {complete.error}
        </FormMessage>
      )}

      <NavButtons onNext={onNext} nextDisabled={!complete.ok || inFlight > 0} />

      <p className="mt-6 text-sm text-muted-foreground">
        Podés cerrar esta página y seguir después: te mandamos por email el enlace para retomar la
        solicitud donde la dejaste.
      </p>
    </div>
  );
}

function DocumentSlot({
  resumeToken,
  docType,
  title,
  hint,
  done,
  doneLabel = "Listo",
  optional,
  full,
  fullLabel,
  reopenLabel = "Cambiar",
  upload,
}: {
  resumeToken: string;
  docType: DocumentType;
  title: string;
  hint: string;
  done: boolean;
  doneLabel?: string;
  optional?: boolean;
  full?: boolean;
  fullLabel?: string;
  reopenLabel?: string;
  upload: (formData: FormData) => Promise<UploadState>;
}) {
  const inputId = useId();
  // Plegada al estar completa: el vecino la vuelve a abrir si quiere cambiarla.
  const [open, setOpen] = useState(false);
  const [hasFile, setHasFile] = useState(false);

  // El estado de envío de ESTA ranura y de ninguna otra (ver el comentario de
  // arriba). `response` sólo puede cambiar cuando la subida de esta ranura
  // termina: ni un clic, ni lo que pase en otra ranura, ni un re-render lo
  // mueven.
  const [response, formAction, busy] = useActionState<UploadState, FormData>(
    (_prev, formData) => upload(formData),
    {},
  );

  // Ajuste de estado en el render (el patrón de "You Might Not Need an Effect",
  // el mismo `dismissed` del wizard): la respuesta se reconoce por IDENTIDAD,
  // no por ser truthy —`useActionState` devuelve un objeto nuevo por respuesta,
  // y el `{}` inicial es el que arranca en `seenResponse`, así que un render
  // cualquiera no dispara nada—.
  //
  //   - `hasFile` se apaga SIEMPRE, salga bien o mal: React 19 vacía el `<form>`
  //     después de correr la action, así que el archivo elegido ya no está.
  //     Verificado en el smoke — sin esto, tras un rechazo por formato el botón
  //     quedaba encendido sobre un campo vacío y el siguiente clic sólo podía
  //     terminar en "Elegí un archivo".
  //   - Plegarla es sólo para la que entró: un rechazo tiene que dejar a la vista
  //     el campo y el motivo.
  const [seenResponse, setSeenResponse] = useState(response);
  if (response !== seenResponse) {
    setSeenResponse(response);
    setHasFile(false);
    if (response.uploaded) setOpen(false);
  }

  const error = response.error;
  const expanded = (!done && !full) || open;

  return (
    <li
      className={cn(
        "rounded-xl border-2 p-4 transition-colors",
        done ? "border-success/40 bg-success/5" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Decorativo: el estado también va en texto, a la derecha. */}
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2",
            done ? "border-success bg-success text-background" : "border-muted-foreground/40",
          )}
        >
          {done && <CheckIcon className="size-4" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{title}</span>
          {(expanded || !done) && (
            <span className="mt-1 block text-sm text-muted-foreground">{hint}</span>
          )}
        </span>
        <span
          className={cn(
            "shrink-0 text-xs font-semibold tracking-[0.08em] uppercase",
            done ? "text-success" : "text-muted-foreground",
          )}
        >
          {done ? doneLabel : optional ? "Opcional" : "Falta"}
        </span>
      </div>

      {expanded ? (
        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="resumeToken" value={resumeToken} />
          <input type="hidden" name="docType" value={docType} />
          <Label htmlFor={inputId} className="text-sm">
            {done ? "Elegí el archivo nuevo" : "Elegí el archivo"}
          </Label>
          <input
            id={inputId}
            name="file"
            type="file"
            accept={ACCEPT}
            onChange={(e) => setHasFile((e.target.files?.length ?? 0) > 0)}
            className={cn(
              "block w-full rounded-md border border-input p-2 text-base",
              "file:mr-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm",
              FOCUS_RING,
            )}
          />
          {error && <FormMessage kind="error">{error}</FormMessage>}
          <div className="flex flex-wrap gap-3">
            {/* Sin `onClick`: el clic NO toca estado. Lo único que apaga este
                botón es no haber elegido archivo o tener una subida en vuelo,
                y las dos cosas ya son ciertas ANTES del clic. */}
            <Button
              type="submit"
              // Sin archivo elegido el envío sólo puede terminar en un reto:
              // se apaga acá en vez de gastar un viaje al server.
              disabled={!hasFile || busy}
              className={cn(CONTROL_HEIGHT, "font-semibold sm:w-auto sm:px-6")}
            >
              {busy ? "Subiendo…" : "Subir"}
            </Button>
            {done && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                className={cn(CONTROL_HEIGHT, "sm:w-auto sm:px-5")}
              >
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="mt-3">
          {full && fullLabel && <p className="text-sm text-muted-foreground">{fullLabel}</p>}
          {!full && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setHasFile(false);
                setOpen(true);
              }}
              className={cn(CONTROL_HEIGHT, "sm:w-auto sm:px-5")}
            >
              {reopenLabel}
              <span className="sr-only"> {title.toLowerCase()}</span>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
