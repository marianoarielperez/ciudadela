import Image from "next/image";
import Link from "next/link";

import logoNegativo from "../../../assets/logo-negativo.png";
import { SITE } from "@/lib/site";

// Footer del sitio público. Mismo motivo que `SiteHeader`: lo comparten el
// layout de `(public)`, el 404 y la pantalla de error (client component), así
// que tiene que seguir siendo client-safe — sin async, sin Prisma, solo
// constantes puras. El teléfono/email de `configuration` NO entran acá.

const NAV_LINKS = [
  ["/", "Inicio"],
  ["/noticias", "Noticias"],
  ["/actividades", "Actividades"],
  ["/ubicacion", "Ubicación"],
] as const;

// Receta local de link sobre la banda oscura: mismo juego de foco que la
// lateral del panel (anillo --sidebar-ring sobre --sidebar) y min-h-11 de
// target táctil, como el nav público.
const FOOTER_LINK =
  "inline-flex min-h-11 items-center gap-2 rounded-sm text-sm text-sidebar-foreground outline-hidden hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring";

const COLUMN_HEADING = "text-[10px] font-bold tracking-widest uppercase text-sidebar-foreground/70";

export function SiteFooter() {
  return (
    // border-t-4 con el celeste de MARCA (#2E9BDF, --sidebar-primary): la
    // franja hermana del border-b-4 del header de /mi. Es decorativa sobre la
    // banda oscura, no texto: no necesita el 4.5:1 de --primary.
    <footer className="border-t-4 border-sidebar-primary bg-sidebar text-sidebar-foreground">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3">
          <div className="space-y-3">
            {/* alt vacío: el nombre va como texto acá abajo. */}
            <Image src={logoNegativo} alt="" className="h-10 w-auto" sizes="40px" />
            <p className="font-semibold text-white">{SITE.name}</p>
            <div className="space-y-1 text-sm">
              <p>{SITE.address}</p>
              <p>{SITE.legalStatus}</p>
              <p>Fundada el {SITE.founded}</p>
            </div>
          </div>
          <nav aria-label="Secciones del sitio (pie de página)" className="space-y-2">
            <p className={COLUMN_HEADING}>Secciones</p>
            <ul className="flex flex-col">
              {NAV_LINKS.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className={FOOTER_LINK}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="space-y-2">
            <p className={COLUMN_HEADING}>Contacto y acceso</p>
            <ul className="flex flex-col">
              <li>
                <a
                  href={SITE.social.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={FOOTER_LINK}
                >
                  <FacebookIcon />
                  Facebook
                </a>
              </li>
              <li>
                <a
                  href={SITE.social.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={FOOTER_LINK}
                >
                  <WhatsAppIcon />
                  Canal de WhatsApp
                </a>
              </li>
              <li>
                <Link href="/ingresar" className={FOOTER_LINK}>
                  Ingresar
                </Link>
              </li>
              <li>
                <Link href="/asociate" className={FOOTER_LINK}>
                  Asociate
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-sidebar-border pt-4 text-xs text-sidebar-foreground/70">
          <p>
            {SITE.shortName} — {SITE.city}
          </p>
          <p>Sistema SIGeV</p>
        </div>
      </div>
    </footer>
  );
}

// Glifos de marca (lucide no incluye logos de terceros): paths de Simple
// Icons (CC0), viewBox 24×24, fill currentColor para heredar el color del
// link. SVG inline: compatible con la CSP (img-src 'self' no lo alcanza).
function FacebookIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
