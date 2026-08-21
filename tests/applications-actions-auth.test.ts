import { beforeEach, describe, expect, it, vi } from "vitest";

// Una server action no se despacha por su URL sino por el id del encabezado
// `Next-Action` contra un manifiesto global, así que el proxy (matcher
// `/admin/:path*`) y el layout del panel NO la protegen: cada action es un
// endpoint público y el `requireAdmin()` que la abre es el único control.
//
// Acá pesa más que en cualquier otra bandeja: esta action CREA SOCIOS, les
// asigna número de libro y fecha de ingreso, y puede crear un acta de la
// Comisión Directiva. Un anónimo no puede llegar ni a leer la bandeja.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo.
const prismaMock = vi.hoisted(() => ({
  application: { count: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  member: { findUnique: vi.fn(), update: vi.fn() },
  minute: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  movement: { count: vi.fn() },
  book: { count: vi.fn() },
  mpSubscription: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
const recorderMock = vi.hoisted(() => ({ recordOne: vi.fn() }));
const tokensMock = vi.hoisted(() => ({ issue: vi.fn(), revokeForMember: vi.fn() }));
const mailerMock = vi.hoisted(() => ({ sendToMember: vi.fn(), sendToApplication: vi.fn() }));
const gatewayMock = vi.hoisted(() => ({
  updatePreapprovalAmount: vi.fn(), cancelPreapproval: vi.fn(),
}));
const feesMock = vi.hoisted(() => ({ getFeeAmounts: vi.fn(), planIdForCategory: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: false, reason: "anonymous", error: "Sesión inválida." })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/tokens", () => ({ tokens: tokensMock }));
vi.mock("@/lib/email", () => ({ mailer: mailerMock }));
vi.mock("@/lib/applications/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/applications/record")>()),
  applicationRecorder: recorderMock,
}));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: gatewayMock }));
vi.mock("@/lib/mp/plans", () => feesMock);
vi.mock("@/lib/members/account-email-notice", () => ({ accountEmailNotice: { announce: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  recategorizeApplicationAction, recordApplicationsAction, rejectApplicationAction,
} from "@/app/admin/solicitudes/actions";
import { audit } from "@/lib/audit";

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe("autorización de las actions de solicitudes", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<[string, FormData]> = [
    ["acta existente", form([["ids", "1"], ["ids", "2"], ["minuteId", "10"]])],
    [
      "acta nueva",
      form([
        ["ids", "1"], ["minuteNew", "1"], ["minuteType", "board"],
        ["minuteNumber", "47"], ["minuteDate", "2026-08-20"],
      ]),
    ],
  ];

  for (const [name, fd] of cases) {
    it(`asiento en acta (${name}): sin sesión devuelve error y no toca la base`, async () => {
      const result = await recordApplicationsAction({}, fd);

      expect(result.error).toBe("Sesión inválida.");
      // Ni siquiera se leen: un anónimo no tiene por qué enterarse de si las
      // solicitudes existen ni de en qué estado están.
      expect(prismaMock.application.count).not.toHaveBeenCalled();
      expect(prismaMock.member.findUnique).not.toHaveBeenCalled();
      // Nada de acta: la guarda corre ANTES de resolver el acta, así que ni
      // siquiera queda un asiento huérfano en el libro.
      expect(prismaMock.minute.create).not.toHaveBeenCalled();
      expect(recorderMock.recordOne).not.toHaveBeenCalled();
      // Ni correo ni enlaces de acceso.
      expect(tokensMock.issue).not.toHaveBeenCalled();
      expect(mailerMock.sendToMember).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    });
  }

  // El orden importa: la guarda va PRIMERO, antes de validar el formulario. Un
  // anónimo con un FormData vacío tiene que ver el error de sesión y no el de
  // "elegí al menos una solicitud", que ya sería información sobre la pantalla.
  it("la guarda corre antes que la validación del formulario", async () => {
    const result = await recordApplicationsAction({}, new FormData());
    expect(result.error).toBe("Sesión inválida.");
  });

  // Las dos decisiones del detalle son endpoints igual de públicos, y las dos
  // salen del sistema: una le cambia el monto del débito a un vecino, la otra
  // le cancela la suscripción, le retiene la cuota de ingreso y le bloquea el
  // DNI por seis meses.
  it("recategorizar: sin sesión no lee la solicitud ni llama a MP", async () => {
    const result = await recategorizeApplicationAction(
      {}, form([["applicationId", "5"], ["newCategory", "active"]]),
    );

    expect(result.error).toBe("Sesión inválida.");
    expect(prismaMock.application.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.application.update).not.toHaveBeenCalled();
    expect(feesMock.getFeeAmounts).not.toHaveBeenCalled();
    expect(gatewayMock.updatePreapprovalAmount).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("rechazar: sin sesión no crea acta, no cancela en MP y no manda correo", async () => {
    const result = await rejectApplicationAction(
      {}, form([["applicationId", "5"], ["minuteId", "10"]]),
    );

    expect(result.error).toBe("Sesión inválida.");
    expect(prismaMock.application.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(gatewayMock.cancelPreapproval).not.toHaveBeenCalled();
    expect(mailerMock.sendToApplication).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
