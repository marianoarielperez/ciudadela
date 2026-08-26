// Task 12 (6B): las decisiones de la Comisión sobre UNA presentación de
// re-empadronamiento, y la carga presencial.
//
// Db FAKE en todo el archivo: acá no hay base ni escritor real de fichas. Lo
// que se fija es lo que en producción decide si un socio conserva su condición
// de tal —y, por primera vez en todo el módulo, lo que entra al PADRÓN desde
// una pantalla pública:
//
//   - `validate` vuelca a la ficha EXACTAMENTE los campos declarados y ninguno
//     más: el NOMBRE nunca viaja (es el ancla de identidad de la ficha, y con
//     un DNI por toda credencial dejarlo entrar permitiría apropiarse de la
//     ficha de otro), y el DNI tampoco;
//   - el cerrojo del `updateMany` condicionado por estado: dos administradores
//     mirando la misma presentación no pueden pisarse en silencio;
//   - `observe` SIN nota se rechaza. Que la nota LLEGUE a la plantilla del
//     correo lo fija `presentation-actions.test.ts`, que es donde vive el
//     llamador: la plantilla la acepta opcional, así que un llamador olvidadizo
//     le manda al vecino un correo que promete un detalle inexistente con el
//     plazo del Art. 9° bis corriendo;
//   - `registerInPerson` exige email: es decisión expresa del operador
//     (decisión 4 del diseño) porque constituye el domicilio electrónico del
//     Art. 5° ter.
import { describe, expect, it, vi } from "vitest";
// El módulo no importa el singleton (el cliente se INYECTA), pero `tokens.ts`
// —de donde sale `hashToken`— sí lo evalúa al cargarse, y `@/lib/prisma` tira
// si falta DATABASE_URL. Es la trampa que documenta `applications/query.ts`.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import type { DocumentType, PresentationStatus } from "@/generated/prisma/client";
import { MemberEmailConflictError } from "@/lib/members/write";
import {
  ALREADY_DECIDED,
  makePresentations,
  NOT_SUBMITTED_YET,
  OBSERVATION_MAX,
  type PresentationData,
} from "@/lib/reregistration/presentation";

const NOW = new Date("2026-10-05T12:00:00Z");

const DATA: PresentationData = {
  birthDate: new Date("1970-05-04T12:00:00Z"),
  civilStatus: "Casado/a",
  nationality: "Argentina",
  occupation: "Docente",
  streetId: 7,
  streetText: null,
  streetNumber: "1234",
  neighborhood: "Ciudadela",
  phone: "297 4000000",
  email: "vecina@ejemplo.com",
};

type Row = {
  id: number;
  processId: number;
  memberId: number;
  status: PresentationStatus;
  channel: string | null;
  submittedAt: Date | null;
  validatedAt: Date | null;
  validatedById: number | null;
  observation: string | null;
  processStatus: string;
} & PresentationData;

function row(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    processId: 3,
    memberId: 42,
    status: "submitted",
    channel: "web",
    submittedAt: new Date("2026-10-01T12:00:00Z"),
    validatedAt: null,
    validatedById: null,
    observation: null,
    processStatus: "first_instance",
    ...DATA,
    ...over,
  };
}

type MemberRow = {
  id: number;
  fullName: string;
  dni: string | null;
  status: string;
  userId: number | null;
  emailStatus: string;
  emailVerifiedAt: Date | null;
} & PresentationData;

function member(over: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 42,
    fullName: "Castillo Nestor",
    dni: "12345678",
    status: "active",
    userId: null,
    emailStatus: "none",
    emailVerifiedAt: null,
    birthDate: null,
    civilStatus: null,
    nationality: null,
    occupation: null,
    streetId: null,
    streetText: null,
    streetNumber: null,
    neighborhood: null,
    phone: null,
    email: null,
    ...over,
  };
}

