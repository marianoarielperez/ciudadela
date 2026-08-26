// Task 16 (6C): las BAJAS por no haberse re-empadronado, en lotes con acta.
//
// Por qué este archivo es el más grave del módulo: acá una persona real deja de
// ser socia de la asociación por resolución fundada de la Comisión (Art. 9° bis
// inc. c), y desde la notificación fehaciente le corren treinta días para
// recurrir ante la asamblea (Art. 9° bis d). Un error acá no se ve en ninguna
// pantalla: se ve en un vecino al que se le declaró la baja sin haberlo
// notificado nunca, o en una ventana de recurso que arrancó el día equivocado.
//
// Lo que se fija:
//   - a quién alcanza la etapa de bajas (cohortados que SIGUEN siendo adherentes
//     vigentes y no tienen presentación validada) y a quién ya no;
//   - que el lote corte en 25 ANTES de tocar el acta;
//   - que un fallo de `withdraw` vaya a su balde y no frene a los demás;
//   - que `debitFailures` sea un balde PROPIO (la baja salió; lo que quedó vivo
//     es el débito);
//   - que la presentación quede `withdrawn` SÓLO si la baja salió;
//   - que la notificación estampe la fecha fehaciente y la ventana de recurso, y
//     que un correo que no salió NO las estampe;
//   - que el checklist cuente lo que bloquea y lo que sólo advierte.
//
// Deps FAKES: acá no hay base. `@/lib/prisma` se mockea porque el módulo exporta
// también su singleton (mismo criterio que `board/notice` y `reregistration/service`).
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import type { MemberCategory, MemberStatus, PresentationStatus } from "@/generated/prisma/client";
import { civilDateUtc } from "@/lib/dates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { makeMailBudget } from "@/lib/email/batch-cap";
import { appealUntil } from "@/lib/reregistration/rules";
import {
  ARREARS_CATEGORIES_MIRROR,
  ARREARS_THRESHOLD_MIRROR,
  makeWithdrawals,
  WITHDRAWAL_BATCH_MAX,
} from "@/lib/reregistration/withdrawals";
// Sólo para el test de deriva: el dominio NO los importa (son de tesorería).
import { ACCRUING_CATEGORIES, ARREARS_THRESHOLD } from "@/lib/treasury/rules";

const d = civilDateUtc;
const NOW = new Date("2026-11-10T15:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// Base de mentira, mínima pero HONESTA
// ─────────────────────────────────────────────────────────────────────────────

/** Aplica un `where` LITERALMENTE contra una fila: cada clave que llega se
 *  compara, ninguna se da por supuesta, y las relaciones (`member: {...}`) se
 *  recorren igual.
 *
 *  Existe porque un doble que REIMPLEMENTA el filtro en vez de honrarlo deja de
 *  ser un guardián: el proyecto ya se comió dos veces el mismo defecto en esta
 *  rama —un doble que buscaba la fila "sin fijar" por su cuenta dejaba en verde
 *  el borrado del cerrojo optimista de producción—. Acá el caso caro es el
 *  `status: { in: [...] }` de la presentación: si de producción desapareciera,
 *  una presentación VALIDADA entraría al lote y el vecino que se re-empadronó a
 *  tiempo perdería la condición de socio. Pasando el `where` por acá, la
 *  condición que se prueba es la que el código manda. */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") {
      return (expected as Array<Record<string, unknown>>).some((c) => matchesWhere(row, c));
    }
    if (key === "AND") {
      return (expected as Array<Record<string, unknown>>).every((c) => matchesWhere(row, c));
    }
    const actual = row[key];
    if (expected === null) return actual === null || actual === undefined;
    if (expected instanceof Date) {
      return actual instanceof Date && actual.getTime() === expected.getTime();
    }
    if (typeof expected === "object") {
      const clause = expected as Record<string, unknown>;
      if ("in" in clause) return (clause.in as unknown[]).includes(actual);
      if ("notIn" in clause) return !(clause.notIn as unknown[]).includes(actual);
      if ("not" in clause) return actual !== clause.not;
      if ("gte" in clause) {
        const bound = clause.gte as Date;
        return actual instanceof Date && actual.getTime() >= bound.getTime();
      }
      // Filtro de relación: la fila lleva el objeto embebido.
      return matchesWhere((actual ?? {}) as Record<string, unknown>, clause);
    }
    return actual === expected;
  });
}

