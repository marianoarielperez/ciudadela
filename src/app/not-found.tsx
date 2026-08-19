import Link from "next/link";

// 404 del sitio entero. Vive en la raíz (no dentro de `(public)`) porque una
// URL que no matchea ninguna ruta no entra en ningún grupo: por eso no lleva
// el header ni el footer y tiene que ofrecer su propia salida al inicio.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[50vh] w-full max-w-2xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold">Página no encontrada</h1>
      <p className="mt-2 text-muted-foreground">La dirección que buscás no existe o fue movida.</p>
      <Link href="/" className="mt-6 text-sm text-primary underline">
        Ir al inicio
      </Link>
    </main>
  );
}
