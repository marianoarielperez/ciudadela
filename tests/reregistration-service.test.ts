// Task 8 (6B): el servicio que CONVOCA el re-empadronamiento del Art. 9° bis,
// abre la 2ª instancia y cuenta la cola.
//
// Deps FAKES en todo el archivo: acá no hay base ni SMTP. Lo que se fija es lo
// que en producción le pasa a más de cien vecinos de una sola vez:
//   - qué queda ADENTRO de la transacción y qué DESPUÉS del commit (ningún
//     correo antes de que el proceso esté asentado, y ningún fallo de correo
//     que deshaga la convocatoria);
//   - a quién alcanza la cohorte, que se CONGELA en ese acto;
//   - quién recibe correo (email cargado y sin rebote) y quién queda para la
//     cartelera;
//   - que el plazo se lea con `hasExpired` y no con un `>` sobre el instante:
//     el día del vencimiento el socio todavía tiene el día entero.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import type { MemberCategory, MemberStatus } from "@/generated/prisma/client";
import { DEFAULT_MAIL_BATCH_CAP, makeMailBudget } from "@/lib/email/batch-cap";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { COHORT_CATEGORY, COHORT_STATUSES, isCohortMember } from "@/lib/reregistration/rules";
import { makeReregistration } from "@/lib/reregistration/service";

// 20/09/2026 a las 12:00 UTC = 09:00 en Argentina.
const NOW = new Date("2026-09-20T12:00:00Z");
const CALLED_AT = new Date("2026-09-20T12:00:00Z");
// 30 días corridos desde el 20/09 → 20/10/2026 (mediodía UTC del día civil AR).
const FIRST_ENDS = new Date("2026-10-20T12:00:00Z");

type MemberRow = { id: number; fullName: string; email: string | null; emailStatus: string };

function member(id: number, over: Partial<MemberRow> = {}): MemberRow {
  return { id, fullName: `Socio ${id}`, email: `socio${id}@x.com`, emailStatus: "verified", ...over };
}

type ProcessRow = {
  id: number;
  status: string;
  firstEndsAt: Date;
  secondEndsAt: Date | null;
};

/** Envíos que ocurrieron ANTES del commit, acumulados por el doble del mailer y
 *  afirmados en el `afterEach`.
 *
 *  La aserción NO puede ir adentro del doble: el servicio envuelve cada envío en
 *  un `try/catch`, así que una excepción tirada ahí se la traga el catch y se
 *  cuenta como un fallo de envío más — el candado no trababa y el test pasaba
 *  igual. Acumular y afirmar desde afuera es lo que hace que una violación
 *  rompa, y que rompa diciendo qué socio salió antes de tiempo. */
const preCommitSends: number[] = [];

function deps(
  over: {
    live?: { id: number } | null;
    cohort?: MemberRow[];
    process?: ProcessRow | null;
    missing?: MemberRow[];
    updateCount?: number;
    groups?: Array<{ status: string; _count: { _all: number } }>;
    cap?: number;
    now?: Date;
    send?: (input: { memberId: number | null }) => Promise<{ messageId: string | null }>;
  } = {},
) {
  // Se prende cuando la función de la transacción terminó: los correos tienen
  // que salir con esto ya en `true`.
  let committed = false;

  const tx = {
    reregistrationProcess: {
      findFirst: vi.fn(async () => over.live ?? null),
      findUnique: vi.fn(async () => (over.process === undefined ? null : over.process)),
      create: vi.fn(async () => ({ id: 7 })),
      updateMany: vi.fn(async () => ({ count: over.updateCount ?? 1 })),
    },
    member: { findMany: vi.fn(async () => over.cohort ?? []) },
    presentation: {
      createMany: vi.fn(async () => ({ count: (over.cohort ?? []).length })),
      findMany: vi.fn(async () => (over.missing ?? []).map((m) => ({ member: m }))),
    },
    boardNotice: { create: vi.fn(async () => ({ id: 33 })) },
    configuration: { upsert: vi.fn(async () => ({})) },
  };

  const db = {
    ...tx,
    presentation: {
      ...tx.presentation,
      groupBy: vi.fn(async () => over.groups ?? []),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const result = await fn(tx);
      committed = true;
      return result;
    }),
  };

  const sent: Array<{ memberId: number | null; type: string; subject: string }> = [];
  const mailer = {
    sendToMember: vi.fn(async (input: { memberId: number | null; type: string; message: { subject: string } }) => {
      // La invariante más cara del módulo: ninguna llamada de red adentro de la
      // transacción de Prisma (el timeout es de 5 s y el lock se sostiene). La
      // violación se ACUMULA y se afirma en el `afterEach` — ver `preCommitSends`.
      if (!committed) preCommitSends.push(input.memberId ?? -1);
      sent.push({ memberId: input.memberId, type: input.type, subject: input.message.subject });
      if (over.send) return over.send(input);
      return { messageId: "mid" };
    }),
  };

  const service = makeReregistration({
    db: db as never,
    mailer: mailer as never,
    baseUrl: () => "https://vecinalciudadela.ar",
    // El presupuesto se inyecta SÓLO cuando el caso quiere forzar un tope chico.
    // Sin `cap` corre el default del servicio, que es lo que dimensiona el
    // presupuesto a la cohorte: si se inyectara siempre, ese default no se
    // probaría nunca.
    ...(over.cap === undefined ? {} : { mailBudget: () => makeMailBudget(over.cap as number) }),
    now: () => over.now ?? NOW,
  });
  return { service, db, tx, mailer, sent };
}