/** Base falsa: filas en memoria. Devuelve COPIAS —como Prisma— así que el
 *  módulo no puede pasar un test mutando el objeto que le prestamos. */
function fakeDb(
  rows: Row[],
  opts: { docs?: Array<{ ownerId: number; type: DocumentType }>; members?: MemberRow[] } = {},
) {
  const docs = opts.docs ?? [
    { ownerId: 1, type: "dni_front" as DocumentType },
    { ownerId: 1, type: "dni_back" as DocumentType },
  ];
  const members = opts.members ?? [member()];

  function shape(r: Row) {
    const { processStatus, ...rest } = r;
    return { ...rest, process: { id: r.processId, status: processStatus } };
  }

  const presentation = {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { id?: number; processId_memberId?: { processId: number; memberId: number } };
      }) => {
        const found = rows.find((r) =>
          where.processId_memberId
            ? r.processId === where.processId_memberId.processId &&
              r.memberId === where.processId_memberId.memberId
            : r.id === where.id,
        );
        return found ? shape(found) : null;
      },
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: number; status?: { in: PresentationStatus[] } };
        data: Record<string, unknown>;
      }) => {
        const target = rows.find(
          (r) => r.id === where.id && (!where.status || where.status.in.includes(r.status)),
        );
        if (!target) return { count: 0 };
        Object.assign(target, data);
        return { count: 1 };
      },
    ),
  };

  const memberDelegate = {
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: number } }) => {
      const found = members.find((m) => m.id === where.id);
      if (!found) throw new Error("no member");
      return { ...found };
    }),
  };

  const db = {
    rows,
    members,
    presentation,
    member: memberDelegate,
    document: {
      findMany: vi.fn(async ({ where }: { where: { ownerId: number } }) =>
        docs.filter((d) => d.ownerId === where.ownerId).map((d) => ({ type: d.type })),
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

/** Escritor de fichas falso: guarda el patch que recibió para que el test pueda
 *  afirmar QUÉ campos se volcaron (y cuáles no). */
function fakeWriter(over: { throws?: Error; accountEmailMove?: { from: string; to: string } } = {}) {
  const calls: Array<{ memberId: number; data: Record<string, unknown> }> = [];
  return {
    calls,
    writerFor: (tx: { member: { findUniqueOrThrow: (a: unknown) => Promise<MemberRow> } }) => ({
      async updateMember(memberId: number, data: Record<string, unknown>) {
        if (over.throws) throw over.throws;
        calls.push({ memberId, data });
        const before = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
        return {
          member: { ...before, ...data },
          revokedTokens: 0,
          accountEmailMove: over.accountEmailMove ?? null,
          accountEmailUpdated: over.accountEmailMove !== undefined,
        };
      },
    }),
  };
}

function presentations(db: ReturnType<typeof fakeDb>, writer = fakeWriter()) {
  return makePresentations(db as never, {
    writerFor: writer.writerFor as never,
    now: () => NOW,
  });
}

describe("validate", () => {
  it("vuelca a la ficha los campos declarados y NINGUNO más: el nombre nunca viaja", async () => {
    const db = fakeDb([row()]);
    const writer = fakeWriter();
    const res = await presentations(db, writer).validate({ presentationId: 1, actorId: 9 });

    expect(res.ok).toBe(true);
    expect(writer.calls).toHaveLength(1);
    const patch = writer.calls[0].data;
    // El ancla de identidad de la ficha: no está y no puede estar.
    expect(patch).not.toHaveProperty("fullName");
    expect(patch).not.toHaveProperty("dni");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("category");
    // Los diez declarados, más las dos columnas que gobiernan la verificación
    // de la casilla (`emailStatus`/`emailVerifiedAt`, como `buildPatch`).
    expect(Object.keys(patch).sort()).toEqual(
      [
        "birthDate",
        "civilStatus",
        "email",
        "emailStatus",
        "emailVerifiedAt",
        "nationality",
        "neighborhood",
        "occupation",
        "phone",
        "streetId",
        "streetNumber",
        "streetText",
      ].sort(),
    );
    expect(patch.email).toBe("vecina@ejemplo.com");
    expect(patch.streetNumber).toBe("1234");
  });

  it("una dirección nueva vuelve la casilla a «declarada» y borra la verificación anterior", async () => {
    const db = fakeDb([row()], {
      members: [member({ email: "vieja@ejemplo.com", emailStatus: "verified", emailVerifiedAt: NOW })],
    });
    const writer = fakeWriter();
    const res = await presentations(db, writer).validate({ presentationId: 1, actorId: 9 });

    expect(res.ok && res.emailChanged).toBe(true);
    expect(writer.calls[0].data.emailStatus).toBe("declared");
    expect(writer.calls[0].data.emailVerifiedAt).toBeNull();
  });

  it("la misma dirección con otra caja NO cuenta como cambio y no baja la verificación", async () => {
    const db = fakeDb([row({ email: "Vecina@Ejemplo.com" })], {
      members: [member({ email: "vecina@ejemplo.com", emailStatus: "verified", emailVerifiedAt: NOW })],
    });
    const writer = fakeWriter();
    const res = await presentations(db, writer).validate({ presentationId: 1, actorId: 9 });

    expect(res.ok && res.emailChanged).toBe(false);
    expect(writer.calls[0].data.emailStatus).toBe("verified");
  });

  it("deja la presentación validada con quién y cuándo", async () => {
    const db = fakeDb([row()]);
    await presentations(db).validate({ presentationId: 1, actorId: 9 });
    expect(db.rows[0].status).toBe("validated");
    expect(db.rows[0].validatedById).toBe(9);
    expect(db.rows[0].validatedAt).toEqual(NOW);
  });

  it("CERROJO: si otro admin decidió primero, no escribe la ficha y lo dice", async () => {
    // La fila ya está resuelta: el `updateMany` condicionado por estado devuelve
    // count 0, que es exactamente lo que pasa cuando el otro admin ganó la
    // carrera entre la lectura de esta pantalla y su POST.
    const db = fakeDb([row({ status: "validated" })]);
    const writer = fakeWriter();
    const res = await presentations(db, writer).validate({ presentationId: 1, actorId: 9 });

    expect(res.ok).toBe(false);
    expect(writer.calls).toHaveLength(0);
  });

  it("no valida una presentación que nunca se envió, y lo dice SIN culpar a otro admin", async () => {
    const db = fakeDb([row({ status: "pending", submittedAt: null })]);
    const res = await presentations(db).validate({ presentationId: 1, actorId: 9 });
    expect(res.ok).toBe(false);
    // "Otro administrador ya resolvió" mandaría al operador a recargar una
    // pantalla que dice exactamente lo mismo. Los dos "no" no son el mismo no.
    if (!res.ok) expect(res.error).toBe(NOT_SUBMITTED_YET);
  });

  it("la que otro admin ya resolvió lo dice CON esas palabras, aunque la pantalla venga vieja", async () => {
    // El caso real del cerrojo: la pantalla se dibujó con la presentación en
    // `submitted`, el otro administrador la validó mientras esta persona la
    // leía, y el POST llega tarde. La pre-guarda lo atrapa antes que el
    // `updateMany`, y tiene que decir lo mismo que diría el `updateMany`.
    for (const status of ["validated", "rejected", "withdrawn"] as const) {
      const db = fakeDb([row({ status })]);
      const res = await presentations(db).validate({ presentationId: 1, actorId: 9 });
      expect(res).toEqual({ ok: false, error: ALREADY_DECIDED });
    }
  });

  it("sí valida una observada: es lo que la etapa A del cierre tiene que poder resolver", async () => {
    const db = fakeDb([row({ status: "observed", observation: "Falta el dorso" })]);
    const res = await presentations(db).validate({ presentationId: 1, actorId: 9 });
    expect(res.ok).toBe(true);
  });

  it("con el proceso cerrado no se toca nada", async () => {
    const db = fakeDb([row({ processStatus: "closed" })]);
    const writer = fakeWriter();
    const res = await presentations(db, writer).validate({ presentationId: 1, actorId: 9 });
    expect(res.ok).toBe(false);
    expect(writer.calls).toHaveLength(0);
  });

  it("una presentación incompleta no entra al padrón", async () => {
    const db = fakeDb([row({ email: null })]);
    const writer = fakeWriter();
    const res = await presentations(db, writer).validate({ presentationId: 1, actorId: 9 });
    expect(res.ok).toBe(false);
    expect(writer.calls).toHaveLength(0);
  });

  it("el choque de email de acceso sale como un mensaje accionable, no como un error crudo", async () => {
    const db = fakeDb([row()]);
    const writer = fakeWriter({ throws: new MemberEmailConflictError() });
    const res = await presentations(db, writer).validate({ presentationId: 1, actorId: 9 });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/otra cuenta/i);
      // Le dice al operador qué hacer, que es la diferencia entre un error y un
      // mensaje: la presentación sigue en la cola y se resuelve observándola.
      expect(res.error).toMatch(/observ|ficha/i);
    }
  });

  it("`applied` nombra sólo lo que efectivamente cambió", async () => {
    const db = fakeDb([row()], {
      members: [member({ ...DATA, emailStatus: "verified", emailVerifiedAt: NOW, phone: "otro" })],
    });
    const res = await presentations(db).validate({ presentationId: 1, actorId: 9 });
    expect(res.ok && res.applied).toEqual(["phone"]);
  });
});

describe("observe", () => {
  it("sin nota no observa: ese texto es lo único que le llega al vecino", async () => {
    const db = fakeDb([row()]);
    const res = await presentations(db).observe({ presentationId: 1, actorId: 9, note: "   " });
    expect(res.ok).toBe(false);
    expect(db.rows[0].status).toBe("submitted");
  });

  it("guarda la nota recortada y pasa a observada", async () => {
    const db = fakeDb([row()]);
    const res = await presentations(db).observe({
      presentationId: 1,
      actorId: 9,
      note: "  El dorso del DNI salió movido.  ",
    });
    expect(res.ok).toBe(true);
    expect(db.rows[0].status).toBe("observed");
    expect(db.rows[0].observation).toBe("El dorso del DNI salió movido.");
  });

  it("no acepta una nota más larga que la columna", async () => {
    const db = fakeDb([row()]);
    const res = await presentations(db).observe({
      presentationId: 1,
      actorId: 9,
      note: "x".repeat(OBSERVATION_MAX + 1),
    });
    expect(res.ok).toBe(false);
  });

  it("CERROJO: la que otro admin ya validó no se puede observar", async () => {
    const db = fakeDb([row({ status: "validated" })]);
    const res = await presentations(db).observe({ presentationId: 1, actorId: 9, note: "algo" });
    expect(res).toEqual({ ok: false, error: ALREADY_DECIDED });
  });
});

describe("reject / unreject", () => {
  it("rechaza y guarda la nota si la hay", async () => {
    const db = fakeDb([row()]);
    const res = await presentations(db).reject({
      presentationId: 1,
      actorId: 9,
      note: "No es el titular.",
    });
    expect(res.ok).toBe(true);
    expect(db.rows[0].status).toBe("rejected");
    expect(db.rows[0].observation).toBe("No es el titular.");
  });

  it("el rechazo es reversible: vuelve a observada", async () => {
    const db = fakeDb([row({ status: "rejected" })]);
    const res = await presentations(db).unreject({ presentationId: 1, actorId: 9 });
    expect(res.ok).toBe(true);
    expect(db.rows[0].status).toBe("observed");
  });

  it("no se puede revivir algo que no está rechazado", async () => {
    const db = fakeDb([row({ status: "validated" })]);
    const res = await presentations(db).unreject({ presentationId: 1, actorId: 9 });
    expect(res).toEqual({ ok: false, error: ALREADY_DECIDED });
  });
});

describe("registerInPerson", () => {
  it("sin email no se registra: es el domicilio electrónico del Art. 5° ter", async () => {
    const db = fakeDb([row({ status: "pending", submittedAt: null, channel: null })]);
    const res = await presentations(db).registerInPerson({
      processId: 3,
      memberId: 42,
      actorId: 9,
      data: { ...DATA, email: null },
    });
    expect(res.ok).toBe(false);
    expect(db.rows[0].status).toBe("pending");
  });

  it("tampoco sin barrio: usa la MISMA regla de completitud que el wizard", async () => {
    const db = fakeDb([row({ status: "pending", submittedAt: null, channel: null })]);
    const res = await presentations(db).registerInPerson({
      processId: 3,
      memberId: 42,
      actorId: 9,
      data: { ...DATA, neighborhood: null },
    });
    expect(res.ok).toBe(false);
  });

  it("exige los mismos documentos que la web", async () => {
    const db = fakeDb([row({ status: "pending", submittedAt: null, channel: null })], {
      docs: [{ ownerId: 1, type: "dni_front" }],
    });
    const res = await presentations(db).registerInPerson({
      processId: 3,
      memberId: 42,
      actorId: 9,
      data: DATA,
    });
    expect(res.ok).toBe(false);
    expect(db.rows[0].status).toBe("pending");
  });

  it("asienta la presentación del mostrador con su canal y su prueba de plazo", async () => {
    const db = fakeDb([row({ status: "pending", submittedAt: null, channel: null })]);
    const res = await presentations(db).registerInPerson({
      processId: 3,
      memberId: 42,
      actorId: 9,
      data: DATA,
    });
    expect(res.ok).toBe(true);
    expect(db.rows[0].status).toBe("submitted");
    expect(db.rows[0].channel).toBe("in_person");
    expect(db.rows[0].submittedAt).toEqual(NOW);
    expect(db.rows[0].email).toBe("vecina@ejemplo.com");
  });

  it("una subsanación en el mostrador NO mueve `submittedAt`: es la prueba del plazo", async () => {
    const first = new Date("2026-10-01T12:00:00Z");
    const db = fakeDb([row({ status: "observed", submittedAt: first })]);
    await presentations(db).registerInPerson({
      processId: 3,
      memberId: 42,
      actorId: 9,
      data: DATA,
    });
    expect(db.rows[0].submittedAt).toEqual(first);
  });

  it("no carga por mostrador a quien no fue convocado", async () => {
    const db = fakeDb([row()]);
    const res = await presentations(db).registerInPerson({
      processId: 3,
      memberId: 999,
      actorId: 9,
      data: DATA,
    });
    expect(res.ok).toBe(false);
  });

  it("con el plazo vencido el mostrador tampoco recibe", async () => {
    const db = fakeDb([row({ status: "pending", submittedAt: null, processStatus: "closing" })]);
    const res = await presentations(db).registerInPerson({
      processId: 3,
      memberId: 42,
      actorId: 9,
      data: DATA,
    });
    expect(res.ok).toBe(false);
  });

  it("lo que ya está en la cola no se vuelve a cargar desde el mostrador", async () => {
    const db = fakeDb([row({ status: "submitted" })]);
    const res = await presentations(db).registerInPerson({
      processId: 3,
      memberId: 42,
      actorId: 9,
      data: DATA,
    });
    expect(res.ok).toBe(false);
  });
});

describe("ALREADY_DECIDED", () => {
  it("le dice al operador que alguien más decidió y que refresque", () => {
    expect(ALREADY_DECIDED).toMatch(/otro/i);
    expect(ALREADY_DECIDED).toMatch(/actualiz/i);
  });
});
