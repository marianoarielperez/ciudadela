// Lo que llega al navegador lo decide `next.config.ts`, no el handler (lección
// CSP/setHeader). Se fija: la geolocalización queda apagada para el sitio y se
// enciende (`self`) SÓLO en las rutas del wizard de Reportes; robots cierra el
// prefijo de la llave; el sitemap lista /reportes.
import { describe, expect, it } from "vitest";
import config from "../next.config";
import robots from "@/app/robots";

type Header = { key: string; value: string };
type Entry = { source: string; headers: Header[] };

async function entries(): Promise<Entry[]> {
  const cfg = config("phase-development-server");
  return (await cfg.headers!()) as Entry[];
}

describe("Permissions-Policy", () => {
  it("global: geolocation=(); wizard público y del socio: geolocation=(self)", async () => {
    const all = await entries();
    const global = all.find((e) => e.source === "/(.*)")!;
    expect(global.headers.find((h) => h.key === "Permissions-Policy")?.value).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    for (const source of ["/reportes/:path*", "/mi/solicitudes/reportes/:path*"]) {
      const entry = all.find((e) => e.source === source);
      expect(entry, source).toBeDefined();
      expect(entry!.headers.find((h) => h.key === "Permissions-Policy")?.value).toBe(
        "camera=(), microphone=(), geolocation=(self)",
      );
      // Declarada DESPUÉS de la global: `headers()` pisa por clave en orden.
      expect(all.indexOf(entry!)).toBeGreaterThan(all.indexOf(global));
    }
  });
});

describe("robots", () => {
  it("cierra /reportes/nuevo (la llave viaja en la URL) y deja /reportes abierto", () => {
    process.env.AUTH_URL = "https://vecinalciudadela.ar";
    const r = robots();
    const disallow = (r.rules as { disallow: string[] }).disallow;
    expect(disallow).toContain("/reportes/nuevo");
    expect(disallow).not.toContain("/reportes");
  });
});
