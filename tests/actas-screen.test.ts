// Red de seguridad del rediseño de /admin/actas: fija los INVARIANTES que
// cualquier versión de estas pantallas tiene que sostener — los hrefs que otras
// nueve pantallas y los tests de regresión esperan, el nombre del acta por
// tipo+número (nunca el id), y el bloqueo de fecha en edición. No fija markup:
// el rediseño puede cambiar todo lo demás.
//
// Prisma y las actions se mockean: importarlas de verdad arrastra `@/lib/prisma`,
// que tira al evaluarse sin DATABASE_URL (regla del repo).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted`: la factory de `vi.mock` se iza al tope del archivo, así que el
// mock tiene que construirse también izado o quedaría sin inicializar.
const prismaMock = vi.hoisted(() => ({
  minute: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/app/admin/actas/actions", () => ({
  createMinuteAction: vi.fn(),
  updateMinuteAction: vi.fn(),
}));

import ActasPage from "@/app/admin/actas/page";
import ActaPage from "@/app/admin/actas/[id]/page";
import EditarActaPage from "@/app/admin/actas/[id]/editar/page";
import { MinuteEditForm } from "@/app/admin/actas/[id]/editar/minute-edit-form";

const render = renderToStaticMarkup;

// _count superset: la versión vieja lee `movements`; la rediseñada lee las
// siete relaciones. Un fixture con todas sirve a las dos.
const COUNTS = {
  movements: 2, applications: 0, feeValues: 0, booksOpened: 0, booksClosed: 0,
  processesCalled: 0, processesClosed: 0,
};
const LIST = [
  { id: 16, type: "board", number: 124, date: new Date(Date.UTC(2026, 7, 15, 12)),
    description: "Exención de cuota del socio 7", _count: COUNTS },
  { id: 3, type: "assembly", number: 2, date: new Date(Date.UTC(2025, 2, 10, 12)),
    description: null, _count: { ...COUNTS, movements: 0 } },
];

// Fixture del detalle: superset con las relaciones que la versión rediseñada
// incluye vacías. La vieja sólo mira movements/description/type/number/date/id.
const DETAIL = {
  id: 16, type: "board", number: 124, date: new Date(Date.UTC(2026, 7, 15, 12)),
  description: "Exención de cuota del socio 7",
  movements: [
    { id: 1, type: "fee_exemption", memberId: 7, member: { fullName: "Juana Molina" } },
    { id: 2, type: "admission", memberId: 9, member: { fullName: "Ana Paz" } },
  ],
  applications: [], feeValues: [], booksOpened: [], booksClosed: [],
  processesCalled: [], processesClosed: [],
  _count: { movements: 2, booksOpened: 0, booksClosed: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.minute.findMany.mockResolvedValue(LIST);
  prismaMock.minute.count.mockResolvedValue(LIST.length);
  prismaMock.minute.groupBy.mockResolvedValue([
    { type: "board", _count: { _all: 1 } },
    { type: "assembly", _count: { _all: 1 } },
  ]);
  prismaMock.minute.findUnique.mockResolvedValue(DETAIL);
});

describe("listado: invariantes que el rediseño no puede romper", () => {
  it("linkea al detalle de cada acta y al alta", async () => {
    const html = render(await ActasPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/admin/actas/16"');
    expect(html).toContain('href="/admin/actas/3"');
    expect(html).toContain('href="/admin/actas/nueva"');
  });

  it("nombra las actas por tipo y número, nunca por id", async () => {
    const html = render(await ActasPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Comisión Directiva");
    expect(html).toContain("Asamblea");
    expect(html).toContain("124");
  });
});

describe("detalle: invariantes", () => {
  const props = { params: Promise.resolve({ id: "16" }) };

  it("linkea a la ficha de cada socio asentado y a editar", async () => {
    const html = render(await ActaPage(props));
    expect(html).toContain('href="/admin/socios/7"');
    expect(html).toContain('href="/admin/socios/9"');
    expect(html).toContain('href="/admin/actas/16/editar"');
    expect(html).toContain("Juana Molina");
  });

  it("nombra el acta por tipo y número", async () => {
    const html = render(await ActaPage(props));
    expect(html).toContain("Comisión Directiva N° 124");
  });
});

describe("edición: el bloqueo de fecha sobrevive al rediseño", () => {
  const minute = {
    id: 16, type: "board", number: 124, date: "2026-08-15",
    description: "Exención de cuota del socio 7",
  };

  it("con movimientos, la fecha viaja en un hidden y el campo se ve bloqueado", () => {
    const html = render(
      createElement(MinuteEditForm, { minute, dateLocked: true, movementCount: 2 }),
    );
    expect(html).toContain('name="date"');
    expect(html).toContain('value="2026-08-15"');
    expect(html).toContain("disabled");
    expect(html).toContain("antigüedad estatutaria");
  });

  it("sin movimientos la fecha es editable", () => {
    const html = render(
      createElement(MinuteEditForm, { minute, dateLocked: false, movementCount: 0 }),
    );
    expect(html).toContain('name="date"');
    expect(html).not.toContain("antigüedad estatutaria");
  });

  it("la pantalla explica por qué no hay borrado", async () => {
    const html = render(await EditarActaPage({ params: Promise.resolve({ id: "16" }) }));
    expect(html).toContain("no se eliminan");
    expect(html).not.toContain("Eliminar");
  });
});
