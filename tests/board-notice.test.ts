// Task 13 (6B): el AVISO DE CARTELERA como lote.
//
// Por qué este archivo es el más caro del módulo: de los 124 adherentes
// convocados, 100 no tienen casilla. Para esos cien el papel pegado en la pared
// ES la notificación fehaciente del Art. 5° ter, y de la fecha en que ese plazo
// se cumple dependen la validez de su baja y su ventana de recurso. Un error
// acá no se ve en ninguna pantalla: se ve en un plazo que salió corto.
//
// Lo que se fija:
//   - a quién alcanza cada `kind` (y a quién NO vuelve a alcanzar una vez que
//     su fila de cartelera quedó escrita);
//   - que la fijación se asiente UNA SOLA VEZ (cerrojo optimista), porque la
//     segunda fijación correría el plazo de cien vecinos;
//   - que `dueAt` salga de `businessDayEnd` con los feriados INYECTADOS;
//   - que las dos excepciones del cómputo —año sin cobertura y feriado fuera
//     del formato canónico— vuelvan como MENSAJE para el operador y no como
//     una excepción que rompa la pantalla;
//   - que cada fila creada lleve el tipo que corresponde a su `kind`.
//
// Deps FAKES: acá no hay base. `@/lib/prisma` se mockea porque el módulo
// exporta también su singleton (mismo criterio que `reregistration-service`).
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import type { BoardNoticeKind, PresentationStatus } from "@/generated/prisma/client";
import { BOARD_BUSINESS_DAYS, businessDayEnd } from "@/lib/board/business-days";
import { coverageNotice, effectiveKind, makeBoardNotices } from "@/lib/board/notice";
import { civilDateUtc } from "@/lib/dates";

const d = civilDateUtc;

// Feriados 2026-2027 en su fecha EFECTIVA, los que caen dentro de los casos.
// El año tiene que estar REPRESENTADO aunque el caso no lo pise: la guarda de
// cobertura de `businessDayEnd` trata un año sin filas como "no sé qué pasa
// acá", no como "año sin feriados".
const HOLIDAYS = [
  d(2026, 1, 1), d(2026, 10, 12), d(2026, 11, 23), d(2026, 12, 8), d(2026, 12, 25),
  d(2027, 1, 1),
];

type MemberRow = {
  id: number;
  fullName: string;
  email: string | null;
  emailStatus: string;
  memberNumber: number | null;
};

function member(id: number, over: Partial<MemberRow> = {}): MemberRow {
  return {
    id,
    fullName: `Socio ${id}`,
    email: null,
    emailStatus: "none",
    memberNumber: id,
    ...over,
  };
}

type NoticeRow = {
  id: number;
  processId: number;
  kind: BoardNoticeKind;
  postedAt: Date | null;
  dueAt: Date | null;
};

type World = {
  notices: NoticeRow[];
  /** Presentaciones del proceso: socio + estado. */
  cohort: Array<{ member: MemberRow; status: PresentationStatus }>;
  /** Filas de cartelera ya escritas: `[memberId, kind]`. */
  covered: Array<{ memberId: number; kind: BoardNoticeKind }>;
  process?: { id: number; bookId: number; secondEndsAt: Date | null } | null;
};

/** Base de mentira, mínima pero honesta: filtra por lo mismo que filtra la
 *  consulta real (estado de la presentación, aviso del proceso, `kind`), así
 *  que un caso que pasa acá no pasa por accidente. */
function fakeDb(world: World) {
  const created: Array<Record<string, unknown>> = [];
  const processRow =
    world.process === undefined ? { id: 1, bookId: 9, secondEndsAt: null } : world.process;

  const tx = {
    reregistrationProcess: {
      findUnique: vi.fn(async () => processRow),
    },
    boardNotice: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
        world.notices.find((n) => n.id === where.id) ?? null,
      ),
      findFirst: vi.fn(async ({ where }: { where: { processId: number; kind: BoardNoticeKind } }) =>
        world.notices.find(
          (n) => n.processId === where.processId && n.kind === where.kind && n.postedAt === null,
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: { processId: number; kind: BoardNoticeKind } }) => {
        const row: NoticeRow = {
          id: Math.max(0, ...world.notices.map((n) => n.id)) + 1,
          processId: data.processId,
          kind: data.kind,
          postedAt: null,
          dueAt: null,
        };
        world.notices.push(row);
        return row;
      }),
      updateMany: vi.fn(
        async ({ where, data }: {
          where: { id: number; postedAt: null };
          data: { postedAt: Date; dueAt: Date };
        }) => {
          const row = world.notices.find((n) => n.id === where.id && n.postedAt === null);
          if (!row) return { count: 0 };
          row.postedAt = data.postedAt;
          row.dueAt = data.dueAt;
          return { count: 1 };
        },
      ),
    },
    presentation: {
      findMany: vi.fn(async ({ where }: { where: { status: { in: PresentationStatus[] } } }) =>
        world.cohort
          .filter((c) => where.status.in.includes(c.status))
          .map((c) => ({
            member: {
              id: c.member.id,
              fullName: c.member.fullName,
              email: c.member.email,
              emailStatus: c.member.emailStatus,
              memberships: c.member.memberNumber === null
                ? []
                : [{ memberNumber: c.member.memberNumber }],
            },
          })),
      ),
    },
    notification: {
      findMany: vi.fn(async ({ where }: { where: { boardNotice: { kind?: BoardNoticeKind } } }) =>
        world.covered
          .filter((c) => where.boardNotice.kind === undefined || c.kind === where.boardNotice.kind)
          .map((c) => ({ memberId: c.memberId })),
      ),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        created.push(...data);
        return { count: data.length };
      }),
    },
  };

  const db = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db, created, tx };
}

