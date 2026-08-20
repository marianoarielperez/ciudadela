import { afterEach, describe, expect, it, vi } from "vitest";
import { siteBaseUrl } from "@/lib/site";

// siteBaseUrl() lee el entorno en CADA llamada (no al importar el módulo), así
// que alcanza con pisar las variables antes de invocarla.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteBaseUrl", () => {
  it("devuelve el dominio del entorno", () => {
    vi.stubEnv("AUTH_URL", "https://sigev.redaccion.ar");
    expect(siteBaseUrl().toString()).toBe("https://sigev.redaccion.ar/");
  });

  it("fuera de producción cae a localhost sin romper nada", () => {
    vi.stubEnv("AUTH_URL", undefined);
    expect(siteBaseUrl().hostname).toBe("localhost");
  });

  // El caso caro: el valor se hornea en el build (sitemap, robots, canonical).
  // Si sale mal, el sitio se publica apuntando a localhost y se desindexa; el
  // build tiene que romper, no salir con exit 0.
  describe("en un build de producción", () => {
    it("falla si AUTH_URL no está definida", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_URL", undefined);
      expect(() => siteBaseUrl()).toThrow(/AUTH_URL no está definida/);
    });

    it.each([
      "http://localhost:3000",
      "http://localhost",
      "http://127.0.0.1:3006",
      "http://[::1]:3000",
    ])("falla si AUTH_URL apunta a %s", (url) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_URL", url);
      expect(() => siteBaseUrl()).toThrow(/apunta a localhost/);
    });

    it("acepta un dominio real", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_URL", "https://vecinalciudadela.ar");
      expect(siteBaseUrl().toString()).toBe("https://vecinalciudadela.ar/");
    });

    // `next build` fija NODE_ENV=production también en la máquina de desarrollo,
    // donde AUTH_URL es localhost a propósito. Sin esta escotilla no se podría
    // verificar un build de producción en local.
    it("la escotilla explícita permite el build local", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_URL", "http://localhost:3000");
      vi.stubEnv("ALLOW_LOCALHOST_BASE_URL", "1");
      expect(siteBaseUrl().hostname).toBe("localhost");
    });

    it("la escotilla sólo vale con el valor exacto '1'", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_URL", "http://localhost:3000");
      vi.stubEnv("ALLOW_LOCALHOST_BASE_URL", "true");
      expect(() => siteBaseUrl()).toThrow(/apunta a localhost/);
    });
  });
});
