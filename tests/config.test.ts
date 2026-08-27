import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `src/lib/config.ts` exporta el singleton `configReader = makeConfigReader(prisma)`,
// así que importarlo construye el PrismaClient real en tiempo de import. Los tests
// no deben depender de DATABASE_URL ni tocar una base viva: stubeamos el módulo,
// como en tests/audit.test.ts. Acá se ejercita `makeConfigReader` con un fake.
//
// El doble de prisma lee de `rows`, un objeto que cada test rellena: alcanza para
// los lectores cacheados (`getLegalTexts`), que no reciben la base por parámetro
// sino que usan el singleton.
const rows = vi.hoisted(() => ({}) as Record<string, unknown>);
// El proceso de re-empadronamiento que ve `openWizardProcess` (lo usa
// `getActiveReregistration`). Es un solo proceso porque la clave de
// configuración apunta a uno solo, y el fake HONRA el `where.id` que le dan en
// vez de devolver siempre la fila: un doble que ignora el where prueba que la
// función corre, no que consulte lo que dice consultar (lección de la fase 6B).
const processRow = vi.hoisted(
  () =>
    ({ current: null }) as {
      current: null | { id: number; status: string; firstEndsAt: Date; secondEndsAt: Date | null };
    },
);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    configuration: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key in rows ? { key: where.key, value: rows[where.key] } : null,
    },
    reregistrationProcess: {
      findUnique: async ({ where }: { where: { id: number } }) =>
        processRow.current !== null && processRow.current.id === where.id
          ? processRow.current
          : null,
    },
  },
}));
// `unstable_cache` fuera de Next no existe; acá el envoltorio no aporta nada al
// test —lo que se verifica es QUÉ lee el lector, no que se cachee— así que se
// reemplaza por la función tal cual, igual que en tests/config-actions.test.ts.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import {
  CONFIG_KEYS,
  getActiveReregistration,
  getLegalTexts,
  makeConfigReader,
  parseRecipients,
} from "@/lib/config";

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

// El lector que el SITIO PÚBLICO CACHEADO usa para saber si hay un
// re-empadronamiento en curso y hasta cuándo. Lo que se fija acá es la
// invariante que su docblock declara crítica y que hasta ahora sostenía sólo un
// comentario: EL PLAZO VIAJA COMO TEXTO, NUNCA COMO `Date`.
//
// Por qué importa: `unstable_cache` guarda el valor con `JSON.stringify`, así
// que un `Date` devuelto por la función cacheada vuelve como `Date` en el fallo
// de caché y como string en el acierto. Es un bug que sólo aparece en
// producción y bajo carga —en el test el envoltorio está mockeado y nunca
// serializa—, así que lo único que puede protegerlo es una aserción sobre el
// TIPO de lo que sale.
describe("getActiveReregistration", () => {
  // El reloj se congela: desde que `currentDeadline` calla los plazos vencidos,
  // "25/09/2026" sólo significa lo mismo si "hoy" no se mueve. Sólo `Date`: no
  // hay temporizadores en este camino y falsearlos colgaría los `await`.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T15:00:00Z")); // 12:00 en Argentina
  });
  afterAll(() => { vi.useRealTimers(); });

  beforeEach(() => {
    for (const key of Object.keys(rows)) delete rows[key];
    processRow.current = null;
  });

  function seedProcess(over: { status?: string; secondEndsAt?: Date } = {}) {
    rows[CONFIG_KEYS.reregistrationProcessId] = "7";
    processRow.current = {
      id: 7,
      status: over.status ?? "first_instance",
      firstEndsAt: new Date("2026-09-25T12:00:00.000Z"),
      secondEndsAt: over.secondEndsAt ?? null,
    };
  }

  it("con proceso abierto: el plazo sale como TEXTO ya formateado, no como Date", async () => {
    seedProcess();

    const result = await getActiveReregistration();

    expect(result).toEqual({ deadline: "25/09/2026" });
    // La aserción que vale: el tipo. `toEqual` sobre un string pasaría igual si
    // alguien devolviera un `Date` que casualmente se compare, y sobre todo no
    // diría nada del día en que el caché acierta.
    expect(typeof result?.deadline).toBe("string");
    expect(result?.deadline).not.toBeInstanceOf(Date);
  });

  it("sin proceso: null, y el sitio funciona como siempre", async () => {
    const result = await getActiveReregistration();

    expect(result).toBeNull();
  });
});

// Destinatarios del resumen diario a la Comisión (4C §6). El valor lo escribe el
// superadmin desde /admin/configuracion, pero el lector es DEFENSIVO a propósito:
// la clave puede haber quedado escrita por SQL a mano, y una dirección basura no
// puede tumbar el cron de la mañana.
describe("parseRecipients", () => {
  it("CSV → direcciones normalizadas, sin repetir y sin vacíos", () => {
    expect(parseRecipients(" A@B.com , a@b.com ,, c@d.org ")).toEqual(["a@b.com", "c@d.org"]);
  });
  it("null, vacío o basura sin arroba → nadie (el resumen simplemente no sale)", () => {
    expect(parseRecipients(null)).toEqual([]);
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("comision")).toEqual([]);
  });
  it("la clave está en el catálogo", () => {
    expect(CONFIG_KEYS.digestRecipients).toBe("digest_recipients");
  });
});
