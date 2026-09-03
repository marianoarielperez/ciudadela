// Las dos pantallas de Reportes en /mi (spec §5.2).
//
// Lo que sostienen y no se ve en ningún otro test: la lista no consulta la base
// sin sesión de socio, la tarjeta lee el desenlace por TIPO (un reclamo se
// presenta ante un organismo; una iniciativa la trata la Comisión), y —la
// guarda que importa— el retome exige las DOS credenciales: la sesión y la
// llave. Un borrador de otro socio, o de un vecino sin cuenta, cae en la misma
// pantalla que uno inexistente y no llega a montar el wizard.
//
// El wizard se stubea: es un componente cliente con `useActionState` y acá lo
// que se verifica son sus PROPS (modo socio, sin `siteKey`, con el borrador
// rehidratado), no su render.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Report, ReportFile } from "@/generated/prisma/client";

const h = vi.hoisted(() => ({
  requireMember: vi.fn(),
  listForMember: vi.fn(),
  findByClaim: vi.fn(),
  findMany: vi.fn(async () => []),
  // Tipada para poder leer sus PROPS: es lo único que este stub existe para
  // verificar.
  wizard: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: h.requireMember }));
vi.mock("@/lib/reports/service", () => ({
  reports: { listForMember: h.listForMember, findByClaim: h.findByClaim },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { street: { findMany: h.findMany } } }));
vi.mock("@/lib/config", () => ({ getLegalTexts: async () => ({ terms: null, privacyConsent: "ok" }) }));
vi.mock("@/app/(public)/reportes/report-wizard", () => ({ ReportWizard: h.wizard }));

import MiReportesPage from "@/app/mi/solicitudes/reportes/page";
import MiRetomarReportePage from "@/app/mi/solicitudes/reportes/nuevo/[claim]/page";

const OK_ACTOR = { ok: true as const, userId: 7, memberId: 14, fullName: "Ana López", suspension: null };
const BLOCKED = { ok: false as const, reason: "withdrawn" as const, error: "Figurás con baja." };

const BASE = {
  anonymous: false,
  memberId: 14,
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
  submittedAt: new Date(Date.UTC(2026, 8, 1, 12)),
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
} satisfies Omit<Report, "id" | "number" | "kind" | "status" | "category">;

const withFiles = (r: Report): Report & { files: ReportFile[] } => ({ ...r, files: [] });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireMember.mockResolvedValue(OK_ACTOR);
  h.listForMember.mockResolvedValue([]);
  h.findMany.mockResolvedValue([]);
  h.wizard.mockReturnValue(null);
});

async function render(node: Promise<React.ReactNode>): Promise<string> {
  return renderToStaticMarkup((await node) as React.ReactElement);
}

