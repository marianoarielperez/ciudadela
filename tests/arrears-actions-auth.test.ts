import { describe, expect, it, vi } from "vitest";

// Los dobles se tipan a mano: sin esto, `vi.fn(async () => [])` infiere
// `never[]` y `vi.fn(async () => ({ ok: false, ... }))` infiere un objeto sin
// `actorId`, y cada `mockResolvedValueOnce` del cuerpo no compila.
type AdminDouble = { ok: boolean; actorId?: number; reason?: string; error?: string };
type MemberDouble = {
  id: number; fullName: string; status: string; category: string;
  memberships?: { memberNumber: number; book: { status: string } }[];
};
type FeeGroup = { memberId: number; _count: { _all: number } };
// Sin este tipo, `cancelled: []` infiere `never[]` y ningún `mockResolvedValueOnce`
// con un preapprovalId adentro compila.
type DebitsDouble = {
  debits: { cancelled: string[]; failed: Array<{ preapprovalId: string; code: string }> };
};

const mocks = vi.hoisted(() => ({
  // El lote pasa por `withdrawWithDebits`, no por `memberService.withdraw`: es
  // el camino que además CANCELA el débito automático en Mercado Pago. Por
  // defecto devuelve el desenlace feliz (nada abierto).
  withdraw: vi.fn(async (): Promise<DebitsDouble> => ({ debits: { cancelled: [], failed: [] } })),
  audit: vi.fn(async () => {}),
  admin: vi.fn(async (): Promise<AdminDouble> => ({ ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." })),
  prisma: {
    member: {
      findMany: vi.fn(async (args: { where: { id: { in: number[] } } }): Promise<MemberDouble[]> => {
        void args;
        return [];
      }),
    },
    fee: {
      count: vi.fn(async () => 5),
      groupBy: vi.fn(async (): Promise<FeeGroup[]> => []),
    },
    minute: {
      findUnique: vi.fn(async () => ({
        id: 3, type: "board", number: 12, date: new Date("2026-08-12T12:00:00Z"),
      })),
      create: vi.fn(),
      delete: vi.fn(),
    },
    movement: { count: vi.fn(async () => 0) },
    book: { count: vi.fn(async () => 0) },
    application: { count: vi.fn(async () => 0) },
    // Los otros tres referentes de un acta que mira `discardUnusedMinute`. Sin
    // ellos el `count` que falta tira un TypeError que el propio `catch` de la
    // función se traga: el acta NO se borra y el fallo aparece acá como una
    // aserción de borrado que no ocurrió.
    reregistrationProcess: { count: vi.fn(async () => 0) },
    feeValue: { count: vi.fn(async () => 0) },
    feeExemption: { count: vi.fn(async () => 0) },
    // Séptimo referente de `discardUnusedMinute` (M7).
    report: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/members/withdraw-with-debits", () => ({
  withdrawWithDebits: { withdraw: mocks.withdraw },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import type { MinuteSelection } from "@/lib/members/minute-form";
import { arrearsConfirmToken } from "@/lib/treasury/arrears-confirm";
import { ARREARS_BATCH_MAX } from "@/lib/treasury/rules";
import { declareArrearsAction } from "@/app/admin/tesoreria/deudores/actions";

function form(ids: string, minuteId = "3") {
  const f = new FormData();
  f.append("ids", ids);
  f.append("minuteMode", "existing");
  f.append("minuteId", minuteId);
  return f;
}

// El segundo paso: lo que manda el botón "Confirmar la cesantía" de la pantalla
// de confirmación. Sin esto la acción sólo devuelve la lista para revisar.
function confirmed(f: FormData, ids: number[], sel: MinuteSelection): FormData {
  f.append("confirmar", "1");
  f.append("confirmToken", arrearsConfirmToken(ids, sel));
  return f;
}

describe("declareArrearsAction", () => {
  it("sin admin no da de baja a nadie", async () => {
    const r = await declareArrearsAction({}, form("1,2"));
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sin selección avisa", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    expect((await declareArrearsAction({}, form(""))).error).toBe("Seleccioná al menos un socio.");
  });

  // Tope de lote (`ARREARS_BATCH_MAX`). Desde la 4C cada baja suma ~1,2 s de
  // llamada a Mercado Pago: un lote de 50 se pasa del `proxy_read_timeout` de
  // Nginx (60 s por defecto) y ahí las bajas quedan HECHAS pero la respuesta se
  // pierde — y con ella `debitFailures`, el único aviso de que a esos ex socios
  // se les sigue cobrando. Se corta antes de tocar el padrón y el libro de actas.
  it("un lote más grande que el tope no da de baja a nadie ni crea acta", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const many = Array.from({ length: ARREARS_BATCH_MAX + 1 }, (_, i) => i + 1).join(",");
    const r = await declareArrearsAction({}, form(many));
    expect(r.error).toContain(`hasta ${ARREARS_BATCH_MAX} por vez`);
    expect(mocks.prisma.member.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.minute.create).not.toHaveBeenCalled();
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  it("un lote exactamente en el tope sí se procesa", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const ids = Array.from({ length: ARREARS_BATCH_MAX }, (_, i) => i + 1);
    mocks.prisma.member.findMany.mockResolvedValueOnce(
      ids.map((id) => ({
        id, fullName: `S${id}`, status: "active", category: "active",
        memberships: [{ memberNumber: id, book: { status: "open" } }],
      })),
    );
    const r = await declareArrearsAction({}, form(ids.join(",")));
    // Llega al primer paso (la confirmación), que es lo que prueba que el tope
    // no mordió: la lista para leer antes de expulsar a nadie.
    expect(r.error).toBeUndefined();
    expect(r.confirm?.targets).toHaveLength(ARREARS_BATCH_MAX);
  });

  it("da de baja por mora a cada seleccionado con ≥4 pendientes, audita y redirige", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.prisma.member.findMany.mockResolvedValueOnce([
      { id: 1, fullName: "A", status: "active", category: "active" },
      { id: 2, fullName: "B", status: "active", category: "active" },
    ]);
    mocks.prisma.fee.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
    mocks.withdraw.mockResolvedValue({ debits: { cancelled: [], failed: [] } });
    await declareArrearsAction({}, confirmed(form("1,2"), [1, 2], { minuteId: 3 }));
    expect(mocks.withdraw).toHaveBeenCalledTimes(1);
    expect(mocks.withdraw).toHaveBeenCalledWith(expect.objectContaining({ memberId: 1, reason: "arrears", minuteId: 3, actorId: 9 }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "arrears_declared", entity: "member", entityId: 1, detail: { minuteId: 3, pendingCount: 5, debitsCancelled: [], debitsFailed: [] } }));
    // El 2 no llega a 4 cuotas: queda como fallo y no se redirige (éxito parcial).
    expect(redirect).not.toHaveBeenCalled();
  });

  // El formulario real NO manda una lista separada por comas: manda un campo
  // `ids` por cada checkbox tildado. Con `formData.get("ids")` se declararía la
  // cesantía de UNO SOLO y el operador creería haber dado de baja a todos.
  //
  // El mock de `findMany` HONRA su `where`: filtra el padrón fijo por los ids
  // que la acción realmente pidió. Si `getAll` se revierte a `get`, la acción
  // sólo pide el id 5 y ni la aserción sobre `findMany` ni la de `withdaw` (2
  // veces) pueden pasar con datos que la acción nunca solicitó.
  it("acepta la selección como un campo por socio (checkboxes nativos)", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const roll: MemberDouble[] = [
      { id: 5, fullName: "C", status: "active", category: "active" },
      { id: 6, fullName: "D", status: "active", category: "collaborator" },
    ];
    mocks.prisma.member.findMany.mockImplementationOnce(async (args: { where: { id: { in: number[] } } }) =>
      roll.filter((m) => args.where.id.in.includes(m.id)),
    );
    mocks.prisma.fee.count.mockResolvedValueOnce(4).mockResolvedValueOnce(11);
    const f = new FormData();
    f.append("ids", "5");
    f.append("ids", "6");
    f.append("minuteMode", "existing");
    f.append("minuteId", "3");
    await declareArrearsAction({}, confirmed(f, [5, 6], { minuteId: 3 }));
    // Pinea el INPUT parseado, no sólo el resultado: un `findMany` que ignora
    // su `where` (o una acción que sólo parseó el primer checkbox) no puede
    // hacer pasar esta aserción con datos que nunca se pidieron.
    expect(mocks.prisma.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [5, 6] } }) }),
    );
    expect(mocks.withdraw).toHaveBeenCalledTimes(2);
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/deudores?declaradas=2");
  });

  // El `Set` de la acción dedupe antes de tocar la base: un socio tildado dos
  // veces (o llegado dos veces por el `split` de comas) se declara UNA sola
  // vez, no dos.
  it("deduplica ids repetidos: un socio no se declara ni se audita dos veces", async () => {
    mocks.withdraw.mockClear();
    mocks.audit.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const roll: MemberDouble[] = [{ id: 7, fullName: "E", status: "active", category: "active" }];
    mocks.prisma.member.findMany.mockImplementationOnce(async (args: { where: { id: { in: number[] } } }) =>
      roll.filter((m) => args.where.id.in.includes(m.id)),
    );
    mocks.prisma.fee.count.mockResolvedValueOnce(5);
    const f = new FormData();
    f.append("ids", "7");
    f.append("ids", "7,7");
    f.append("minuteMode", "existing");
    f.append("minuteId", "3");
    await declareArrearsAction({}, confirmed(f, [7], { minuteId: 3 }));
    expect(mocks.prisma.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [7] } }) }),
    );
    expect(mocks.withdraw).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/deudores?declaradas=1");
  });

  // Un acta sin ningún movimiento es un asiento fantasma en un libro que se
  // presenta ante la IGJ.
  it("descarta el acta que creó este lote si no se declaró ninguna cesantía", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.prisma.member.findMany.mockResolvedValueOnce([
      { id: 1, fullName: "Perez Ana", status: "active", category: "active" },
    ]);
    mocks.prisma.fee.count.mockResolvedValueOnce(2);
    mocks.prisma.minute.create.mockResolvedValueOnce({ id: 77 });
    const newMinute = {
      minuteNew: "1" as const, minuteType: "board" as const, minuteNumber: 48,
      minuteDate: "2026-08-20", minuteDescription: undefined,
    };
    const f = new FormData();
    f.append("ids", "1");
    f.append("minuteMode", "new");
    f.append("minuteNew", "1");
    f.append("minuteType", "board");
    f.append("minuteNumber", "48");
    f.append("minuteDate", "2026-08-20");
    const r = await declareArrearsAction({}, confirmed(f, [1], newMinute));
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(r.error).toBe("No se declaró ninguna cesantía.");
    expect(r.failures?.[0]).toMatchObject({ memberId: 1, name: "Perez Ana" });
    expect(r.failures?.[0].error).toContain("2");
    expect(mocks.prisma.minute.delete).toHaveBeenCalledWith({ where: { id: 77 } });
  });
});

