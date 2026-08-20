import Link from "next/link";
import { SITE } from "@/lib/site";

// Footer del sitio público. Mismo motivo que `SiteHeader`: lo comparten el
// layout de `(public)`, el 404 y la pantalla de error.
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto w-full max-w-5xl space-y-1 px-4 py-6 text-sm text-muted-foreground">
        <p>
          {SITE.name} — {SITE.city}
        </p>
        <p>{SITE.address}</p>
        <p>
          {SITE.legalStatus} · Fundada el {SITE.founded}
        </p>
        <p>
          Sistema SIGeV ·{" "}
          <Link href="/ingresar" className="underline hover:text-primary">
            Acceso de socios y administración
          </Link>
        </p>
      </div>
    </footer>
  );
}
