// La ÚNICA puerta de escritura de `reports` (spec §4 invariantes): el borrador
// nace con su llave hasheada, el envío revalida en la base (identidad, DNI,
// reglas) y pasa draft→received con un updateMany condicional, presentar y
// desestimar sólo tocan `received`, y los conteos son los de la pestaña y la
// landing. Doble de base en memoria que HONRA el `where` (lección del M6).
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { hashClaim } from "@/lib/reports/claim";
import { REPORT_MESSAGES } from "@/lib/reports/rules";
import { makeReports } from "@/lib/reports/service";

const NOW = new Date("2026-09-01T15:00:00Z");
type Row = Record<string, unknown> & { id: number; status: string };
type FileRow = { id: number; reportId: number; kind: string };

function fakeDb() {
  const reports: Row[] = [];
  const files: FileRow[] = [];
  let nextId = 1;
  // La fila única de `report_sequences`. El doble la trata como la trata
  // MariaDB: `$executeRaw` la incrementa y `findUniqueOrThrow` la lee.
  const sequence = { id: 1, last: 0 };
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v !== null && typeof v === "object" && "in" in (v as object)) {
        return (v as { in: unknown[] }).in.includes(r[k]);
      }
      if (v !== null && typeof v === "object" && "gte" in (v as object)) {
        const { gte, lt } = v as { gte?: Date; lt?: Date };
        const val = (r[k] ?? null) as Date | null;
        return val !== null && (!gte || val >= gte) && (!lt || val < lt);
      }
      return r[k] === v;
    });
  const withFiles = (r: Row) => ({ ...r, files: files.filter((f) => f.reportId === r.id) });
  const db = {
    report: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: nextId++, status: "draft", createdAt: NOW, ...data };
        reports.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const r = reports.find((x) => matches(x, where));
        return r ? withFiles(r) : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const r = reports.find((x) => matches(x, where));
        return r ? withFiles(r) : null;
      }),
      // Honra el `orderBy` que recibe además del `where`: un doble que devuelve
      // el orden de inserción deja sin ejercitar el `orderBy` real (lección del
      // M6), y acá el orden ES parte del contrato de la lista del socio.
      findMany: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: Record<string, unknown>;
          orderBy?: Record<string, "asc" | "desc">;
        }) => {
          const rows = reports.filter((x) => matches(x, where)).map(withFiles);
          const [field, dir] = Object.entries(orderBy ?? {})[0] ?? [];
          if (field) {
            rows.sort((a, b) => {
              const av = (a as Row)[field] as number, bv = (b as Row)[field] as number;
              return dir === "desc" ? bv - av : av - bv;
            });
          }
          return rows;
        },
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const r of reports)
            if (matches(r, where)) {
              Object.assign(r, data);
              count++;
            }
          return { count };
        },
      ),
      count: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => reports.filter((x) => matches(x, where)).length,
      ),
    },
    reportFile: {
      findMany: vi.fn(async ({ where }: { where: { reportId: number } }) =>
        files.filter((f) => f.reportId === where.reportId),
      ),
    },
    // La transacción del envío. El `tx` que recibe el callback expone lo mismo
    // que usa `submit`: el `updateMany` de reportes —el MISMO, que honra el
    // `where`— y las dos piezas de la secuencia. Y modela lo único que importa
    // de una transacción para este contrato: si el callback TIRA, el número
    // vuelve atrás. Sin ese `rollback` el test de la carrera pasaría igual con
    // un `return` en vez del `throw`, que es justo la guarda que sostiene la
    // serie sin huecos (REG-33).
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = sequence.last;
      const tx = {
        report: { updateMany: db.report.updateMany },
        $executeRaw: vi.fn(async () => {
          sequence.last += 1;
          return 1;
        }),
        reportSequence: {
          findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: number } }) => {
            if (where.id !== sequence.id) throw new Error("no existe la fila de la secuencia");
            return { ...sequence };
          }),
        },
      };
      try {
        return await fn(tx);
      } catch (e) {
        sequence.last = before;
        throw e;
      }
    }),
  };
  return { db, reports, files, sequence };
}

