// Las dos actions de la exención de cuota (Art. 7 inc. a.4).
//
// Qué se fija acá, y por qué:
//
//   - **La guarda de rol.** Una server action NO se despacha por su URL: Next la
//     resuelve por el id del encabezado `Next-Action` contra un manifiesto
//     global, así que ni el proxy ni el layout de /admin la protegen (ver el
//     comentario largo de `require-admin.ts`). Asentar una exención le saca a la
//     asociación hasta 24 cuotas y anularla se asienta una sola vez con su acta:
//     las dos revalidan `requireSuperadmin()` en su PRIMERA línea, y acá se
//     verifica que un admin común no llegue ni al servicio ni al libro de actas.
//   - **El acta huérfana.** El servicio abre su propia transacción y puede
//     rechazar por regla estatutaria (deuda, débito vivo, otra exención). Si el
//     acta se creó para este asiento y el asiento no ocurrió, el acta queda
//     asentada sin ningún movimiento: basura en el libro que la asociación
//     presenta ante la IGJ. `discardUnusedMinute` corre SOLO si el acta era
//     nueva — una existente es del libro y no se toca.
//   - **Qué se audita.** Ids, períodos y conteos. Nunca el nombre del socio ni
//     nada que lo identifique más allá del id (Ley 25.326, docs/08).
//
// `discardUnusedMinute` y `resolveMinuteId` corren de verdad contra el doble de
// Prisma: son la mitad del comportamiento que se está probando. Lo único que se
// reemplaza es el servicio de exenciones (tiene su propia suite) y la guarda.
import { describe, expect, it, vi, beforeEach } from "vitest";

const auth = vi.hoisted(() => ({
  result: { ok: true, actorId: 9 } as
    | { ok: true; actorId: number }
    | { ok: false; reason: string; error: string },
}));
const service = vi.hoisted(() => ({ grant: vi.fn(), revoke: vi.fn() }));
const prismaMock = vi.hoisted(() => ({
  // La pre-validación del asiento: la ficha y su categoría. Por defecto un socio
  // activo y vigente, que es el camino que llega al servicio.
  member: {
    findUnique: vi.fn(
      async () =>
        ({ category: "active", status: "active" }) as
          | { category: string; status: string }
          | null,
    ),
  },
  minute: {
    findUnique: vi.fn(async ({ where }: { where: { id: number } }) => ({
      id: where.id,
      date: new Date("2024-05-10T12:00:00Z"),
    })),
    create: vi.fn(async () => ({ id: 77 })),
    delete: vi.fn(async () => ({ id: 77 })),
  },
  // Los siete referentes que consulta `discardUnusedMinute` antes de borrar.
  movement: { count: vi.fn(async () => 0) },
  book: { count: vi.fn(async () => 0) },
  application: { count: vi.fn(async () => 0) },
  reregistrationProcess: { count: vi.fn(async () => 0) },
  feeValue: { count: vi.fn(async () => 0) },
  feeExemption: {
    count: vi.fn(async () => 0),
    findUnique: vi.fn(async () => ({ memberId: 42, revokedAt: null }) as { memberId: number; revokedAt: Date | null } | null),
    // `activeExemption` corre DE VERDAD en la pre-validación del asiento (el
    // módulo se mockea spreando el original): por defecto no hay ninguna vigente.
    findFirst: vi.fn(async () => null as null | { id: number; toPeriod: string }),
  },
  // El séptimo (M7): un acta que respalda el tratamiento de una iniciativa.
  report: { count: vi.fn(async () => 0) },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: vi.fn(async () => auth.result) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// El servicio se reemplaza, pero las reglas PURAS del módulo (el `toPeriod` que
// va a la auditoría) se dejan reales: si divergieran, el asiento diría un mes
// distinto del que se eximió.
vi.mock("@/lib/treasury/exemptions", async (orig) => ({
  ...(await orig<typeof import("@/lib/treasury/exemptions")>()),
  exemptions: service,
}));

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { grantExemptionAction, revokeExemptionAction } from "@/app/admin/tesoreria/exenciones/actions";

const NOT_SUPERADMIN = {
  ok: false as const,
  reason: "not_admin",
  error: "Solo el superadmin puede cambiar la configuración.",
};

/** El formulario de alta tal como lo manda la pantalla. `over` pisa campos para
 *  el caso de cada test (acta existente, meses fuera de rango, etc). */
function grantForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string> = {
    memberId: "42",
    months: "12",
    fromPeriod: "2026-09",
    note: "Contribución en especie: pintura de la sede",
    // Modo "Acta nueva" del MinutePicker.
    minuteNew: "1",
    minuteType: "board",
    minuteNumber: "128",
    minuteDate: "2024-05-10",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== "") fd.append(k, v);
  return fd;
}

function revokeForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string> = {
    exemptionId: "5",
    minuteNew: "1",
    minuteType: "board",
    minuteNumber: "129",
    minuteDate: "2024-05-10",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== "") fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.result = { ok: true, actorId: 9 };
  prismaMock.member.findUnique.mockResolvedValue({ category: "active", status: "active" });
  prismaMock.feeExemption.findUnique.mockResolvedValue({ memberId: 42, revokedAt: null });
  prismaMock.feeExemption.findFirst.mockResolvedValue(null);
  prismaMock.minute.create.mockResolvedValue({ id: 77 });
});

