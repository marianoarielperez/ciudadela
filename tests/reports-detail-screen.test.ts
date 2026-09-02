// La ficha de un reporte del panel (spec §5.3), renderizada.
//
// Lo que sostiene y no se ve en `reports-admin-actions.test.ts` —que prueba las
// dos decisiones— es lo que la PANTALLA hace con el reporte:
//
// 1. Un BORRADOR no es un reporte: cae en 404 como uno inexistente. El panel no
//    lo lista en ninguna vista y la ficha no puede ser la puerta de atrás.
// 2. El estado se nombra con `statusLabel(kind, status)`: una iniciativa
//    desestimada dice "Desestimada" y una tratada dice "Tratada", no
//    "Presentado".
// 3. El acta se nombra por TIPO y NÚMERO (`minuteName`) y el link va al acta;
//    mostrar el id manda al operador a buscar en el libro otro documento.
// 4. Los dos formularios existen sólo mientras el reporte está `received`, y el
//    libro de actas se consulta SÓLO para una iniciativa pendiente.
//
// Los tres componentes cliente (los dos formularios y el mini-mapa) se stubean:
// acá se verifica el árbol del Server Component, no su render — y el mapa
// arrastraría Leaflet a un test de node.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findUnique: vi.fn(),
  minuteFindMany: vi.fn(async () => [] as unknown[]),
  minuteGroupBy: vi.fn(async () => [] as unknown[]),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    report: { findUnique: h.findUnique },
    minute: { findMany: h.minuteFindMany, groupBy: h.minuteGroupBy },
  },
}));
vi.mock("next/navigation", () => ({ notFound: h.notFound }));
vi.mock("@/app/admin/solicitudes/reportes/[id]/file-form", () => ({
  FileForm: () => "FILE_FORM",
}));
vi.mock("@/app/admin/solicitudes/reportes/[id]/dismiss-form", () => ({
  DismissForm: () => "DISMISS_FORM",
}));
vi.mock("@/app/admin/solicitudes/reportes/[id]/report-mini-map-loader", () => ({
  default: () => "MINI_MAP",
}));

import ReporteDetallePage from "@/app/admin/solicitudes/reportes/[id]/page";

const render = renderToStaticMarkup;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const BASE = {
  id: 14,
  kind: "claim" as const,
  status: "received" as const,
  anonymous: false,
  category: "water",
  subtype: "leak",
  description: "Pierde agua en la vereda.",
  lat: null as number | null,
  lng: null as number | null,
  outsideBoundary: false,
  streetName: "Pizarro",
  addressDetail: "1200",
  scplTicket: null as string | null,
  submittedAt: new Date(Date.UTC(2026, 8, 1, 15)),
  filedAt: null as Date | null,
  filedAgency: null as string | null,
  filedAgencyOther: null as string | null,
  filedReference: null as string | null,
  dismissedAt: null as Date | null,
  dismissReason: null as string | null,
  dniPurgedAt: null as Date | null,
  reporterName: "Ana López",
  reporterDni: "30123456",
  reporterPhone: "2974",
  reporterEmail: "ana@example.com",
  files: [] as { id: number; kind: string }[],
  filedBy: null as { name: string | null } | null,
  dismissedBy: null as { name: string | null } | null,
  filedMinute: null as { id: number; type: string; number: number } | null,
  member: null as { id: number; memberships: { memberNumber: number; book: { status: string } }[] } | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAdmin.mockResolvedValue({ ok: true, actorId: 1 });
  h.findUnique.mockResolvedValue(BASE);
  h.minuteFindMany.mockResolvedValue([]);
  h.minuteGroupBy.mockResolvedValue([]);
});