type MemberRow = {
  id: number;
  fullName: string;
  category: MemberCategory;
  status: MemberStatus;
  email: string | null;
  emailStatus: string;
  memberNumber: number | null;
};

function member(id: number, over: Partial<MemberRow> = {}): MemberRow {
  return {
    id,
    fullName: `Socio ${id}`,
    category: "adherent",
    status: "active",
    email: null,
    emailStatus: "none",
    memberNumber: id,
    ...over,
  };
}

type PresentationRow = {
  id: number;
  processId: number;
  memberId: number;
  status: PresentationStatus;
  withdrawalNotifiedAt: Date | null;
  appealUntil: Date | null;
  member: MemberRow;
};

function presentation(
  id: number,
  m: MemberRow,
  over: Partial<Omit<PresentationRow, "member">> = {},
): PresentationRow {
  return {
    id,
    processId: 1,
    memberId: m.id,
    status: "pending",
    withdrawalNotifiedAt: null,
    appealUntil: null,
    member: m,
    ...over,
  };
}

type NoticeRow = {
  memberId: number;
  type: string;
  via: string;
  status: string;
  sentAt: Date;
  boardFrom: Date | null;
  boardTo: Date | null;
  /** La relación, para que el `where` del módulo se pueda aplicar tal cual. */
  boardNotice: { processId: number } | null;
};

type BoardNoticeRow = {
  id: number;
  processId: number;
  kind: string;
  postedAt: Date | null;
  dueAt: Date | null;
};

type World = {
  presentations: PresentationRow[];
  notices?: NoticeRow[];
  boardNotices?: BoardNoticeRow[];
  /** Cuotas pendientes por socio, para el conteo de cesanteables por mora. */
  fees?: Array<{ memberId: number; category: MemberCategory; status: MemberStatus; pending: number }>;
  process?: { id: number; bookId: number; createdAt: Date } | null;
};

function fakeDb(world: World) {
  const processRow =
    world.process === undefined ? { id: 1, bookId: 9, createdAt: new Date("2026-09-01T10:00:00Z") } : world.process;

  const shape = (p: PresentationRow) => ({
    id: p.id,
    memberId: p.memberId,
    status: p.status,
    withdrawalNotifiedAt: p.withdrawalNotifiedAt,
    appealUntil: p.appealUntil,
    member: {
      id: p.member.id,
      fullName: p.member.fullName,
      category: p.member.category,
      status: p.member.status,
      email: p.member.email,
      emailStatus: p.member.emailStatus,
      memberships: p.member.memberNumber === null ? [] : [{ memberNumber: p.member.memberNumber }],
    },
  });

  return {
    reregistrationProcess: { findUnique: vi.fn(async () => processRow) },
    presentation: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        world.presentations.filter((p) => matchesWhere(p, where)).map(shape),
      ),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const hit = world.presentations.find((p) => matchesWhere(p, where));
        return hit ? shape(hit) : null;
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        world.presentations.filter((p) => matchesWhere(p, where)).length,
      ),
      // EL CERROJO SE PRUEBA ACÁ: el `where` viaja tal cual. Si de producción
      // desapareciera el filtro por estado, esta línea pisaría igual una
      // presentación ya marcada y el test correspondiente se pondría rojo.
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const hits = world.presentations.filter((p) => matchesWhere(p, where));
          for (const p of hits) Object.assign(p, data);
          return { count: hits.length };
        },
      ),
    },
    notification: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        (world.notices ?? []).filter((n) => matchesWhere(n, where)),
      ),
    },
    fee: {
      groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        (world.fees ?? [])
          .filter((f) =>
            matchesWhere({ status: "pending", member: { category: f.category, status: f.status } }, where),
          )
          .map((f) => ({ memberId: f.memberId, _count: { _all: f.pending } })),
      ),
    },
    boardNotice: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        (world.boardNotices ?? []).filter((n) => matchesWhere(n, where)),
      ),
    },
  };
}

type WithdrawCall = { memberId: number; reason: string; minuteId: number; actorId: number };
type Debits = { debits: { cancelled: string[]; failed: Array<{ preapprovalId: string; code: string }> } };

