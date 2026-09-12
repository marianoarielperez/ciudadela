// Lista de capturas de los manuales. Cada entrada produce
// docs/manuales/img/<manual>/<file>.png. `prepare` corre con la página ya
// cargada y la sesión del rol iniciada, para abrir pestañas, llenar pasos, etc.
import type { Page } from "playwright-core";

export type Role = "public" | "admin" | "member" | "superadmin";
export type Manual = "m1" | "m2" | "m3";
export type Capture = {
  manual: Manual;
  file: string;          // NN-slug, sin extensión
  role: Role;
  url: string;           // relativa a DOCS_CAPTURE_BASE_URL
  fullPage?: boolean;    // default: solo el viewport
  prepare?: (page: Page) => Promise<void>;
  /** Selector que tiene que estar en pantalla antes de disparar la foto. Para
   *  lo que se pinta después del primer render (una tabla que se carga, un
   *  panel de pestaña, un gráfico): sin esto la captura sale a mitad de camino
   *  y nadie se entera hasta que el manual está impreso. */
  ready?: string;
  /** Oculta el widget de Turnstile. En local corre con las claves dummy de
   *  Cloudflare, que pintan una leyenda ROJA "Solo para pruebas. Si se ve,
   *  informe al propietario del sitio": en un manual eso se lee como un error
   *  del sitio. Se prende sólo donde el widget está en cuadro. */
  hideTurnstile?: boolean;
};

export const CAPTURES: Capture[] = [
  { manual: "m1", file: "01-ingresar", role: "public", url: "/ingresar", hideTurnstile: true },
  { manual: "m1", file: "02-inicio-tablero", role: "admin", url: "/admin", fullPage: true },
  { manual: "m2", file: "01-mi-inicio", role: "member", url: "/mi", fullPage: true },
  { manual: "m3", file: "01-portada", role: "public", url: "/", fullPage: true },
];