describe("la ficha del reporte", () => {
  it("sin admin no consulta la base y muestra el bloqueo", async () => {
    h.requireAdmin.mockResolvedValue({ ok: false, reason: "not_admin", error: "No tenés permiso." });
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).toContain("No tenés permiso.");
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("un id que no es un entero positivo es 404 antes de la consulta", async () => {
    await expect(ReporteDetallePage(params("abc"))).rejects.toThrow("NOT_FOUND");
    await expect(ReporteDetallePage(params("0"))).rejects.toThrow("NOT_FOUND");
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("un BORRADOR cae en 404 igual que uno inexistente", async () => {
    h.findUnique.mockResolvedValue({ ...BASE, status: "draft" });
    await expect(ReporteDetallePage(params("14"))).rejects.toThrow("NOT_FOUND");
    h.findUnique.mockResolvedValue(null);
    await expect(ReporteDetallePage(params("14"))).rejects.toThrow("NOT_FOUND");
  });

  it("un reclamo pendiente ofrece las dos decisiones y NO consulta el libro de actas", async () => {
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).toContain("Reporte N° 14");
    expect(html).toContain("Marcar presentado");
    expect(html).toContain("FILE_FORM");
    expect(html).toContain("DISMISS_FORM");
    // Un reclamo no asienta nada en el libro: no hay por qué traer las actas.
    expect(h.minuteFindMany).not.toHaveBeenCalled();
  });

  it("una iniciativa pendiente dice 'Marcar tratada' y sí trae las actas", async () => {
    h.findUnique.mockResolvedValue({ ...BASE, kind: "initiative", category: "sports", subtype: null });
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).toContain("Marcar tratada");
    expect(html).not.toContain("Marcar presentado");
    expect(h.minuteFindMany).toHaveBeenCalled();
  });

  // `statusLabel(kind, status)`: leer `STATUS_LABELS[status]` a mano le diría
  // "Presentado" y "Desestimado" a una iniciativa.
  it("nombra el estado por TIPO y con género", async () => {
    h.findUnique.mockResolvedValue({
      ...BASE, kind: "initiative", category: "social", subtype: null,
      status: "dismissed", dismissedAt: new Date(Date.UTC(2026, 8, 2, 15)),
      dismissedBy: { name: "Vocal" }, dismissReason: "Duplicada de la N° 3.",
    });
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).toContain("Desestimada");
    expect(html).not.toContain("FILE_FORM");
    expect(html).not.toContain("DISMISS_FORM");
    expect(html).toContain("Duplicada de la N° 3.");
  });

  it("una iniciativa tratada nombra el acta por tipo y número, y linkea al acta", async () => {
    h.findUnique.mockResolvedValue({
      ...BASE, kind: "initiative", category: "works", subtype: null,
      status: "filed", filedAt: new Date(Date.UTC(2026, 8, 2, 12)),
      filedBy: { name: "Secretaria" }, filedReference: "EXP 42",
      filedMinute: { id: 16, type: "board", number: 124 },
    });
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).toContain("Comisión Directiva N° 124");
    expect(html).toContain('href="/admin/actas/16"');
    // Nunca el id como si fuera el número del acta.
    expect(html).not.toContain("Acta N° 16");
    expect(html).toContain("EXP 42");
  });

  it("con punto en el mapa monta el mini-mapa y escribe las coordenadas en texto", async () => {
    h.findUnique.mockResolvedValue({ ...BASE, lat: -45.799336, lng: -67.503133 });
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).toContain("MINI_MAP");
    expect(html).toContain("-45.79934, -67.50313");
  });

  it("sin punto ni calle dice que no hay ubicación y no monta el mapa", async () => {
    h.findUnique.mockResolvedValue({ ...BASE, streetName: null, addressDetail: null });
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).not.toContain("MINI_MAP");
    expect(html).toContain("Sin ubicación");
  });

  // Las dos caras del DNI y las fotos salen SIEMPRE de la ruta autenticada: no
  // hay una sola imagen de un vecino servida desde `public/`.
  it("fotos y DNI apuntan a la ruta autenticada, con alt distinto", async () => {
    h.findUnique.mockResolvedValue({
      ...BASE,
      files: [
        { id: 1, kind: "photo" },
        { id: 2, kind: "dni_front" },
        { id: 3, kind: "dni_back" },
      ],
    });
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).toContain('src="/api/admin/reportes/14/archivos/1"');
    expect(html).toContain('src="/api/admin/reportes/14/archivos/2"');
    expect(html).toContain("Frente del DNI");
    expect(html).toContain("Dorso del DNI");
    expect(html).not.toContain("/uploads/");
  });

  it("un socio linkea a su ficha con el número del libro ABIERTO", async () => {
    h.findUnique.mockResolvedValue({
      ...BASE,
      member: {
        id: 42,
        memberships: [
          { memberNumber: 306, book: { status: "closed" } },
          { memberNumber: 63, book: { status: "open" } },
        ],
      },
    });
    const html = render(await ReporteDetallePage(params("14")));
    expect(html).toContain('href="/admin/socios/42"');
    expect(html).toContain("socio N° 63");
  });
});
