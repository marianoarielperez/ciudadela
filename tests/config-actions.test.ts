import { beforeEach, describe, expect, it, vi } from "vitest";

// Comportamiento de `updateConfigAction` con el superadmin YA autorizado (la
// guarda en sí la fija `config-actions-auth.test.ts`).
//
// Se asierta sobre los ARGUMENTOS que llegan a Prisma y a la auditoría, no sobre
// "no explotó": lo que esta pantalla tiene que garantizar es que la fila quede
// con `updated_by` escrito —la columna existe desde el Módulo 0 y hasta esta
// task no la completaba nadie— y que el asiento diga de qué valor a qué valor
// cambió cada clave. Un test que solo cuente llamadas no distingue ninguna de
// las dos cosas.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo.
const prismaMock = vi.hoisted(() => ({
  configuration: {
    findUnique: vi.fn<(args: { where: { key: string } }) => Promise<unknown>>(),
    upsert: vi.fn(async () => ({})),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadmin: vi.fn(async () => ({ ok: true, actorId: 3 })),
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
import { CONFIG_KEYS } from "@/lib/config";
import { updateConfigAction } from "@/app/admin/configuracion/actions";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

// Lo que el formulario manda cuando el superadmin prende el botón y carga los
// dos contactos.
const filled = {
  asociateActivo: "on",
  contactPhone: "297 4 123456",
  contactEmail: "vecinal@ejemplo.com",
};

/** Fija lo que hay guardado hoy, por clave. Una clave ausente del mapa devuelve
 *  `null`, que es lo que Prisma devuelve cuando la fila no existe. */
function stored(rows: Record<string, unknown>) {
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }) =>
    where.key in rows ? { key: where.key, value: rows[where.key], updatedBy: 1 } : null,
  );
}

describe("updateConfigAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored({});
    prismaMock.configuration.upsert.mockImplementation(async () => ({}));
  });

  it("escribe las tres claves con el superadmin en updated_by", async () => {
    await updateConfigAction({}, form(filled));
    expect(prismaMock.configuration.upsert).toHaveBeenCalledTimes(3);
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith({
      where: { key: CONFIG_KEYS.asociateActivo },
      update: { value: true, updatedBy: 3 },
      create: { key: CONFIG_KEYS.asociateActivo, value: true, updatedBy: 3 },
    });
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith({
      where: { key: CONFIG_KEYS.contactPhone },
      update: { value: "297 4 123456", updatedBy: 3 },
      create: { key: CONFIG_KEYS.contactPhone, value: "297 4 123456", updatedBy: 3 },
    });
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith({
      where: { key: CONFIG_KEYS.contactEmail },
      update: { value: "vecinal@ejemplo.com", updatedBy: 3 },
      create: { key: CONFIG_KEYS.contactEmail, value: "vecinal@ejemplo.com", updatedBy: 3 },
    });
  });

  it("audita de qué valor a qué valor cambió cada clave, con la IP de x-real-ip", async () => {
    stored({ [CONFIG_KEYS.asociateActivo]: false, [CONFIG_KEYS.contactPhone]: "297 111" });
    await updateConfigAction({}, form(filled));
    expect(audit).toHaveBeenCalledWith({
      userId: 3,
      action: "config_update",
      entity: "configuration",
      entityId: CONFIG_KEYS.asociateActivo,
      detail: { from: false, to: true },
      ip: "10.0.0.9",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: CONFIG_KEYS.contactPhone,
        detail: { from: "297 111", to: "297 4 123456" },
      }),
    );
    // Clave que no existía todavía: el asiento lo dice con `from: null` en vez de
    // inventar un valor anterior.
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: CONFIG_KEYS.contactEmail,
        detail: { from: null, to: "vecinal@ejemplo.com" },
      }),
    );
  });

  it("un guardado sin cambios no escribe ni deja asiento", async () => {
    stored({
      [CONFIG_KEYS.asociateActivo]: true,
      [CONFIG_KEYS.contactPhone]: "297 4 123456",
      [CONFIG_KEYS.contactEmail]: "vecinal@ejemplo.com",
    });
    const result = await updateConfigAction({}, form(filled));
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    // Pero el flujo sí termina: se redirige al aviso de guardado igual.
    expect(result).toBeUndefined();
    expect(redirect).toHaveBeenCalledWith("/admin/configuracion?guardado=1");
  });

  it("toca solo la clave que cambió y deja las otras dos quietas", async () => {
    stored({
      [CONFIG_KEYS.asociateActivo]: true,
      [CONFIG_KEYS.contactPhone]: "297 4 123456",
      [CONFIG_KEYS.contactEmail]: "vecinal@ejemplo.com",
    });
    await updateConfigAction({}, form({ ...filled, contactEmail: "otro@ejemplo.com" }));
    expect(prismaMock.configuration.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: CONFIG_KEYS.contactEmail } }),
    );
    expect(audit).toHaveBeenCalledTimes(1);
  });

  // ESTE es el punto de la pantalla: destildar el checkbox tiene que APAGAR el
  // alta de socios. El navegador no manda nada cuando está destildado, así que si
  // la action tratara la ausencia como "no tocar", el superadmin creería haber
  // cerrado el alta y seguiría abierta.
  it("destildar el botón ASOCIATE guarda false, no la ausencia del campo", async () => {
    stored({ [CONFIG_KEYS.asociateActivo]: true });
    await updateConfigAction({}, form({ contactPhone: "297 4 123456", contactEmail: "" }));
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: CONFIG_KEYS.asociateActivo },
        update: { value: false, updatedBy: 3 },
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: CONFIG_KEYS.asociateActivo,
        detail: { from: true, to: false },
      }),
    );
  });

  // Vaciar el campo guarda "" y NO un null de JSON: `configReader.getString` ya
  // trata "" como ausente, y el null de JSON obligaría a `Prisma.DbNull`.
  it("vaciar un contacto guarda la cadena vacía, no null", async () => {
    stored({ [CONFIG_KEYS.contactPhone]: "297 111" });
    await updateConfigAction({}, form({ asociateActivo: "on", contactPhone: "", contactEmail: "" }));
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: CONFIG_KEYS.contactPhone },
        update: { value: "", updatedBy: 3 },
      }),
    );
    // Y la clave que ya estaba vacía no se vuelve a escribir.
    stored({ [CONFIG_KEYS.contactPhone]: "" });
    vi.clearAllMocks();
    await updateConfigAction({}, form({ asociateActivo: "on", contactPhone: "", contactEmail: "" }));
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: CONFIG_KEYS.contactPhone } }),
    );
  });

  it("invalida la caché del sitio público y redirige al aviso de guardado", async () => {
    await updateConfigAction({}, form(filled));
    expect(updateTag).toHaveBeenCalledWith(CACHE_TAGS.config);
    expect(redirect).toHaveBeenCalledWith("/admin/configuracion?guardado=1");
  });

  // Una server action es un endpoint HTTP público: un POST armado a mano con un
  // campo basura es tráfico esperable y lo que zod devuelve termina en pantalla
  // tal cual. Estos casos fijan que NINGÚN mensaje caiga en el default en inglés.
  it("rechaza un email de contacto inválido en castellano y no escribe nada", async () => {
    const result = await updateConfigAction({}, form({ ...filled, contactEmail: "no-es-un-mail" }));
    expect(result.error).toBe("El email de contacto no es válido.");
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("rechaza un teléfono de más de 40 caracteres en castellano", async () => {
    const result = await updateConfigAction({}, form({ ...filled, contactPhone: "9".repeat(41) }));
    expect(result.error).toBe("El teléfono no puede superar los 40 caracteres.");
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });

  it("rechaza un email de más de 191 caracteres en castellano", async () => {
    const long = `${"a".repeat(190)}@ejemplo.com`;
    const result = await updateConfigAction({}, form({ ...filled, contactEmail: long }));
    expect(result.error).toBe("El email de contacto no puede superar los 191 caracteres.");
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });

  it("un valor de checkbox que no es 'on' se rechaza en castellano", async () => {
    const result = await updateConfigAction({}, form({ ...filled, asociateActivo: "true" }));
    expect(result.error).toBe("Valor inválido para el botón ASOCIATE.");
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });

  // La clave ausente NO es lo mismo que el valor vacío para zod (`undefined` vs
  // `""`), y los tres campos son opcionales justamente para que los dos casos
  // signifiquen "sin valor" sin caer nunca en "Invalid input: expected string,
  // received undefined".
  it.each(["asociateActivo", "contactPhone", "contactEmail"] as const)(
    "un POST sin el campo %s se acepta como 'sin valor' y no muestra el default de zod",
    async (missing) => {
      const entries = { ...filled } as Record<string, string>;
      delete entries[missing];
      const result = await updateConfigAction({}, form(entries));
      expect(result).toBeUndefined();
      expect(prismaMock.configuration.upsert).toHaveBeenCalled();
    },
  );

  it("ningún mensaje de error se escapa en inglés", async () => {
    const cases = [
      { ...filled, contactEmail: "no-es-un-mail" },
      { ...filled, contactPhone: "9".repeat(41) },
      { ...filled, asociateActivo: "true" },
    ];
    for (const c of cases) {
      const result = await updateConfigAction({}, form(c));
      expect(result.error).toBeDefined();
      expect(result.error).not.toMatch(/Invalid|Too big|Too small|expected/i);
    }
  });
});