const reporter = { name: "Ana López", dni: "30123456", phone: "2974000000", email: "ana@example.com" };
const submission = {
  category: "streets",
  subtype: "pothole",
  description: "Un pozo enorme.",
  lat: -45.797,
  lng: -67.494,
  streetId: 3,
  streetName: "Cerro Catedral",
  addressDetail: "al 280",
  scplTicket: null,
  consent: true,
};

let ctx: ReturnType<typeof fakeDb>;
let service: ReturnType<typeof makeReports>;
beforeEach(() => {
  vi.clearAllMocks();
  ctx = fakeDb();
  service = makeReports({ db: ctx.db as never, now: () => NOW });
});

async function vecinoDraft() {
  const { id, claim } = await service.startDraft({
    kind: "claim",
    anonymous: false,
    ip: "1.1.1.1",
    userAgent: "ua",
  });
  await service.saveReporter({ reportId: id, ...reporter });
  ctx.files.push({ id: 1, reportId: id, kind: "dni_front" }, { id: 2, reportId: id, kind: "dni_back" });
  return { id, claim };
}

describe("startDraft y findByClaim", () => {
  it("crea el borrador con el hash de la llave, nunca con la llave", async () => {
    const { id, claim } = await service.startDraft({
      kind: "claim",
      anonymous: true,
      ip: "1.1.1.1",
      userAgent: "ua",
    });
    expect(ctx.reports[0]).toMatchObject({
      id,
      status: "draft",
      kind: "claim",
      anonymous: true,
      claimTokenHash: hashClaim(claim),
    });
    expect(JSON.stringify(ctx.reports[0])).not.toContain(claim);
    expect(await service.findByClaim(claim)).toMatchObject({ id });
    expect(await service.findByClaim("x".repeat(43))).toBeNull();
    expect(await service.findByClaim("../")).toBeNull();
    expect(ctx.db.report.findUnique).toHaveBeenCalledTimes(2); // la llave sin forma no consulta
  });

  it("el borrador de un socio copia la identidad de la ficha", async () => {
    const { id } = await service.startDraft({
      kind: "initiative",
      anonymous: false,
      memberId: 14,
      reporter,
      ip: "1.1.1.1",
      userAgent: "ua",
    });
    expect(ctx.reports[0]).toMatchObject({
      id,
      memberId: 14,
      reporterName: "Ana López",
      reporterDni: "30123456",
    });
  });
});

describe("saveReporter", () => {
  it("sólo escribe sobre un borrador", async () => {
    const { id } = await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.saveReporter({ reportId: id, ...reporter })).toEqual({ ok: true });
    ctx.reports[0].status = "received";
    expect(await service.saveReporter({ reportId: id, ...reporter })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.notDraft,
    });
  });
});

