// Task 11 (6B): el ciclo de vida de UNA presentación de re-empadronamiento —
// la llave de retorno, la carga de datos, los documentos y el envío.
//
// Db FAKE en todo el archivo: acá no hay base. Lo que se fija es lo que en
// producción decide si un socio conserva su condición de tal:
//
//   - la LLAVE rota en cada `claim` y la anterior deja de abrir (el enlace del
//     correo es siempre el último emitido, y sólo uno vive a la vez);
//   - `submit` NO acepta una presentación incompleta —sin DNI, sin email— ni
//     una fuera de plazo, porque `submittedAt` es la ÚNICA prueba de que el
//     socio cumplió dentro de los treinta días del Art. 9° bis;
//   - un segundo `submit` (doble clic, reintento del navegador) contesta ok y
//     NO pisa `submittedAt`: mover esa marca un minuto es mover la prueba del
//     plazo;
//   - lo que ya validó la Comisión no se puede editar desde la web.
import { describe, expect, it, vi } from "vitest";
// El módulo no importa el singleton (el cliente se INYECTA), pero `tokens.ts`
// —de donde sale `hashToken`— sí lo evalúa al cargarse, y `@/lib/prisma` tira
// si falta DATABASE_URL. Es la trampa que documenta `applications/query.ts`.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import type { DocumentType, PresentationStatus } from "@/generated/prisma/client";
import {
  documentSlotFill,
  makePresentations,
  presentationDataComplete,
  presentationDocsComplete,
  PRESENTATION_MAX_ANNEXES,
  type PresentationData,
} from "@/lib/reregistration/presentation";
import { hashToken } from "@/lib/tokens";

// 20/09/2026 a las 12:00 UTC = 09:00 en Argentina.
const NOW = new Date("2026-09-20T12:00:00Z");

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
  memberId: number;
  status: PresentationStatus;
  resumeTokenHash: string | null;
  submittedAt: Date | null;
  validatedAt: Date | null;
  observation: string | null;
  channel: string | null;
  processStatus: string;
} & Partial<PresentationData>;

function row(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    memberId: 42,
    status: "pending",
    resumeTokenHash: null,
    submittedAt: null,
    validatedAt: null,
    observation: null,
    channel: null,
    processStatus: "first_instance",
    birthDate: null as unknown as undefined,
    ...over,
  };
}

/** Base falsa: un puñado de filas en memoria. Devuelve COPIAS —como Prisma— así
 *  que el módulo no puede pasar un test mutando el objeto que le prestamos. */
function fakeDb(rows: Row[], docs: Array<{ ownerId: number; type: DocumentType }> = []) {
  function shape(r: Row) {
    const { processStatus, ...rest } = r;
    return { ...rest, process: { id: 3, status: processStatus } };
  }
  return {
    rows,
    presentation: {
      findUnique: vi.fn(async ({ where }: { where: { resumeTokenHash?: string; id?: number } }) => {
        const found = rows.find((r) =>
          where.resumeTokenHash !== undefined
            ? r.resumeTokenHash === where.resumeTokenHash
            : r.id === where.id,
        );
        return found ? shape(found) : null;
      }),
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
    },
    document: {
      findMany: vi.fn(async ({ where }: { where: { ownerId: number } }) =>
        docs.filter((d) => d.ownerId === where.ownerId).map((d) => ({ type: d.type })),
      ),
    },
  };
}

function presentations(db: ReturnType<typeof fakeDb>) {
  return makePresentations(db as never);
}

