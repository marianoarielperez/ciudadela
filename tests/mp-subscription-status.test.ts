import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARGEABLE_STATUSES,
  canStillCharge,
  isKnownDead,
  isNotCancelled,
} from "@/lib/mp/subscription-status";

describe("las dos semánticas de 'suscripción viva'", () => {
  it("puede cobrar: authorized, pending y paused — una pausada se reanuda", () => {
    expect(CHARGEABLE_STATUSES).toEqual(["authorized", "pending", "paused"]);
    for (const s of CHARGEABLE_STATUSES) expect(canStillCharge(s)).toBe(true);
    expect(canStillCharge("cancelled")).toBe(false);
  });

  it("un estado que MP invente mañana NO se afirma como cobrable (lista blanca)", () => {
    expect(canStillCharge("suspended_by_bank_2027")).toBe(false);
  });

  it("no está cancelada: lo ÚNICO que se puede afirmar muerto es `cancelled` (lista negra)", () => {
    expect(isKnownDead("cancelled")).toBe(true);
    for (const s of ["authorized", "pending", "paused", "suspended_by_bank_2027"]) {
      expect(isKnownDead(s)).toBe(false);
      expect(isNotCancelled(s)).toBe(true);
    }
  });

  it("las dos NO son complementarias, y ahí está el punto", () => {
    // Un estado desconocido no se puede cobrar (no prometemos un débito) pero
    // tampoco está muerto (la ficha tiene que seguir avisando).
    expect(canStillCharge("vaya_a_saber")).toBe(false);
    expect(isNotCancelled("vaya_a_saber")).toBe(true);
  });
});

// Las dos divergencias que costaban plata vivían en un server component y en un
// cron: la del cron se prueba por comportamiento en `mp-reconcile.test.ts`, pero
// la del vinculador es una pantalla que lee prisma y Mercado Pago, así que se
// verifica la FUENTE — mismo criterio estructural que `ADMIN_NAV routes` y que
// el aviso del pago tardío en `applications-query.test.ts`. Lo que estos tests
// tienen que impedir es la regresión concreta: que alguien vuelva a escribir la
// lista de estados a mano en la pantalla.
describe("los llamadores no vuelven a inventar su propia lista", () => {
  const src = (...parts: string[]) =>
    readFileSync(path.resolve(import.meta.dirname, "..", "src", ...parts), "utf8");
  const vincular = src("app", "admin", "tesoreria", "suscripciones", "[preapprovalId]", "vincular", "page.tsx");

  it("el vinculador cuenta las otras vivas con `canStillCharge`, que incluye `paused`", () => {
    // Sin `paused` la pantalla no avisaba "este socio ya tiene otra viva" y el
    // vecino terminaba con dos débitos por mes.
    expect(vincular).toContain("const otherLive = member?.mpSubscriptions.filter((s) => canStillCharge(s.status)).length ?? 0;");
    expect(canStillCharge("paused")).toBe(true);
  });

  it("el vinculador no define ninguna lista de estados propia", () => {
    expect(vincular).not.toMatch(/LIVE_STATUSES/);
    expect(vincular).not.toMatch(/\[\s*"authorized"/);
  });
});
