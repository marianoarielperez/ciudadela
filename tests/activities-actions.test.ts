import { beforeEach, describe, expect, it, vi } from "vitest";

// Comportamiento de las actions del calendario con el admin YA autorizado (la
// guarda en sí la fija `activities-actions-auth.test.ts`).
//
// Se asierta sobre los ARGUMENTOS que llegan a Prisma, no sobre "no explotó":
// que `findOverlap` esté probada en `activities-rules.test.ts` no prueba que la
// action la use ni que le pase el año correcto. El fake de `findMany` guarda sus
// argumentos por eso.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo.
const prismaMock = vi.hoisted(() => ({
  activity: {
    create: vi.fn(async () => ({ id: 99 })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    findUnique: vi.fn(),
    findMany: vi.fn(async () => [] as unknown[]),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 7 })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "10.0.0.9" }),
}));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/cache-tags";
import {
  createActivityAction,
  deleteActivityAction,
  updateActivityAction,
} from "@/app/admin/actividades/actions";

// Formulario con checkboxes: `weekdays` se repite una vez por día tildado, que
// es exactamente lo que manda el navegador.
const form = (entries: Record<string, string>, weekdays: number[] = [2, 4]) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  for (const d of weekdays) fd.append("weekdays", String(d));
  return fd;
};

const base = {
  name: "Taekwondo niños",
  room: "glass",
  startTime: "18:00",
  endTime: "19:30",
  year: "2026",
  active: "on",
};

// Fila tal como la devuelve la base (weekdays es una columna JSON).
const stored = (over: Record<string, unknown> = {}) => ({
  id: 5,
  name: "Gimnasia mujeres",
  room: "glass",
  weekdays: [2, 4],
  startTime: "18:00",
  endTime: "19:30",
  year: 2026,
  active: true,
  ...over,
});

const existing = (rows: ReturnType<typeof stored>[]) => {
  prismaMock.activity.findMany.mockImplementation(async () => rows);
};

