import { beforeEach, describe, expect, it, vi } from "vitest";

// Lo que la action agrega al recorder y que no se ve desde `record.ts`: quién
// recibe la invitación de acceso al portal, y qué pasa con el acta cuando el
// lote entero se rechaza.
const prismaMock = vi.hoisted(() => ({
  application: { count: vi.fn() },
  member: { findUnique: vi.fn() },
  minute: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  movement: { count: vi.fn(async () => 0) },
  book: { count: vi.fn(async () => 0) },
}));
const recorderMock = vi.hoisted(() => ({ recordOne: vi.fn() }));
const tokensMock = vi.hoisted(() => ({
  issue: vi.fn(async () => "raw-token"),
  revokeForMember: vi.fn(async () => 0),
}));
const mailerMock = vi.hoisted(() => ({
  sendToMember: vi.fn<(input: Record<string, unknown>) => Promise<void>>(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 3 })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/tokens", () => ({ tokens: tokensMock }));
vi.mock("@/lib/email", () => ({ mailer: mailerMock }));
vi.mock("@/lib/applications/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/applications/record")>()),
  applicationRecorder: recorderMock,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers([["x-real-ip", "1.2.3.4"]]) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { recordApplicationsAction } from "@/app/admin/solicitudes/actions";
import { audit } from "@/lib/audit";

const MEMBER = {
  id: 99, fullName: "Perez Ana", email: "ana@example.com",
  emailStatus: "verified", userId: null as number | null,
};

const existingMinute = (ids: string[] = ["1"]) => {
  const fd = new FormData();
  for (const id of ids) fd.append("ids", id);
  fd.append("minuteId", "10");
  return fd;
};

const newMinute = (ids: string[] = ["1"]) => {
  const fd = new FormData();
  for (const id of ids) fd.append("ids", id);
  fd.append("minuteNew", "1");
  fd.append("minuteType", "board");
  fd.append("minuteNumber", "47");
  fd.append("minuteDate", "2026-08-20");
  return fd;
};

/** La action termina en `redirect`, que señaliza con una excepción. */
async function runExpectingRedirect(fd: FormData): Promise<string> {
  try {
    const state = await recordApplicationsAction({}, fd);
    throw new Error(`no redirigió: ${JSON.stringify(state)}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.startsWith("REDIRECT:")) throw e;
    return message.slice("REDIRECT:".length);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.application.count.mockResolvedValue(1);
  prismaMock.minute.findUnique.mockResolvedValue({ id: 10 });
  prismaMock.minute.create.mockResolvedValue({ id: 77 });
  prismaMock.movement.count.mockResolvedValue(0);
  prismaMock.book.count.mockResolvedValue(0);
  prismaMock.member.findUnique.mockResolvedValue({ ...MEMBER });
  mailerMock.sendToMember.mockResolvedValue(undefined);
  recorderMock.recordOne.mockResolvedValue({
    ok: true, applicationId: 1, memberId: 99, memberNumber: 306, reentry: false,
  });
});

// TERCERA propiedad del contrato con la Task 15: la invitación de acceso crea la
// contraseña de quien tenga ese buzón, así que NO puede salir hacia una
// dirección sin confirmar. La ficha que nace `declared` recibe la invitación
// recién cuando el vecino canjea su enlace de verificación.
describe("a quién le llega la invitación de acceso", () => {
  it("a la ficha con el email verificado y sin cuenta", async () => {
    await runExpectingRedirect(existingMinute());
    expect(tokensMock.revokeForMember).toHaveBeenCalledWith(99, ["password_invitation"]);
    expect(tokensMock.issue).toHaveBeenCalledWith({ purpose: "password_invitation", memberId: 99 });
    expect(mailerMock.sendToMember).toHaveBeenCalledTimes(1);
    expect(mailerMock.sendToMember.mock.calls[0][0]).toMatchObject({
      memberId: 99, to: "ana@example.com", type: "password_invitation",
    });
  });

  it("NUNCA a la ficha cuyo email no está verificado", async () => {
    prismaMock.member.findUnique.mockResolvedValue({ ...MEMBER, emailStatus: "declared" });
    await runExpectingRedirect(existingMinute());
    expect(tokensMock.issue).not.toHaveBeenCalled();
    expect(mailerMock.sendToMember).not.toHaveBeenCalled();
  });

  it("tampoco a la que rebotó", async () => {
    prismaMock.member.findUnique.mockResolvedValue({ ...MEMBER, emailStatus: "bounced" });
    await runExpectingRedirect(existingMinute());
    expect(mailerMock.sendToMember).not.toHaveBeenCalled();
  });

  it("ni a la que ya tiene cuenta: la contraseña ya la eligió", async () => {
    prismaMock.member.findUnique.mockResolvedValue({ ...MEMBER, userId: 55 });
    await runExpectingRedirect(existingMinute());
    expect(mailerMock.sendToMember).not.toHaveBeenCalled();
  });

  // El asiento societario ya está commiteado: un hipo del SMTP no puede
  // deshacerlo ni romperle la pantalla al operador.
  it("un fallo del correo no tumba el asiento ya firme", async () => {
    mailerMock.sendToMember.mockRejectedValue(Object.assign(new Error("smtp"), { code: "ECONN" }));
    const url = await runExpectingRedirect(existingMinute());
    expect(url).toBe("/admin/solicitudes?asentadas=1");
    expect(audit).toHaveBeenCalled();
  });
});

describe("el acta huérfana del asiento masivo", () => {
  it("no llega a crear el acta si ninguna de las elegidas es asentable", async () => {
    prismaMock.application.count.mockResolvedValue(0);
    const result = await recordApplicationsAction({}, newMinute(["1", "2"]));
    expect(result.error).toMatch(/Ninguna de las solicitudes elegidas/);
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(recorderMock.recordOne).not.toHaveBeenCalled();
  });

  // Compensación: la pre-validación dejó pasar (había una asentable) pero el
  // asiento la rechazó igual —carrera contra otro admin, DNI repetido—. El acta
  // recién creada no puede quedar en el libro sin un solo movimiento.
  it("descarta el acta recién creada cuando no se asentó ninguna", async () => {
    recorderMock.recordOne.mockResolvedValue({
      ok: false, applicationId: 1, error: "Baja por expulsión: el reingreso está prohibido.",
    });
    const result = await recordApplicationsAction({}, newMinute());
    expect(result.error).toMatch(/expulsión/);
    expect(prismaMock.minute.delete).toHaveBeenCalledWith({ where: { id: 77 } });
    expect(audit).not.toHaveBeenCalled();
  });

  it("no descarta un acta EXISTENTE que eligió el operador", async () => {
    recorderMock.recordOne.mockResolvedValue({ ok: false, applicationId: 1, error: "no" });
    await recordApplicationsAction({}, existingMinute());
    expect(prismaMock.minute.delete).not.toHaveBeenCalled();
  });

  it("con éxito parcial el acta se queda: ya tiene asientos reales adentro", async () => {
    recorderMock.recordOne
      .mockResolvedValueOnce({ ok: true, applicationId: 1, memberId: 99, memberNumber: 306, reentry: false })
      .mockResolvedValueOnce({ ok: false, applicationId: 2, error: "DNI repetido" });
    const url = await runExpectingRedirect(newMinute(["1", "2"]));
    expect(prismaMock.minute.delete).not.toHaveBeenCalled();
    expect(url).toBe("/admin/solicitudes?asentadas=1&fallidas=1");
  });
});

describe("el lote y su rastro", () => {
  it("rechaza el envío sin ninguna solicitud tildada", async () => {
    const fd = new FormData();
    fd.append("minuteId", "10");
    const result = await recordApplicationsAction({}, fd);
    expect(result.error).toMatch(/Elegí al menos una solicitud/);
    expect(prismaMock.application.count).not.toHaveBeenCalled();
  });

  it("exige un acta: sin ella no hay asiento", async () => {
    const fd = new FormData();
    fd.append("ids", "1");
    const result = await recordApplicationsAction({}, fd);
    expect(result.error).toMatch(/acta/i);
    expect(recorderMock.recordOne).not.toHaveBeenCalled();
  });

  it("asienta una sola vez cada solicitud aunque el id venga repetido", async () => {
    await runExpectingRedirect(existingMinute(["1", "1", "2"]));
    expect(recorderMock.recordOne).toHaveBeenCalledTimes(2);
  });

  // El detalle del asiento lleva ids y nada más: ni nombres ni DNIs (docs/08,
  // Ley 25.326). Y la IP sale de X-Real-IP, como en todo el panel.
  it("audita el lote con ids, el acta y la IP, sin datos personales", async () => {
    recorderMock.recordOne
      .mockResolvedValueOnce({ ok: true, applicationId: 1, memberId: 99, memberNumber: 306, reentry: false })
      .mockResolvedValueOnce({ ok: true, applicationId: 2, memberId: 7, memberNumber: null, reentry: true })
      .mockResolvedValueOnce({ ok: false, applicationId: 3, error: "no" });
    await runExpectingRedirect(existingMinute(["1", "2", "3"]));

    expect(audit).toHaveBeenCalledWith({
      userId: 3, action: "application_record", entity: "application",
      detail: { minuteId: 10, recorded: [1, 2], reentries: [2], failed: [3] },
      ip: "1.2.3.4",
    });
    expect(JSON.stringify(vi.mocked(audit).mock.calls[0][0])).not.toMatch(/Perez|ana@example/);
  });
});