describe("submit", () => {
  it("pasa draft→received, estampa submittedAt, consentAt y la marca de fuera del barrio", async () => {
    const { id } = await vecinoDraft();
    const r = await service.submit({ reportId: id, ...submission });
    // El N° PÚBLICO viaja en la respuesta Y queda escrito en la fila: es lo que
    // el acuse le manda al vecino y lo que la pantalla terminal imprime.
    expect(r).toEqual({ ok: true, id, number: 1 });
    expect(ctx.reports[0]).toMatchObject({
      status: "received",
      submittedAt: NOW,
      consentAt: NOW,
      number: 1,
      category: "streets",
      subtype: "pothole",
      outsideBoundary: false,
      streetName: "Cerro Catedral",
    });
    const far = await vecinoDraft();
    await service.submit({ reportId: far.id, ...submission, lat: -45.8647, lng: -67.4823 });
    expect(ctx.reports[1]).toMatchObject({ outsideBoundary: true });
  });

  it("revalida en la base: sin DNI o sin identidad no pasa, y sin consentimiento tampoco", async () => {
    const { id } = await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.identity,
    });
    await service.saveReporter({ reportId: id, ...reporter });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.dni,
    });
    ctx.files.push({ id: 1, reportId: id, kind: "dni_front" }, { id: 2, reportId: id, kind: "dni_back" });
    expect(await service.submit({ reportId: id, ...submission, consent: false })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.consent,
    });
    expect(ctx.reports[0].status).toBe("draft");
  });

  it("un socio envía sin DNI ni identidad declarada", async () => {
    const { id } = await service.startDraft({
      kind: "initiative",
      anonymous: false,
      memberId: 14,
      reporter,
      ip: "1",
      userAgent: "",
    });
    const r = await service.submit({
      reportId: id,
      ...submission,
      category: "social",
      subtype: null,
      lat: null,
      lng: null,
    });
    expect(r).toEqual({ ok: true, id, number: 1 });
  });

  // La normalización de `rules.ts` («"" → null») tiene que llegar a la BASE: una
  // categoría sin tipos guarda NULL, no la cadena vacía que manda el `<select>`.
  it("una categoría sin tipos persiste el subtipo en NULL, nunca en cadena vacía", async () => {
    const { id } = await vecinoDraft();
    const r = await service.submit({
      reportId: id,
      ...submission,
      category: "other",
      subtype: "",
      lat: null,
      lng: null,
    });
    expect(r).toEqual({ ok: true, id, number: 1 });
    expect(ctx.reports[0].subtype).toBeNull();
  });

  it("un segundo envío del mismo borrador no escribe dos veces", async () => {
    const { id } = await vecinoDraft();
    await service.submit({ reportId: id, ...submission });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.notDraft,
    });
  });

  // La CARRERA, no la precondición: el test de arriba lo corta la lectura previa
  // (`report.status !== "draft"`), así que no ejercita el `status` del `where`.
  // Acá el segundo POST llega con la foto VIEJA —leyó antes de que el primero
  // escribiera—, que es lo que pasa con dos clicks simultáneos: lo único que lo
  // frena es que el updateMany sea condicional por estado.
  it("dos envíos simultáneos: el updateMany condicional deja pasar uno solo", async () => {
    const { id } = await vecinoDraft();
    const stale = await ctx.db.report.findUnique({ where: { id } });
    await service.submit({ reportId: id, ...submission });
    ctx.db.report.findUnique.mockResolvedValueOnce(stale);
    expect(await service.submit({ reportId: id, ...submission })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.notDraft,
    });
  });

  // REG-33 aplicado a los reportes: el envío perdido de la carrera de arriba
  // PIDIÓ un número antes de descubrir que el borrador ya no era suyo, y ese
  // número tiene que volver con el rollback. Si no volviera, el próximo vecino
  // sería el "N° 3" siendo el segundo reporte de la historia — el hueco que
  // esta serie viene a eliminar.
  //
  // MUTACIÓN que lo prueba: cambiar el `throw new NotDraftError()` de
  // `service.submit` por un `return { ok: false, ... }` deja la transacción
  // commitear y esta aserción se pone en rojo (`last` queda en 2).
  it("un envío que pierde la carrera NO consume número: la secuencia vuelve atrás", async () => {
    const a = await vecinoDraft();
    const stale = await ctx.db.report.findUnique({ where: { id: a.id } });
    expect(await service.submit({ reportId: a.id, ...submission })).toMatchObject({ number: 1 });
    ctx.db.report.findUnique.mockResolvedValueOnce(stale);
    await service.submit({ reportId: a.id, ...submission });
    expect(ctx.sequence.last).toBe(1);

    // Y el siguiente envío REAL toma el 2, no el 3: la serie quedó corrida.
    const b = await vecinoDraft();
    expect(await service.submit({ reportId: b.id, ...submission })).toEqual({
      ok: true,
      id: b.id,
      number: 2,
    });
  });

  // El N° no es el id: la fila nace `draft` en el paso 1 y los abandonados se
  // llevaban un número. Con tres borradores muertos antes, el primer envío
  // sigue siendo el N° 1 aunque su id sea el 4.
  it("los borradores abandonados no gastan número: el primer envío es el N° 1", async () => {
    for (let i = 0; i < 3; i++) {
      await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    }
    const { id } = await vecinoDraft();
    expect(id).toBe(4);
    expect(await service.submit({ reportId: id, ...submission })).toEqual({ ok: true, id, number: 1 });
  });
});

