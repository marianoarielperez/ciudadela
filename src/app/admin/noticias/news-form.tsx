"use client";
import Image from "next/image";
import { useActionState } from "react";
import { createNewsAction, deleteNewsAction, publishNewsAction, unpublishNewsAction, updateNewsAction } from "./actions";
import { NewsEditor } from "@/components/admin/news-editor";
import { useSyncedForm, TextField } from "@/components/admin/synced-fields";
// image-url, NO images: este es un client component y images.ts importa node:fs.
import { newsImageUrl } from "@/lib/news/image-url";
// slugify es puro (sin node:*), así que se puede importar acá.
import { slugify } from "@/lib/news/slug";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type EditableNews = {
  id: number; title: string; slug: string; body: string;
  coverImagePath: string | null; status: "draft" | "published";
};

export function NewsForm(props: { mode: "create" } | { mode: "edit"; news: EditableNews }) {
  const editing = props.mode === "edit" ? props.news : null;
  const [state, formAction, pending] = useActionState(
    editing ? updateNewsAction : createNewsAction, {},
  );
  const { values, formRef, field } = useSyncedForm({
    title: editing?.title ?? "",
    slug: editing?.slug ?? "",
  });

  // Misma regla que `slugFor` en actions.ts: si el campo URL está vacío el
  // servidor deriva el slug del título; si no, usa lo tipeado TAL CUAL. El
  // preview lo dice en voz alta para que un slug degenerado (`---`, que el
  // regex del schema acepta) se vea antes de guardar, no después.
  // Con el formulario todavía vacío no hay nada que previsualizar: `slugify("")`
  // devuelve su fallback "noticia" y mostrarlo de arranque sería ruido.
  const slugPreview =
    values.slug !== "" ? values.slug : values.title !== "" ? slugify(values.title) : null;

  return (
    <form ref={formRef} action={formAction} className="max-w-2xl space-y-4">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <TextField label="Título" field={field("title")} maxLength={160} autoFocus />
      <TextField
        label="URL (opcional)"
        field={field("slug", (raw) => raw.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
        maxLength={180}
        hint={
          <>
            Se genera sola desde el título si la dejás vacía. Cambiarla rompe el enlace anterior.
            {slugPreview !== null && (
              <>
                <br />
                Va a quedar: <code>/noticias/{slugPreview}</code>
              </>
            )}
          </>
        }
      />
      <div className="space-y-1">
        <Label htmlFor="cover">Imagen de portada (JPG, PNG o WebP, máx. 5 MB)</Label>
        <input
          id="cover" name="cover" type="file" accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5"
        />
        {editing?.coverImagePath && (
          <div className="flex items-center gap-3 pt-1">
            <Image src={newsImageUrl(editing.coverImagePath)} alt="Portada actual" width={120} height={80}
              className="h-20 w-auto rounded border object-cover" unoptimized />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="removeCover" /> Quitar la portada actual
            </label>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <Label>Contenido</Label>
        <NewsEditor name="body" initialHtml={editing?.body ?? ""} />
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear noticia"}
        </Button>
      </div>
    </form>
  );
}

// Botonera de estado: publicar / despublicar / eliminar. Forms separados
// porque cada action es un endpoint distinto.
export function NewsStateButtons({ news }: { news: EditableNews }) {
  const [pubState, publish, pubPending] = useActionState(publishNewsAction, {});
  const [unpubState, unpublish, unpubPending] = useActionState(unpublishNewsAction, {});
  const [delState, del, delPending] = useActionState(deleteNewsAction, {});
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {news.status === "draft" ? (
          <form action={publish}>
            <input type="hidden" name="id" value={news.id} />
            <Button type="submit" disabled={pubPending}>{pubPending ? "Publicando…" : "Publicar"}</Button>
          </form>
        ) : (
          <form action={unpublish}>
            <input type="hidden" name="id" value={news.id} />
            <Button type="submit" variant="secondary" disabled={unpubPending}>
              {unpubPending ? "Despublicando…" : "Volver a borrador"}
            </Button>
          </form>
        )}
        <form
          action={del}
          onSubmit={(e) => {
            if (!window.confirm("¿Eliminar esta noticia? Esta acción no se puede deshacer.")) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={news.id} />
          <Button type="submit" variant="destructive" disabled={delPending}>
            {delPending ? "Eliminando…" : "Eliminar"}
          </Button>
        </form>
      </div>
      {(pubState.error || unpubState.error || delState.error) && (
        <p role="alert" className="text-sm text-destructive">
          {pubState.error ?? unpubState.error ?? delState.error}
        </p>
      )}
    </div>
  );
}