function makeSut(world: World, over: Partial<{ withdraw: unknown; send: unknown }> = {}) {
  const db = fakeDb(world);
  const calls: WithdrawCall[] = [];
  const withdraw =
    (over.withdraw as ((i: WithdrawCall) => Promise<Debits>) | undefined) ??
    (async (): Promise<Debits> => ({ debits: { cancelled: [], failed: [] } }));
  const audited: Array<Record<string, unknown>> = [];
  const sent: Array<Record<string, unknown>> = [];
  const send =
    (over.send as ((i: Record<string, unknown>) => Promise<unknown>) | undefined) ??
    (async (i: Record<string, unknown>) => {
      sent.push(i);
      return { messageId: "x" };
    });

  const sut = makeWithdrawals({
    db: db as never,
    withdrawer: {
      withdraw: vi.fn(async (i: WithdrawCall): Promise<Debits> => {
        calls.push(i);
        return withdraw(i);
      }),
    },
    mailer: { sendToMember: vi.fn(send) as never },
    audit: vi.fn(async (e: Record<string, unknown>) => {
      audited.push(e);
    }),
    now: () => NOW,
  });
  return { sut, db, calls, audited, sent };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("las constantes espejo de la mora", () => {
  it("valen lo mismo que las de tesorería", () => {
    // El dominio del re-empadronamiento NO importa de tesorería: son dos
    // dominios, y el criterio es ESTATUTARIO (REG-15, Art. 9 inc. c), no de
    // tesorería. Pero dos copias que se separan en silencio harían que el
    // checklist advirtiera de un número de cesanteables distinto del que el
    // lote de Deudores ofrece declarar. Este test es el que no lo permite.
    expect(ARREARS_THRESHOLD_MIRROR).toBe(ARREARS_THRESHOLD);
    expect([...ARREARS_CATEGORIES_MIRROR].sort()).toEqual([...ACCRUING_CATEGORIES].sort());
  });
});

describe("listPendingWithdrawals", () => {
  it("lista a los cohortados que siguen siendo adherentes vigentes sin validar", async () => {
    const { sut } = makeSut({
      presentations: [
        presentation(1, member(10), { status: "pending" }),
        presentation(2, member(20, { status: "suspended" }), { status: "observed" }),
        presentation(3, member(30), { status: "rejected" }),
        // Se presentó y la Comisión la validó: NO es candidato a baja.
        presentation(4, member(40), { status: "validated" }),
        // Esperando decisión: no entra a bajas (y además bloquea el cierre).
        presentation(5, member(50), { status: "submitted" }),
        // Ya se le declaró la baja.
        presentation(6, member(60, { status: "withdrawn" }), { status: "withdrawn" }),
      ],
    });

    const rows = await sut.listPendingWithdrawals(1);
    expect(rows.map((r) => r.presentationId)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ memberId: 10, memberNumber: 10, fullName: "Socio 10", status: "pending" });
  });

  it("deja fuera a quien dejó de ser adherente vigente por otro camino", async () => {
    // Spec §3: un cohortado al que la CD recategorizó o al que se le declaró la
    // baja por otra causal SALE del alcance de esta etapa. Su acta ya dice por
    // qué dejó de ser socio, y una segunda baja por otro motivo sería falsa.
    const { sut } = makeSut({
      presentations: [
        presentation(1, member(10, { category: "active" }), { status: "pending" }),
        presentation(2, member(20, { status: "withdrawn" }), { status: "pending" }),
        presentation(3, member(30), { status: "pending" }),
      ],
    });

    const rows = await sut.listPendingWithdrawals(1);
    expect(rows.map((r) => r.memberId)).toEqual([30]);
  });

  it("trae las notificaciones cursadas, con la vía y las dos fechas del cartel", async () => {
    // ESTO es el anexo del acta que exige REG-23: qué se le notificó, por qué
    // vía y en qué fecha. Sin él la resolución no es oponible.
    const { sut } = makeSut({
      presentations: [presentation(1, member(10), { status: "pending" })],
      notices: [
        {
          memberId: 10, type: "reregistration_first", via: "email", status: "sent",
          sentAt: d(2026, 9, 2), boardFrom: null, boardTo: null, boardNotice: null,
        },
        {
          memberId: 10, type: "reregistration_second", via: "board", status: "posted_board",
          sentAt: d(2026, 10, 5), boardFrom: d(2026, 10, 5), boardTo: d(2026, 11, 2),
          boardNotice: { processId: 1 },
        },
        // De OTRO proceso y de otro tipo: no entra al anexo de este acta.
        {
          memberId: 10, type: "receipt", via: "email", status: "sent",
          sentAt: d(2026, 10, 20), boardFrom: null, boardTo: null, boardNotice: null,
        },
      ],
    });

    const [row] = await sut.listPendingWithdrawals(1);
    expect(row.notices).toEqual([
      { type: "reregistration_first", via: "email", status: "sent", at: d(2026, 9, 2), effectiveAt: d(2026, 9, 2) },
      {
        type: "reregistration_second", via: "board", status: "posted_board",
        at: d(2026, 10, 5), effectiveAt: d(2026, 11, 2),
      },
    ]);
  });
});

