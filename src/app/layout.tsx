import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE, siteBaseUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Con metadataBase, las rutas relativas de openGraph/twitter (entre ellas la
  // `opengraph-image` por convención de src/app/) se resuelven a URL absoluta,
  // que es lo único que las redes sociales aceptan.
  metadataBase: siteBaseUrl(),
  title: {
    default: "Asociación Vecinal del Barrio Ciudadela",
    // Se mantiene el patrón existente de sufijos manuales en cada página en
    // vez de `template: "%s — …"`, porque el admin usa otro sufijo.
    template: "%s",
  },
  description:
    "Sitio institucional y sistema de gestión de socios de la Asociación Vecinal del Barrio Ciudadela — Comodoro Rivadavia, Chubut.",
  openGraph: {
    // /noticias/[slug] tiene que repetir siteName y locale, porque su propio
    // openGraph reemplaza a este en vez de fusionarse: sale del mismo SITE
    // para que no puedan divergir.
    siteName: SITE.shortName,
    locale: "es_AR",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