describe("presentationDocsComplete", () => {
  it("exige el frente y el dorso del DNI, y nada más", () => {
    expect(presentationDocsComplete([]).ok).toBe(false);
    expect(presentationDocsComplete([{ type: "dni_front" }]).ok).toBe(false);
    expect(presentationDocsComplete([{ type: "dni_back" }]).ok).toBe(false);
    // El anexo del domicilio es OPCIONAL: el estatuto lo pide para acreditar,
    // pero el DNI ya trae domicilio y la Comisión decide al validar.
    expect(presentationDocsComplete([{ type: "dni_front" }, { type: "dni_back" }]).ok).toBe(true);
  });

  it("nombra UN faltante por vez, en el orden en que la pantalla los pide", () => {
    const only = presentationDocsComplete([{ type: "annex" }]);
    expect(only.ok).toBe(false);
    if (!only.ok) expect(only.error).toMatch(/frente/i);
  });

  it("el tope de anexos es 2", () => {
    expect(PRESENTATION_MAX_ANNEXES).toBe(2);
  });
});

// La distinción que el wizard público tenía bien y el formulario del mostrador
// no: "esta ranura YA TIENE archivo" (que permite REEMPLAZARLO) no es lo mismo
// que "no entran más archivos" (que sí bloquea). El mostrador las confundía y
// apagaba el campo apenas subía el frente, así que el operador que escaneaba el
// dorso movido no tenía forma de rehacerlo desde ninguna pantalla del panel.
describe("documentSlotFill", () => {
  it("el frente y el dorso NUNCA se llenan: volver a subirlos REEMPLAZA", () => {
    // Y es literal: `saveOwned` busca el documento anterior del mismo tipo y lo
    // borra, salvo para `annex`. El server siempre soportó el reemplazo.
    for (const type of ["dni_front", "dni_back"] as const) {
      expect(documentSlotFill({ type, uploaded: 0 }).full).toBe(false);
      expect(documentSlotFill({ type, uploaded: 1 }).full).toBe(false);
      expect(documentSlotFill({ type, uploaded: 1 }).replaces).toBe(true);
    }
  });

  it("el anexo ACUMULA, y sólo él se llena al llegar al tope", () => {
    expect(documentSlotFill({ type: "annex", uploaded: 0 }).replaces).toBe(false);
    expect(documentSlotFill({ type: "annex", uploaded: 1 }).full).toBe(false);
    expect(documentSlotFill({ type: "annex", uploaded: PRESENTATION_MAX_ANNEXES }).full).toBe(true);
    // Defensivo: si la base trajera más de los que entran, sigue lleno.
    expect(documentSlotFill({ type: "annex", uploaded: 99 }).full).toBe(true);
  });
});

