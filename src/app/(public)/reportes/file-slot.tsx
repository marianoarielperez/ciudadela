"use client";
// Una ranura de archivo del wizard de Reportes. REGLA (pagada cara en ASOCIATE,
// ver el comentario largo de `step-documents.tsx`): cada ranura tiene su PROPIO
// `useActionState` de subida y otro de quitado, y ninguna sabe de las otras. Un
// clic NO toca estado —el puntero compartido que lo hacía se comía 11 de cada 12
// subidas en producción, en silencio y sin un solo request—. Lo único que sube
// al paso es `onUploaded`/`onRemoved` (para la lista) y `onBusy` (para apagar
// "Continuar" mientras un archivo viaja).
//
// La vista previa es un `URL.createObjectURL` del archivo elegido (la CSP ya
// admite `blob:`), y se revoca al desmontar o al cambiar.
import { CheckIcon, X } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { REPORT_MESSAGES } from "@/lib/reports/rules";
import { cn } from "@/lib/utils";
import { removeReportFileAction, uploadReportFileAction } from "./actions";
import {
  CONTROL_HEIGHT,
  FOCUS_RING,
  type FileKindSlug,
  type RemoveState,
  type UploadState,
  type UploadedFile,
} from "./wizard-shared";

// Sólo imágenes: el store re-codifica con sharp y pdf-lib no embebe PDF. El
// `accept` es comodidad del selector, no un control: el que decide es el server.
const ACCEPT = "image/jpeg,image/png,image/webp";

export function FileSlot({
  claim,
  kind,
  title,
  hint,
  existing,
  optional,
  onUploaded,
  onRemoved,
  onBusy,
}: {
  claim: string;
  kind: FileKindSlug;
  title: string;
  hint: string;
  /** El archivo ya subido en esta ranura, si lo hay. */
  existing: UploadedFile | null;
  optional?: boolean;
  onUploaded: (file: UploadedFile) => void;
  onRemoved: (fileId: number) => void;
  onBusy: (delta: 1 | -1) => void;
}) {
  const inputId = useId();
  const [hasFile, setHasFile] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const [uploadState, uploadAction, uploading] = useActionState<UploadState, FormData>(
    async (_prev, fd) => {
      onBusy(1);
      try {
        const r = await uploadReportFileAction({}, fd);
        if (r.uploaded) onUploaded(r.uploaded);
        return r;
      } finally {
        onBusy(-1);
      }
    },
    {},
  );
  const [removeState, removeAction, removing] = useActionState<RemoveState, FormData>(
    async (_prev, fd) => {
      onBusy(1);
      try {
        const r = await removeReportFileAction({}, fd);
        // La ausencia CONFIRMADA por el server cuenta como quitado: el archivo
        // ya no está, que es exactamente lo que el vecino pidió. Si sólo se
        // mirara `r.removed`, la lista del paso seguiría mostrando una fila que
        // en la base no existe y la ranura quedaría trabada en "Listo".
        if (existing && (r.removed || r.error === REPORT_MESSAGES.fileGone)) onRemoved(existing.id);
        return r;
      } finally {
        onBusy(-1);
      }
    },
    {},
  );

  // Ajuste en el render (no en efecto): React 19 vacía el <form> después de la
  // action, así que el archivo elegido ya no está, salga bien o mal. La
  // respuesta se reconoce por IDENTIDAD, no por ser truthy. La vista previa se
  // limpia en TODA respuesta —también en el error—: el <input> ya quedó vacío,
  // así que una miniatura sobreviviente muestra un archivo que ya no se puede
  // subir. Revocar acá no hace falta: la limpieza del efecto `[preview]` revoca
  // la URL anterior cuando `preview` cambia.
  const [seen, setSeen] = useState(uploadState);
  if (uploadState !== seen) {
    setSeen(uploadState);
    setHasFile(false);
    setPreview(null);
  }

  const done = existing !== null;
  // `fileGone` NO se muestra: es la ausencia confirmada por el server, que unas
  // líneas más arriba se trata como quitado y deja la ranura vacía. Pintarlo en
  // rojo contradiría lo que la pantalla acaba de hacer bien — el vecino pidió
  // sacar el archivo y el archivo no está.
  const removeError = removeState.error === REPORT_MESSAGES.fileGone ? undefined : removeState.error;
  const error = uploadState.error ?? removeError;

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
          {!done && <span className="mt-1 block text-sm text-muted-foreground">{hint}</span>}
        </span>
        <span
          className={cn(
            "shrink-0 text-xs font-semibold tracking-[0.08em] uppercase",
            done ? "text-success" : "text-muted-foreground",
          )}
        >
          {done ? "Listo" : optional ? "Opcional" : "Falta"}
        </span>
      </div>

      {done ? (
        <form action={removeAction} className="mt-3 flex items-center gap-3">
          <input type="hidden" name="claim" value={claim} />
          <input type="hidden" name="fileId" value={existing.id} />
          <Button
            type="submit"
            variant="outline"
            disabled={removing}
            className={cn(CONTROL_HEIGHT, "sm:w-auto sm:px-5")}
          >
            <X aria-hidden className="size-4" />
            {removing ? "Quitando…" : kind === "photo" ? "Quitar" : "Cambiar"}
            <span className="sr-only"> {title.toLowerCase()}</span>
          </Button>
        </form>
      ) : (
        <form action={uploadAction} className="mt-4 space-y-3">
          <input type="hidden" name="claim" value={claim} />
          <input type="hidden" name="kind" value={kind} />
          <Label htmlFor={inputId} className="text-sm">
            Elegí la foto
          </Label>
          {/* Sin `capture`: en iOS no es una sugerencia sino una RESTRICCIÓN —
              fuerza la cámara y esconde la galería—, y el vecino que ya tiene la
              foto en el celular se queda sin camino. No reponerlo. */}
          <input
            id={inputId}
            name="file"
            type="file"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setHasFile(f !== null);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
            className={cn(
              "block w-full rounded-md border border-input p-2 text-base",
              "file:mr-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm",
              FOCUS_RING,
            )}
          />
          {preview && (
            // Una vista previa `blob:` no puede pasar por `next/image`: no hay
            // qué optimizar y el loader la rechaza.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="max-h-40 rounded-lg object-cover" />
          )}
          {/* Sin `onClick`: el clic NO toca estado. Lo único que apaga este botón
              es no haber elegido archivo o tener una subida en vuelo, y las dos
              cosas ya son ciertas ANTES del clic. */}
          <Button
            type="submit"
            disabled={!hasFile || uploading}
            className={cn(CONTROL_HEIGHT, "font-semibold sm:w-auto sm:px-6")}
          >
            {uploading ? "Subiendo…" : "Subir"}
          </Button>
        </form>
      )}
      {error && (
        <FormMessage kind="error" className="mt-2">
          {error}
        </FormMessage>
      )}
    </li>
  );
}