function board(world: World) {
  const { db, created, tx } = fakeDb(world);
  return { board: makeBoardNotices({ db: db as never }), created, db, tx };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("effectiveKind", () => {
  it("los tres avisos propios se nombran a sí mismos", () => {
    const p = { secondEndsAt: null };
    expect(effectiveKind("first_instance", p)).toBe("first_instance");
    expect(effectiveKind("second_instance", p)).toBe("second_instance");
    expect(effectiveKind("withdrawal", p)).toBe("withdrawal");
  });

  it("el aviso `other` habla de la instancia que está corriendo", () => {
    // El rebote posterior no tiene texto propio: es el MISMO aviso que el resto
    // de su instancia, para un vecino que se quedó afuera del lote. Cuál es la
    // instancia lo dice `secondEndsAt`, igual que en las dos pantallas.
    expect(effectiveKind("other", { secondEndsAt: null })).toBe("first_instance");
    expect(effectiveKind("other", { secondEndsAt: d(2026, 10, 20) })).toBe("second_instance");
  });
});

describe("listRecipients", () => {
  it("son los convocados SIN casilla utilizable, por número de socio", async () => {
    const { board: b } = board({
      notices: [],
      covered: [],
      cohort: [
        { member: member(3, { memberNumber: 30 }), status: "pending" },
        { member: member(1, { memberNumber: 10, email: "a@b.com", emailStatus: "verified" }), status: "pending" },
        { member: member(2, { memberNumber: 20, email: "c@d.com", emailStatus: "bounced" }), status: "pending" },
      ],
    });

    const rows = await b.listRecipients({ processId: 1, kind: "first_instance" });
    // El del correo verificado NO va al cartel; el que rebotó, sí.
    expect(rows.map((r) => r.memberId)).toEqual([2, 3]);
    expect(rows[0]).toEqual({ memberId: 2, memberNumber: 20, fullName: "Socio 2" });
  });

  it("la 2ª instancia deja afuera a quien ya presentó", async () => {
    const { board: b } = board({
      notices: [],
      covered: [],
      cohort: [
        { member: member(1), status: "pending" },
        { member: member(2), status: "submitted" },
        { member: member(3), status: "validated" },
        { member: member(4), status: "observed" },
      ],
    });

    const rows = await b.listRecipients({ processId: 1, kind: "second_instance" });
    expect(rows.map((r) => r.memberId)).toEqual([1, 4]);
  });

  it("el aviso de bajas alcanza sólo a los declarados de baja", async () => {
    const { board: b } = board({
      notices: [],
      covered: [],
      cohort: [
        { member: member(1), status: "pending" },
        { member: member(2), status: "withdrawn" },
      ],
    });

    const rows = await b.listRecipients({ processId: 1, kind: "withdrawal" });
    expect(rows.map((r) => r.memberId)).toEqual([2]);
  });

  it("no vuelve a listar a quien ya tiene su fila de cartelera de ese mismo aviso", async () => {
    const world: World = {
      notices: [],
      covered: [{ memberId: 1, kind: "first_instance" }],
      cohort: [
        { member: member(1), status: "pending" },
        { member: member(2), status: "pending" },
      ],
    };
    const { board: b } = board(world);

    // Fijado el cartel de 1ª instancia, el socio 1 ya quedó notificado por esa
    // vía: repetirlo sería asentar dos veces la misma notificación.
    expect((await b.listRecipients({ processId: 1, kind: "first_instance" })).map((r) => r.memberId))
      .toEqual([2]);
    // Pero la 2ª instancia dice algo DISTINTO (apercibimiento de baja): al
    // mismo socio hay que volver a fijarlo.
    expect((await b.listRecipients({ processId: 1, kind: "second_instance" })).map((r) => r.memberId))
      .toEqual([1, 2]);
  });

  it("`other` deja afuera a quien ya está cubierto por CUALQUIER aviso del proceso", async () => {
    const { board: b } = board({
      notices: [],
      covered: [{ memberId: 1, kind: "first_instance" }],
      cohort: [
        { member: member(1, { email: "a@b.com", emailStatus: "bounced" }), status: "pending" },
        { member: member(2, { email: "c@d.com", emailStatus: "bounced" }), status: "pending" },
      ],
    });

    // El 1 ya está en la pared por la convocatoria; el 2 rebotó DESPUÉS del
    // envío masivo y no entró en ningún cartel: ése es el caso de `other`.
    const rows = await b.listRecipients({ processId: 1, kind: "other" });
    expect(rows.map((r) => r.memberId)).toEqual([2]);
  });

  it("un proceso que no existe devuelve lista vacía en vez de romper", async () => {
    const { board: b } = board({ notices: [], covered: [], cohort: [], process: null });
    expect(await b.listRecipients({ processId: 99, kind: "first_instance" })).toEqual([]);
  });
});

describe("post", () => {
  const POSTED = d(2026, 10, 2); // viernes 02/10/2026

  function worldWithNotice(over: Partial<NoticeRow> = {}): World {
    return {
      notices: [{ id: 5, processId: 1, kind: "first_instance", postedAt: null, dueAt: null, ...over }],
      covered: [],
      cohort: [
        { member: member(1), status: "pending" },
        { member: member(2), status: "pending" },
      ],
    };
  }

  it("estampa la fijación y crea UNA fila por destinatario", async () => {
    const { board: b, created } = board(worldWithNotice());

    const result = await b.post({ noticeId: 5, postedAt: POSTED, holidays: HOLIDAYS });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `dueAt` NO se escribe a mano: sale de la misma función que el resto del
    // proyecto, con los feriados inyectados.
    expect(result.dueAt).toEqual(businessDayEnd(POSTED, BOARD_BUSINESS_DAYS, HOLIDAYS));
    expect(result.stamped).toBe(2);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      memberId: 1,
      boardNoticeId: 5,
      type: "reregistration_first",
      via: "board",
      status: "posted_board",
      boardFrom: POSTED,
      boardTo: result.dueAt,
    });
  });

  it("el viernes 02/10/2026 + 20 días hábiles, con el feriado del 12/10, cae el lunes 02/11", async () => {
    // El almanaque contado a mano, que es la única verificación que vale acá.
    // El 02/10/2026 es VIERNES y el día en que se cuelga el cartel no cuenta:
    //   oct 5, 6, 7, 8, 9      → 1-5
    //   oct 12 FERIADO (Día del Respeto a la Diversidad Cultural) — no cuenta
    //   oct 13, 14, 15, 16     → 6-9
    //   oct 19, 20, 21, 22, 23 → 10-14
    //   oct 26, 27, 28, 29, 30 → 15-19
    //   nov 2                  → 20
    // SIN la fila del 12/10 el plazo cerraría el viernes 30/10 y le comería un
    // día hábil al vecino. Ojo: el ejemplo ilustrativo del diseño (§8, "fijado
    // 02/10 · fehaciente el 30/10") es justamente el que sale de olvidar ese
    // feriado — es la cuenta que este módulo existe para no hacer.
    const { board: b } = board(worldWithNotice());
    const result = await b.post({ noticeId: 5, postedAt: POSTED, holidays: HOLIDAYS });
    expect(result.ok && result.dueAt).toEqual(d(2026, 11, 2));
  });

  it("la segunda fijación no pasa: el cerrojo la corta y no escribe nada", async () => {
    const world = worldWithNotice();
    const { board: b, created } = board(world);

    const first = await b.post({ noticeId: 5, postedAt: POSTED, holidays: HOLIDAYS });
    expect(first.ok).toBe(true);

    const second = await b.post({ noticeId: 5, postedAt: d(2026, 10, 20), holidays: HOLIDAYS });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toContain("una sola vez");
    // Y —lo que importa— la fecha original quedó intacta: una segunda fijación
    // correría el plazo de cien vecinos.
    expect(world.notices[0].postedAt).toEqual(POSTED);
    expect(created).toHaveLength(2);
  });

  it("cada `kind` escribe el tipo de notificación que le corresponde", async () => {
    for (const [kind, type] of [
      ["first_instance", "reregistration_first"],
      ["second_instance", "reregistration_second"],
      ["withdrawal", "withdrawal_declared"],
    ] as const) {
      const world = worldWithNotice({ kind });
      // El aviso de bajas alcanza sólo a los `withdrawn`.
      if (kind === "withdrawal") world.cohort = world.cohort.map((c) => ({ ...c, status: "withdrawn" }));
      const { board: b, created } = board(world);
      await b.post({ noticeId: 5, postedAt: POSTED, holidays: HOLIDAYS });
      expect(created.every((row) => row.type === type)).toBe(true);
      expect(created).toHaveLength(2);
    }
  });

  it("el aviso `other` hereda el tipo de la instancia en curso", async () => {
    const world = worldWithNotice({ kind: "other" });
    world.process = { id: 1, bookId: 9, secondEndsAt: d(2026, 10, 20) };
    const { board: b, created } = board(world);
    await b.post({ noticeId: 5, postedAt: POSTED, holidays: HOLIDAYS });
    expect(created.every((row) => row.type === "reregistration_second")).toBe(true);
  });

  it("un año sin feriados cargados vuelve como MENSAJE, no como excepción", async () => {
    const { board: b, created } = board(worldWithNotice());

    // 20 días hábiles desde el 20/12/2026 entran en 2027, que acá no está
    // cargado. La lectura ingenua ("no hay filas = no hay feriados") contaría
    // el 1° de enero como hábil y le acortaría el plazo al vecino.
    const result = await b.post({
      noticeId: 5,
      postedAt: d(2026, 12, 20),
      holidays: HOLIDAYS.filter((h) => h.getUTCFullYear() === 2026),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("2027");
    // Y dice CÓMO arreglarlo: el operador tiene un ABM en Configuración.
    expect(result.error).toContain("feriados");
    // Nada se estampó: el aviso sigue sin fijar y se puede reintentar.
    expect(created).toHaveLength(0);
  });

  it("un feriado fuera del formato canónico vuelve como MENSAJE, no como excepción", async () => {
    const { board: b, created } = board(worldWithNotice());

    // Medianoche UTC: en Argentina eso son las 21:00 del día ANTERIOR, así que
    // el feriado se contaría el día equivocado y encima engañaría a la guarda
    // de cobertura.
    const result = await b.post({
      noticeId: 5,
      postedAt: POSTED,
      holidays: [...HOLIDAYS, new Date("2026-10-12T00:00:00Z")],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("canónico");
    expect(created).toHaveLength(0);
  });

  it("un aviso que no existe no rompe", async () => {
    const { board: b } = board(worldWithNotice());
    const result = await b.post({ noticeId: 404, postedAt: POSTED, holidays: HOLIDAYS });
    expect(result.ok).toBe(false);
  });
});

describe("openOther", () => {
  it("crea el aviso `other` del proceso y reutiliza el que ya está abierto", async () => {
    const world: World = {
      notices: [],
      covered: [],
      cohort: [{ member: member(2, { email: "c@d.com", emailStatus: "bounced" }), status: "pending" }],
    };
    const { board: b } = board(world);

    const first = await b.openOther({ processId: 1, memberId: 2 });
    expect(first.ok).toBe(true);
    expect(world.notices).toHaveLength(1);
    expect(world.notices[0].kind).toBe("other");

    // Segundo rebote: se suma al MISMO cartel, no abre otro. La unidad de
    // trabajo del operador es el aviso, no el socio.
    const second = await b.openOther({ processId: 1, memberId: 2 });
    expect(second.ok && second.noticeId).toBe(first.ok && first.noticeId);
    expect(world.notices).toHaveLength(1);
  });

  it("rechaza a quien no es destinatario de cartelera", async () => {
    const world: World = {
      notices: [],
      covered: [],
      cohort: [{ member: member(2, { email: "c@d.com", emailStatus: "verified" }), status: "pending" }],
    };
    const { board: b } = board(world);

    const result = await b.openOther({ processId: 1, memberId: 2 });
    expect(result.ok).toBe(false);
    expect(world.notices).toHaveLength(0);
  });
});

describe("coverageNotice", () => {
  const FROM = d(2026, 10, 2);

  it("calla cuando el calendario cubre lo que el plazo puede pisar", () => {
    expect(coverageNotice(HOLIDAYS, FROM)).toBeNull();
  });

  it("avisa ANTES de asentar cuando falta el año que el plazo va a pisar", () => {
    const message = coverageNotice(HOLIDAYS.filter((h) => h.getUTCFullYear() === 2026), d(2026, 12, 20));
    expect(message).not.toBeNull();
    expect(message).toContain("2027");
  });

  it("avisa cuando una fila de feriado no está en el formato canónico", () => {
    const message = coverageNotice([...HOLIDAYS, new Date("2026-10-12T00:00:00Z")], FROM);
    expect(message).not.toBeNull();
    expect(message).toContain("canónico");
  });
});
