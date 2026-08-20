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
// La subida va de a UN archivo: cada ranura es su propio `<form>` y todos
// postean a la MISMA action (el estado vive en el wizard, ver el comentario de
// `asociate-wizard.tsx`). Por eso hace falta saber qué ranura fue la última en
// enviar —`activeSlot`, que se marca en el clic del botón, un evento del
// usuario— para colgarle a ESA el "Subiendo…" y el error, y no a las tres.
import { CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import type { DocumentType, MemberCategory } from "@/generated/prisma/client";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MAX_ANNEXES, requiredDocsComplete } from "@/lib/applications/documents-rules";
import { cn } from "@/lib/utils";
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
  state,
  formAction,
  pending,
  onNext,
}: {
  resumeToken: string;
  category: MemberCategory;
  uploaded: DocumentType[];
  state: UploadState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  onNext: () => void;
}) {
  const [activeSlot, setActiveSlot] = useState<DocumentType | null>(null);

  const annexes = uploaded.filter((t) => t === "annex").length;
  const complete = requiredDocsComplete(
    uploaded.map((type) => ({ type })),
    category,
  );
  const needsAnnex = category === "collaborator";

  // El error y el "Subiendo…" se le cuelgan a la ranura que envió, no a todas.
  const slotProps = (docType: DocumentType) => ({
    resumeToken,
    docType,
    formAction,
    onSubmit: () => setActiveSlot(docType),
    busy: pending && activeSlot === docType,
    // La respuesta del server que le corresponde a ESTA ranura, sea buena o
    // mala. `useActionState` devuelve un objeto nuevo por respuesta, así que la
    // ranura la reconoce comparando por identidad, sin ningún efecto.
    response: !pending && activeSlot === docType ? state : undefined,
  });

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Sacá las fotos con el documento apoyado y bien iluminado, o subí el archivo si ya lo tenés
        escaneado. Un archivo por vez, hasta 10 MB, en JPG, PNG, WebP o PDF.
      </p>

      <ul className="mt-5 space-y-3">
        <DocumentSlot
          {...slotProps("dni_front")}
          title="Frente del DNI"
          hint="La cara con tu foto y tu número de documento."
          camera
          done={uploaded.includes("dni_front")}
        />
        <DocumentSlot
          {...slotProps("dni_back")}
          title="Dorso del DNI"
          hint="La cara de atrás, con el domicilio y el código de barras."
          camera
          done={uploaded.includes("dni_back")}
        />
        <DocumentSlot
          {...slotProps("annex")}
          title={needsAnnex ? "Comprobante de vinculación con el barrio" : "Otros documentos"}
          hint={
            needsAnnex
              ? "Escritura o boleta de un inmueble en el barrio, una factura de servicios a tu nombre, o algo que acredite tu comercio o actividad en la zona."
              : "Opcional. Si querés sumar algo a tu solicitud, este es el lugar."
          }
          optional={!needsAnnex}
          // Sin `capture`: el anexo casi siempre es un archivo que ya existe
          // (una boleta en PDF, una foto vieja), no algo que se saca en el
          // momento, y forzar la cámara esconde la galería en iOS.
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

      <NavButtons onNext={onNext} nextDisabled={!complete.ok || pending} />

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
  camera,
  full,
  fullLabel,
  reopenLabel = "Cambiar",
  formAction,
  onSubmit,
  busy,
  response,
}: {
  resumeToken: string;
  docType: DocumentType;
  title: string;
  hint: string;
  done: boolean;
  doneLabel?: string;
  optional?: boolean;
  camera?: boolean;
  full?: boolean;
  fullLabel?: string;
  reopenLabel?: string;
  formAction: (formData: FormData) => void;
  onSubmit: () => void;
  busy: boolean;
  response?: UploadState;
}) {
  const inputId = useId();
  // Plegada al estar completa: el vecino la vuelve a abrir si quiere cambiarla.
  const [open, setOpen] = useState(false);
  const [hasFile, setHasFile] = useState(false);

  // Ajuste de estado en el render (el patrón de "You Might Not Need an Effect",
  // el mismo `dismissed` del wizard): cada respuesta que le toca a esta ranura
  // reacomoda el formulario.
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
    if (response) {
      setHasFile(false);
      if (response.uploaded) setOpen(false);
    }
  }

  const error = response?.error;
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
            // Hint para el celular: abre la cámara trasera en vez del selector.
            capture={camera ? "environment" : undefined}
            onChange={(e) => setHasFile((e.target.files?.length ?? 0) > 0)}
            className={cn(
              "block w-full rounded-md border border-input p-2 text-base",
              "file:mr-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm",
              FOCUS_RING,
            )}
          />
          {error && <FormMessage kind="error">{error}</FormMessage>}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              onClick={onSubmit}
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
