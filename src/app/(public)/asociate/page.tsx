import Link from "next/link";

export const metadata = { title: "Asociate — Vecinal Ciudadela" };

// Placeholder: el wizard de asociación llega con el Módulo 3. Existe para
// que el botón ASOCIATE habilitado no termine en un 404 (spec §3).
export default function AsociatePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Asociate a la Vecinal</h1>
      <p className="mt-3 text-muted-foreground">
        El formulario de asociación en línea estará disponible próximamente. Mientras tanto,
        acercate a la sede para asociarte.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm text-primary underline">
        Volver al inicio
      </Link>
    </main>
  );
}
