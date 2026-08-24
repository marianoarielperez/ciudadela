import { beforeEach, describe, expect, it, vi } from "vitest";

// "Cancelar el débito" de la tabla Vinculadas (spec 4C §10, enmienda del
// 24/08/2026). Es el reintento al que apuntan los tres avisos de "Mercado Pago
// no aceptó cancelar el débito"; hasta esta acción la pantalla era de sólo
// lectura y el reintento real era entrar al panel de Mercado Pago.
//
// Lo que fija este archivo:
//   - las tres precondiciones se releen de la BASE, no del formulario: un POST
//     armado a mano no puede cortarle el débito a un socio vigente;
//   - un fallo de MP no toca el espejo local y deja al operador el id ENTERO,
//     que es lo único que le sirve para ir al panel de Mercado Pago;
//   - el asiento no lleva ni el nombre del socio ni el email del pagador.
const requireAdmin = vi.hoisted(() => vi.fn());
const cancelPreapproval = vi.hoisted(() => vi.fn());
const findUnique = vi.hoisted(() => vi.fn());
const updateMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: { cancelPreapproval } }));
vi.mock("@/lib/prisma", () => ({ prisma: { mpSubscription: { findUnique, updateMany } } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { cancelSubscriptionAction } from "@/app/admin/tesoreria/suscripciones/[preapprovalId]/cancelar/actions";

const PRE = "a69d4b7c9e65472bb46c0489897880af";

function form(preapprovalId = PRE) {
  const fd = new FormData();
  fd.append("preapprovalId", preapprovalId);
  return fd;
}

/** La fila tal cual la lee la acción: estado de la suscripción y del socio. */
function row(over: { status?: string; memberStatus?: string | null } = {}) {
  const memberStatus = over.memberStatus === undefined ? "withdrawn" : over.memberStatus;
  return {
    status: over.status ?? "authorized",
    member: memberStatus === null ? null : { id: 14, status: memberStatus },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, actorId: 3 });
  findUnique.mockResolvedValue(row());
  cancelPreapproval.mockResolvedValue(undefined);
  updateMany.mockResolvedValue({ count: 1 });
});

describe("cancelSubscriptionAction", () => {
  it("sin sesión de admin no llega a Mercado Pago", async () => {
    requireAdmin.mockResolvedValue({ ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." });
    expect(await cancelSubscriptionAction({}, form())).toEqual({ error: "Necesitás permisos de administrador." });
    expect(findUnique).not.toHaveBeenCalled();
    expect(cancelPreapproval).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("un id con forma rara no llega a Mercado Pago", async () => {
    const r = await cancelSubscriptionAction({}, form("../../etc/passwd"));
    expect(r.error).toBe("Suscripción inválida.");
    expect(cancelPreapproval).not.toHaveBeenCalled();
  });

  // La regla: sólo el débito de quien dejó de ser socio. Al vigente se le corta
  // dándolo de baja, que es lo que deja el acta.
  it("con el socio vigente no cancela nada, y dice por dónde se corta", async () => {
    findUnique.mockResolvedValue(row({ memberStatus: "active" }));
    const r = await cancelSubscriptionAction({}, form());
    expect(r.error).toContain("se cancela al registrar la baja");
    expect(cancelPreapproval).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("con el socio suspendido tampoco: sigue siendo socio", async () => {
    findUnique.mockResolvedValue(row({ memberStatus: "suspended" }));
    expect((await cancelSubscriptionAction({}, form())).error).toContain("sigue vigente");
    expect(cancelPreapproval).not.toHaveBeenCalled();
  });

  // Idempotente y SIN red: volver a cancelar una cancelada no gana nada y el
  // error que devolvería MP no significaría nada.
  it("una suscripción ya cancelada no se vuelve a cancelar", async () => {
    findUnique.mockResolvedValue(row({ status: "cancelled" }));
    expect(await cancelSubscriptionAction({}, form())).toEqual({ error: "Esa suscripción ya está cancelada." });
    expect(cancelPreapproval).not.toHaveBeenCalled();
  });

  it("una suscripción que el sistema no conoce no llega a Mercado Pago", async () => {
    findUnique.mockResolvedValue(null);
    expect((await cancelSubscriptionAction({}, form())).error).toContain("no está vinculada");
    expect(cancelPreapproval).not.toHaveBeenCalled();
  });

  it("cancela, marca el espejo local, asienta sin datos personales y vuelve a la lista", async () => {
    await cancelSubscriptionAction({}, form());
    expect(cancelPreapproval).toHaveBeenCalledWith(PRE);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { preapprovalId: PRE } }));
    const entry = vi.mocked(audit).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 3, action: "subscription_cancelled", entity: "mp_subscription", entityId: PRE,
      detail: { preapprovalId: PRE, memberId: 14, statusBefore: "authorized" },
    });
    expect(JSON.stringify(entry)).not.toMatch(/@/);
    expect(redirect).toHaveBeenCalledWith(`/admin/tesoreria/suscripciones?cancelada=${PRE}`);
  });

  // MEDIDO contra la API el 24/08/2026 (sandbox): MP acepta el salto
  // `pending` → `cancelled` y el recurso queda `cancelled`. Por eso la lista
  // NEGRA de `isKnownDead` alcanza y el botón se ofrece igual.
  it("una pending —que el vecino nunca autorizó— también se cancela", async () => {
    findUnique.mockResolvedValue(row({ status: "pending" }));
    await cancelSubscriptionAction({}, form());
    expect(cancelPreapproval).toHaveBeenCalledWith(PRE);
    expect(vi.mocked(audit).mock.calls[0][0]).toMatchObject({
      detail: expect.objectContaining({ statusBefore: "pending" }),
    });
  });

  // El SDK de MP no lanza `Error`: hace `throw await response.json()`, y ese
  // cuerpo puede arrastrar el `payer_email` del vecino (Ley 25.326).
  it("si MP no acepta: el espejo no se toca, el log va enmascarado y el operador se lleva el id entero", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    cancelPreapproval.mockRejectedValue({
      status: 404, message: "The preapproval does not exist for vecino@ejemplo.com",
      error: null, cause: [],
    });
    const r = await cancelSubscriptionAction({}, form());
    // El código lleva el status HTTP: MP manda `error: null` en el 404 y
    // `code || "unknown"` borraba lo único que distingue "ese id no existe" de
    // "el token no tiene permiso".
    expect(r.error).toContain("http_404");
    // El id ENTERO: la tabla sólo muestra 8 caracteres y el panel de MP pide el
    // id completo. Es un id de Mercado Pago, no un dato personal.
    expect(r.error).toContain(PRE);
    // El espejo local sigue diciendo la verdad: MP no la canceló.
    expect(updateMany).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("vecino@ejemplo.com");
    expect(logged).toContain("mp:cancelPreapproval");
    expect(logged).toContain("status=404");
    // El fallo queda asentado con su código: es lo que permite ver después
    // cuántas veces se reintentó y contra qué.
    expect(vi.mocked(audit).mock.calls[0][0]).toMatchObject({
      action: "subscription_cancel_failed",
      detail: { preapprovalId: PRE, memberId: 14, code: "http_404" },
    });
    spy.mockRestore();
  });

  // El espejo va DESPUÉS de MP y en su propio try: si acá falla, el débito ya
  // está cortado y decir que falló mandaría al operador a cancelar de nuevo algo
  // que ya no cobra.
  it("si el espejo local no se puede escribir, la cancelación se da por hecha igual", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    updateMany.mockRejectedValue(new Error("db caída"));
    await cancelSubscriptionAction({}, form());
    expect(vi.mocked(audit).mock.calls[0][0]).toMatchObject({ action: "subscription_cancelled" });
    expect(redirect).toHaveBeenCalledWith(`/admin/tesoreria/suscripciones?cancelada=${PRE}`);
    spy.mockRestore();
  });
});
