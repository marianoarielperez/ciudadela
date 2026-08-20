import { beforeEach, describe, expect, it, vi } from "vitest";

// `src/lib/config.ts` exporta el singleton `configReader = makeConfigReader(prisma)`,
// así que importarlo construye el PrismaClient real en tiempo de import. Los tests
// no deben depender de DATABASE_URL ni tocar una base viva: stubeamos el módulo,
// como en tests/audit.test.ts. Acá se ejercita `makeConfigReader` con un fake.
//
// El doble de prisma lee de `rows`, un objeto que cada test rellena: alcanza para
// los lectores cacheados (`getLegalTexts`), que no reciben la base por parámetro
// sino que usan el singleton.
const rows = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    configuration: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key in rows ? { key: where.key, value: rows[where.key] } : null,
    },
  },
}));
// `unstable_cache` fuera de Next no existe; acá el envoltorio no aporta nada al
// test —lo que se verifica es QUÉ lee el lector, no que se cachee— así que se
// reemplaza por la función tal cual, igual que en tests/config-actions.test.ts.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import { CONFIG_KEYS, getLegalTexts, makeConfigReader } from "@/lib/config";

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

  // Los textos legales son texto PLANO multilínea y el wizard los muestra con
  // `whitespace-pre-line`: el lector no puede aplanarlos. Recorta las puntas
  // (igual que cualquier otro valor) pero los saltos y las líneas en blanco de
  // adentro son parte del documento.
  it("getString conserva los saltos de línea internos", async () => {
    const texto = "Términos\n\n1. Primera cláusula.\n2. Segunda cláusula.";
    const reader = makeConfigReader(fakeDb({ terms: `\n${texto}\n  ` }));
    expect(await reader.getString("terms")).toBe(texto);
  });

  it("expone las claves del módulo 2", () => {
    expect(CONFIG_KEYS.asociateActivo).toBe("asociate_activo");
    expect(CONFIG_KEYS.contactPhone).toBe("contact_phone");
    expect(CONFIG_KEYS.contactEmail).toBe("contact_email");
  });

  it("expone las claves del módulo 3", () => {
    expect(CONFIG_KEYS.termsText).toBe("terms_text");
    expect(CONFIG_KEYS.privacyConsentText).toBe("privacy_consent_text");
    expect(CONFIG_KEYS.mpPlanActiveId).toBe("mp_plan_active_id");
    expect(CONFIG_KEYS.mpPlanSharedId).toBe("mp_plan_shared_id");
  });
});

describe("getLegalTexts", () => {
  beforeEach(() => {
    for (const key of Object.keys(rows)) delete rows[key];
  });

  it("devuelve los dos textos tal cual están guardados", async () => {
    rows[CONFIG_KEYS.termsText] = "Términos\n\n1. Primera cláusula.";
    rows[CONFIG_KEYS.privacyConsentText] = "Consentimiento\n\nLey 25.326.";
    expect(await getLegalTexts()).toEqual({
      terms: "Términos\n\n1. Primera cláusula.",
      privacyConsent: "Consentimiento\n\nLey 25.326.",
    });
  });

  // Sin cargar, la pantalla del wizard tiene que poder distinguir "todavía no hay
  // texto" de "hay un texto vacío": por eso null y no "".
  it("devuelve null por cada texto que falta o está vacío", async () => {
    rows[CONFIG_KEYS.termsText] = "   ";
    expect(await getLegalTexts()).toEqual({ terms: null, privacyConsent: null });
  });
});
