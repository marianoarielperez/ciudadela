import { beforeEach, describe, expect, it, vi } from "vitest";

// El comportamiento de `createFeeValueAction` con el superadmin ya adentro. Va
// aparte del test de autorización por el mismo motivo que `config-actions.test`
// va aparte de `config-actions-auth.test`: la guarda y lo que la action hace
// una vez pasada la guarda se rompen por motivos distintos.
//
// Lo que se fija acá y no se ve en pantalla: los montos viajan a una columna
// Decimal(10,2) como STRING con dos decimales (un float ahí es redondeo
// silencioso sobre plata), la vigencia se guarda al mediodía UTC como toda
// fecha civil del proyecto, y el acta que no existe corta ANTES del insert —si
// no, el FK tiraría un error de Prisma en crudo en la cara del superadmin.

const prismaMock = vi.hoisted(() => ({
  feeValue: { create: vi.fn(async () => ({ id: 42 })) },
  // El tipo de retorno va explícito para que un caso pueda devolver un acta
  // que SÍ existe con `mockResolvedValueOnce`.
  minute: { findUnique: vi.fn(async (): Promise<{ id: number } | null> => null) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadmin: vi.fn(async () => ({ ok: true, actorId: 3 })),
}));
const auditMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { createFeeValueAction } from "@/app/admin/configuracion/actions";

function form(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

describe("createFeeValueAction como superadmin", () => {
  // Cada caso arranca sin llamadas previas: los `not.toHaveBeenCalled()` de los
  // rechazos no pueden depender de en qué orden corrieron los casos que sí
  // insertan. `clearAllMocks` limpia las llamadas, no las implementaciones.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("monto 0 rechaza con el mensaje de pantalla", async () => {
    const r = await createFeeValueAction({}, form({ activeAmount: "0", sharedAmount: "3000", validFrom: "2026-09-01" }));
    expect(r.error).toBe("El monto de activo tiene que ser mayor a cero.");
    expect(prismaMock.feeValue.create).not.toHaveBeenCalled();
  });

  it("sin fecha en el POST el mensaje sigue siendo en castellano", async () => {
    // Un POST armado a mano puede no traer la clave. Sin mensaje propio en
    // `z.string(...)`, zod devolvía acá su texto por defecto en inglés y la
    // pantalla lo mostraba tal cual.
    const r = await createFeeValueAction({}, form({ activeAmount: "6000", sharedAmount: "3000" }));
    expect(r.error).toBe("Ingresá desde cuándo rige el valor.");
  });

  it("fecha imposible rechaza", async () => {
    const r = await createFeeValueAction({}, form({ activeAmount: "6000", sharedAmount: "3000", validFrom: "2026-02-31" }));
    expect(r.error).toBe("La fecha de vigencia no es válida.");
  });

  it("acta inexistente rechaza sin insertar", async () => {
    const r = await createFeeValueAction({}, form({ activeAmount: "6000", sharedAmount: "3000", validFrom: "2026-09-01", minuteId: "99" }));
    expect(r.error).toBe("El acta seleccionada no existe.");
    expect(prismaMock.feeValue.create).not.toHaveBeenCalled();
  });

  it("válido inserta con string de 2 decimales, mediodía UTC, audita y redirige", async () => {
    await createFeeValueAction({}, form({ activeAmount: "8000", sharedAmount: "4000", validFrom: "2027-01-01" }));
    expect(prismaMock.feeValue.create).toHaveBeenCalledWith({
      data: {
        activeAmount: "8000.00",
        sharedAmount: "4000.00",
        validFrom: new Date(Date.UTC(2027, 0, 1, 12)),
        minuteId: null,
        createdById: 3,
      },
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "fee_value_create", entityId: 42 }));
    expect(redirect).toHaveBeenCalledWith("/admin/configuracion?cuota=1");
  });

  it("con acta existente, el id llega a la fila y al asiento", async () => {
    // El único caso que prueba que `minuteId` se escribe: en todos los demás el
    // acta no existe y la action corta antes del insert, así que el camino del
    // acta válida no lo tocaba nadie.
    prismaMock.minute.findUnique.mockResolvedValueOnce({ id: 12 });
    await createFeeValueAction({}, form({
      activeAmount: "9000", sharedAmount: "4500", validFrom: "2027-06-01", minuteId: "12",
    }));
    expect(prismaMock.minute.findUnique).toHaveBeenCalledWith({ where: { id: 12 }, select: { id: true } });
    expect(prismaMock.feeValue.create).toHaveBeenCalledWith({
      data: {
        activeAmount: "9000.00",
        sharedAmount: "4500.00",
        validFrom: new Date(Date.UTC(2027, 5, 1, 12)),
        minuteId: 12,
        createdById: 3,
      },
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "fee_value_create",
      detail: expect.objectContaining({ minuteId: 12, activeAmount: 9000, sharedAmount: 4500 }),
    }));
  });

  // Un POST armado a mano puede traer cualquier cosa en `minuteId`: era el
  // último mensaje de zod del archivo sin texto propio, y salía en inglés.
  it("minuteId no numérico rechaza en castellano y sin insertar", async () => {
    const r = await createFeeValueAction({}, form({
      activeAmount: "6000", sharedAmount: "3000", validFrom: "2026-09-01", minuteId: "abc",
    }));
    expect(r.error).toBe("El acta seleccionada no es válida.");
    expect(prismaMock.feeValue.create).not.toHaveBeenCalled();
  });

  it("minuteId negativo rechaza en castellano y sin insertar", async () => {
    const r = await createFeeValueAction({}, form({
      activeAmount: "6000", sharedAmount: "3000", validFrom: "2026-09-01", minuteId: "-3",
    }));
    expect(r.error).toBe("El acta seleccionada no es válida.");
    expect(prismaMock.feeValue.create).not.toHaveBeenCalled();
  });

  // `Decimal(10,2)` llega hasta 99.999.999,99: sin tope en el schema el INSERT
  // lo rechazaría MariaDB y el superadmin vería un error de Prisma en crudo.
  it("monto arriba del tope de la columna rechaza con una frase", async () => {
    const r = await createFeeValueAction({}, form({
      activeAmount: "100000000", sharedAmount: "3000", validFrom: "2026-09-01",
    }));
    expect(r.error).toBe("El monto no puede superar los $ 99.999.999.");
    expect(prismaMock.feeValue.create).not.toHaveBeenCalled();
  });
});