// El paso de confirmación (decisión del cliente, 22/08/2026): la acción más
// grave del módulo no se ejecuta con un solo clic. El primer envío devuelve
// QUIÉNES se van a declarar cesantes, con nombre, número de socio y cuotas; la
// baja recién ocurre en el segundo.
describe("declareArrearsAction — paso de confirmación", () => {
  const roll: MemberDouble[] = [
    { id: 1, fullName: "Perez Ana", status: "active", category: "active", memberships: [{ memberNumber: 41, book: { status: "open" } }] },
    { id: 2, fullName: "Gomez Luis", status: "active", category: "active", memberships: [{ memberNumber: 12, book: { status: "closed" } }] },
  ];

  function byId() {
    mocks.prisma.member.findMany.mockImplementationOnce(async (args: { where: { id: { in: number[] } } }) =>
      roll.filter((m) => args.where.id.in.includes(m.id)),
    );
  }

  it("el primer envío no da de baja a nadie: devuelve la lista para revisar", async () => {
    mocks.withdraw.mockClear();
    mocks.audit.mockClear();
    vi.mocked(redirect).mockClear();
    mocks.prisma.minute.create.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    byId();
    mocks.prisma.fee.groupBy.mockResolvedValueOnce([
      { memberId: 1, _count: { _all: 7 } }, { memberId: 2, _count: { _all: 4 } },
    ]);
    const r = await declareArrearsAction({}, form("1,2"));
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(r.error).toBeUndefined();
    expect(r.confirm?.targets).toEqual([
      { memberId: 1, name: "Perez Ana", memberNumber: 41, pendingCount: 7 },
      // El número del libro CERRADO es historia: no es el que figura hoy.
      { memberId: 2, name: "Gomez Luis", memberNumber: null, pendingCount: 4 },
    ]);
    // Y en qué acta se va a asentar, para que el operador lo lea antes.
    expect(r.confirm?.minuteLabel).toBe("Comisión Directiva N° 12 — 12/08/2026");
  });

  // La garantía dura del paso: los nombres y las cuotas se resuelven contra la
  // base, NUNCA se toman del POST. Un payload armado a mano no puede mostrar un
  // nombre y dar de baja a otro socio.
  it("ignora los nombres y las cuotas que venga a dictarle el formulario", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    byId();
    mocks.prisma.fee.groupBy.mockResolvedValueOnce([{ memberId: 1, _count: { _all: 9 } }]);
    const f = form("1");
    f.append("name", "Otro Socio");
    f.append("fullName", "Otro Socio");
    f.append("targets", JSON.stringify([{ memberId: 1, name: "Otro Socio", pendingCount: 99 }]));
    f.append("pendingCount", "99");
    f.append("memberNumber", "999");
    const r = await declareArrearsAction({}, f);
    expect(r.confirm?.targets).toEqual([
      { memberId: 1, name: "Perez Ana", memberNumber: 41, pendingCount: 9 },
    ]);
  });

  // Un socio que pagó entre las dos pantallas aparece en la confirmación con su
  // cuenta REAL, y el operador ve que no llega al umbral antes de confirmar.
  it("muestra la cuenta viva, no la que tenía la lista", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    byId();
    mocks.prisma.fee.groupBy.mockResolvedValueOnce([{ memberId: 1, _count: { _all: 1 } }]);
    const r = await declareArrearsAction({}, form("1"));
    expect(r.confirm?.targets[0].pendingCount).toBe(1);
  });

  // Volver atrás desde la confirmación no puede dejar un acta asentada sin
  // ningún movimiento en el libro que se presenta ante la IGJ.
  it("no crea el acta nueva mientras sólo se está confirmando", async () => {
    mocks.prisma.minute.create.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    byId();
    mocks.prisma.fee.groupBy.mockResolvedValueOnce([{ memberId: 1, _count: { _all: 5 } }]);
    const f = new FormData();
    f.append("ids", "1");
    f.append("minuteMode", "new");
    f.append("minuteNew", "1");
    f.append("minuteType", "board");
    f.append("minuteNumber", "48");
    f.append("minuteDate", "2026-08-20");
    const r = await declareArrearsAction({}, f);
    expect(mocks.prisma.minute.create).not.toHaveBeenCalled();
    expect(r.confirm?.minuteLabel).toContain("N° 48");
    expect(r.confirm?.minuteLabel).toMatch(/acta nueva/i);
  });

  // Si el operador cambió de acta (o de selección) después de confirmar, lo que
  // se iba a ejecutar ya no es lo que leyó: se vuelve a pedir confirmación.
  it("vuelve a pedir confirmación si el acta cambió después de confirmar", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    byId();
    mocks.prisma.fee.groupBy.mockResolvedValueOnce([{ memberId: 1, _count: { _all: 5 } }]);
    // Token de la selección con OTRA acta: el POST dice acta 3.
    const f = confirmed(form("1"), [1], { minuteId: 4 });
    const r = await declareArrearsAction({}, f);
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(r.confirm?.changed).toBe(true);
    expect(r.confirm?.targets).toHaveLength(1);
  });

  it("vuelve a pedir confirmación si la selección cambió después de confirmar", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    byId();
    mocks.prisma.fee.groupBy.mockResolvedValueOnce([
      { memberId: 1, _count: { _all: 5 } }, { memberId: 2, _count: { _all: 5 } },
    ]);
    // Se confirmó por un socio y el POST trae dos.
    const r = await declareArrearsAction({}, confirmed(form("1,2"), [1], { minuteId: 3 }));
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(r.confirm?.changed).toBe(true);
  });

  it("un acta existente que ya no está se rechaza antes de confirmar, en castellano", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    byId();
    mocks.prisma.minute.findUnique.mockResolvedValueOnce(null as never);
    const r = await declareArrearsAction({}, form("1"));
    expect(r.error).toBe("El acta seleccionada no existe.");
    expect(r.confirm).toBeUndefined();
  });
});