describe("createActivityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.activity.create.mockImplementation(async () => ({ id: 99 }));
    existing([]);
  });

  it("persiste los días como array de enteros y el resto del horario tal cual", async () => {
    await createActivityAction({}, form(base, [4, 2, 2]));
    expect(prismaMock.activity.create).toHaveBeenCalledWith({
      data: {
        name: "Taekwondo niños",
        room: "glass",
        // Ordenados y sin repetidos, aunque el formulario los haya mandado así.
        weekdays: [2, 4],
        startTime: "18:00",
        endTime: "19:30",
        year: 2026,
        active: true,
      },
    });
  });

  // Los dos espacios que sumó el cliente: si el enum de zod no los acepta, el
  // formulario los ofrece y la action los rechaza con "Elegí el espacio.".
  it.each(["kitchen", "classroom"] as const)("acepta el espacio %s y lo persiste", async (room) => {
    await createActivityAction({}, form({ ...base, room }));
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ room }) }),
    );
  });

  it("busca los candidatos a solape SOLO del año que se está cargando", async () => {
    await createActivityAction({}, form(base));
    expect(prismaMock.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { year: 2026 } }),
    );
  });

  it("audita el alta con la IP de x-real-ip e invalida la caché del sitio público", async () => {
    await createActivityAction({}, form(base));
    expect(audit).toHaveBeenCalledWith({
      userId: 7,
      action: "activity_create",
      entity: "activity",
      entityId: 99,
      detail: { name: "Taekwondo niños", room: "glass", year: 2026 },
      ip: "10.0.0.9",
    });
    expect(updateTag).toHaveBeenCalledWith(CACHE_TAGS.activities);
    expect(redirect).toHaveBeenCalledWith("/admin/actividades");
  });

  it("rechaza el solapamiento NOMBRANDO a la actividad existente y no escribe nada", async () => {
    existing([stored({ name: "Gimnasia mujeres", startTime: "18:00", endTime: "19:30" })]);
    const result = await createActivityAction({}, form(base));
    expect(result.error).toBe(
      'Se superpone con "Gimnasia mujeres" (18:00–19:30) en el mismo salón. Ajustá el horario o los días.',
    );
    expect(prismaMock.activity.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("acepta el borde exacto: una termina 19:30 y la otra empieza 19:30", async () => {
    existing([stored({ startTime: "18:00", endTime: "19:30" })]);
    const result = await createActivityAction(
      {},
      form({ ...base, startTime: "19:30", endTime: "21:00" }),
    );
    expect(result).toBeUndefined();
    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1);
  });

  it("no hay solape si el salón es otro", async () => {
    existing([stored({ room: "historic" })]);
    await createActivityAction({}, form(base));
    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1);
  });

  it("no hay solape si no comparten ningún día", async () => {
    existing([stored({ weekdays: [1, 3] })]);
    await createActivityAction({}, form(base, [2, 4]));
    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1);
  });

  it("una actividad OCULTA no ocupa el salón: se guarda aunque se pise", async () => {
    existing([stored()]);
    // Sin `active`: el navegador simplemente no manda el checkbox destildado.
    const { name, room, startTime, endTime, year } = base;
    await createActivityAction({}, form({ name, room, startTime, endTime, year }));
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ active: false }) }),
    );
  });

  it("una actividad existente OCULTA tampoco bloquea el alta", async () => {
    existing([stored({ active: false })]);
    await createActivityAction({}, form(base));
    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1);
  });

  // ESTE es el criterio de aceptación de la task: `findOverlap` da por sentado
  // que start < end y compara `start < oEnd && oStart < end`. Con "20:00 a
  // 08:00" esa condición no se cumple contra NADA, así que sin esta guarda la
  // actividad entraría sin ningún control de solape.
  it("rechaza un rango invertido antes de siquiera consultar el solapamiento", async () => {
    existing([stored()]);
    const result = await createActivityAction(
      {},
      form({ ...base, startTime: "20:00", endTime: "08:00" }),
    );
    expect(result.error).toBe("La hora de fin tiene que ser posterior a la de inicio.");
    expect(prismaMock.activity.create).not.toHaveBeenCalled();
    // La guarda corre ANTES de findOverlap, no después: si se consultara la
    // base primero, el rango invertido pasaría por el comparador roto.
    expect(prismaMock.activity.findMany).not.toHaveBeenCalled();
  });

  it("rechaza un rango de duración cero", async () => {
    const result = await createActivityAction(
      {},
      form({ ...base, startTime: "18:00", endTime: "18:00" }),
    );
    expect(result.error).toBe("La hora de fin tiene que ser posterior a la de inicio.");
    expect(prismaMock.activity.create).not.toHaveBeenCalled();
  });

  it("exige al menos un día y lo dice en castellano", async () => {
    const result = await createActivityAction({}, form(base, []));
    expect(result.error).toBe("Elegí al menos un día de la semana.");
    expect(prismaMock.activity.create).not.toHaveBeenCalled();
  });

  it("rechaza una hora que no es HH:MM de 24 horas", async () => {
    const result = await createActivityAction({}, form({ ...base, startTime: "25:00" }));
    expect(result.error).toBe("Hora de inicio inválida.");
    expect(prismaMock.activity.create).not.toHaveBeenCalled();
  });

  it("rechaza un espacio que no existe", async () => {
    const result = await createActivityAction({}, form({ ...base, room: "quincho" }));
    expect(result.error).toBe("Elegí el espacio.");
    expect(prismaMock.activity.create).not.toHaveBeenCalled();
  });

  // Una server action es un endpoint HTTP público: un POST armado a mano con un
  // campo basura o directamente ausente es tráfico esperable, y lo que zod
  // devuelve termina en pantalla tal cual. Estos casos fijan que NINGUNO caiga en
  // el texto default de zod en inglés.
  it("un valor de visibilidad que no es 'on' se rechaza en castellano", async () => {
    const result = await createActivityAction({}, form({ ...base, active: "x" }));
    expect(result.error).toBe("Valor inválido para la visibilidad.");
    expect(prismaMock.activity.create).not.toHaveBeenCalled();
  });

  it.each(["name", "startTime", "endTime", "year", "room"] as const)(
    "un POST sin el campo %s se rechaza en castellano, no con el default de zod",
    async (missing) => {
      const entries = { ...base } as Record<string, string>;
      delete entries[missing];
      const result = await createActivityAction({}, form(entries));
      expect(result.error).toBeDefined();
      expect(result.error).not.toMatch(/Invalid input/);
      expect(prismaMock.activity.create).not.toHaveBeenCalled();
    },
  );
});

