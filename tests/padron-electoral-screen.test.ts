// La pantalla del padrón electoral (spec 4C §9), renderizada de verdad.
//
// Lo que se afirma acá es sobre PAPEL y sobre autorización, que es lo que no se
// puede ver desde el dominio: qué datos de los vecinos salen impresos y cuáles
// NO (Ley 25.326), que el moroso figure en vez de desaparecer, que una fecha
// basura no arme ningún padrón, y que un admin común no vea ni una fila.
//
// La cobertura sigue la partición del código:
//  - `ElectoralRollSheet` decide qué columnas salen impresas y qué dice la hoja.
//  - `PadronElectoralPage` decide quién puede verla, qué fecha usa y qué queda
//    asentado.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AdminDouble = { ok: boolean; actorId?: number; reason?: string; error?: string };

const mocks = vi.hoisted(() => ({
  superadmin: vi.fn(async (): Promise<AdminDouble> => ({ ok: true, actorId: 7 })),
  current: vi.fn(async (): Promise<unknown> => ({ activeAmount: 6000, sharedAmount: 3000 })),
  getBool: vi.fn(async () => false),
  buildRoll: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: mocks.superadmin }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: { current: mocks.current } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));
// El formulario del flag es un componente cliente con `useActionState`: se
// renderiza, pero su action arrastraría el cliente de Prisma a este test.
vi.mock("@/app/admin/padron-electoral/actions", () => ({ setElectionsFlagAction: vi.fn() }));

import PadronElectoralPage from "@/app/admin/padron-electoral/page";
import { ElectoralRollSheet } from "@/app/admin/padron-electoral/roll-sheet";
import { audit } from "@/lib/audit";
import { configReader } from "@/lib/config";
import { buildElectoralRoll, type ElectoralRoll, type ElectoralRow } from "@/lib/members/electoral";

vi.mock("@/lib/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/config")>()),
  configReader: { getBool: mocks.getBool, getString: vi.fn(async () => null) },
}));
vi.mock("@/lib/members/electoral", async (orig) => ({
  ...(await orig<typeof import("@/lib/members/electoral")>()),
  buildElectoralRoll: mocks.buildRoll,
}));

const AT = new Date("2026-11-15T12:00:00Z");
const GENERATED_AT = new Date("2026-11-10T18:30:00Z");

const row = (over: Partial<ElectoralRow> = {}): ElectoralRow => ({
  memberId: 1,
  memberNumber: 42,
  fullName: "Coñuecar, Marta",
  category: "active",
  joinedAt: new Date("2019-09-01T12:00:00Z"),
  arrears: 0,
  debt: 0,
  ...over,
});

const roll = (over: Partial<ElectoralRoll> = {}): ElectoralRoll => ({
  at: AT,
  period: "2026-11",
  considered: 0,
  withoutSeniority: [],
  enabled: [],
  toPurge: [],
  purgeFees: 0,
  purgeAmount: 0,
  ...over,
});

const sheet = (r: ElectoralRoll, valued = true, pastDate = false) =>
  renderToStaticMarkup(
    createElement(ElectoralRollSheet, { roll: r, valued, pastDate, generatedAt: GENERATED_AT }),
  );

const page = async (fecha?: string) =>
  renderToStaticMarkup(
    await PadronElectoralPage({ searchParams: Promise.resolve(fecha ? { fecha } : {}) }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.superadmin.mockResolvedValue({ ok: true, actorId: 7 });
  mocks.current.mockResolvedValue({ activeAmount: 6000, sharedAmount: 3000 });
  mocks.getBool.mockResolvedValue(false);
  mocks.buildRoll.mockResolvedValue(roll());
});