/** El primer argumento con el que se llamó a un doble. Los dobles se declaran
 *  sin parámetros (`vi.fn(async () => …)`) y TypeScript tipa entonces `calls`
 *  como una tupla VACÍA, así que `calls[0][0]` no compila: éste es el único
 *  lugar del archivo donde se ensancha, en vez de repartir casts por cada
 *  aserción. */
function argOf<T>(fn: unknown): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[0][0] as T;
}

function failWith(code: string) {
  return async () => {
    throw Object.assign(new Error("nope"), { code });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Se limpia ACÁ y no en el `afterEach`: si la aserción de allá falla, lo que
  // venga después del `expect` no corre y el resto del archivo arrastraría la
  // violación del test anterior.
  preCommitSends.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  expect(preCommitSends, "hubo envíos ANTES del commit (socios)").toEqual([]);
});

describe("reregistration.activate", () => {
  it("un proceso vivo bloquea la convocatoria y NO escribe nada", async () => {
    const d = deps({ live: { id: 3 } });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r.ok).toBe(false);
    expect(d.tx.reregistrationProcess.create).not.toHaveBeenCalled();
    expect(d.tx.presentation.createMany).not.toHaveBeenCalled();
    expect(d.tx.configuration.upsert).not.toHaveBeenCalled();
    expect(d.tx.boardNotice.create).not.toHaveBeenCalled();
    expect(d.mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("happy path: proceso en 1ª instancia, cohorte congelada, config apuntando al id y correos a los utilizables", async () => {
    const cohort = [member(1), member(2), member(3, { email: null })];
    const d = deps({ cohort });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 4,
    });

    expect(r).toMatchObject({ ok: true, processId: 7, cohortSize: 3, emailed: 2, boardCount: 1 });

    // El proceso nace en 1ª instancia con el plazo de `rules.firstEndsAt`.
    expect(d.tx.reregistrationProcess.create).toHaveBeenCalledTimes(1);
    const created = argOf<{
      data: { status: string; firstEndsAt: Date; callMinuteId: number; bookId: number };
    }>(d.tx.reregistrationProcess.create);
    expect(created.data.status).toBe("first_instance");
    expect(created.data.firstEndsAt.toISOString()).toBe(FIRST_ENDS.toISOString());
    expect(created.data.callMinuteId).toBe(9);
    expect(created.data.bookId).toBe(1);

    // Una fila `pending` por convocado: la cohorte es un hecho registrado.
    const rows = argOf<{ data: Array<{ memberId: number; status: string; processId: number }> }>(
      d.tx.presentation.createMany,
    ).data;
    expect(rows.map((x) => x.memberId)).toEqual([1, 2, 3]);
    expect(rows.every((x) => x.status === "pending" && x.processId === 7)).toBe(true);

    // El id del proceso vivo viaja como STRING: `configReader.getString` es el
    // lector que usa el wizard y devuelve null para cualquier otro tipo.
    const upsert = argOf<{
      where: { key: string }; create: { value: unknown; updatedBy: number };
    }>(d.tx.configuration.upsert);
    expect(upsert.where.key).toBe("reempadronamiento_proceso_id");
    expect(upsert.create.value).toBe("7");
    expect(upsert.create.updatedBy).toBe(4);

    // Sólo los dos con casilla utilizable.
    expect(d.sent.map((s) => s.memberId)).toEqual([1, 2]);
    expect(d.sent.every((s) => s.type === "reregistration_first")).toBe(true);
  });

  it("la cohorte pide adherentes vigentes y NADIE más (los suspendidos entran, el withdrawn no)", async () => {
    const d = deps({ cohort: [member(1)] });
    await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    const args = argOf<{ where: { category: string; status: { in: string[] } } }>(d.tx.member.findMany);
    expect(args.where.category).toBe("adherent");
    expect([...args.where.status.in].sort()).toEqual(["active", "suspended"]);
  });

  it("un email vacío o rebotado no recibe correo: va a la cartelera", async () => {
    const cohort = [member(1, { email: null }), member(2, { emailStatus: "bounced" }), member(3, { email: "" })];
    const d = deps({ cohort });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r).toMatchObject({ ok: true, emailed: 0, boardCount: 3 });
    expect(d.mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("el aviso de cartelera nace SIN fecha de fijación y sin filas de notificación", async () => {
    const d = deps({ cohort: [member(1, { email: null })] });
    await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(d.tx.boardNotice.create).toHaveBeenCalledTimes(1);
    const notice = argOf<{ data: { kind: string; postedAt?: unknown; dueAt?: unknown } }>(
      d.tx.boardNotice.create,
    );
    expect(notice.data.kind).toBe("first_instance");
    expect(notice.data.postedAt).toBeUndefined();
    expect(notice.data.dueAt).toBeUndefined();
  });

  it("sin nadie para cartelera no se crea un aviso vacío", async () => {
    const d = deps({ cohort: [member(1), member(2)] });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r).toMatchObject({ ok: true, boardCount: 0 });
    expect(d.tx.boardNotice.create).not.toHaveBeenCalled();
  });

  it("una cohorte vacía no llama a createMany con un array vacío", async () => {
    const d = deps({ cohort: [] });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r).toMatchObject({ ok: true, cohortSize: 0, emailed: 0, boardCount: 0 });
    expect(d.tx.presentation.createMany).not.toHaveBeenCalled();
  });

  it("un fallo de envío NO deshace la convocatoria ya asentada", async () => {
    const cohort = [member(1), member(2)];
    const d = deps({
      cohort,
      send: async (input) => {
        if (input.memberId === 1) return failWith("ESOCKET")();
        return { messageId: "mid" };
      },
    });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r).toMatchObject({ ok: true, processId: 7, cohortSize: 2, emailed: 1, failed: 1 });
  });

  it("el bloqueo de EMAIL_ALLOWLIST no es un fallo y devuelve el cupo", async () => {
    const cohort = [member(1), member(2)];
    const d = deps({ cap: 1, send: failWith(ALLOWLIST_BLOCK_CODE) });
    d.tx.member.findMany.mockResolvedValue(cohort as never);
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    // Los dos INTENTARON salir aunque el tope era de uno: el bloqueado devolvió
    // el lugar, así que el tope cuenta correos mandados y no intentos.
    expect(d.mailer.sendToMember).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ ok: true, emailed: 0, failed: 0, blocked: 2, deferred: 0 });
  });

  it("el tope de correos difiere el excedente y lo REPORTA", async () => {
    const d = deps({ cohort: [member(1), member(2), member(3)], cap: 1 });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r).toMatchObject({ ok: true, emailed: 1, deferred: 2 });
    expect(d.mailer.sendToMember).toHaveBeenCalledTimes(1);
  });

  // El tope por default (50) existe para trabajos RECURRENTES: lo que se difiere
  // hoy sale en la corrida del mes que viene. La convocatoria corre UNA vez y no
  // tiene repesca, así que un diferido es un vecino al que le corre un plazo de
  // treinta días del que nunca se enteró. Con la cohorte real —124 adherentes—
  // el default diferiría a más de setenta si el padrón tuviera las casillas
  // cargadas.
  it("sin tope inyectado el presupuesto se dimensiona a la cohorte: nadie queda diferido", async () => {
    const cohort = Array.from({ length: DEFAULT_MAIL_BATCH_CAP + 10 }, (_, i) => member(i + 1));
    const d = deps({ cohort });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r).toMatchObject({ ok: true, emailed: cohort.length, deferred: 0, deferredIds: [] });
    expect(d.mailer.sendToMember).toHaveBeenCalledTimes(cohort.length);
  });

  // Un conteo no se puede reintentar ni nombrar en una pantalla. Y el diferido es
  // el caso que no deja NINGÚN otro rastro: el mailer no escribió fila (nunca
  // hubo envío) y tampoco cae a la cartelera, porque la cartelera se calcula
  // sobre quienes no tienen casilla utilizable — y éste la tiene.
  it("los que quedaron sin aviso vuelven CON SU ID, no sólo contados", async () => {
    const d = deps({ cohort: [member(1), member(2), member(3)], cap: 1 });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r).toMatchObject({ ok: true, emailed: 1, deferredIds: [2, 3], failedIds: [], blockedIds: [] });
  });

  it("el fallo y el bloqueo también vuelven con su id", async () => {
    const d = deps({
      cohort: [member(1), member(2), member(3)],
      send: async (input) => {
        if (input.memberId === 1) return failWith("ESOCKET")();
        if (input.memberId === 2) return failWith(ALLOWLIST_BLOCK_CODE)();
        return { messageId: "mid" };
      },
    });
    const r = await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    expect(r).toMatchObject({
      ok: true, emailed: 1, failedIds: [1], blockedIds: [2], deferredIds: [],
    });
  });

  // El wizard público filtra con `isCohortMember`; el servicio convoca con una
  // consulta. Si los dos criterios divergen, un socio convocado —al que le corre
  // el plazo y al que le llegó el correo— recibe "no te encontramos" al intentar
  // presentarse. Por eso la consulta se arma con las MISMAS constantes que la
  // función pura, y este test recorre la tabla entera de pares.
  it("la consulta de la cohorte no puede divergir de `isCohortMember`", async () => {
    const d = deps({ cohort: [member(1)] });
    await d.service.activate({
      bookId: 1, calledAt: CALLED_AT, minuteId: 9,
      igjApprovedAt: null, estimatedElectionAt: null, actorId: 1,
    });
    const where = argOf<{ where: { category: MemberCategory; status: { in: MemberStatus[] } } }>(
      d.tx.member.findMany,
    ).where;
    expect(where.category).toBe(COHORT_CATEGORY);
    expect([...where.status.in]).toEqual([...COHORT_STATUSES]);

    const categories: MemberCategory[] = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"];
    const statuses: MemberStatus[] = ["active", "suspended", "withdrawn"];
    for (const category of categories) {
      for (const status of statuses) {
        const matchesQuery = category === where.category && where.status.in.includes(status);
        expect(isCohortMember({ category, status }), `${category}/${status}`).toBe(matchesQuery);
      }
    }
  });
});

