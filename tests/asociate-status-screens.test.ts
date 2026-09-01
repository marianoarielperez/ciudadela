// Las pantallas de estado post-envío (spec §5.5). La garantía central del
// rediseño: ninguna pantalla afirma la admisión antes del acta.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// El componente importa sus server actions, y ésas arrastran `@/lib/prisma`,
// que tira al evaluarse si falta `DATABASE_URL`. El sondeo vive en un
// `useEffect` que `renderToStaticMarkup` no corre: acá sólo se mira el markup
// inicial, así que el doble no necesita comportamiento.
vi.mock("@/app/(public)/asociate/actions", () => ({
  applicationStatusAction: vi.fn(),
}));

import { ApplicationStatusScreen } from "@/app/(public)/asociate/application-status";

function render(status: string) {
  return renderToStaticMarkup(
    createElement(ApplicationStatusScreen, {
      status: status as never,
      resumeToken: "T",
      preapprovalId: null,
      fullName: "Marcela Gómez",
    }),
  );
}

describe("approved_pending_minute (pagó, espera el acta)", () => {
  const html = render("approved_pending_minute");
  it("dice 'completa' y niega la membresía; nunca 'aceptada' ni 'Bienvenido'", () => {
    expect(html).toContain("Tu solicitud quedó completa");
    expect(html).toContain("Todavía no sos socio/a");
    expect(html).not.toMatch(/aceptada/i);
    expect(html).not.toMatch(/Bienvenid/);
  });
  it("saluda por nombre en el acuse y muestra la timeline con 'Estás acá'", () => {
    expect(html).toContain("Marcela");
    expect(html).toContain("Estás acá");
    expect(html).toContain("La Comisión Directiva resuelve");
    expect(html).toContain("Alta en acta");
  });
  it("los 90 días del Art. 6 están dichos", () => {
    expect(html).toMatch(/90 días/);
  });
});

describe("pending_board (sin pago)", () => {
  const html = render("pending_board");
  it("presenta y resuelve, sin caja de éxito", () => {
    expect(html).toContain("Recibimos tu solicitud");
    expect(html).toContain("presentada");
    expect(html).toMatch(/resolver|resuelve/);
    expect(html).not.toMatch(/tratar/);
    expect(html).toContain("Estás acá");
  });
});

describe("expired y resueltas no cambian", () => {
  it("expired conserva su copy", () => {
    expect(render("expired")).toContain("vencen a los 7 días");
  });
  it("rejected/completed conservan su copy", () => {
    expect(render("rejected")).toContain("Revisá tu email");
  });
});
