import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// La EXENCIÓN en la ficha del socio: el badge, el aviso y el botón.
//
// Los tres son presentacionales y viven fuera de `page.tsx` justo para poder
// probarse acá: la página es un componente async que consulta Prisma y
// `renderToStaticMarkup` no la puede montar (precedente `admin-health-screen` y
// el molde de `cierre/confirmar/confirm-panels.tsx`).
//
// Lo que se fija es lo que el operador tiene que poder leer y hacer desde la
// ficha, que es la pantalla del mostrador: que un eximido se vea eximido, que el
// aviso nombre el ACTA como se la busca en el libro, y que el botón de eximir
// sólo aparezca cuando eximir es posible.
import {
  ExemptAction, ExemptionBadge, ExemptionNotice,
} from "@/app/admin/socios/[id]/exemption-panels";
import type { FichaExemption } from "@/app/admin/socios/[id]/exemption-panels";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// El id de la FILA (16) y el número del ACTA (124) son distintos a propósito: es
// el hallazgo de la verificación en vivo —"acta N° 16" señalaba un documento que
// no existe, porque las dos numeraciones son independientes— y por eso cada test
// de acá abajo mira el 124 y descarta el 16 como nombre.
const EXEMPTION: FichaExemption = {
  fromPeriod: "2026-09",
  toPeriod: "2027-08",
  minuteId: 16,
  minute: { type: "board", number: 124 },
};

describe("ExemptionBadge", () => {
  it("dice «Eximido» en verde y lleva el rango para el lector de pantalla", () => {
    const html = render(createElement(ExemptionBadge, { exemption: EXEMPTION }));
    expect(html).toContain("Eximido");
    expect(html).toContain('data-variant="success"');
    // El rango no cabe en la pastilla, pero sin él "Eximido" no dice hasta
    // cuándo: va en un `sr-only`, en palabras y no en AAAA-MM.
    expect(html).toContain("sr-only");
    expect(html).toContain("septiembre 2026 a agosto 2027");
  });

  it("sin exención vigente no dibuja nada", () => {
    expect(render(createElement(ExemptionBadge, { exemption: null }))).toBe("");
  });
});

describe("ExemptionNotice", () => {
  it("dice hasta cuándo y NOMBRA el acta por tipo y número", () => {
    const html = render(createElement(ExemptionNotice, { exemption: EXEMPTION }));
    expect(html).toContain("Exención de cuota vigente hasta agosto 2027");
    expect(html).toContain("Comisión Directiva N° 124");
    // El id es a dónde LLEVA el enlace, nunca cómo se nombra el acta.
    expect(html).toContain('href="/admin/actas/16"');
    expect(html).not.toContain("acta N° 16");
    // Y desde el aviso se llega a donde se anula: la ficha no esconde el
    // camino cuando el botón de eximir ya no corresponde.
    expect(html).toContain('href="/admin/tesoreria/exenciones"');
  });

  it("sin exención vigente no dibuja nada", () => {
    expect(render(createElement(ExemptionNotice, { exemption: null }))).toBe("");
  });
});

describe("ExemptAction", () => {
  const base = {
    memberId: 42,
    status: "active" as const,
    category: "active" as const,
    exempted: false,
    superadmin: true,
  };

  it("el superadmin de un socio vigente sin exención llega a Exenciones con el socio ya elegido", () => {
    const html = render(createElement(ExemptAction, base));
    expect(html).toContain("Eximir de cuota");
    expect(html).toContain('href="/admin/tesoreria/exenciones?socio=42"');
  });

  it("al admin común no se le ofrece: asentar una exención es del superadmin", () => {
    expect(render(createElement(ExemptAction, { ...base, superadmin: false }))).toBe("");
  });

  it("a un socio que ya está eximido no se le ofrece otra exención", () => {
    expect(render(createElement(ExemptAction, { ...base, exempted: true }))).toBe("");
  });

  it("a un socio que no está vigente no se le ofrece: sólo se exime al vigente", () => {
    expect(render(createElement(ExemptAction, { ...base, status: "suspended" }))).toBe("");
    expect(render(createElement(ExemptAction, { ...base, status: "withdrawn" }))).toBe("");
  });

  it("a un ADHERENTE no se le ofrece: el Art. 7 inc. a.4 exime a los socios activos", () => {
    // Es la guarda 1 del asiento, y la ficha tiene que mirarla igual que las
    // otras tres: sin ella el botón mandaba al operador a una pantalla que le
    // contesta "esta ficha es de categoría Adherente. Cambiala de categoría con
    // acta si corresponde" — una puerta cerrada con el cartel adentro.
    expect(render(createElement(ExemptAction, { ...base, category: "adherent" }))).toBe("");
    for (const category of ["collaborator", "cadet", "honorary", "lifetime"] as const) {
      expect(render(createElement(ExemptAction, { ...base, category }))).toBe("");
    }
  });
});
