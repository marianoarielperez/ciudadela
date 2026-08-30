import { beforeEach, describe, expect, it, vi } from "vitest";

// Comportamiento de las actions con el admin YA autorizado (la guarda en sí la
// fija `documentos-actions-auth.test.ts`).
//
// Lo que se asierta acá son las tres invariantes que NO tienen respaldo en la
// base: "a lo sumo una norma destacada" —no hay unique que lo sostenga, `false`
// no es NULL, así que el `updateMany` que apaga la anterior es lo único que
// hay—, que el `size` persistido sea el que DEVOLVIÓ el store (bytes realmente
// escritos) y no `file.size`, que lo declara el caller y puede mentir, y que la
// edición IGNORE el `type` posteado: es la guarda anti-POST-forjado del módulo.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo.
const prismaMock = vi.hoisted(() => {
  const mock = {
    institutionalDocument: {
      create: vi.fn(async () => ({ id: 7 })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(),
      findUnique: vi.fn<(args: { where: { id: number } }) => Promise<unknown>>(),
    },
    // El doble le pasa al callback el mismo objeto, así los `expect` sobre
    // `institutionalDocument.*` siguen viendo las llamadas: lo que se verifica
    // es QUÉ se escribe, no el aislamiento del motor.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mock)),
  };
  return mock;
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 3 })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "10.0.0.9" }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// El store no toca el disco en los tests: devuelve un tamaño distinto del del
// File a propósito, para que se vea CUÁL de los dos se persiste.
vi.mock("@/lib/institutional-documents/storage", () => ({
  saveInstitutionalDocument: vi.fn(async () => ({ ok: true, fileName: "nuevo.pdf", size: 4242 })),
  deleteInstitutionalDocument: vi.fn(async () => {}),
}));

import {
  createDocumentAction,
  updateDocumentAction,
} from "@/app/admin/documentos/actions";

const form = (entries: Record<string, string>, file?: File) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  if (file) fd.append("file", file);
  return fd;
};

// 5 bytes, contra los 4242 que declara el store.
const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "x.pdf");

describe("alta de documentos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("una norma destacada apaga la destacada anterior, en la misma transacción", async () => {
    await createDocumentAction({}, form({ type: "norm", title: "Estatuto 2026", featured: "on" }, pdf()));

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.institutionalDocument.updateMany).toHaveBeenCalledWith({
      where: { type: "norm", featured: true },
      data: { featured: false },
    });
    expect(prismaMock.institutionalDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "norm", featured: true, uploadedById: 3 }),
      }),
    );
  });

  it("una norma NO destacada no toca a las demás", async () => {
    await createDocumentAction({}, form({ type: "norm", title: "Reglamento interno" }, pdf()));

    expect(prismaMock.institutionalDocument.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.institutionalDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ featured: false }) }),
    );
  });

  it("persiste el tamaño que devolvió el store, no el que declara el File", async () => {
    await createDocumentAction({}, form({ type: "balance", year: "2025" }, pdf()));

    expect(prismaMock.institutionalDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileName: "nuevo.pdf", size: 4242, yearKey: "balance:2025" }),
      }),
    );
  });
});

describe("edición de documentos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.institutionalDocument.findUnique.mockResolvedValue({
      id: 5,
      type: "norm",
      title: "Estatuto",
      description: null,
      year: null,
      yearKey: null,
      fileName: "viejo.pdf",
      size: 10,
      featured: false,
    });
  });

  it("al destacar una norma apaga las otras y se excluye a sí misma", async () => {
    await updateDocumentAction({}, form({ id: "5", type: "norm", title: "Estatuto", featured: "on" }));

    expect(prismaMock.institutionalDocument.updateMany).toHaveBeenCalledWith({
      where: { type: "norm", featured: true, id: { not: 5 } },
      data: { featured: false },
    });
    expect(prismaMock.institutionalDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        // Sin archivo nuevo queda el actual, con su tamaño.
        data: expect.objectContaining({ featured: true, fileName: "viejo.pdf", size: 10 }),
      }),
    );
  });

  it("sin cambio de destacado no barre nada", async () => {
    await updateDocumentAction({}, form({ id: "5", type: "norm", title: "Estatuto" }));

    expect(prismaMock.institutionalDocument.updateMany).not.toHaveBeenCalled();
  });

  // La fila 5 es una norma y el POST forjado dice "memoria 2025": si la action
  // tomara el `type` posteado, `prepareDocumentInput` le reescribiría el título
  // ("Memoria 2025") y le materializaría un `yearKey` de otro tipo. El título y
  // el yearKey que llegan al update son, entonces, la prueba de qué tipo mandó.
  it("ignora el tipo posteado y usa el de la fila", async () => {
    await updateDocumentAction(
      {},
      form({ id: "5", type: "annual_report", year: "2025", title: "Estatuto reformado" }),
    );

    expect(prismaMock.institutionalDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ title: "Estatuto reformado", yearKey: null }),
      }),
    );
  });

  it("al reemplazar el archivo persiste el tamaño que devolvió el store", async () => {
    await updateDocumentAction({}, form({ id: "5", type: "norm", title: "Estatuto" }, pdf()));

    expect(prismaMock.institutionalDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        // 4242 es lo que devuelve el store; el File declara 5.
        data: expect.objectContaining({ fileName: "nuevo.pdf", size: 4242 }),
      }),
    );
  });
});