describe("file y dismiss", () => {
  async function received() {
    const { id } = await vecinoDraft();
    await service.submit({ reportId: id, ...submission });
    return id;
  }

  it("presenta un reporte recibido y guarda organismo, fecha, expediente y quién", async () => {
    const id = await received();
    const r = await service.file({
      reportId: id,
      actorId: 9,
      agency: "scpl",
      agencyOther: null,
      filedAt: NOW,
      reference: "EXP-1",
      minuteId: null,
    });
    expect(r).toEqual({ ok: true });
    expect(ctx.reports[0]).toMatchObject({
      status: "filed",
      filedAgency: "scpl",
      filedReference: "EXP-1",
      filedById: 9,
      filedAt: NOW,
    });
  });

  it("'Otro' exige el texto del organismo", async () => {
    const id = await received();
    const r = await service.file({
      reportId: id,
      actorId: 9,
      agency: "other",
      agencyOther: null,
      filedAt: NOW,
      reference: null,
      minuteId: null,
    });
    expect(r).toEqual({ ok: false, error: REPORT_MESSAGES.agencyOther });
    expect(ctx.reports[0].status).toBe("received");
  });

  it("desestimar exige motivo y sólo actúa sobre received; presentar sobre desestimado falla", async () => {
    const id = await received();
    // El piso son 5 caracteres (spec §5.3): el vacío y un motivo de 4 no pasan.
    expect(await service.dismiss({ reportId: id, actorId: 9, reason: "  " })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.dismissReason,
    });
    expect(await service.dismiss({ reportId: id, actorId: 9, reason: " dup " })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.dismissReason,
    });
    expect(await service.dismiss({ reportId: id, actorId: 9, reason: "Duplicado del N° 3." })).toEqual({
      ok: true,
    });
    expect(ctx.reports[0]).toMatchObject({
      status: "dismissed",
      dismissReason: "Duplicado del N° 3.",
      dismissedById: 9,
    });
    expect(
      await service.file({
        reportId: id,
        actorId: 9,
        agency: "mcr",
        agencyOther: null,
        filedAt: NOW,
        reference: null,
        minuteId: null,
      }),
    ).toEqual({ ok: false, error: REPORT_MESSAGES.notPending });
    // Motivo válido a propósito: lo que se ejercita acá es el `where` (un id que
    // no existe), no la guarda de longitud que ya se probó arriba.
    expect(await service.dismiss({ reportId: 999, actorId: 9, reason: "No existe." })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.notPending,
    });
  });
});

describe("conteos y listados", () => {
  it("pendingCount cuenta sólo received; yearStats cuenta enviados y presentados del año civil", async () => {
    const a = await vecinoDraft();
    await service.submit({ reportId: a.id, ...submission });
    const b = await vecinoDraft();
    await service.submit({ reportId: b.id, ...submission });
    await service.file({
      reportId: b.id,
      actorId: 9,
      agency: "mcr",
      agencyOther: null,
      filedAt: NOW,
      reference: null,
      minuteId: null,
    });
    await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.pendingCount()).toBe(1);
    expect(await service.yearStats(NOW)).toEqual({ received: 2, filed: 1 });
  });

  it("listForMember devuelve sólo los del socio, sin borradores", async () => {
    const mine = await service.startDraft({
      kind: "claim",
      anonymous: false,
      memberId: 14,
      reporter,
      ip: "1",
      userAgent: "",
    });
    await service.submit({ reportId: mine.id, ...submission });
    await service.startDraft({
      kind: "claim",
      anonymous: false,
      memberId: 14,
      reporter,
      ip: "1",
      userAgent: "",
    });
    await service.startDraft({
      kind: "claim",
      anonymous: false,
      memberId: 15,
      reporter,
      ip: "1",
      userAgent: "",
    });
    const list = await service.listForMember(14);
    expect(list.map((r) => r.id)).toEqual([mine.id]);
    // El `where` y el `orderBy` con los que se pide, tal cual: el filtro por
    // estado es `SUBMITTED_STATUSES` (received/filed/dismissed — el borrador de
    // otra pestaña no es un reporte que el socio "mandó") y el orden es por id
    // descendente, que es el más nuevo arriba.
    expect(ctx.db.report.findMany).toHaveBeenLastCalledWith({
      where: { memberId: 14, status: { in: ["received", "filed", "dismissed"] } },
      orderBy: { id: "desc" },
      take: 20,
      include: { files: true },
    });
  });

  it("listForMember devuelve el más nuevo primero", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await service.startDraft({
        kind: "claim", anonymous: false, memberId: 14, reporter, ip: "1", userAgent: "",
      });
      await service.submit({ reportId: r.id, ...submission });
      ids.push(r.id);
    }
    const list = await service.listForMember(14);
    expect(list.map((r) => r.id)).toEqual([...ids].reverse());
  });
});
