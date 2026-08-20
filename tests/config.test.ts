import { describe, expect, it, vi } from "vitest";

// `src/lib/config.ts` exporta el singleton `configReader = makeConfigReader(prisma)`,
// así que importarlo construye el PrismaClient real en tiempo de import. Los tests
// no deben depender de DATABASE_URL ni tocar una base viva: stubeamos el módulo,
// como en tests/audit.test.ts. Acá se ejercita `makeConfigReader` con un fake.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { CONFIG_KEYS, makeConfigReader } from "@/lib/config";

type Row = { key: string; value: unknown } | null;

function fakeDb(rows: Record<string, unknown>) {
  return {
    configuration: {
      findUnique: async ({ where }: { where: { key: string } }): Promise<Row> =>
        where.key in rows ? { key: where.key, value: rows[where.key] } : null,
    },
  } as never;
}

describe("makeConfigReader", () => {
  it("getBool: true solo con el JSON true estricto", async () => {
    const reader = makeConfigReader(fakeDb({ a: true, b: "true", c: 1, d: false }));
    expect(await reader.getBool("a")).toBe(true);
    expect(await reader.getBool("b")).toBe(false);
    expect(await reader.getBool("c")).toBe(false);
    expect(await reader.getBool("d")).toBe(false);
    expect(await reader.getBool("missing")).toBe(false);
  });

  it("getString: null si falta, no es string o es vacío", async () => {
    const reader = makeConfigReader(fakeDb({ tel: " 297-1234 ", vacio: "  ", num: 42 }));
    expect(await reader.getString("tel")).toBe("297-1234");
    expect(await reader.getString("vacio")).toBeNull();
    expect(await reader.getString("num")).toBeNull();
    expect(await reader.getString("missing")).toBeNull();
  });

  it("expone las claves del módulo 2", () => {
    expect(CONFIG_KEYS.asociateActivo).toBe("asociate_activo");
    expect(CONFIG_KEYS.contactPhone).toBe("contact_phone");
    expect(CONFIG_KEYS.contactEmail).toBe("contact_email");
  });
});
