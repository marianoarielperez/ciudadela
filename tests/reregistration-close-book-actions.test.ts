// La action del cierre (etapa C): lo que se fija acá es el CONTRATO alrededor
// de la transacción, no la transacción misma (eso es
// `tests/reregistration-close-book.test.ts`):
//
//   - autorización de superadmin y confirmación explícita ANTES de tocar nada;
//   - anti-acta-huérfana: con bloqueos vivos ni se resuelve el acta, y si el
//     dominio rechaza, el acta recién creada se descarta;
//   - el asiento del cierre es ESTRICTO y post-commit: si falla, el operador lo
//     ve en el resumen (`asiento=0`) en vez de no enterarse nunca;
//   - EL TEST ESPEJO de la invalidación del caché: al cerrar, el sitio público
//     tiene que volver a ofrecer ASOCIATE, y esa línea (`updateTag`) ya faltó
//     una vez en esta fase sin que nadie lo notara.
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireMock = vi.hoisted(() => ({
  superadmin: vi.fn(async () => ({ ok: true, actorId: 4 })),
}));
const db = vi.hoisted(() => ({
  process: vi.fn(async () => ({
    id: 5,
    status: "second_instance",
    // Vencida: la precondición de la etapa se revalida contra la base.
    secondEndsAt: new Date("2026-08-01T12:00:00Z"),
  })),
  presentationCount: vi.fn(async () => 0),
}));
const domain = vi.hoisted(() => ({
  closeBook: vi.fn(),
}));

vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: requireMock.superadmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reregistrationProcess: { findUnique: db.process },
    presentation: { count: db.presentationCount },
  },
}));
vi.mock("@/lib/members/minute-form", async (orig) => ({
  ...(await orig<typeof import("@/lib/members/minute-form")>()),
  resolveMinuteId: vi.fn(async () => 77),
  discardUnusedMinute: vi.fn(async () => {}),
}));
vi.mock("@/lib/reregistration/close-book", () => ({
  BOOK_CLOSE_AUDIT_ACTION: "book_close",
  BOOK_AUDIT_ENTITY: "book",
  closeBookService: domain,
}));
vi.mock("@/lib/audit", () => ({ auditStrict: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.4"]])),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { closeBookAction } from "@/app/admin/reempadronamiento/cierre/confirmar/actions";
import { auditStrict } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { discardUnusedMinute, resolveMinuteId } from "@/lib/members/minute-form";

type MockedFn = ReturnType<typeof vi.fn>;

const OK_CLOSE = {
  ok: true as const,
  newBookId: 9,
  migrated: 3,
  oldBookId: 1,
  oldBookNumber: 1,
  newBookNumber: 2,
  withdrawnCount: 118,
};

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = { processId: "5", confirmar: "1", minuteId: "12", ...over };
  for (const [k, v] of Object.entries(base)) if (v !== "") fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMock.superadmin.mockResolvedValue({ ok: true, actorId: 4 });
  db.process.mockResolvedValue({
    id: 5,
    status: "second_instance",
    secondEndsAt: new Date("2026-08-01T12:00:00Z"),
  });
  db.presentationCount.mockResolvedValue(0);
  domain.closeBook.mockResolvedValue(OK_CLOSE);
});

describe("closeBookAction — autorización y confirmación", () => {
  it("sin superadmin no toca nada", async () => {
    requireMock.superadmin.mockResolvedValue({ ok: false, error: "Solo el superadmin puede." } as never);
    const state = await closeBookAction({}, form());
    expect(state.error).toContain("superadmin");
    expect(domain.closeBook).not.toHaveBeenCalled();
    expect(resolveMinuteId).not.toHaveBeenCalled();
  });

  it("sin la casilla de confirmación no resuelve ni el acta", async () => {
    const state = await closeBookAction({}, form({ confirmar: "" }));
    expect(state.error).toContain("confirmación");
    expect(resolveMinuteId).not.toHaveBeenCalled();
    expect(domain.closeBook).not.toHaveBeenCalled();
  });

  it("con la segunda instancia todavía corriendo, rechaza", async () => {
    db.process.mockResolvedValue({
      id: 5,
      status: "second_instance",
      secondEndsAt: new Date("2099-01-01T12:00:00Z"),
    });
    const state = await closeBookAction({}, form());
    expect(state.error).toContain("segunda instancia");
    expect(domain.closeBook).not.toHaveBeenCalled();
  });
});

describe("closeBookAction — anti acta huérfana", () => {
  it("con bloqueos vivos corta ANTES de resolver el acta", async () => {
    db.presentationCount.mockResolvedValue(3);
    const state = await closeBookAction({}, form());
    expect(state.error).toContain("bloqueantes");
    expect(resolveMinuteId).not.toHaveBeenCalled();
    expect(domain.closeBook).not.toHaveBeenCalled();
  });

  it("si la transacción rechaza, descarta el acta que ESTE cierre creó", async () => {
    domain.closeBook.mockResolvedValue({ ok: false, error: "Algo cambió después de la vista previa." });
    const state = await closeBookAction(
      {},
      form({ minuteId: "", minuteNew: "1", minuteType: "board", minuteNumber: "44", minuteDate: "2026-11-10" }),
    );
    expect(state.error).toContain("vista previa");
    expect(discardUnusedMinute).toHaveBeenCalledWith(expect.anything(), 77);
    expect(auditStrict).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("si la transacción rechaza con un acta EXISTENTE, no descarta nada", async () => {
    domain.closeBook.mockResolvedValue({ ok: false, error: "El Libro N° 1 ya está cerrado." });
    await closeBookAction({}, form());
    expect(discardUnusedMinute).not.toHaveBeenCalled();
  });
});

describe("closeBookAction — post-commit", () => {
  it("asienta el cierre con auditoría ESTRICTA: ids y conteos, nunca nombres", async () => {
    await closeBookAction({}, form());

    expect(auditStrict).toHaveBeenCalledTimes(1);
    const entry = (auditStrict as MockedFn).mock.calls[0][0] as {
      action: string; entity: string; entityId: number; detail: Record<string, unknown>;
    };
    expect(entry.action).toBe("book_close");
    expect(entry.entity).toBe("book");
    expect(entry.entityId).toBe(1);
    expect(entry.detail).toEqual({
      oldBookId: 1, newBookId: 9, migrated: 3, withdrawnCount: 118, minuteId: 77,
    });
    // El candado de docs/08: nada que parezca un nombre o un correo.
    const dump = JSON.stringify(entry.detail);
    expect(dump).not.toMatch(/@/);
    expect(dump).not.toMatch(/[A-Za-z]{4,}\s+[A-Za-z]{4,}/);
  });

  it("EL ESPEJO: invalida el caché del sitio público — sin eso ASOCIATE no vuelve", async () => {
    await closeBookAction({}, form());

    expect(updateTag).toHaveBeenCalledWith(CACHE_TAGS.config);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reempadronamiento");
  });

  it("redirige al resumen con los conteos del COMMIT, no de la vista previa", async () => {
    await closeBookAction({}, form());

    expect(redirect).toHaveBeenCalledTimes(1);
    const url = vi.mocked(redirect).mock.calls[0][0] as string;
    expect(url).toContain("/admin/reempadronamiento/cierre/confirmar?");
    expect(url).toContain("cerrado=1");
    expect(url).toContain("nuevo=2");
    expect(url).toContain("migrados=3");
    expect(url).toContain("bajas=118");
    expect(url).not.toContain("asiento");
  });

  it("si el asiento estricto falla, el cierre NO se convierte en error: el resumen lo dice", async () => {
    (auditStrict as MockedFn).mockRejectedValue(Object.assign(new Error("down"), { code: "P1001" }));
    await closeBookAction({}, form());

    // El caché se invalida igual (el libro YA está cerrado) y el redirect lleva
    // la marca para que el resumen muestre la advertencia.
    expect(updateTag).toHaveBeenCalledWith(CACHE_TAGS.config);
    const url = vi.mocked(redirect).mock.calls[0][0] as string;
    expect(url).toContain("asiento=0");
  });
});