describe("updateActivityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.activity.findUnique.mockImplementation(async () => stored({ id: 5 }));
    existing([]);
  });

  it("no se compara contra sí misma: editar el nombre sin tocar el horario pasa", async () => {
    // La propia fila está entre los candidatos, igual que en producción.
    existing([stored({ id: 5 })]);
    const result = await updateActivityAction({}, form({ id: "5", ...base }));
    expect(result).toBeUndefined();
    expect(prismaMock.activity.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ name: "Taekwondo niños", weekdays: [2, 4] }),
    });
  });

  it("sí choca contra OTRA fila del mismo salón y año", async () => {
    existing([stored({ id: 5 }), stored({ id: 8, name: "Zumba" })]);
    const result = await updateActivityAction({}, form({ id: "5", ...base }));
    expect(result.error).toContain('"Zumba"');
    expect(prismaMock.activity.update).not.toHaveBeenCalled();
  });

  it("audita la edición e invalida la caché", async () => {
    await updateActivityAction({}, form({ id: "5", ...base }));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        action: "activity_update",
        entity: "activity",
        entityId: 5,
        ip: "10.0.0.9",
      }),
    );
    expect(updateTag).toHaveBeenCalledWith(CACHE_TAGS.activities);
    expect(redirect).toHaveBeenCalledWith("/admin/actividades");
  });

  it("una actividad que no existe no se edita", async () => {
    prismaMock.activity.findUnique.mockImplementation(async () => null);
    const result = await updateActivityAction({}, form({ id: "404", ...base }));
    expect(result.error).toBe("La actividad no existe.");
    expect(prismaMock.activity.update).not.toHaveBeenCalled();
  });

  it("un id que no es un entero positivo se rechaza en castellano", async () => {
    const result = await updateActivityAction({}, form({ id: "abc", ...base }));
    expect(result.error).toBe("Actividad inválida.");
    expect(prismaMock.activity.findUnique).not.toHaveBeenCalled();
  });
});

describe("deleteActivityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.activity.findUnique.mockImplementation(async () => stored({ id: 5 }));
  });

  it("borra y deja en el asiento lo que había, que después del delete ya no está", async () => {
    await deleteActivityAction({}, form({ id: "5" }, []));
    expect(prismaMock.activity.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(audit).toHaveBeenCalledWith({
      userId: 7,
      action: "activity_delete",
      entity: "activity",
      entityId: 5,
      detail: { name: "Gimnasia mujeres", room: "glass", year: 2026 },
      ip: "10.0.0.9",
    });
    expect(updateTag).toHaveBeenCalledWith(CACHE_TAGS.activities);
    expect(redirect).toHaveBeenCalledWith("/admin/actividades");
  });

  it("una actividad que no existe no se borra", async () => {
    prismaMock.activity.findUnique.mockImplementation(async () => null);
    const result = await deleteActivityAction({}, form({ id: "404" }, []));
    expect(result.error).toBe("La actividad no existe.");
    expect(prismaMock.activity.delete).not.toHaveBeenCalled();
  });
});
