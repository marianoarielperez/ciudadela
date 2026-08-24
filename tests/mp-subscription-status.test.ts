import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARGEABLE_STATUSES,
  canStillCharge,
  countChargeable,
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

// El aviso "este socio ya tiene otra viva" es la regla que evita dejarle dos
// débitos por mes al mismo vecino. Vivía como un `.filter(...).length` dentro de
// un server component —que lee Prisma y Mercado Pago, así que no se puede
// renderizar en un test puro— y sólo se podía cubrir mirando el texto fuente.
// Extraída a `countChargeable`, se prueba por COMPORTAMIENTO: estos tests fallan
// ante cualquier mutación de la lista, incluidas las que reordenan.
describe("countChargeable: cuántas de las que ya tiene todavía pueden cobrar", () => {
  it("cuenta las tres cobrables y ninguna cancelada", () => {
    expect(countChargeable([{ status: "authorized" }, { status: "pending" }, { status: "paused" }])).toBe(3);
    expect(countChargeable([{ status: "cancelled" }, { status: "cancelled" }])).toBe(0);
  });

  it("una `paused` CUENTA: es justo la que se reanuda y vuelve a cobrar", () => {
    // La divergencia que costaba plata: la pantalla contaba sólo `authorized` y
    // `pending`, así que no avisaba y el vecino terminaba con dos débitos.
    expect(countChargeable([{ status: "paused" }])).toBe(1);
  });

  it("un estado que MP invente mañana no se cuenta como cobrable", () => {
    expect(countChargeable([{ status: "suspended_by_bank_2027" }])).toBe(0);
  });

  it("sin suscripciones, cero", () => {
    expect(countChargeable([])).toBe(0);
  });
});

// Queda UN chequeo de fuente, y sólo el negativo: que la pantalla no vuelva a
// escribirse su propia lista de estados. No fija ninguna línea —eso es lo que
// hacía frágil al test anterior sin hacerlo fuerte—, y la regla en sí ya está
// probada arriba por comportamiento.
describe("el vinculador no inventa su propia lista de estados", () => {
  const vincular = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "app", "admin", "tesoreria", "suscripciones", "[preapprovalId]", "vincular", "page.tsx"),
    "utf8",
  );

  it("no declara constantes de estado ni arrays literales", () => {
    expect(vincular).not.toMatch(/LIVE_STATUSES/);
    expect(vincular).not.toMatch(/\[\s*"authorized"/);
  });
});
