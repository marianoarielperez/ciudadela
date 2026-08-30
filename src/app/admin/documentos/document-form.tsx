"use client";
// Formulario único de alta y edición de documentos institucionales, con el
// molde de `noticias/news-form.tsx`: un solo componente para los dos modos, el
// estado en `useSyncedForm` y el borrado en su propio form con `window.confirm`.
import { useActionState } from "react";
import { createDocumentAction, deleteDocumentAction, updateDocumentAction } from "./actions";
import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
// rules.ts es puro (sin node:), importable desde un client component.
import { DOCUMENT_TYPE_LABELS, requiresYear } from "@/lib/institutional-documents/rules";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type DocType = "norm" | "annual_report" | "balance" | "other";

export type EditableDocument = {
  id: number;
  type: DocType;
  title: string;
  description: string | null;
  year: number | null;
  featured: boolean;
  fileName: string;
};

const TYPE_OPTIONS: Array<{ value: DocType; label: string }> = [
  { value: "norm", label: "Norma (estatuto, reglamento)" },
  { value: "annual_report", label: "Memoria" },
  { value: "balance", label: "Balance" },
  { value: "other", label: "Otro documento" },
];

export function DocumentForm(
  props: { mode: "create"; initialType: DocType } | { mode: "edit"; doc: EditableDocument },
) {
  const editing = props.mode === "edit" ? props.doc : null;
  const [state, formAction, pending] = useActionState(
    editing ? updateDocumentAction : createDocumentAction, {},
  );
  // El select y el checkbox entran al estado sincronizado: sin esto, el reset
  // de React 19 tras un rechazo los volvería al valor inicial en silencio.
  const { values, setValue, formRef, field } = useSyncedForm({
    type: editing?.type ?? (props.mode === "create" ? props.initialType : "norm"),
    title: editing?.title ?? "",
    description: editing?.description ?? "",
    year: editing?.year ? String(editing.year) : "",
    featured: editing?.featured ? "on" : "",
  });
  const type = values.type as DocType;
  const yearRequired = requiresYear(type);

  return (
    <form ref={formRef} action={formAction} className="max-w-2xl space-y-4">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      {editing ? (
        // El tipo es inmutable en edición (la action lo ignora): se muestra y
        // viaja igual para que el schema no falle por campo requerido ausente.
        <div className="space-y-1">
          <Label>Tipo</Label>
          <p className="text-sm">{DOCUMENT_TYPE_LABELS[editing.type]}</p>
          <input type="hidden" name="type" value={editing.type} />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="type">Tipo</Label>
          {/* El `id` lo pone `field("type")` (vale "type", el mismo al que
              apunta el <label>): repetirlo acá lo duplicaría en las props. */}
          <select {...field("type")} className={SELECT_CLASS}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
      {yearRequired ? (
        <>
          <TextField
            label="Año (ejercicio)"
            field={field("year", (raw) => raw.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
            hint={`El título se arma solo: "${DOCUMENT_TYPE_LABELS[type]} ${values.year || "AAAA"}". Un solo documento por año; para reemplazarlo, editá el existente.`}
          />
        </>
      ) : (
        <>
          <TextField label="Título" field={field("title")} maxLength={160} autoFocus={!editing} />
          <TextField
            label="Año (opcional)"
            field={field("year", (raw) => raw.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
          />
        </>
      )}
      <TextField
        label="Descripción (opcional)"
        field={field("description")}
        maxLength={200}
        hint="Una línea que el socio ve bajo el título, por ejemplo la asamblea que lo aprobó."
      />
      {type === "norm" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="featured"
            value="on"
            checked={values.featured === "on"}
            onChange={(e) => setValue("featured", e.target.checked ? "on" : "")}
          />
          Marcar como norma vigente (va destacada arriba en el panel del socio; desmarca la anterior)
        </label>
      )}
      <div className="space-y-1">
        <Label htmlFor="file">
          {editing ? "Reemplazar el PDF (opcional, máx. 10 MB)" : "Archivo PDF (máx. 10 MB)"}
        </Label>
        <input
          id="file" name="file" type="file" accept="application/pdf"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5"
        />
        {editing && (
          <p className="text-xs text-muted-foreground">
            Si no subís nada, queda el archivo actual.{" "}
            <a
              className="text-primary hover:underline"
              href={`/api/admin/documentos/${editing.id}`}
              target="_blank"
              rel="noopener"
            >
              Ver el PDF actual
            </a>
          </p>
        )}
      </div>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : editing ? "Guardar cambios" : "Publicar documento"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteDocumentButton({ doc }: { doc: EditableDocument }) {
  const [state, del, pending] = useActionState(deleteDocumentAction, {});
  return (
    <div className="space-y-2">
      <form
        action={del}
        onSubmit={(e) => {
          if (
            !window.confirm(
              "¿Eliminar este documento? Los socios dejan de verlo y el archivo se borra. Esta acción no se puede deshacer.",
            )
          )
            e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={doc.id} />
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Eliminando…" : "Eliminar"}
        </Button>
      </form>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
    </div>
  );
}
