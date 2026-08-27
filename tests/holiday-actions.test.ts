// El ABM de feriados de /admin/configuracion (M6, cartelera).
//
// Lo que este archivo existe para impedir es UNA cosa, y no se ve en ninguna
// pantalla: que el alta escriba la fecha fuera del formato canónico del proyecto
// (mediodía UTC del día civil argentino). Una fila a medianoche UTC son las
// 21:00 del día ANTERIOR acá, así que el feriado se contaría el día equivocado
// —el 1° de enero pasaría a ser hábil— y encima la cobertura quedaría anotada en
// el año anterior, engañando a la guarda que `businessDayEnd` tiene justamente
// para eso. Y como el unique de la tabla es por INSTANTE y no por día, la base
// tampoco rechazaría la fila duplicada.
//
// El resultado de todo eso es un plazo de cartelera más corto que el que manda
// el Art. 5° ter, y de ese plazo cuelgan la validez de una baja y la ventana de
// recurso de un vecino.
import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  holiday: {
    create: vi.fn(async () => ({ id: 1 })),
    findUnique: vi.fn(async () => null as { id: number; date: Date; label: string } | null),
    delete: vi.fn(async () => ({})),
  },
}));
const requireMock = vi.hoisted(() => ({
  superadmin: vi.fn(async () => ({ ok: true, actorId: 1 })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: requireMock.superadmin }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createHolidayAction, deleteHolidayAction } from "@/app/admin/configuracion/actions";
import { audit } from "@/lib/audit";
import { civilDateUtc } from "@/lib/dates";
import { civilDayOf } from "@/lib/treasury/periods";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

function denySuperadmin() {
  requireMock.superadmin.mockResolvedValueOnce(
    { ok: false, error: "Solo el superadmin puede cambiar la configuración." } as unknown as Awaited<
      ReturnType<typeof requireMock.superadmin>
    >,
  );
}

describe("createHolidayAction", () => {
  it("escribe la fecha en el formato CANÓNICO del proyecto", async () => {
    prismaMock.holiday.create.mockClear();

    await createHolidayAction({}, form({ date: "2028-10-09", label: "Diversidad Cultural" }));

    const written = prismaMock.holiday.create.mock.calls.at(0)?.at(0) as unknown as {
      data: { date: Date; label: string };
    };
    expect(written.data.date).toEqual(civilDateUtc(2028, 10, 9));
    // La verificación que importa, dicha como la pregunta el propio cómputo de
    // días hábiles: la fila TIENE que ser su propio día civil.
    expect(civilDayOf(written.data.date).getTime()).toBe(written.data.date.getTime());
    expect(written.data.label).toBe("Diversidad Cultural");
  });

  it("un día que no existe en el calendario no se guarda", async () => {
    prismaMock.holiday.create.mockClear();
    // `civilDateUtc` rodaría "2028-02-31" al 02/03 en silencio, y quedaría
    // cargado un feriado en un día que nadie quiso.
    const result = await createHolidayAction({}, form({ date: "2028-02-31", label: "Inventado" }));

    expect(result?.error).toContain("no existe en el calendario");
    expect(prismaMock.holiday.create).not.toHaveBeenCalled();
  });

  it("un año tipeado de más tampoco se guarda: la cota va para los dos lados", async () => {
    prismaMock.holiday.create.mockClear();
    // El año se acotaba sólo por abajo (2020), así que un "9999" entraba como
    // fila válida —ningún unique lo rechaza— y quedaba para siempre en una
    // tabla de la que cuelgan plazos: el borrado sólo alcanza a los feriados
    // futuros, y ése lo es por otros ocho mil años.
    const result = await createHolidayAction({}, form({ date: "9999-01-01", label: "Año Nuevo" }));

    expect(result?.error).toContain("El año del feriado");
    expect(prismaMock.holiday.create).not.toHaveBeenCalled();
  });

  it("el año que viene sí entra: el tope no puede molestar al uso normal", async () => {
    prismaMock.holiday.create.mockClear();
    const nextYear = civilDayOf().getUTCFullYear() + 1;

    const result = await createHolidayAction({}, form({ date: `${nextYear}-01-01`, label: "Año Nuevo" }));

    expect(result?.error).toBeUndefined();
    expect(prismaMock.holiday.create).toHaveBeenCalled();
  });

  it("el día ya cargado se rechaza con una frase, no con un error de Prisma", async () => {
    prismaMock.holiday.create.mockClear();
    prismaMock.holiday.create.mockRejectedValueOnce(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );

    const result = await createHolidayAction({}, form({ date: "2028-01-01", label: "Año Nuevo" }));

    expect(result?.error).toBe("Ese día ya está cargado como feriado.");
  });

  it("sin superadmin no escribe ni audita", async () => {
    prismaMock.holiday.create.mockClear();
    vi.mocked(audit).mockClear();
    denySuperadmin();

    const result = await createHolidayAction({}, form({ date: "2028-01-01", label: "Año Nuevo" }));

    expect(result?.error).toContain("superadmin");
    expect(prismaMock.holiday.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("deleteHolidayAction", () => {
  it("borra un feriado futuro", async () => {
    prismaMock.holiday.delete.mockClear();
    const future = new Date(civilDayOf().getTime() + 30 * 24 * 60 * 60 * 1000);
    prismaMock.holiday.findUnique.mockResolvedValueOnce({ id: 7, date: future, label: "X" });

    await deleteHolidayAction({}, form({ id: "7" }));

    expect(prismaMock.holiday.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it("un feriado que ya pasó NO se borra", async () => {
    // La tabla conserva el calendario histórico: asentar una fijación con fecha
    // retroactiva es un camino que existe (el operador asienta el lunes el
    // cartel que colgó el viernes), y borrar el pasado le cambiaría el cómputo.
    prismaMock.holiday.delete.mockClear();
    const past = new Date(civilDayOf().getTime() - 30 * 24 * 60 * 60 * 1000);
    prismaMock.holiday.findUnique.mockResolvedValueOnce({ id: 7, date: past, label: "X" });

    const result = await deleteHolidayAction({}, form({ id: "7" }));

    expect(result?.error).toContain("ya pasó");
    expect(prismaMock.holiday.delete).not.toHaveBeenCalled();
  });

  it("sin superadmin no borra ni audita", async () => {
    prismaMock.holiday.delete.mockClear();
    vi.mocked(audit).mockClear();
    denySuperadmin();

    const result = await deleteHolidayAction({}, form({ id: "7" }));

    expect(result?.error).toContain("superadmin");
    expect(prismaMock.holiday.delete).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
