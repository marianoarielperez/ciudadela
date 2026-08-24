import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { fetchDebtors, parseDebtorFilters, rankDebtors } from "@/lib/treasury/debtors";

describe("parseDebtorFilters", () => {
  it("acepta nivel 2 o 4 y texto", () => {
    expect(parseDebtorFilters({ nivel: "4", q: " sosa " })).toEqual({ level: 4, q: "sosa" });
    expect(parseDebtorFilters({ nivel: "7" })).toEqual({});
  });
});

describe("rankDebtors", () => {
  it("ordena por cuotas adeudadas desc y luego por número", () => {
    const contactable = { lastPaidAt: null, phone: null, emailUsable: true, address: null } as const;
    const rows = rankDebtors([
      { memberId: 1, memberNumber: 213, fullName: "Martinez", category: "active", status: "active", pendingCount: 4, debt: 24000, level: 4, ...contactable },
      { memberId: 2, memberNumber: 144, fullName: "Skardius", category: "active", status: "active", pendingCount: 23, debt: 138000, level: 4, ...contactable },
      { memberId: 3, memberNumber: 100, fullName: "X", category: "active", status: "active", pendingCount: 4, debt: 24000, level: 4, ...contactable },
    ]);
    expect(rows.map((r) => r.memberNumber)).toEqual([144, 100, 213]);
  });
});

describe("fetchDebtors", () => {
  it("agrupa pendientes por socio vigente/suspendido y calcula deuda y nivel", async () => {
    const db = {
      fee: {
        groupBy: vi.fn(async () => [{ memberId: 1, _count: { _all: 23 } }, { memberId: 2, _count: { _all: 1 } }]),
      },
      member: {
        findMany: vi.fn(async () => [
          { id: 1, fullName: "Skardius Ana", category: "active", status: "active", memberships: [{ memberNumber: 144, book: { status: "open" } }], payments: [{ paidAt: new Date("2024-05-01T12:00:00Z") }] },
          { id: 2, fullName: "Uno", category: "collaborator", status: "suspended", memberships: [{ memberNumber: 7, book: { status: "open" } }], payments: [] },
        ]),
      },
    } as never;
    const rows = await fetchDebtors(db, {}, { activeAmount: 6000, sharedAmount: 3000 });
    expect(rows[0]).toMatchObject({ memberId: 1, memberNumber: 144, pendingCount: 23, debt: 138000, level: 4 });
    expect(rows[1]).toMatchObject({ memberId: 2, pendingCount: 1, debt: 3000, level: 1 });
  });

  it("pide el groupBy filtrado a socios vigentes o suspendidos: un dado de baja no vuelve a la lista", async () => {
    const groupBy = vi.fn(async () => []);
    const db = {
      fee: { groupBy },
      member: { findMany: vi.fn(async () => []) },
    } as never;
    await fetchDebtors(db, {}, null);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "pending", member: { status: { in: ["active", "suspended"] } } },
      }),
    );
  });

  it("cada fila dice si el socio tiene casilla utilizable y su teléfono", async () => {
    const db = {
      fee: { groupBy: vi.fn(async () => [{ memberId: 1, _count: { _all: 4 } }, { memberId: 2, _count: { _all: 2 } }]) },
      member: { findMany: vi.fn(async () => [
        { id: 1, fullName: "A", category: "active", status: "active", memberships: [], payments: [], email: "a@b.com", emailStatus: "verified", phone: "297-4000000" },
        { id: 2, fullName: "B", category: "active", status: "active", memberships: [], payments: [], email: "c@d.com", emailStatus: "bounced", phone: null },
      ]) },
    } as never;
    const rows = await fetchDebtors(db, {}, { activeAmount: 6000, sharedAmount: 3000 });
    expect(rows.find((r) => r.memberId === 1)).toMatchObject({ emailUsable: true, phone: "297-4000000" });
    // Una casilla que rebota no sirve para avisar: ese socio va a la lista de
    // gestión manual igual que el que no tiene email.
    expect(rows.find((r) => r.memberId === 2)).toMatchObject({ emailUsable: false, phone: null });
  });

  it("sin email no hay casilla utilizable, aunque el estado no sea 'bounced'", async () => {
    // El caso mayoritario del padrón real: 241 de 278 socios no tienen email
    // cargado y su `emailStatus` es `none`. Son ellos los que llenan la hoja.
    const db = {
      fee: { groupBy: vi.fn(async () => [{ memberId: 3, _count: { _all: 5 } }]) },
      member: { findMany: vi.fn(async () => [
        { id: 3, fullName: "C", category: "active", status: "active", memberships: [], payments: [], email: null, emailStatus: "none", phone: "297-4111111" },
      ]) },
    } as never;
    const rows = await fetchDebtors(db, {}, null);
    expect(rows[0]).toMatchObject({ emailUsable: false, phone: "297-4111111" });
  });

  it("arma el domicilio con la calle del catálogo, con el texto libre, o lo deja en null", async () => {
    // Es la columna que habilita la visita, que para el vecino sin teléfono ni
    // casilla es el único canal que queda. El formato no se inventa acá: sale de
    // `memberAddress`, la misma función que arma el padrón exportable.
    const db = {
      fee: { groupBy: vi.fn(async () => [
        { memberId: 1, _count: { _all: 2 } },
        { memberId: 2, _count: { _all: 2 } },
        { memberId: 3, _count: { _all: 2 } },
      ]) },
      member: { findMany: vi.fn(async () => [
        // Socio del barrio: la calle sale del catálogo.
        { id: 1, fullName: "A", category: "active", status: "active", memberships: [], payments: [], street: { name: "Pizarro, Francisco" }, streetText: null, streetNumber: "1250" },
        // Socio de afuera: texto libre.
        { id: 2, fullName: "B", category: "active", status: "active", memberships: [], payments: [], street: null, streetText: "Rivadavia", streetNumber: "870 B" },
        // Ficha sin domicilio: `null`, no una cadena vacía — la hoja imprime un
        // guión, que en papel se distingue de un error de impresión.
        { id: 3, fullName: "C", category: "active", status: "active", memberships: [], payments: [], street: null, streetText: null, streetNumber: null },
      ]) },
    } as never;
    const rows = await fetchDebtors(db, {}, null);
    expect(rows.find((r) => r.memberId === 1)?.address).toBe("Pizarro, Francisco 1250");
    expect(rows.find((r) => r.memberId === 2)?.address).toBe("Rivadavia 870 B");
    expect(rows.find((r) => r.memberId === 3)?.address).toBeNull();
  });

  it("con nivel 4 solo devuelve candidatos a cesantía", async () => {
    const db = {
      fee: { groupBy: vi.fn(async () => [{ memberId: 1, _count: { _all: 5 } }, { memberId: 2, _count: { _all: 2 } }]) },
      member: { findMany: vi.fn(async () => [
        { id: 1, fullName: "A", category: "active", status: "active", memberships: [], payments: [] },
        { id: 2, fullName: "B", category: "active", status: "active", memberships: [], payments: [] },
      ]) },
    } as never;
    const rows = await fetchDebtors(db, { level: 4 }, null);
    expect(rows.map((r) => r.memberId)).toEqual([1]);
    expect(rows[0].debt).toBeNull();
  });
});
