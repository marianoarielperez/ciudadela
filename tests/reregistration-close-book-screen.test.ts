import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// La vista previa del cierre es la última pantalla antes del acto irreversible
// del módulo, así que lo que se fija acá es lo que el operador tiene que poder
// LEER antes de apretar: el aviso con todas las letras, el mapeo ordenado por
// número nuevo, y que una baja sin notificar se muestre en ámbar CON nombre
// (advierte, no bloquea — decisión del operador) mientras que un bloqueo del
// checklist se muestre como error.
//
// Nada de este archivo toca Prisma: `confirm-panels.tsx` recibe datos
// serializables.
import {
  CloseBlockersNotice, CloseWarnings, IrreversibleWarning, MigrationPreview,
} from "@/app/admin/reempadronamiento/cierre/confirmar/confirm-panels";
import type { ClosePreview } from "@/lib/reregistration/close-book";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const MIGRANTS: ClosePreview["migrants"] = [
  { memberId: 14, fullName: "Ana Aguirre", oldNumber: 288, newNumber: 1, category: "active", status: "active" },
  { memberId: 99, fullName: "Beto Barrios", oldNumber: 12, newNumber: 2, category: "adherent", status: "suspended" },
  { memberId: 306, fullName: "Carla Cruz", oldNumber: 306, newNumber: 3, category: "active", status: "active" },
];

describe("IrreversibleWarning", () => {
  it("dice el aviso con todas las letras, con los dos números", () => {
    const html = render(createElement(IrreversibleWarning, { oldNumber: 1, newNumber: 2 }));
    expect(html).toContain("Este paso cierra el Libro N°");
    expect(html).toContain("Solo se revierte restaurando un backup.");
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
  });
});

describe("MigrationPreview", () => {
  it("lista el mapeo ordenado por número NUEVO, con nombre y categoría", () => {
    const html = render(
      createElement(MigrationPreview, { migrants: MIGRANTS, oldNumber: 1, newNumber: 2 }),
    );
    expect(html).toContain("N° nuevo (Libro 2)");
    expect(html).toContain("N° anterior (Libro 1)");
    // Los tres nombres, en el orden del plan (la tabla no reordena).
    const positions = ["Ana Aguirre", "Beto Barrios", "Carla Cruz"].map((n) => html.indexOf(n));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Los números en monoespaciada tabular, como toda columna numérica del panel.
    expect(html).toContain("font-mono tabular-nums");
    expect(html).toContain(">3<");
    expect(html).toContain("socios migran");
  });
});

describe("CloseWarnings — ámbar, con nombres, y NO bloquea", () => {
  it("la baja sin notificar se dice con el nombre de la persona", () => {
    const html = render(
      createElement(CloseWarnings, {
        arrears: 0,
        unnotified: [{ memberId: 4, fullName: "Dora Díaz", memberNumber: 60 }],
      }),
    );
    expect(html).toContain("Dora Díaz");
    expect(html).toContain("sin notificar");
    expect(html).toContain("ventana de recurso");
    // Es una ADVERTENCIA (FormMessage kind="warning"), no un error.
    expect(html).toContain("Se puede cerrar");
  });

  it("la mora advierte con el conteo y manda a Deudores", () => {
    const html = render(createElement(CloseWarnings, { arrears: 7, unnotified: [] }));
    expect(html).toContain("/admin/tesoreria/deudores");
    expect(html).toContain(">7<");
  });

  it("sin nada que advertir no dibuja nada", () => {
    expect(render(createElement(CloseWarnings, { arrears: 0, unnotified: [] }))).toBe("");
  });
});

describe("CloseBlockersNotice", () => {
  it("un bloqueo se lee como error y manda al checklist", () => {
    const html = render(
      createElement(CloseBlockersNotice, {
        blockers: [
          { kind: "unresolved_presentations", count: 2 },
          { kind: "cohort_not_terminal", count: 5 },
        ],
      }),
    );
    expect(html).toContain("No se puede cerrar todavía");
    expect(html).toContain("/admin/reempadronamiento/cierre");
    expect(html).toContain(">2<");
    expect(html).toContain(">5<");
    expect(html).toContain("sin desenlace");
  });

  it("sin bloqueos no dibuja nada", () => {
    expect(render(createElement(CloseBlockersNotice, { blockers: [] }))).toBe("");
  });
});