describe("grantExemptionAction", () => {
  it("sin superadmin no llega al servicio, ni crea el acta, ni audita, ni redirige", async () => {
    auth.result = NOT_SUPERADMIN;
    const result = await grantExemptionAction({}, grantForm());
    expect(result?.error).toBe(NOT_SUPERADMIN.error);
    expect(service.grant).not.toHaveBeenCalled();
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("asienta la exención con el acta nueva y audita ids, períodos y conteos", async () => {
    service.grant.mockResolvedValue({
      ok: true,
      exemptionId: 31,
      periods: ["2026-09", "2026-10"],
      skippedPaid: ["2026-09"],
    });

    await grantExemptionAction({}, grantForm());

    expect(service.grant).toHaveBeenCalledWith({
      memberId: 42,
      fromPeriod: "2026-09",
      months: 12,
      minuteId: 77,
      note: "Contribución en especie: pintura de la sede",
      actorId: 9,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        action: "fee_exemption_create",
        entity: "member",
        entityId: 42,
        // 12 meses desde septiembre de 2026 terminan en AGOSTO de 2027: el
        // último mes es inclusive, y lo calcula la regla pura del dominio.
        detail: {
          exemptionId: 31,
          fromPeriod: "2026-09",
          toPeriod: "2027-08",
          months: 12,
          minuteId: 77,
          skippedPaid: ["2026-09"],
        },
      }),
    );
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/exenciones?asentada=1");
    expect(prismaMock.minute.delete).not.toHaveBeenCalled();
  });

  it("el asiento no lleva NINGÚN dato personal: sólo ids, períodos y conteos", async () => {
    service.grant.mockResolvedValue({ ok: true, exemptionId: 31, periods: [], skippedPaid: [] });
    await grantExemptionAction({}, grantForm());
    const entry = vi.mocked(audit).mock.calls[0][0];
    expect(Object.keys(entry.detail as object).sort()).toEqual(
      ["exemptionId", "fromPeriod", "minuteId", "months", "skippedPaid", "toPeriod"],
    );
    // La nota es texto libre del operador y puede nombrar a un tercero: se
    // guarda en el registro, que lee sólo el panel, y nunca en la auditoría.
    expect(JSON.stringify(entry)).not.toContain("pintura");
  });

  it("descarta el acta HUÉRFANA cuando el servicio rechaza el asiento", async () => {
    service.grant.mockResolvedValue({ ok: false, error: "El socio tiene 2 cuotas pendientes." });

    const result = await grantExemptionAction({}, grantForm());

    expect(result?.error).toBe("El socio tiene 2 cuotas pendientes.");
    expect(prismaMock.minute.delete).toHaveBeenCalledWith({ where: { id: 77 } });
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un acta EXISTENTE no se borra aunque el asiento falle: es del libro", async () => {
    service.grant.mockResolvedValue({ ok: false, error: "El socio ya tiene una exención vigente." });

    const result = await grantExemptionAction(
      {},
      grantForm({ minuteId: "12", minuteNew: "", minuteType: "", minuteNumber: "", minuteDate: "" }),
    );

    expect(result?.error).toBe("El socio ya tiene una exención vigente.");
    expect(prismaMock.minute.delete).not.toHaveBeenCalled();
  });

  // Las tres guardas BARATAS se pre-validan antes de crear el acta: son los
  // rechazos frecuentes, y con el acta creada primero cada uno dejaba un acta
  // huérfana que después había que salir a borrar.
  it("un ADHERENTE se corta ANTES de crear el acta, con el texto del dominio", async () => {
    prismaMock.member.findUnique.mockResolvedValue({ category: "adherent", status: "active" });

    const result = await grantExemptionAction({}, grantForm());

    expect(result?.error).toContain("Adherente");
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(prismaMock.minute.delete).not.toHaveBeenCalled();
    expect(service.grant).not.toHaveBeenCalled();
  });

  it("un socio SUSPENDIDO tampoco llega al libro de actas", async () => {
    prismaMock.member.findUnique.mockResolvedValue({ category: "active", status: "suspended" });
    const result = await grantExemptionAction({}, grantForm());
    expect(result?.error).toContain("Suspendido");
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(service.grant).not.toHaveBeenCalled();
  });

  it("una exención YA VIGENTE se corta antes del acta: es el rechazo más frecuente", async () => {
    prismaMock.feeExemption.findFirst.mockResolvedValue({ id: 3, toPeriod: "2027-08" });

    const result = await grantExemptionAction({}, grantForm());

    expect(result?.error).toContain("agosto 2027");
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(service.grant).not.toHaveBeenCalled();
  });

  it("un socio que no existe no crea el acta", async () => {
    prismaMock.member.findUnique.mockResolvedValue(null);
    const result = await grantExemptionAction({}, grantForm());
    expect(result?.error).toBe("El socio no existe.");
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
  });

  it("rechaza más de 24 meses sin tocar el libro de actas ni el servicio", async () => {
    const result = await grantExemptionAction({}, grantForm({ months: "25" }));
    expect(result?.error).toContain("24");
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(service.grant).not.toHaveBeenCalled();
  });

  it("rechaza un mes de inicio que no tiene forma de período", async () => {
    const result = await grantExemptionAction({}, grantForm({ fromPeriod: "2026-13" }));
    expect(result?.error).toContain("AAAA-MM");
    expect(service.grant).not.toHaveBeenCalled();
  });
});

describe("revokeExemptionAction", () => {
  it("sin superadmin no anula, ni crea el acta, ni audita, ni redirige", async () => {
    auth.result = NOT_SUPERADMIN;
    const result = await revokeExemptionAction({}, revokeForm());
    expect(result?.error).toBe(NOT_SUPERADMIN.error);
    expect(service.revoke).not.toHaveBeenCalled();
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("anula con su acta y audita contra el SOCIO de la exención", async () => {
    service.revoke.mockResolvedValue({ ok: true, removedFuture: 7 });

    await revokeExemptionAction({}, revokeForm());

    expect(service.revoke).toHaveBeenCalledWith({ exemptionId: 5, revokeMinuteId: 77, actorId: 9 });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "fee_exemption_revoke",
        entity: "member",
        entityId: 42,
        detail: { exemptionId: 5, revokeMinuteId: 77, removedFuture: 7 },
      }),
    );
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/exenciones?anulada=1");
  });

  it("una exención ya anulada corta ANTES de crear el acta", async () => {
    prismaMock.feeExemption.findUnique.mockResolvedValue({
      memberId: 42,
      revokedAt: new Date("2026-09-01T12:00:00Z"),
    });

    const result = await revokeExemptionAction({}, revokeForm());

    expect(result?.error).toContain("anulada");
    expect(prismaMock.minute.create).not.toHaveBeenCalled();
    expect(service.revoke).not.toHaveBeenCalled();
  });

  it("descarta el acta huérfana si el cerrojo del dominio gana la carrera", async () => {
    service.revoke.mockResolvedValue({
      ok: false,
      error: "Otro administrador ya la anuló: la anulación se asienta una sola vez, con su acta.",
    });

    const result = await revokeExemptionAction({}, revokeForm());

    expect(result?.error).toContain("Otro administrador");
    expect(prismaMock.minute.delete).toHaveBeenCalledWith({ where: { id: 77 } });
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
