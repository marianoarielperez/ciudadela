"use client";
// Editor visual de noticias (Tiptap v3, alcance BÁSICO decidido en la
// entrevista: negrita, cursiva, subrayado, H2/H3, listas, links). El HTML
// viaja en un hidden input y se sanitiza SIEMPRE en el servidor: esta
// toolbar es UX, no seguridad.
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const BTN = "h-8 min-w-8 px-2 text-xs";

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
      }),
    ],
    content: initialHtml,
    onUpdate: ({ editor }) => setHtml(editor.getHTML()),
  });

  if (!editor) {
    return <div className="min-h-40 rounded-md border p-3 text-sm text-muted-foreground">Cargando editor…</div>;
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
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Formato del texto">
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Negrita"><strong>B</strong></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Cursiva"><em>I</em></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Subrayado"><u>S</u></Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("heading", { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("heading", { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Lista">• Lista</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("orderedList"))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Lista numerada">1. Lista</Button>
        <Button type="button" size="sm" className={BTN} variant={mark(editor.isActive("link"))}
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
