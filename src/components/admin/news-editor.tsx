"use client";
// Editor visual de noticias (Tiptap v3, alcance BÁSICO decidido en la
// entrevista: negrita, cursiva, subrayado, H2/H3, listas, links). El HTML
// viaja en un hidden input y se sanitiza SIEMPRE en el servidor: esta
// toolbar es UX, no seguridad.
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const BTN = "h-8 min-w-8 px-2 text-xs";

type ActiveMarks = {
  bold: boolean; italic: boolean; underline: boolean;
  h2: boolean; h3: boolean;
  bulletList: boolean; orderedList: boolean; link: boolean;
};

// Estado de la toolbar mientras el editor todavía no existe (primer render en
// App Router, ver `immediatelyRender: false`).
const NONE_ACTIVE: ActiveMarks = {
  bold: false, italic: false, underline: false,
  h2: false, h3: false, bulletList: false, orderedList: false, link: false,
};

export function NewsEditor({ name, initialHtml }: { name: string; initialHtml: string }) {
  const [html, setHtml] = useState(initialHtml);
  const editor = useEditor({
    // Requerido en App Router: sin esto Tiptap intenta renderizar en SSR y
    // rompe la hidratación.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Fuera lo que la allowlist del server no acepta:
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        // El tachado da <s>, que el sanitizador tira: sin desactivarlo el
        // operador puede tachar texto (Ctrl+Shift+S) y perder el formato en
        // silencio al guardar.
        strike: false,
      }),
    ],
    content: initialHtml,
    // El área editable de ProseMirror es un div contenteditable: sin nombre
    // accesible propio, un lector de pantalla lo anuncia como "edición" a
    // secas (el <Label>Contenido</Label> del formulario no lo alcanza porque
    // no hay `htmlFor` posible sobre un div sin id estable).
    editorProps: { attributes: { "aria-label": "Contenido de la noticia" } },
    onUpdate: ({ editor }) => setHtml(editor.getHTML()),
  });

  // En Tiptap v3 `shouldRerenderOnTransaction` viene en false y `onUpdate`
  // solo se dispara cuando cambia el DOCUMENTO. Si la toolbar leyera
  // `editor.isActive(...)` en el render, quedaría congelada ante todo lo que
  // no toca el documento: mover el cursor a una palabra en negrita no
  // encendería el botón B, y apretar B con el cursor colapsado (que solo
  // cambia marcas almacenadas, no el doc) no daría ningún feedback.
  // `useEditorState` se suscribe a cada transacción y re-renderiza solo
  // cuando alguno de estos booleanos cambia.
  const active = useEditorState({
    editor,
    selector: ({ editor }): ActiveMarks => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      underline: editor?.isActive("underline") ?? false,
      h2: editor?.isActive("heading", { level: 2 }) ?? false,
      h3: editor?.isActive("heading", { level: 3 }) ?? false,
      bulletList: editor?.isActive("bulletList") ?? false,
      orderedList: editor?.isActive("orderedList") ?? false,
      link: editor?.isActive("link") ?? false,
    }),
  }) ?? NONE_ACTIVE;

  if (!editor) {
    return (
      <div className="space-y-2">
        <div className="min-h-40 rounded-md border p-3 text-sm text-muted-foreground">Cargando editor…</div>
        {/* El hidden va también acá: sin él, un submit en esa ventana manda
            body vacío y el servidor rechaza con "Escribí el contenido de la
            noticia." aunque la noticia editada tenga cuerpo. */}
        <input type="hidden" name={name} value={html} />
      </div>
    );
  }

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL del enlace (https://…)", prev ?? "https://");
    if (url === null) return;
    if (url === "" || url === "https://") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  };

  const mark = (active: boolean) => (active ? "default" : "outline") as "default" | "outline";

  return (
    <div className="space-y-2">
      {/* role="group" y no "toolbar": el patrón APG de toolbar espera
          navegación con flechas (roving tabindex), que no implementamos. */}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Formato del texto">
        <Button type="button" size="sm" className={BTN} variant={mark(active.bold)} aria-pressed={active.bold}
          onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Negrita"><strong>B</strong></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(active.italic)} aria-pressed={active.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Cursiva"><em>I</em></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(active.underline)} aria-pressed={active.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Subrayado"><u>S</u></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(active.h2)} aria-pressed={active.h2}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(active.h3)} aria-pressed={active.h3}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Button>
        {/* Sin aria-label en los dos de lista: el texto visible ya es buen
            nombre y un aria-label que no lo contenga rompe el control por voz. */}
        <Button type="button" size="sm" className={BTN} variant={mark(active.bulletList)} aria-pressed={active.bulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>• Lista</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(active.orderedList)} aria-pressed={active.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. Lista</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(active.link)} aria-pressed={active.link}
          onClick={setLink} aria-label="Enlace">Link</Button>
      </div>
      <EditorContent
        editor={editor}
        className="prose-news min-h-40 rounded-md border p-3 text-sm [&_.tiptap]:outline-none"
      />
      <input type="hidden" name={name} value={html} />
    </div>
  );
}