describe("reregistration.startSecond", () => {
  const first = (over: Partial<ProcessRow> = {}): ProcessRow => ({
    id: 7, status: "first_instance", firstEndsAt: FIRST_ENDS, secondEndsAt: null, ...over,
  });

  it("un proceso inexistente da error sin escribir", async () => {
    const d = deps({ process: null });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: false });
    expect(r.ok).toBe(false);
    expect(d.tx.reregistrationProcess.updateMany).not.toHaveBeenCalled();
  });

  it("desde un estado que no es 1ª instancia no se abre", async () => {
    const d = deps({ process: first({ status: "second_instance" }) });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: false });
    expect(r.ok).toBe(false);
    expect(d.tx.reregistrationProcess.updateMany).not.toHaveBeenCalled();
  });

  it("con el plazo corriendo y sin force NO se abre", async () => {
    const d = deps({ process: first() });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: false });
    expect(r.ok).toBe(false);
    expect(d.tx.reregistrationProcess.updateMany).not.toHaveBeenCalled();
    expect(d.mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("el DÍA del vencimiento todavía no vence: el socio lo tiene entero", async () => {
    // 20/10/2026 a las 23:00 en Argentina = 21/10 02:00 UTC. El comparador
    // crudo (`now > firstEndsAt`) diría "vencido" desde las 09:00 de ese día.
    const d = deps({ process: first(), now: new Date("2026-10-21T02:00:00Z") });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: false });
    expect(r.ok).toBe(false);
  });

  it("el día SIGUIENTE al vencimiento sí abre, sin force", async () => {
    const d = deps({
      process: first(), missing: [member(1)],
      now: new Date("2026-10-21T12:00:00Z"),
    });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: false });
    expect(r.ok).toBe(true);
  });

  it("con force abre antes de tiempo y fija secondEndsAt a 10 días corridos de HOY", async () => {
    const d = deps({ process: first(), missing: [member(1), member(2, { email: null })] });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: true });
    expect(r).toMatchObject({ ok: true, processId: 7, pending: 2, emailed: 1, boardCount: 1 });
    const args = argOf<{
      where: { id: number; status: string }; data: { status: string; secondEndsAt: Date };
    }>(d.tx.reregistrationProcess.updateMany);
    expect(args.where).toMatchObject({ id: 7, status: "first_instance" });
    expect(args.data.status).toBe("second_instance");
    // 20/09 + 10 días corridos → 30/09/2026.
    expect(args.data.secondEndsAt.toISOString()).toBe("2026-09-30T12:00:00.000Z");
  });

  it("los correos de 2ª instancia van SOLO a los que no presentaron", async () => {
    const d = deps({ process: first(), missing: [member(5), member(6)] });
    await d.service.startSecond({ processId: 7, actorId: 1, force: true });
    const where = argOf<{ where: { processId: number; status: { notIn: string[] } } }>(
      d.tx.presentation.findMany,
    ).where;
    expect(where.processId).toBe(7);
    expect([...where.status.notIn].sort()).toEqual(["submitted", "validated"]);
    expect(d.sent.map((s) => s.memberId)).toEqual([5, 6]);
    expect(d.sent.every((s) => s.type === "reregistration_second")).toBe(true);
  });

  it("el aviso de 2ª instancia se crea con su kind y sin fijación", async () => {
    const d = deps({ process: first(), missing: [member(1, { emailStatus: "bounced" })] });
    await d.service.startSecond({ processId: 7, actorId: 1, force: true });
    const notice = argOf<{ data: { kind: string; postedAt?: unknown } }>(d.tx.boardNotice.create);
    expect(notice.data.kind).toBe("second_instance");
    expect(notice.data.postedAt).toBeUndefined();
  });

  // Mismo motivo que en la convocatoria, y acá pesa más: el correo de 2ª
  // instancia es la ÚLTIMA notificación antes de una baja estatutaria. Un
  // diferido silencioso ahí es una baja que el socio no vio venir.
  it("sin tope inyectado el presupuesto se dimensiona a los no presentados", async () => {
    const missing = Array.from({ length: DEFAULT_MAIL_BATCH_CAP + 10 }, (_, i) => member(i + 1));
    const d = deps({ process: first(), missing });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: true });
    expect(r).toMatchObject({ ok: true, emailed: missing.length, deferred: 0, deferredIds: [] });
  });

  it("los no notificados de la 2ª instancia también vuelven con su id", async () => {
    const d = deps({ process: first(), missing: [member(5), member(6), member(7)], cap: 1 });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: true });
    expect(r).toMatchObject({ ok: true, emailed: 1, deferredIds: [6, 7] });
  });

  it("el cerrojo optimista corta si otra corrida ya movió el proceso", async () => {
    const d = deps({ process: first(), updateCount: 0, missing: [member(1)] });
    const r = await d.service.startSecond({ processId: 7, actorId: 1, force: true });
    expect(r.ok).toBe(false);
    expect(d.mailer.sendToMember).not.toHaveBeenCalled();
  });
});