describe("presentationDataComplete", () => {
  it("acepta la ficha completa", () => {
    expect(presentationDataComplete(DATA).ok).toBe(true);
  });

  it("rechaza sin email: es el domicilio electrónico del Art. 5° ter", () => {
    const r = presentationDataComplete({ ...DATA, email: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/email/i);
  });

  it("rechaza sin domicilio", () => {
    expect(presentationDataComplete({ ...DATA, streetId: null, streetText: null }).ok).toBe(false);
    expect(presentationDataComplete({ ...DATA, streetNumber: null }).ok).toBe(false);
  });

  it("rechaza sin fecha de nacimiento", () => {
    expect(presentationDataComplete({ ...DATA, birthDate: null }).ok).toBe(false);
  });

  // El barrio es obligatorio en el formulario del paso 2 (`dataSchema` lo pide
  // con `min(1)`) y tiene su propia columna. Que la regla COMPARTIDA no lo
  // mirara era inofensivo mientras el único camino de escritura fuera el
  // wizard —zod lo rechazaba antes—, pero esta función está vendida como LA
  // regla de completitud y la carga presencial del operador la va a reusar sin
  // pasar por ese schema: ahí sí entraría una presentación sin barrio.
  it("rechaza sin barrio", () => {
    const r = presentationDataComplete({ ...DATA, neighborhood: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/barrio/i);
  });

  // La red que impide que se vuelva a olvidar un campo: TODO campo declarado
  // que el trámite exige tiene que hacer fallar a la función si falta. Se
  // enumeran los opcionales en vez de los obligatorios para que un campo NUEVO
  // en `PresentationData` nazca exigido y haya que decidir a mano que no lo es.
  //
  //   - `streetText` es la calle LIBRE: sólo se usa cuando no hay `streetId`,
  //     y la pareja ya está cubierta por el caso de "sin domicilio";
  //   - `streetId` idem, por el otro lado de la misma pareja.
  it("exige todos los campos del trámite, no sólo algunos", () => {
    const optional = new Set<keyof PresentationData>(["streetId", "streetText"]);
    for (const field of Object.keys(DATA) as Array<keyof PresentationData>) {
      if (optional.has(field)) continue;
      const r = presentationDataComplete({ ...DATA, [field]: null });
      expect(r.ok, `falta el chequeo de "${field}"`).toBe(false);
    }
  });
});

describe("claim", () => {
  it("rota la llave: dos claims dan tokens distintos y el viejo deja de abrir", async () => {
    const db = fakeDb([row()]);
    const p = presentations(db);

    const first = await p.claim({ presentationId: 1 });
    const second = await p.claim({ presentationId: 1 });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.raw).not.toEqual(second?.raw);

    // Sólo la última vive: el enlace anterior —y la pestaña que lo tenía— muere.
    expect(await p.findByToken(second!.raw)).not.toBeNull();
    expect(await p.findByToken(first!.raw)).toBeNull();
  });

  it("persiste el HASH, nunca el crudo", async () => {
    const db = fakeDb([row()]);
    const claimed = await presentations(db).claim({ presentationId: 1 });
    expect(db.rows[0].resumeTokenHash).toBe(hashToken(claimed!.raw));
    expect(db.rows[0].resumeTokenHash).not.toBe(claimed!.raw);
  });

  it("no entrega llave de una presentación que ya no se puede editar", async () => {
    const db = fakeDb([row({ status: "validated" })]);
    expect(await presentations(db).claim({ presentationId: 1 })).toBeNull();
    expect(db.rows[0].resumeTokenHash).toBeNull();
  });
});

describe("saveData", () => {
  it("guarda los datos declarados sobre una presentación pendiente", async () => {
    const db = fakeDb([row()]);
    const p = presentations(db);
    const { raw } = (await p.claim({ presentationId: 1 }))!;

    const saved = await p.saveData({ token: raw, data: DATA });
    expect(saved.ok).toBe(true);
    expect(db.rows[0].email).toBe("vecina@ejemplo.com");
    expect(db.rows[0].occupation).toBe("Docente");
    // La presentación NO toca la ficha del socio: acá sólo hay columnas de
    // `presentations` (decisión 10). El volcado a `Member` es del operador.
    expect(db.rows[0].status).toBe("pending");
  });

  it("una presentación ya VALIDADA no se edita desde la web", async () => {
    const db = fakeDb([row()]);
    const p = presentations(db);
    const { raw } = (await p.claim({ presentationId: 1 }))!;
    db.rows[0].status = "validated";

    const saved = await p.saveData({ token: raw, data: DATA });
    expect(saved.ok).toBe(false);
    expect(db.rows[0].occupation).toBeUndefined();
  });

  it("con el proceso fuera de las dos instancias no se guarda nada", async () => {
    const db = fakeDb([row({ processStatus: "closing" })]);
    const p = presentations(db);
    // La llave se acuñó mientras el proceso estaba abierto; el plazo venció
    // después. Lo que decide es el estado del proceso AL GUARDAR.
    const { raw } = (await p.claim({ presentationId: 1 }))!;

    const saved = await p.saveData({ token: raw, data: DATA });
    expect(saved.ok).toBe(false);
    expect(db.rows[0].occupation).toBeUndefined();
  });

  it("un token que no abre nada no dice qué falló de la presentación de otro", async () => {
    const db = fakeDb([row()]);
    const saved = await presentations(db).saveData({ token: "no-existe", data: DATA });
    expect(saved.ok).toBe(false);
  });
});

describe("submit", () => {
  const READY_DOCS: Array<{ ownerId: number; type: DocumentType }> = [
    { ownerId: 1, type: "dni_front" },
    { ownerId: 1, type: "dni_back" },
  ];

  async function ready(over: Partial<Row> = {}) {
    const db = fakeDb([row({ ...DATA, ...over })], READY_DOCS);
    const p = presentations(db);
    const { raw } = (await p.claim({ presentationId: 1 }))!;
    return { db, p, raw };
  }

  it("envía: status submitted, submittedAt y canal web", async () => {
    const { db, p, raw } = await ready();
    const sent = await p.submit({ token: raw, now: NOW });
    expect(sent).toEqual({
      ok: true,
      presentationId: 1,
      memberId: 42,
      email: "vecina@ejemplo.com",
      submittedAt: NOW,
      firstSubmission: true,
    });
    expect(db.rows[0].status).toBe("submitted");
    expect(db.rows[0].submittedAt).toEqual(NOW);
    expect(db.rows[0].channel).toBe("web");
  });

  it("sin los documentos obligatorios NO envía", async () => {
    const db = fakeDb([row({ ...DATA })], [{ ownerId: 1, type: "dni_front" }]);
    const p = presentations(db);
    const { raw } = (await p.claim({ presentationId: 1 }))!;

    const sent = await p.submit({ token: raw, now: NOW });
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error).toMatch(/dorso/i);
    expect(db.rows[0].status).toBe("pending");
    expect(db.rows[0].submittedAt).toBeNull();
  });

  it("sin email NO envía: sin domicilio electrónico no hay dónde notificar", async () => {
    const { db, p, raw } = await ready({ email: null });
    const sent = await p.submit({ token: raw, now: NOW });
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error).toMatch(/email/i);
    expect(db.rows[0].submittedAt).toBeNull();
  });

  it("el segundo envío contesta ok y NO pisa submittedAt", async () => {
    const { db, p, raw } = await ready();
    const first = await p.submit({ token: raw, now: NOW });
    const later = new Date("2026-09-21T12:00:00Z");
    const second = await p.submit({ token: raw, now: later });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.firstSubmission).toBe(false);
      // La prueba del plazo del Art. 9° bis es el PRIMER envío.
      expect(second.submittedAt).toEqual(NOW);
    }
    expect(db.rows[0].submittedAt).toEqual(NOW);
  });

  it("una presentación ya validada contesta ok sin reabrirse", async () => {
    // La llave se acuñó mientras se podía editar; la Comisión validó después.
    const { db, p, raw } = await ready();
    Object.assign(db.rows[0], { status: "validated", submittedAt: NOW });
    const sent = await p.submit({ token: raw, now: new Date() });
    expect(sent.ok).toBe(true);
    if (sent.ok) expect(sent.firstSubmission).toBe(false);
    expect(db.rows[0].status).toBe("validated");
  });

  // La constancia es un papel que el socio puede llegar a esgrimir: si la fila
  // llegara SIN marca de tiempo, el envío no puede inventarle una. Antes esta
  // rama devolvía `new Date(0)` "porque el caso no puede ocurrir" y la pantalla
  // imprimía 01/01/1970 como prueba del plazo del Art. 9° bis.
  it("una fila ya presentada SIN marca de tiempo devuelve null, no el epoch", async () => {
    const { db, p, raw } = await ready();
    Object.assign(db.rows[0], { status: "submitted", submittedAt: null });
    const sent = await p.submit({ token: raw, now: NOW });
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.firstSubmission).toBe(false);
      expect(sent.submittedAt).toBeNull();
    }
  });

  it("una observada se subsana y vuelve a submitted", async () => {
    const { db, p, raw } = await ready({ status: "observed", observation: "Falta el dorso" });
    const sent = await p.submit({ token: raw, now: NOW });
    expect(sent.ok).toBe(true);
    if (sent.ok) expect(sent.firstSubmission).toBe(true);
    expect(db.rows[0].status).toBe("submitted");
  });

  // Lo que NO puede pasar en una subsanación: que se mueva la prueba del plazo.
  // Un socio que presentó el día 25, quedó observado y corrigió el día 33
  // quedaría —en el papel— fuera de los treinta días del Art. 9° bis, y de esa
  // marca cuelga su condición de socio.
  it("la subsanación conserva el submittedAt del PRIMER envío", async () => {
    const { db, p, raw } = await ready({
      status: "observed",
      observation: "Falta el dorso",
      submittedAt: NOW,
    });
    const later = new Date("2026-09-28T12:00:00Z");

    const sent = await p.submit({ token: raw, now: later });

    expect(sent.ok).toBe(true);
    if (sent.ok) expect(sent.submittedAt).toEqual(NOW);
    expect(db.rows[0].submittedAt).toEqual(NOW);
    expect(db.rows[0].status).toBe("submitted");
  });

  it("con el proceso cerrado NO se acepta un envío fuera de plazo", async () => {
    const { db, p, raw } = await ready({ processStatus: "closing" });
    const sent = await p.submit({ token: raw, now: NOW });
    expect(sent.ok).toBe(false);
    expect(db.rows[0].status).toBe("pending");
  });

  it("una rechazada no se re-envía sola desde la web", async () => {
    const { db, p, raw } = await ready();
    db.rows[0].status = "rejected";
    const sent = await p.submit({ token: raw, now: NOW });
    expect(sent.ok).toBe(false);
    expect(db.rows[0].status).toBe("rejected");
  });
});

