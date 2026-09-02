// El retome PÚBLICO de un borrador de reporte, /reportes/nuevo/[claim].
//
// Lo que sostiene y no se ve en ningún otro test: la llave es la ÚNICA
// credencial de este trámite, así que la pantalla no puede distinguir "no
// existe" de "es de un SOCIO" —quien prueba llaves no puede enterarse de que
// acertó a medias—, y el borrador de un socio no llega a montar el wizard: ése
// se retoma desde /mi, donde la barrera es la sesión. Es la gemela de
// `mi-reportes-screen.test.ts`, que cubre el mismo cruce desde el otro lado.
//
// El wizard se stubea: es un componente cliente con `useActionState` y acá lo
// que se verifica son sus PROPS (modo público, con `siteKey`, con el borrador
// rehidratado), no su render.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Report, ReportFile } from "@/generated/prisma/client";

const h = vi.hoisted(() => ({
  findByClaim: vi.fn(),
  findMany: vi.fn(async () => []),
  // Tipada para poder leer sus PROPS: es lo único que este stub existe para
  // verificar.
  wizard: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));
vi.mock("@/lib/reports/service", () => ({ reports: { findByClaim: h.findByClaim } }));
vi.mock("@/lib/prisma", () => ({ prisma: { street: { findMany: h.findMany } } }));
vi.mock("@/lib/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/config")>()),
  getLegalTexts: async () => ({ terms: null, privacyConsent: "ok" }),
}));
vi.mock("@/app/(public)/reportes/report-wizard", () => ({ ReportWizard: h.wizard }));

import RetomarReportePage from "@/app/(public)/reportes/nuevo/[claim]/page";

const BASE = {
  anonymous: false,
  memberId: null,
  reporterName: "Ana López",
  reporterDni: "30123456",
  reporterPhone: "2974",
  reporterEmail: "ana@example.com",
  consentAt: new Date(Date.UTC(2026, 8, 1, 12)),
  subtype: null,
  description: "Hace tres días que no hay agua.",
  lat: null,
  lng: null,
  outsideBoundary: false,
  streetId: null,
  streetName: "Pizarro",
  addressDetail: "al 1200",
  scplTicket: null,
  claimTokenHash: null,
  submittedAt: null,
  filedAt: null,
  filedById: null,
  filedAgency: null,
  filedAgencyOther: null,
  filedReference: null,
  filedMinuteId: null,
  dismissedAt: null,
  dismissedById: null,
  dismissReason: null,
  dniPurgedAt: null,
  ip: null,
  userAgent: null,
  createdAt: new Date(Date.UTC(2026, 8, 1, 12)),
  updatedAt: new Date(Date.UTC(2026, 8, 1, 12)),
} satisfies Omit<Report, "id" | "kind" | "status" | "category">;

const withFiles = (r: Report): Report & { files: ReportFile[] } => ({ ...r, files: [] });
const draft = withFiles({ ...BASE, id: 7, kind: "claim", category: null, status: "draft" });

const params = Promise.resolve({ claim: "K".repeat(43) });

beforeEach(() => {
  vi.clearAllMocks();
  h.findMany.mockResolvedValue([]);
  h.wizard.mockReturnValue(null);
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function render(node: Promise<React.ReactNode>): Promise<string> {
  return renderToStaticMarkup((await node) as React.ReactElement);
}

describe("/reportes/nuevo/[claim]", () => {
  it("el borrador propio monta el wizard en modo público, con siteKey y con la llave", async () => {
    h.findByClaim.mockResolvedValue(draft);
    await render(RetomarReportePage({ params }) as Promise<React.ReactNode>);
    expect(h.wizard).toHaveBeenCalledTimes(1);
    const props = h.wizard.mock.calls[0][0];
    expect(props.mode).toBe("public");
    expect(props.siteKey).toBe("1x00000000000000000000AA");
    expect(props.initial).toMatchObject({ claim: "K".repeat(43) });
    expect(h.findMany).toHaveBeenCalledTimes(1);
  });

  // LA guarda: un borrador con `memberId` es de un socio y se retoma desde /mi.
  // Verificada por MUTACIÓN: borrando `|| report.memberId !== null` de la
  // página, este test se pone en rojo (monta el wizard con el borrador ajeno).
  it("el borrador de un SOCIO no monta el wizard ni carga el catálogo de calles", async () => {
    h.findByClaim.mockResolvedValue({ ...draft, memberId: 14 });
    const html = await render(RetomarReportePage({ params }) as Promise<React.ReactNode>);
    expect(html).toContain("No encontramos ese reporte");
    expect(h.wizard).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  // La misma pantalla, palabra por palabra: si una llave inexistente dijera algo
  // distinto de una de socio, probar llaves dejaría de ser a ciegas.
  it("una llave que no existe se dice IGUAL que la de un socio", async () => {
    h.findByClaim.mockResolvedValue({ ...draft, memberId: 14 });
    const owned = await render(RetomarReportePage({ params }) as Promise<React.ReactNode>);
    vi.clearAllMocks();
    h.findByClaim.mockResolvedValue(null);
    const unknown = await render(RetomarReportePage({ params }) as Promise<React.ReactNode>);
    expect(unknown).toContain("No encontramos ese reporte");
    expect(unknown).toContain("/reportes");
    expect(unknown).toBe(owned);
    expect(h.wizard).not.toHaveBeenCalled();
  });

  // Ya enviado: el wizard muestra la pantalla terminal, que no tiene paso 3, así
  // que las 40 calles del catálogo catastral no tienen por qué viajar.
  it("un reporte ya enviado monta el wizard con el snapshot y sin el catálogo de calles", async () => {
    h.findByClaim.mockResolvedValue(
      withFiles({
        ...BASE, id: 31, kind: "claim", category: "water", status: "received",
        submittedAt: new Date(Date.UTC(2026, 8, 1, 12)),
      }),
    );
    await render(RetomarReportePage({ params }) as Promise<React.ReactNode>);
    expect(h.wizard).toHaveBeenCalledTimes(1);
    const props = h.wizard.mock.calls[0][0];
    expect(props.mode).toBe("public");
    expect(props.streets).toEqual([]);
    expect(props.initial).toMatchObject({
      claim: "K".repeat(43),
      snapshot: expect.objectContaining({ status: "received", number: 31 }),
    });
    expect(h.findMany).not.toHaveBeenCalled();
  });
});