describe("ElectoralRollSheet — qué sale impreso", () => {
  it("lista al habilitado con las columnas de REG-31 y la fecha de ingreso", () => {
    const html = sheet(roll({ enabled: [row()] }));

    expect(html).toContain("Coñuecar, Marta");
    expect(html).toContain("42");
    expect(html).toContain("Activo");
    expect(html).toContain("01/09/2019");
  });

  it("no imprime el DNI ni el domicilio ni la casilla de nadie", () => {
    // La hoja se la lleva la Junta Electoral y en papel ya no queda ningún
    // control de acceso (Ley 25.326). Las columnas son las de REG-31.
    const html = sheet(roll({ enabled: [row()] }));

    expect(html).not.toContain("DNI");
    expect(html).not.toContain("Domicilio");
    expect(html).not.toContain("Teléfono");
    expect(html).not.toContain("Email");
  });

  it("al moroso lo LISTA con lo que tiene que pagar en la mesa, no lo excluye", () => {
    // La enmienda del 23/08/2026: el moroso purga hasta una hora antes y vota.
    const html = sheet(
      roll({
        toPurge: [row({ memberId: 2, fullName: "Gómez, Luis", arrears: 3, debt: 18000 })],
        purgeFees: 3,
        purgeAmount: 18000,
      }),
    );

    expect(html).toContain("Con deuda a purgar");
    expect(html).toContain("Gómez, Luis");
    expect(html).toContain("18.000");
    expect(html).toContain("no está excluido");
    expect(html).toContain("Total a purgar");
  });

  it("el bloque de habilitados no lleva columnas de plata", () => {
    const html = sheet(roll({ enabled: [row({ arrears: 5, debt: 15000 })] }));

    expect(html).not.toContain("A purgar</th>");
    expect(html).not.toContain("15.000");
  });

  it("dice de cuándo son sus números: una hoja de ayer se lee como la de hoy", () => {
    const html = sheet(roll({ enabled: [row()] }));

    expect(html).toContain("elección del 15/11/2026");
    expect(html).toContain("10/11/2026");
  });

  it("sin valor de cuota vigente lo dice en vez de imprimir un cero", () => {
    const html = sheet(roll({ toPurge: [row({ arrears: 2, debt: null })], purgeFees: 2 }), false);

    expect(html).toContain("No hay un valor de cuota vigente");
  });

  it("dice en el PAPEL que honorarios y vitalicios votan sin el piso de antigüedad", () => {
    // Si la nota afirmara que todos reúnen 90 días, la hoja mentiría sobre el
    // honorario recién distinguido (REG-30 sobre REG-31, decisión del 24/08/2026).
    const html = sheet(roll({ enabled: [row({ category: "honorary" })] }));

    expect(html).toContain("REG-30");
    expect(html).toMatch(/honorarios y vitalicios/i);
  });

  it("con una fecha PASADA avisa —en el papel— que mezcla dos relojes", () => {
    // La antigüedad es a la fecha pedida; la mora y la condición de socio son de
    // hoy. Sin este aviso, la hoja se lee como el padrón de aquel día y no lo es.
    const html = sheet(roll({ enabled: [row()] }), true, true);

    expect(html).toContain("Esta fecha ya pasó");
    expect(html).toContain("no sirve para resolver una impugnación");
    // No lleva `print:hidden`: el que lee el papel meses después es quien más lo
    // necesita.
    expect(html).not.toMatch(/print:hidden[^"]*">[^<]*Esta fecha ya pasó/);
  });

  it("a una fecha que no pasó no le cuelga el aviso", () => {
    expect(sheet(roll({ enabled: [row()] }))).not.toContain("Esta fecha ya pasó");
  });

  it("escribe el período en castellano y no el YYYY-MM crudo", () => {
    const html = sheet(roll({ enabled: [row()] }));

    expect(html).toContain("noviembre 2026");
    expect(html).not.toContain("2026-11");
  });

  it("al socio sin número de libro abierto lo lista con un guión, no lo esconde", () => {
    const html = sheet(roll({ enabled: [row({ memberNumber: null })] }));

    expect(html).toContain("Coñuecar, Marta");
    expect(html).toContain("—");
  });

  it("la nota del socio sin número sale SÓLO cuando hay alguno", () => {
    // Fuera de la ventana de un re-empadronamiento no hay ninguno, y la Junta
    // Electoral es un cuerpo de vecinos leyendo un papel: una frase que
    // describe una fila que no está los manda a buscarla por toda la hoja.
    const conNumero = sheet(roll({ enabled: [row()] }));
    expect(conNumero).toContain("orden alfabético por apellido");
    expect(conNumero).not.toContain("figura primero");

    const sinNumero = sheet(roll({ enabled: [row({ memberNumber: null })] }));
    expect(sinNumero).toContain("figura primero");

    // También cuando el sin número cae en el bloque de purga.
    const enPurga = sheet(roll({ toPurge: [row({ memberNumber: null, arrears: 2, debt: 12000 })] }));
    expect(enPurga).toContain("figura primero");
  });

  it("un bloque vacío no renderiza un thead sin filas", () => {
    const html = sheet(roll());

    expect(html).not.toContain("<thead");
    expect(html).toContain("Ningún socio queda habilitado a esta fecha.");
    expect(html).toContain("no hay nada que purgar");
    expect(html).toContain("alcanzan los 90 días de antigüedad");
  });

  it("lista al que no llega a los 90 días, con desde cuándo puede votar", () => {
    const html = sheet(
      roll({
        withoutSeniority: [
          row({ memberId: 9, fullName: "Nuevo, Vecino", joinedAt: new Date("2026-10-01T12:00:00Z") }),
        ],
      }),
    );

    expect(html).toContain("No habilitados por antigüedad");
    expect(html).toContain("Nuevo, Vecino");
    // enabledFrom: 01/10/2026 + 90 días.
    expect(html).toContain("30/12/2026");
    // La nota niega el trámite: si la Junta lo lee como "otra lista que puede
    // regularizar", el error es peor que no imprimirlo.
    expect(html).toContain("no hay trámite que lo modifique");
    // Y este bloque no publica deuda de nadie.
    expect(html).not.toContain("A purgar</th>");
  });

  it("con todos los considerados en edad, el bloque nuevo dice la buena noticia", () => {
    const html = sheet(roll({ enabled: [row()] }));

    expect(html).toContain("alcanzan los 90 días de antigüedad");
  });

  it("la cabecera de papel cuenta los TRES bloques", () => {
    const html = sheet(
      roll({
        enabled: [row()],
        withoutSeniority: [row({ memberId: 9, fullName: "Nuevo, Vecino" })],
      }),
    );

    expect(html).toContain("1 habilitados");
    expect(html).toContain("1 no habilitados por antigüedad");
  });

  it("los tres bloques salen en el orden de la pantalla", () => {
    const html = sheet(
      roll({
        enabled: [row()],
        toPurge: [row({ memberId: 2, arrears: 1, debt: 6000 })],
        withoutSeniority: [row({ memberId: 9, fullName: "Nuevo, Vecino" })],
      }),
    );

    expect(html.indexOf("Habilitados")).toBeLessThan(html.indexOf("Con deuda a purgar"));
    expect(html.indexOf("Con deuda a purgar")).toBeLessThan(
      html.indexOf("No habilitados por antigüedad"),
    );
  });

  it("la nota del socio sin número también dispara desde el bloque nuevo", () => {
    const html = sheet(roll({ withoutSeniority: [row({ memberNumber: null })] }));

    expect(html).toContain("figura primero");
  });

  it("cada bloque tiene su ancla para las stat cards", () => {
    const html = sheet(roll({ enabled: [row()] }));

    expect(html).toContain('id="habilitados"');
    expect(html).toContain('id="a-purgar"');
    expect(html).toContain('id="no-habilitados"');
  });

  it("el papel imprime la tabla y esconde las tarjetas; el móvil al revés", () => {
    const html = sheet(roll({ enabled: [row()] }));

    // La tabla vive en el wrapper que el papel muestra…
    expect(html).toContain("hidden md:block print:block");
    // …y las tarjetas apiladas en el que el papel esconde.
    expect(html).toContain("md:hidden print:hidden");
  });
});

describe("PadronElectoralPage", () => {
  it("bloquea al admin común sin armar ningún padrón", async () => {
    mocks.superadmin.mockResolvedValue({
      ok: false,
      reason: "not_admin",
      error: "Solo el superadmin puede cambiar la configuración.",
    });

    const html = await page("2026-11-15");

    expect(html).toContain("Solo el superadmin");
    expect(buildElectoralRoll).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(html).not.toContain("Exportar CSV");
  });

  it("usa la fecha de la URL, no el reloj", async () => {
    await page("2026-11-15");

    expect(vi.mocked(buildElectoralRoll).mock.calls[0][1]).toEqual(AT);
  });

  it("rechaza una fecha inválida sin tocar la base ni auditar", async () => {
    const html = await page("2026-02-31");

    expect(html).toContain("La fecha de la elección no es válida.");
    expect(buildElectoralRoll).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    // Sin padrón no hay nada que exportar ni que imprimir.
    expect(html).not.toContain("Exportar CSV");
  });

  it("deja asiento al generar, con la fecha usada y los tamaños — nunca un nombre", async () => {
    mocks.buildRoll.mockResolvedValue(
      roll({
        enabled: [row()],
        toPurge: [row({ memberId: 2, fullName: "Gómez, Luis", arrears: 3, debt: 18000 })],
        purgeFees: 3,
        purgeAmount: 18000,
      }),
    );

    await page("2026-11-15");

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(audit).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7,
      action: "electoral_roll_generated",
      detail: { at: "2026-11-15", enabled: 1, toPurge: 1, purgeFees: 3 },
      ip: "10.0.0.7",
    });
    const serialized = JSON.stringify(entry.detail);
    expect(serialized).not.toContain("Coñuecar");
    expect(serialized).not.toContain("Gómez");
  });

  it("lleva el link de exportación a la misma fecha que muestra", async () => {
    const html = await page("2026-11-15");

    expect(html).toContain("/api/admin/padron-electoral?fecha=2026-11-15");
  });

  it("muestra la cuenta completa y no sólo el resultado", async () => {
    // "148 habilitados" sólo se puede creer. La igualdad se puede verificar, y es
    // lo que distingue "tres son demasiado nuevos" de "tres faltan por un
    // problema de datos" (que es un derecho político negado en silencio).
    mocks.buildRoll.mockResolvedValue(
      roll({
        considered: 4,
        withoutSeniority: [row({ memberId: 9, fullName: "Nuevo, Vecino", joinedAt: new Date("2026-10-01T12:00:00Z") })],
        enabled: [row(), row({ memberId: 3 })],
        toPurge: [row({ memberId: 2, arrears: 3, debt: 18000 })],
        purgeFees: 3,
        purgeAmount: 18000,
      }),
    );

    const html = await page("2026-11-15");

    expect(html).toContain("socios vigentes considerados");
    expect(html).toContain("sin antigüedad");
    expect(html).toContain("A purgar en la mesa");
  });

  it("le avisa a la hoja cuando la fecha pedida ya pasó, y sólo entonces", async () => {
    // El padrón se regenera meses después para contestar una impugnación: ahí la
    // hoja mezcla la antigüedad de aquel día con la mora de hoy y tiene que
    // decirlo. La comparación es contra el día civil argentino.
    mocks.buildRoll.mockImplementation(async (_db: unknown, at: Date) =>
      roll({ at, enabled: [row()] }),
    );

    expect(await page("2020-06-15")).toContain("Esta fecha ya pasó");
    expect(await page("2099-11-15")).not.toContain("Esta fecha ya pasó");
  });

  it("ofrece el interruptor de elecciones con el estado guardado", async () => {
    mocks.getBool.mockResolvedValue(true);

    const html = await page("2026-11-15");

    expect(vi.mocked(configReader.getBool)).toHaveBeenCalledWith("elecciones_en_curso");
    expect(html).toContain("Hay elecciones en curso");
    expect(html).toContain("bloquea los cambios de categoría");
  });
});