describe("findByToken", () => {
  it("devuelve la vista de la presentación con sus documentos", async () => {
    const db = fakeDb(
      [row({ ...DATA, status: "observed", observation: "La foto del dorso salió movida" })],
      [
        { ownerId: 1, type: "dni_front" },
        { ownerId: 1, type: "dni_back" },
        { ownerId: 1, type: "annex" },
        { ownerId: 99, type: "annex" }, // de otra presentación: no cuenta
      ],
    );
    const p = presentations(db);
    const { raw } = (await p.claim({ presentationId: 1 }))!;

    const view = await p.findByToken(raw);
    expect(view).not.toBeNull();
    expect(view?.status).toBe("observed");
    expect(view?.observation).toBe("La foto del dorso salió movida");
    expect(view?.uploadedTypes).toEqual(["dni_front", "dni_back", "annex"]);
    expect(view?.data.email).toBe("vecina@ejemplo.com");
    expect(view?.processStatus).toBe("first_instance");
  });

  it("un token vacío no consulta nada", async () => {
    const db = fakeDb([row()]);
    expect(await presentations(db).findByToken("")).toBeNull();
    expect(db.presentation.findUnique).not.toHaveBeenCalled();
  });
});

describe("mintResumeToken / commitResumeToken", () => {
  it("acuñar NO toca la base; recién commit la cambia", async () => {
    const db = fakeDb([row()]);
    const p = presentations(db);
    const { raw } = (await p.claim({ presentationId: 1 }))!;
    const before = db.rows[0].resumeTokenHash;

    // Es el orden del reenvío: acuñar → mandar el correo → commitear. Si el
    // correo falla y no se commitea, la llave que el vecino YA tiene sigue viva.
    const minted = p.mintResumeToken();
    expect(db.rows[0].resumeTokenHash).toBe(before);
    expect(await p.findByToken(raw)).not.toBeNull();

    await p.commitResumeToken(1, minted.hash);
    expect(db.rows[0].resumeTokenHash).toBe(hashToken(minted.raw));
    expect(await p.findByToken(raw)).toBeNull();
    expect(await p.findByToken(minted.raw)).not.toBeNull();
  });
});
