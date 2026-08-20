import Link from "next/link";

// 404 propio del panel. Sin esto, un `notFound()` de una pantalla de admin
// —por ejemplo un socio inexistente en /admin/socios/[id]— sube hasta el
// not-found de la raíz, que monta el header y el footer PÚBLICOS: el operador
// terminaba viendo la nav institucional y la personería jurídica dentro del
// panel. Este vive bajo /admin, así que se renderiza dentro del Shell de
// admin/layout.tsx y no necesita montar ninguna cabecera.
export default function AdminNotFound() {
  return (
    <div className="space-y-3 rounded border bg-background p-4">
      <h1 className="text-xl font-semibold">No encontrado</h1>
      <p className="text-sm text-muted-foreground">
        El registro que buscás no existe o fue eliminado.
      </p>
      <Link href="/admin" className="inline-block text-sm text-primary underline">
        Volver al panel
      </Link>
    </div>
  );
}