describe("declareBatch", () => {
  const world = (): World => ({
    presentations: [
      presentation(1, member(10), { status: "pending" }),
      presentation(2, member(20), { status: "observed" }),
      presentation(3, member(30), { status: "rejected" }),
    ],
  });

  it("da de baja por `not_reregistered`, marca la presentación y asienta uno por socio", async () => {
    const w = world();
    const { sut, calls, audited } = makeSut(w);

    const out = await sut.declareBatch({ processId: 1, presentationIds: [1, 2, 3], minuteId: 7, actorId: 4 });

    expect(out.declared).toEqual([1, 2, 3]);
    expect(out.failures).toEqual([]);
    expect(out.debitFailures).toEqual([]);
    expect(calls).toEqual([
      expect.objectContaining({ memberId: 10, reason: "not_reregistered", minuteId: 7, actorId: 4 }),
      expect.objectContaining({ memberId: 20, reason: "not_reregistered", minuteId: 7, actorId: 4 }),
      expect.objectContaining({ memberId: 30, reason: "not_reregistered", minuteId: 7, actorId: 4 }),
    ]);
    expect(w.presentations.map((p) => p.status)).toEqual(["withdrawn", "withdrawn", "withdrawn"]);
    expect(audited).toHaveLength(3);
    // Ids, códigos y banderas — NUNCA datos personales (Ley 25.326).
    const detail = JSON.stringify(audited[0]);
    expect(detail).not.toContain("Socio 10");
    expect(audited[0]).toMatchObject({ entityId: 10, userId: 4 });
  });

  it("corta en el tope del lote y NO llama a ninguna baja", async () => {
    // El tope se aplica antes de tocar a nadie. La guarda que importa está en la
    // action —ahí corta ANTES de crear el acta, para que no quede un asiento
    // fantasma en un libro que se presenta ante la IGJ— y ésta es la segunda
    // barrera: un POST armado a mano no puede saltearla.
    const many = Array.from({ length: WITHDRAWAL_BATCH_MAX + 1 }, (_, i) => i + 1);
    const { sut, calls } = makeSut(world());

    const out = await sut.declareBatch({ processId: 1, presentationIds: many, minuteId: 7, actorId: 4 });

    expect(out.error).toContain(String(WITHDRAWAL_BATCH_MAX));
    expect(out.declared).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("un fallo de la baja va a `failures` y no frena a los demás", async () => {
    const w = world();
    const { sut } = makeSut(w, {
      withdraw: async (i: WithdrawCall) => {
        if (i.memberId === 20) throw new Error("El socio ya está dado de baja.");
        return { debits: { cancelled: [], failed: [] } };
      },
    });

    const out = await sut.declareBatch({ processId: 1, presentationIds: [1, 2, 3], minuteId: 7, actorId: 4 });

    expect(out.declared).toEqual([1, 3]);
    expect(out.failures).toEqual([{ id: 2, error: "El socio ya está dado de baja." }]);
    // La presentación queda `withdrawn` SÓLO si la baja salió.
    expect(w.presentations.map((p) => p.status)).toEqual(["withdrawn", "observed", "withdrawn"]);
  });

  it("`debitFailures` es un balde propio: la baja salió, el débito quedó vivo", async () => {
    const w = world();
    const { sut } = makeSut(w, {
      withdraw: async (i: WithdrawCall) =>
        i.memberId === 30
          ? { debits: { cancelled: [], failed: [{ preapprovalId: "pre-1", code: "404" }] } }
          : { debits: { cancelled: [], failed: [] } },
    });

    const out = await sut.declareBatch({ processId: 1, presentationIds: [1, 2, 3], minuteId: 7, actorId: 4 });

    // Meterlo en `failures` diría que la baja falló sobre alguien que SÍ quedó
    // de baja, y el operador repetiría una acción que ya se hizo.
    expect(out.declared).toEqual([1, 2, 3]);
    expect(out.failures).toEqual([]);
    expect(out.debitFailures).toEqual([{ id: 3, count: 1 }]);
    expect(w.presentations[2].status).toBe("withdrawn");
  });

  it("rechaza por su nombre lo que dejó de corresponder entre la pantalla y el botón", async () => {
    const { sut, calls } = makeSut({
      presentations: [
        presentation(1, member(10), { status: "validated" }),
        presentation(2, member(20), { status: "submitted" }),
        presentation(3, member(30, { category: "active" }), { status: "pending" }),
        presentation(4, member(40), { status: "withdrawn" }),
      ],
    });

    const out = await sut.declareBatch({ processId: 1, presentationIds: [1, 2, 3, 4, 99], minuteId: 7, actorId: 4 });

    expect(calls).toEqual([]);
    expect(out.declared).toEqual([]);
    expect(out.failures.map((f) => f.id)).toEqual([1, 2, 3, 4, 99]);
    expect(out.failures[0].error).toMatch(/validad/i);
    expect(out.failures[1].error).toMatch(/decisión|resolv/i);
    expect(out.failures[2].error).toMatch(/adherente/i);
    expect(out.failures[3].error).toMatch(/ya/i);
    expect(out.failures[4].error).toMatch(/no pertenece|no existe/i);
  });
});

describe("notifyWithdrawal", () => {
  it("con casilla utilizable manda el correo y estampa fehaciente + ventana de recurso", async () => {
    const w: World = {
      presentations: [
        presentation(1, member(10, { email: "a@b.com", emailStatus: "verified" }), { status: "withdrawn" }),
      ],
    };
    const { sut, sent } = makeSut(w);

    await expect(sut.notifyWithdrawal({ presentationId: 1 })).resolves.toBe("email");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ memberId: 10, to: "a@b.com", type: "withdrawal_declared" });
    // Por correo la notificación es fehaciente AL ENVIARSE (Art. 5° ter), y de
    // ahí arrancan los 30 días corridos del recurso (Art. 9° bis d).
    expect(w.presentations[0].withdrawalNotifiedAt).toEqual(NOW);
    expect(w.presentations[0].appealUntil).toEqual(appealUntil(NOW));
  });

  it("sin casilla utilizable queda para el cartel y NO estampa nada", async () => {
    const w: World = {
      presentations: [
        presentation(1, member(10, { email: "a@b.com", emailStatus: "bounced" }), { status: "withdrawn" }),
      ],
    };
    const { sut, sent } = makeSut(w);

    await expect(sut.notifyWithdrawal({ presentationId: 1 })).resolves.toBe("board");
    expect(sent).toEqual([]);
    // Por cartelera la notificación es fehaciente al CUMPLIRSE los veinte días
    // hábiles, no al fijarse el cartel: la estampa la pone `notice.post`.
    expect(w.presentations[0].withdrawalNotifiedAt).toBeNull();
    expect(w.presentations[0].appealUntil).toBeNull();
  });

  it("un correo que no salió NO estampa la fecha fehaciente", async () => {
    const w: World = {
      presentations: [
        presentation(1, member(10, { email: "a@b.com", emailStatus: "verified" }), { status: "withdrawn" }),
      ],
    };
    const { sut } = makeSut(w, {
      send: async () => {
        throw new Error("smtp caído");
      },
    });

    await expect(sut.notifyWithdrawal({ presentationId: 1 })).resolves.toBe("failed");
    expect(w.presentations[0].withdrawalNotifiedAt).toBeNull();
  });

  it("el bloqueo por allowlist no es un fallo, y tampoco notifica", async () => {
    const w: World = {
      presentations: [
        presentation(1, member(10, { email: "a@b.com", emailStatus: "verified" }), { status: "withdrawn" }),
      ],
    };
    const { sut } = makeSut(w, {
      send: async () => {
        const e = new Error("bloqueado") as Error & { code: string };
        e.code = ALLOWLIST_BLOCK_CODE;
        throw e;
      },
    });

    await expect(sut.notifyWithdrawal({ presentationId: 1 })).resolves.toBe("blocked");
    expect(w.presentations[0].withdrawalNotifiedAt).toBeNull();
  });

  it("no vuelve a notificar a quien ya tiene su fecha fehaciente", async () => {
    const w: World = {
      presentations: [
        presentation(1, member(10, { email: "a@b.com", emailStatus: "verified" }), {
          status: "withdrawn",
          withdrawalNotifiedAt: d(2026, 11, 1),
          appealUntil: d(2026, 12, 1),
        }),
      ],
    };
    const { sut, sent } = makeSut(w);

    await expect(sut.notifyWithdrawal({ presentationId: 1 })).resolves.toBe("skipped");
    expect(sent).toEqual([]);
    // Y sobre todo: no le CORRE la ventana de recurso que ya estaba corriendo.
    expect(w.presentations[0].appealUntil).toEqual(d(2026, 12, 1));
  });

  it("no notifica una baja que no se declaró", async () => {
    const w: World = {
      presentations: [
        presentation(1, member(10, { email: "a@b.com", emailStatus: "verified" }), { status: "pending" }),
      ],
    };
    const { sut, sent } = makeSut(w);
    await expect(sut.notifyWithdrawal({ presentationId: 1 })).resolves.toBe("skipped");
    expect(sent).toEqual([]);
  });

  it("respeta el presupuesto de correos de la corrida", async () => {
    const w: World = {
      presentations: [
        presentation(1, member(10, { email: "a@b.com", emailStatus: "verified" }), { status: "withdrawn" }),
        presentation(2, member(20, { email: "c@d.com", emailStatus: "verified" }), { status: "withdrawn" }),
      ],
    };
    const { sut, sent } = makeSut(w);
    const budget = makeMailBudget(1);

    await expect(sut.notifyWithdrawal({ presentationId: 1, budget })).resolves.toBe("email");
    await expect(sut.notifyWithdrawal({ presentationId: 2, budget })).resolves.toBe("deferred");
    expect(sent).toHaveLength(1);
    expect(w.presentations[1].withdrawalNotifiedAt).toBeNull();
  });
});