describe("/mi/solicitudes/reportes", () => {
  it("sin socio habilitado no renderiza ni consulta la base", async () => {
    h.requireMember.mockResolvedValue(BLOCKED);
    expect(await MiReportesPage()).toBeNull();
    expect(h.listForMember).not.toHaveBeenCalled();
  });

  it("sin reportes muestra el estado vacío con la acción que lo resuelve", async () => {
    const html = await render(MiReportesPage() as Promise<React.ReactNode>);
    expect(html).toContain("Todavía no mandaste ningún reporte.");
    expect(html).toContain("/mi/solicitudes/reportes/nuevo");
    expect(h.listForMember).toHaveBeenCalledWith(14);
  });

  it("un reclamo presentado dice ante QUÉ organismo; una iniciativa, que la trató la Comisión", async () => {
    h.listForMember.mockResolvedValue([
      withFiles({
        ...BASE, id: 31, number: 5, kind: "claim", category: "water", subtype: "no_water",
        status: "filed", filedAt: new Date(Date.UTC(2026, 8, 10, 12)),
        filedAgency: "scpl", filedReference: "12345",
      }),
      withFiles({
        ...BASE, id: 30, number: 4, kind: "initiative", category: "sports",
        status: "filed", filedAt: new Date(Date.UTC(2026, 8, 9, 12)),
      }),
    ]);
    const html = await render(MiReportesPage() as Promise<React.ReactNode>);
    expect(html).toContain("Presentado ante SCPL el 10/09/2026");
    expect(html).toContain("(exp. 12345)");
    expect(html).toContain("Tratada por la Comisión Directiva el 09/09/2026");
    expect(html).toContain("Agua potable › Falta de agua");
  });

  // Sola en su render: con las dos tarjetas juntas, "Presentado" aparece
  // legítimamente por el reclamo y la pastilla de la iniciativa se podría leer
  // "Presentado" sin que nadie lo note (spec §2, `statusLabel`/`filedVerb`).
  it("en la tarjeta de una iniciativa presentada no aparece la palabra Presentado", async () => {
    h.listForMember.mockResolvedValue([
      withFiles({
        ...BASE, id: 30, number: 4, kind: "initiative", category: "sports",
        status: "filed", filedAt: new Date(Date.UTC(2026, 8, 9, 12)),
      }),
    ]);
    const html = await render(MiReportesPage() as Promise<React.ReactNode>);
    expect(html).toContain("Tratada");
    expect(html).not.toContain("Presentado");
  });

  // La tarjeta del socio imprime el N° PÚBLICO, no el id: es el que él cita
  // cuando pregunta y el que el operador busca en la cola.
  it("un reporte recibido se anuncia como recibido, con el N° público", async () => {
    h.listForMember.mockResolvedValue([
      withFiles({ ...BASE, id: 12, number: 2, kind: "claim", category: "waste", status: "received" }),
    ]);
    const html = await render(MiReportesPage() as Promise<React.ReactNode>);
    expect(html).toContain("Recibido");
    expect(html).toContain("N° 2");
    expect(html).not.toContain("N° 12");
  });
});

describe("/mi/solicitudes/reportes/nuevo/[claim]", () => {
  const params = Promise.resolve({ claim: "K".repeat(43) });
  const draft = withFiles({ ...BASE, id: 7, number: null, kind: "claim", category: null, status: "draft", submittedAt: null });

  it("el borrador propio monta el wizard en modo socio, sin siteKey y con la llave", async () => {
    h.findByClaim.mockResolvedValue(draft);
    await render(MiRetomarReportePage({ params }) as Promise<React.ReactNode>);
    expect(h.wizard).toHaveBeenCalledTimes(1);
    const props = h.wizard.mock.calls[0][0];
    expect(props.mode).toBe("member");
    expect(props.siteKey).toBeUndefined();
    expect(props.initial).toMatchObject({ claim: "K".repeat(43) });
  });

  it("el borrador de OTRO socio no monta el wizard ni carga el catálogo de calles", async () => {
    h.findByClaim.mockResolvedValue({ ...draft, memberId: 99 });
    const html = await render(MiRetomarReportePage({ params }) as Promise<React.ReactNode>);
    expect(html).toContain("No encontramos ese reporte");
    expect(h.wizard).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("el borrador de un VECINO sin cuenta cae en la misma pantalla", async () => {
    h.findByClaim.mockResolvedValue({ ...draft, memberId: null });
    const html = await render(MiRetomarReportePage({ params }) as Promise<React.ReactNode>);
    expect(html).toContain("No encontramos ese reporte");
    expect(h.wizard).not.toHaveBeenCalled();
  });

  it("una llave que no existe se dice igual que una ajena", async () => {
    h.findByClaim.mockResolvedValue(null);
    const html = await render(MiRetomarReportePage({ params }) as Promise<React.ReactNode>);
    expect(html).toContain("No encontramos ese reporte");
    expect(html).toContain("/mi/solicitudes/reportes");
  });

  it("sin socio habilitado no busca el borrador", async () => {
    h.requireMember.mockResolvedValue(BLOCKED);
    expect(await MiRetomarReportePage({ params })).toBeNull();
    expect(h.findByClaim).not.toHaveBeenCalled();
  });
});