describe("arrearsConfirmToken", () => {
  it("no depende del orden en que se tildaron los socios", () => {
    expect(arrearsConfirmToken([2, 1], { minuteId: 3 })).toBe(arrearsConfirmToken([1, 2], { minuteId: 3 }));
  });
  it("cambia si cambia la selección o el acta", () => {
    const base = arrearsConfirmToken([1, 2], { minuteId: 3 });
    expect(arrearsConfirmToken([1], { minuteId: 3 })).not.toBe(base);
    expect(arrearsConfirmToken([1, 2], { minuteId: 4 })).not.toBe(base);
    expect(arrearsConfirmToken([1, 2], {
      minuteNew: "1", minuteType: "board", minuteNumber: 3,
      minuteDate: "2026-08-20", minuteDescription: undefined,
    })).not.toBe(base);
  });
});

// ── REG-15 y el tercer desenlace ──────────────────────────────────────────────
//
// Dos cosas que la 4C agrega al lote. La primera es estatutaria: la cesantía por
// mora alcanza a activos y colaboradores (Art. 9 inc. c), y hasta acá la
// pantalla le ofrecía la casilla al adherente y esta acción lo daba de baja. La
// segunda es de plata: la cesantía puede salir y el débito quedar vivo, y eso no
// es "no se pudo cesantear".
describe("declareArrearsAction — REG-15 y el débito que queda vivo", () => {
  function roll(members: MemberDouble[]) {
    mocks.prisma.member.findMany.mockImplementationOnce(async (args: { where: { id: { in: number[] } } }) =>
      members.filter((m) => args.where.id.in.includes(m.id)),
    );
  }

  it("no cesantea a un adherente por más deuda que tenga", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    roll([{ id: 3, fullName: "Adherente Ana", status: "active", category: "adherent" }]);
    mocks.prisma.fee.count.mockResolvedValueOnce(12);
    const r = await declareArrearsAction({}, confirmed(form("3"), [3], { minuteId: 3 }));
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(r.failures?.[0].error).toContain("Art. 9 inc. c");
    // Y el motivo dice qué categoría es: "no corresponde" a secas dejaría al
    // operador sin saber por qué ese socio sí y este no.
    expect(r.failures?.[0].error).toContain("Adherente");
  });

  it("el adherente no frena al activo que va en el mismo lote", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    roll([
      { id: 3, fullName: "Adherente Ana", status: "active", category: "adherent" },
      { id: 4, fullName: "Activo Luis", status: "active", category: "active" },
    ]);
    // Una sola lectura de cuotas: la del adherente ni se pide (se corta antes).
    mocks.prisma.fee.count.mockResolvedValueOnce(6);
    const r = await declareArrearsAction({}, confirmed(form("3,4"), [3, 4], { minuteId: 3 }));
    expect(mocks.withdraw).toHaveBeenCalledTimes(1);
    expect(mocks.withdraw).toHaveBeenCalledWith(expect.objectContaining({ memberId: 4 }));
    expect(r.declared).toBe(1);
  });

  it("cesantía OK con el débito vivo: balde propio, no `failures`", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    roll([{ id: 4, fullName: "Activo Luis", status: "active", category: "active" }]);
    mocks.prisma.fee.count.mockResolvedValueOnce(6);
    mocks.withdraw.mockResolvedValueOnce({
      debits: { cancelled: [], failed: [{ preapprovalId: "pre-1", code: "internal_error" }] },
    });
    const r = await declareArrearsAction({}, confirmed(form("4"), [4], { minuteId: 3 }));
    expect(r.declared).toBe(1);
    // Meterlo en `failures` diría que la cesantía falló sobre alguien que SÍ
    // quedó cesante: el operador repetiría una acción ya hecha.
    expect(r.failures).toBeUndefined();
    expect(r.debitFailures).toEqual([{ memberId: 4, name: "Activo Luis", count: 1 }]);
    // Y NO se redirige: el aviso —el único que dice que a un ex socio se le
    // sigue cobrando— se perdería en el querystring.
    expect(redirect).not.toHaveBeenCalled();
  });

  it("el asiento lleva qué débitos se cancelaron y cuáles quedaron abiertos", async () => {
    mocks.audit.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    roll([{ id: 4, fullName: "Activo Luis", status: "active", category: "active" }]);
    mocks.prisma.fee.count.mockResolvedValueOnce(6);
    mocks.withdraw.mockResolvedValueOnce({
      debits: { cancelled: ["pre-9"], failed: [] },
    });
    await declareArrearsAction({}, confirmed(form("4"), [4], { minuteId: 3 }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "arrears_declared",
      detail: { minuteId: 3, pendingCount: 6, debitsCancelled: ["pre-9"], debitsFailed: [] },
    }));
  });

  it("cesantía OK y débito cancelado: redirige como siempre", async () => {
    vi.mocked(redirect).mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    roll([{ id: 4, fullName: "Activo Luis", status: "active", category: "active" }]);
    mocks.prisma.fee.count.mockResolvedValueOnce(6);
    mocks.withdraw.mockResolvedValueOnce({ debits: { cancelled: ["pre-9"], failed: [] } });
    await declareArrearsAction({}, confirmed(form("4"), [4], { minuteId: 3 }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/deudores?declaradas=1");
  });
});