describe("closeChecklist", () => {
  it("separa lo que bloquea de lo que sólo advierte", async () => {
    const { sut } = makeSut({
      presentations: [
        presentation(1, member(10), { status: "submitted" }),
        presentation(2, member(20), { status: "observed" }),
        presentation(3, member(30), { status: "pending" }),
        presentation(4, member(40), { status: "validated" }),
        // Ya no es adherente vigente: su desenlace lo decidió otra acta.
        presentation(5, member(50, { status: "withdrawn" }), { status: "withdrawn" }),
      ],
      fees: [
        { memberId: 90, category: "active", status: "active", pending: 6 },
        { memberId: 91, category: "collaborator", status: "suspended", pending: 4 },
        // No llega al umbral.
        { memberId: 92, category: "active", status: "active", pending: 3 },
        // Adherente: su deuda es real pero NO lo hace cesante (Art. 9 inc. c).
        { memberId: 93, category: "adherent", status: "active", pending: 20 },
      ],
      boardNotices: [
        // Cumplido: ya no está en curso.
        { id: 1, processId: 1, kind: "first_instance", postedAt: d(2026, 9, 2), dueAt: d(2026, 9, 30) },
        // Fijado y corriendo.
        { id: 2, processId: 1, kind: "second_instance", postedAt: d(2026, 10, 20), dueAt: d(2026, 11, 20) },
        // Sin fijar: también está en curso, y es trabajo pendiente del operador.
        { id: 3, processId: 1, kind: "other", postedAt: null, dueAt: null },
      ],
    });

    const { preconditions, openNotices } = await sut.closeChecklist(1);
    const by = Object.fromEntries(preconditions.map((p) => [p.kind, p.count]));
    // Presentada y observada esperan decisión: bloquean.
    expect(by.unresolved_presentations).toBe(2);
    // Sin `validated` y todavía adherentes vigentes: las tres primeras. La
    // presentada cuenta en los dos, y está bien: son dos cosas distintas.
    expect(by.cohort_not_terminal).toBe(3);
    expect(by.arrears_candidates).toBe(2);
    expect(by.board_in_progress).toBe(2);
    // Las cuatro filas SIEMPRE, aunque estén en cero: es lo que hace legible un
    // checklist y lo que evita que la pantalla nazca en rojo.
    expect(preconditions).toHaveLength(4);
    expect(openNotices.map((n) => n.id)).toEqual([2, 3]);
  });
});