describe("reregistration.counters", () => {
  it("devuelve las seis claves del enum aunque la base no traiga filas", async () => {
    const d = deps({
      process: { id: 7, status: "first_instance", firstEndsAt: FIRST_ENDS, secondEndsAt: null },
      groups: [
        { status: "pending", _count: { _all: 100 } },
        { status: "submitted", _count: { _all: 20 } },
      ],
    });
    const c = await d.service.counters(7);
    expect(c.byStatus).toEqual({
      pending: 100, submitted: 20, observed: 0, validated: 0, rejected: 0, withdrawn: 0,
    });
    expect(c.cohortSize).toBe(120);
    // 20/09 → 20/10 son 30 días; el último día cuenta entero.
    expect(c.daysLeft).toBe(30);
  });

  it("en 2ª instancia mide contra secondEndsAt, y el día del vencimiento da 0", async () => {
    const d = deps({
      process: { id: 7, status: "second_instance", firstEndsAt: FIRST_ENDS, secondEndsAt: new Date("2026-09-20T12:00:00Z") },
      groups: [],
    });
    const c = await d.service.counters(7);
    expect(c.daysLeft).toBe(0);
  });

  it("sin instancia abierta no hay cuenta regresiva", async () => {
    const d = deps({
      process: { id: 7, status: "closing", firstEndsAt: FIRST_ENDS, secondEndsAt: FIRST_ENDS },
      groups: [{ status: "validated", _count: { _all: 3 } }],
    });
    const c = await d.service.counters(7);
    expect(c.daysLeft).toBeNull();
    expect(c.cohortSize).toBe(3);
  });
});
