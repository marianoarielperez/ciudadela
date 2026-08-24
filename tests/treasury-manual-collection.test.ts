// La hoja imprimible de gestión manual (spec 4C §5, decisión 2 del operador).
//
// Se renderiza de verdad (mismo recurso que `member-auto-debit`) porque lo que
// se afirma acá es sobre PAPEL: qué datos salen del sistema impresos y cuáles
// NO (Ley 25.326), a quién lista, y que la hoja no mienta sobre la fecha de los
// números que muestra.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

type AdminDouble = { ok: boolean; actorId?: number; reason?: string; error?: string };

const mocks = vi.hoisted(() => ({
  admin: vi.fn(async (): Promise<AdminDouble> => ({ ok: true, actorId: 1 })),
  fetchDebtors: vi.fn(async (): Promise<unknown[]> => []),
  current: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: { current: mocks.current } }));

import GestionManualPage from "@/app/admin/tesoreria/deudores/gestion-manual/page";
import { ManualCollectionSheet } from "@/app/admin/tesoreria/deudores/gestion-manual/sheet";
import { fetchDebtors, type DebtorRow } from "@/lib/treasury/debtors";
import { feeValueReader } from "@/lib/treasury/fee-values";

vi.mock("@/lib/treasury/debtors", async (orig) => ({
  ...(await orig<typeof import("@/lib/treasury/debtors")>()),
  fetchDebtors: mocks.fetchDebtors,
}));

const PRINTED_AT = new Date("2026-09-15T14:00:00Z");

const debtor = (over: Partial<DebtorRow> = {}): DebtorRow => ({
  memberId: 1,
  memberNumber: 144,
  fullName: "Skardius, Ana",
  category: "active",
  status: "active",
  pendingCount: 4,
  debt: 24000,
  level: 4,
  lastPaidAt: new Date("2026-04-10T12:00:00Z"),
  phone: "297-4000000",
  emailUsable: false,
  ...over,
});

const sheet = (rows: DebtorRow[], feeValue: { validFrom: Date } | null = { validFrom: new Date("2026-07-01T12:00:00Z") }) =>
  renderToStaticMarkup(createElement(ManualCollectionSheet, { rows, feeValue, printedAt: PRINTED_AT }));

describe("ManualCollectionSheet: qué sale impreso", () => {
  it("lleva lo que hace falta para llamar: número, nombre, categoría, cuotas, deuda y teléfono", () => {
    const html = sheet([debtor()]);
    expect(html).toContain("144");
    expect(html).toContain("Skardius, Ana");
    expect(html).toContain("Activo");
    expect(html).toContain("24.000");
    expect(html).toContain("297-4000000");
    // El último pago distingue al que se atrasó del que nunca pagó.
    expect(html).toContain("10/04/2026");
  });

  it("NO imprime el DNI ni la casilla de correo del socio", () => {
    // La hoja se imprime y sale del sistema: queda sobre un escritorio. El DNI
    // no hace falta para llamar por teléfono (Ley 25.326, docs/08), y la casilla
    // de estas filas no existe o rebota — imprimirla invitaría a escribirle a un
    // buzón muerto.
    const html = sheet([debtor()]);
    expect(html).not.toContain("30123456");
    expect(html).not.toContain("ana@ejemplo.com");
    expect(html.toLowerCase()).not.toContain("dni");
    expect(html.toLowerCase()).not.toContain("email");
  });

  it("dice la fecha de los números: una hoja guardada en una carpeta no puede mentir", () => {
    // El devengo suma una cuota por mes a cada fila de esta lista: sin la fecha,
    // la deuda de septiembre se sigue leyendo como la de hoy en noviembre.
    expect(sheet([debtor()])).toContain("15/09/2026");
  });

  it("cuenta los socios y suma la deuda de la hoja", () => {
    const html = sheet([debtor(), debtor({ memberId: 2, memberNumber: 7, fullName: "Uno", debt: 6000 })]);
    expect(html).toContain("2 socios para contactar");
    expect(html).toContain("30.000");
  });

  it("en singular no dice '1 socios'", () => {
    expect(sheet([debtor()])).toContain("1 socio para contactar");
  });

  it("sin valor de cuota vigente avisa y no inventa un monto", () => {
    const html = sheet([debtor({ debt: null })], null);
    expect(html).toContain("No hay un valor de cuota vigente");
    expect(html).not.toContain("en total");
  });

  it("el socio sin teléfono queda en la hoja, con un guión y con su aviso", () => {
    // Es al que hay que ir a buscar por la cartelera o una visita: sacarlo de la
    // lista lo dejaría sin ningún canal. Y una celda vacía en papel se lee como
    // un error de impresión.
    const html = sheet([debtor({ phone: null })]);
    expect(html).toContain("—");
    expect(html).toContain("no tiene teléfono cargado");
  });

  it("sin nadie que contactar no renderiza un thead sin filas", () => {
    const html = sheet([]);
    expect(html).toContain("recordatorio les llega solo");
    expect(html).not.toContain("<thead");
    expect(html).not.toContain("Teléfono");
  });
});

describe("GestionManualPage: a quién lista y quién puede verla", () => {
  it("lista SÓLO a los deudores sin casilla utilizable", async () => {
    // El que tiene email ya recibe el recordatorio de vencimiento: repetirlo en
    // la hoja haría que la Comisión lo llame para decirle lo que ya le llegó.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 1 });
    mocks.current.mockResolvedValueOnce({ validFrom: new Date("2026-07-01T12:00:00Z") });
    mocks.fetchDebtors.mockResolvedValueOnce([
      debtor({ memberId: 1, fullName: "Sin casilla", emailUsable: false }),
      debtor({ memberId: 2, fullName: "Con casilla", emailUsable: true }),
    ]);
    const html = renderToStaticMarkup(await GestionManualPage());
    expect(html).toContain("Sin casilla");
    expect(html).not.toContain("Con casilla");
    expect(html).toContain("1 socio para contactar");
  });

  it("pide la lista SIN filtros: la hoja es para la Comisión y va completa", async () => {
    mocks.fetchDebtors.mockResolvedValueOnce([]);
    await GestionManualPage();
    expect(vi.mocked(fetchDebtors).mock.calls.at(-1)?.[1]).toEqual({});
  });

  it("valúa la deuda al valor de cuota vigente que leyó, no a uno inventado", async () => {
    const feeValue = { validFrom: new Date("2026-07-01T12:00:00Z"), activeAmount: 6000, sharedAmount: 3000 };
    mocks.current.mockResolvedValueOnce(feeValue);
    mocks.fetchDebtors.mockResolvedValueOnce([]);
    await GestionManualPage();
    expect(vi.mocked(feeValueReader.current)).toHaveBeenCalled();
    expect(vi.mocked(fetchDebtors).mock.calls.at(-1)?.[2]).toBe(feeValue);
  });

  it("la ruta se autoriza sola: sin permisos vivos no se arma ninguna hoja", async () => {
    // El layout mira el token, que puede estar hasta 8 h desactualizado tras una
    // degradación. Acá hay teléfonos y deudas de vecinos reales.
    mocks.admin.mockResolvedValueOnce({ ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." });
    mocks.fetchDebtors.mockClear();
    const html = renderToStaticMarkup(await GestionManualPage());
    expect(html).toContain("Necesitás permisos de administrador.");
    expect(mocks.fetchDebtors).not.toHaveBeenCalled();
  });
});
