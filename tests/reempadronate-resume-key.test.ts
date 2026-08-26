// La invariante más cara del wizard de re-empadronamiento, y la única que no
// tenía red automática: **acuñar → ENVIAR → persistir**.
//
// La llave de retorno (`resume_token_hash`) vive de a una y es lo ÚNICO que le
// deja al vecino volver a su propio trámite. Rotarla ANTES de mandar el correo
// —el orden que sale solo— convierte cualquier rebote de Brevo en un socio
// encerrado afuera de su presentación mientras le corre el plazo del Art. 9°
// bis. La primitiva ya estaba testeada (`mintResumeToken` no toca la base,
// `commitResumeToken` rota), pero NINGÚN test cubría a los dos que la usan, que
// es donde el orden se puede invertir con un copy-paste. Hasta hoy eso estaba
// verificado sólo a mano en el navegador.
//
// Los dos caminos que mandan el enlace:
//
//   1. `submitPresentationAction` — el envío inicial, con su constancia;
//   2. `resendPresentationLinkAction` → `deliverPresentationLink` — el reenvío.
//
// Y tres desenlaces por camino: el feliz, un SMTP caído y un bloqueo por
// `EMAIL_ALLOWLIST` (que en este proyecto llega como un error con `code`
// propio, no como un envío exitoso: si se lo tratara como éxito, el entorno de
// prueba rotaría llaves por correos que nunca salieron).
//
// El archivo fija además dos cosas más:
//
//   - QUÉ TEXTO se manda en cada estado. El reenvío de un OBSERVADO no puede
//     mandar la constancia ("la Comisión va a revisar lo que cargaste"): a él
//     ya se lo revisaron y ya se le pidió corregir, y ese texto lo manda a
//     esperar cuando tiene que actuar antes de una fecha. Las plantillas quedan
//     REALES a propósito — lo que se afirma es el texto que sale, no que se
//     haya llamado a una función;
//   - que la subida de archivos está ATADA A LA LLAVE: el id de la presentación
//     sale del token y de ningún campo del formulario, así que un POST armado a
//     mano no puede depositar un archivo en la presentación de otro.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationStatus } from "@/generated/prisma/client";

// El proceso vivo: 1ª instancia, con su plazo. La fecha es un mediodía UTC,
// que es como el proyecto guarda toda fecha civil argentina.
const PROCESS_ID = 7;
const FIRST_ENDS_AT = new Date("2026-09-30T12:00:00Z"); // → "30/09/2026"
const SUBMITTED_AT = new Date("2026-08-26T18:40:00Z"); // → "26/08/2026 a las 15:40"
const DNI = "20111222";

/** Lo que un caso necesita poder pisar de la fila sembrada. No es el modelo
 *  completo de Prisma: sólo las columnas de las que depende algún test. */
type Row = {
  id: number;
  memberId: number;
  dni: string;
  status: PresentationStatus;
  resumeTokenHash: string | null;
  submittedAt: Date | null;
  observation: string | null;
  email: string | null;
};

/** Prisma FALSO con filas en memoria. No se mockea `@/lib/reregistration/
 *  presentation`: se le da una base de mentira al singleton REAL, así que lo
 *  que se ejercita es el `mintResumeToken` / `commitResumeToken` de verdad —que
 *  es justo la pieza cuyo orden se quiere fijar—. Devuelve COPIAS, como Prisma:
 *  el módulo no puede pasar un test mutando el objeto que le prestamos. */
const db = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = [];
  const docs: Array<{ ownerType: string; ownerId: number; type: string }> = [];
  return {
    rows,
    docs,
    reset(seed: Array<Record<string, unknown>>) {
      rows.length = 0;
      rows.push(...seed);
      docs.length = 0;
    },
    client: {
      configuration: {
        findUnique: vi.fn(async () => ({
          key: "reempadronamiento_proceso_id",
          value: String(PROCESS_ID),
        })),
      },
      reregistrationProcess: {
        findUnique: vi.fn(async () => ({
          id: PROCESS_ID,
          status: "first_instance",
          firstEndsAt: FIRST_ENDS_AT,
          secondEndsAt: null,
        })),
      },
      presentation: {
        findUnique: vi.fn(async ({ where }: { where: { resumeTokenHash?: string } }) => {
          const found = rows.find((r) => r.resumeTokenHash === where.resumeTokenHash);
          return found ? { ...found, process: { id: PROCESS_ID, status: "first_instance" } } : null;
        }),
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: { member?: { dni?: string }; status?: { in: string[] } };
          }) => {
            const found = rows.find(
              (r) =>
                r.dni === where.member?.dni &&
                (!where.status || where.status.in.includes(r.status as string)) &&
                r.email !== null &&
                r.submittedAt !== null,
            );
            return found ? { ...found } : null;
          },
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: number; status?: { in: string[] } };
            data: Record<string, unknown>;
          }) => {
            const target = rows.find(
              (r) =>
                r.id === where.id && (!where.status || where.status.in.includes(r.status as string)),
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
        count: vi.fn(async ({ where }: { where: { ownerId: number; type?: string } }) =>
          docs.filter((d) => d.ownerId === where.ownerId && (!where.type || d.type === where.type))
            .length,
        ),
      },
    },
  };
});

const mocks = vi.hoisted(() => ({
  sendToMember: vi.fn(),
  verifyTurnstile: vi.fn(),
  savePresentationDocument: vi.fn(),
  audit: vi.fn(),
  /** `after()` no corre solo en un test: se guarda el callback y el test lo
   *  dispara cuando quiere, que además es lo que deja AFIRMAR que el trabajo
   *  quedó fuera de la respuesta (la garantía de tiempo de la anti-enumeración). */
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock("@/lib/prisma", () => ({ prisma: db.client }));
vi.mock("@/lib/email", () => ({ mailer: { sendToMember: mocks.sendToMember } }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verifyTurnstile }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/documents/storage", () => ({
  MAX_DOCUMENT_BYTES: 10 * 1024 * 1024,
  documentStore: { savePresentationDocument: mocks.savePresentationDocument },
}));
// Los limitadores quedan abiertos: lo que este archivo mide es la rotación de
// la llave, no el cupo (que tiene sus propios tests). El objeto se arma DENTRO
// de la factory: `vi.mock` se iza al tope del archivo y un `const` de módulo
// todavía no existe cuando esa factory corre.
vi.mock("@/lib/auth/rate-limiter", () => {
  const openLimiter = { allows: () => true, record: () => {}, check: () => true, refund: () => {} };
  return {
    publicTokenLimiter: openLimiter,
    reregistrationLookupLimiter: openLimiter,
    reregistrationResendLimiter: openLimiter,
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "1.2.3.4" }),
}));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    mocks.afterCallbacks.push(fn);
  },
}));

import {
  resendPresentationLinkAction,
  submitPresentationAction,
  uploadPresentationDocumentAction,
} from "@/app/(public)/reempadronate/actions";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { presentations } from "@/lib/reregistration/presentation";
import { hashToken } from "@/lib/tokens";

function form(entries: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

/** La llave que el vecino YA tiene en la mano: la de la sesión del wizard si
 *  viene del paso 1, o la del último correo si vuelve por el enlace. Es la que
 *  no puede morir sin que salga una nueva. */
const OLD_RAW = "llave-que-el-vecino-ya-tiene";

/** Siembra UNA presentación con su llave viva. Se escribe el hash directo en la
 *  fila en vez de llamar a `claim`: `claim` sólo entrega llave sobre una
 *  presentación EDITABLE, y varios de estos casos parten de una ya enviada —que
 *  es justamente la que tiene una llave viva, la del correo de la constancia—. */
async function seed(over: Partial<Row> = {}): Promise<string> {
  db.reset([
    {
      id: 1,
      memberId: 42,
      dni: DNI,
      status: "pending",
      resumeTokenHash: null,
      submittedAt: null,
      observation: null,
      validatedAt: null,
      channel: null,
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
      ...over,
    },
  ]);
  db.docs.push(
    { ownerType: "presentation", ownerId: 1, type: "dni_front" },
    { ownerType: "presentation", ownerId: 1, type: "dni_back" },
  );
  db.rows[0].resumeTokenHash = hashToken(OLD_RAW);
  return OLD_RAW;
}

/** El token crudo que viajó dentro del enlace del último correo mandado. Es la
 *  única forma honesta de preguntar "¿la llave que le mandamos abre?": se saca
 *  del correo, no del módulo. */
function tokenFromLastMail(): string {
  const [call] = mocks.sendToMember.mock.calls.at(-1) as [{ message: { text: string } }];
  const match = call.message.text.match(/\/reempadronate\/retomar\/([A-Za-z0-9_-]+)/);
  expect(match, "el correo tiene que llevar el enlace de retorno").not.toBeNull();
  return match![1];
}

function lastMail(): { type: string; to: string; message: { subject: string; text: string; html: string } } {
  return (mocks.sendToMember.mock.calls.at(-1) as [never])[0];
}

/** Un fallo de SMTP tal como llega desde nodemailer: un Error con `code`. */
function smtpDown(): Error {
  return Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
}

/** El bloqueo del entorno de prueba. NO es un envío exitoso: llega como error
 *  con su propio `code`, y el orden acuñar → enviar → persistir tiene que
 *  tratarlo igual que a un SMTP caído. */
function allowlistBlocked(): Error {
  return Object.assign(new Error("Envíos restringidos"), { code: ALLOWLIST_BLOCK_CODE });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.verifyTurnstile.mockResolvedValue(true);
  mocks.sendToMember.mockResolvedValue({ messageId: "mid-1" });
  mocks.savePresentationDocument.mockResolvedValue(undefined);
});

describe("submitPresentationAction: la llave se persiste SÓLO si el correo salió", () => {
  it("camino feliz: manda la constancia y la llave nueva es la del correo", async () => {
    const oldRaw = await seed();

    const state = await submitPresentationAction({}, form({ token: oldRaw, oath: "on" }));

    expect(state.error).toBeUndefined();
    expect(state.done?.mailed).toBe(true);
    expect(mocks.sendToMember).toHaveBeenCalledTimes(1);
    // La llave rotó: la que viajó por la URL durante la sesión muere y la del
    // correo pasa a ser la única viva.
    const mailed = tokenFromLastMail();
    expect(mailed).not.toBe(oldRaw);
    expect(db.rows[0].resumeTokenHash).toBe(hashToken(mailed));
    expect(await presentations.findByToken(mailed)).not.toBeNull();
    expect(await presentations.findByToken(oldRaw)).toBeNull();
  });

  for (const [label, failure] of [
    ["un SMTP caído", smtpDown],
    ["un bloqueo por EMAIL_ALLOWLIST", allowlistBlocked],
  ] as const) {
    it(`con ${label} NO se persiste la llave nueva y la vieja sigue viva`, async () => {
      const oldRaw = await seed();
      const hashBefore = db.rows[0].resumeTokenHash;
      mocks.sendToMember.mockRejectedValueOnce(failure());

      const state = await submitPresentationAction({}, form({ token: oldRaw, oath: "on" }));

      // La presentación SÍ quedó enviada: `submittedAt` es la prueba del plazo
      // y un correo caído no puede convertirse en "no pudimos recibirla".
      expect(state.error).toBeUndefined();
      expect(state.done?.mailed).toBe(false);
      expect(db.rows[0].status).toBe("submitted");
      // Y lo que este archivo existe para fijar: la llave NO rotó.
      expect(db.rows[0].resumeTokenHash).toBe(hashBefore);
      expect(await presentations.findByToken(oldRaw)).not.toBeNull();
    });
  }
});

describe("resendPresentationLinkAction: mismo orden, y el texto según el estado", () => {
  /** Corre el trabajo diferido de `after()`. La action contesta ANTES: que el
   *  correo salga acá adentro es lo que impide medir por tiempo si ese DNI
   *  tiene presentación. */
  async function runAfter() {
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]();
  }

  it("camino feliz sobre una presentación enviada: manda la CONSTANCIA y rota", async () => {
    const oldRaw = await seed({ status: "submitted", submittedAt: SUBMITTED_AT });

    const state = await resendPresentationLinkAction({}, form({ dni: DNI, "cf-turnstile-response": "ok" }));
    expect(state).toEqual({ done: true });
    // Nada tocó el correo todavía: el envío vive DESPUÉS de la respuesta.
    expect(mocks.sendToMember).not.toHaveBeenCalled();
    await runAfter();

    const mail = lastMail();
    expect(mail.type).toBe("presentation_received");
    expect(mail.message.subject).toContain("Recibimos tu re-empadronamiento");
    expect(mail.message.text).toContain("es la constancia de que te presentaste");
    // Con fecha Y hora: es la prueba del plazo del Art. 9° bis.
    expect(mail.message.text).toContain("26/08/2026 a las 15:40");

    const mailed = tokenFromLastMail();
    expect(db.rows[0].resumeTokenHash).toBe(hashToken(mailed));
    expect(await presentations.findByToken(oldRaw)).toBeNull();
  });

  // El bug que este cambio arregla: al OBSERVADO se le mandaba la constancia,
  // que le dice que la Comisión "va a revisar" y que "si hay que corregir algo
  // te vamos a escribir". Las dos frases son falsas para él, y las dos lo
  // mandan a esperar cuando lo que tiene que hacer es actuar antes de una fecha
  // de la que cuelga su condición de socio.
  it("sobre una OBSERVADA manda el correo de corrección, con la fecha límite", async () => {
    await seed({
      status: "observed",
      submittedAt: SUBMITTED_AT,
      observation: "La foto del dorso salió movida",
    });

    await resendPresentationLinkAction({}, form({ dni: DNI, "cf-turnstile-response": "ok" }));
    await runAfter();

    const mail = lastMail();
    expect(mail.type).toBe("presentation_observed");
    for (const body of [mail.message.text, mail.message.html]) {
      // Qué pasó y qué hacer.
      expect(body).toContain("corrijas");
      expect(body).toContain("/reempadronate/retomar/");
      // Hasta cuándo: el último día de la instancia que corre.
      expect(body).toContain("30/09/2026");
      expect(body).toContain("Art. 9° bis");
      // Y NADA de lo que decía la constancia.
      expect(body).not.toContain("va a revisar lo que cargaste");
      expect(body).not.toContain("es la constancia de que te presentaste");
    }
    // La nota del operador NO se duplica: ya viajó en el correo original de la
    // observación, y repetirla en dos correos que pueden divergir deja al
    // vecino sin saber cuál manda.
    expect(mail.message.text).not.toContain("La foto del dorso salió movida");
    expect(mail.message.html).not.toContain("La foto del dorso salió movida");
  });

  for (const [label, failure] of [
    ["un SMTP caído", smtpDown],
    ["un bloqueo por EMAIL_ALLOWLIST", allowlistBlocked],
  ] as const) {
    it(`con ${label} el reenvío NO rota la llave: el vecino conserva la que tiene`, async () => {
      const oldRaw = await seed({ status: "observed", submittedAt: SUBMITTED_AT });
      const hashBefore = db.rows[0].resumeTokenHash;
      mocks.sendToMember.mockRejectedValueOnce(failure());

      const state = await resendPresentationLinkAction({}, form({ dni: DNI, "cf-turnstile-response": "ok" }));
      // La respuesta es la MISMA de siempre: el visitante no puede enterarse de
      // nada de lo que pasó adentro (anti-enumeración).
      expect(state).toEqual({ done: true });
      await runAfter();

      expect(db.rows[0].resumeTokenHash).toBe(hashBefore);
      expect(await presentations.findByToken(oldRaw)).not.toBeNull();
    });
  }
});

describe("la subida de documentos está atada a la LLAVE", () => {
  const file = () => new File([Buffer.from("x".repeat(64))], "dni.jpg", { type: "image/jpeg" });

  it("guarda contra la presentación DEL TOKEN, aunque el POST traiga otro id", async () => {
    const raw = await seed();
    // Una segunda presentación, de otro socio, con su propia llave viva.
    db.rows.push({
      id: 2,
      memberId: 99,
      dni: "30999888",
      status: "pending",
      resumeTokenHash: hashToken("llave-ajena"),
      submittedAt: null,
      observation: null,
      validatedAt: null,
      channel: null,
      email: "otro@ejemplo.com",
    });

    // El formulario del wizard NO manda ids; éstos son los que agregaría un POST
    // armado a mano para apuntar a la presentación de otro.
    const state = await uploadPresentationDocumentAction(
      {},
      form({
        token: raw,
        docType: "dni_front",
        file: file(),
        presentationId: "2",
        ownerId: "2",
        memberId: "99",
      }),
    );

    expect(state.error).toBeUndefined();
    expect(mocks.savePresentationDocument).toHaveBeenCalledTimes(1);
    expect(mocks.savePresentationDocument.mock.calls[0][0]).toMatchObject({ presentationId: 1 });
  });

  it("con la llave de otro escribe en la de otro, y nunca en la nuestra", async () => {
    const raw = await seed();
    db.rows.push({
      id: 2,
      memberId: 99,
      dni: "30999888",
      status: "pending",
      resumeTokenHash: hashToken("llave-ajena"),
      submittedAt: null,
      observation: null,
      validatedAt: null,
      channel: null,
      email: "otro@ejemplo.com",
    });

    await uploadPresentationDocumentAction(
      {},
      form({ token: "llave-ajena", docType: "dni_front", file: file(), presentationId: "1" }),
    );

    // El id sale del token y de ningún campo del formulario: quien tiene la
    // llave de la 2 no puede depositar nada en la 1.
    expect(mocks.savePresentationDocument.mock.calls[0][0]).toMatchObject({ presentationId: 2 });
    expect(raw).not.toBe("llave-ajena");
  });

  it("sin llave válida no se toca el disco", async () => {
    await seed();
    const state = await uploadPresentationDocumentAction(
      {},
      form({ token: "no-existe", docType: "dni_front", file: file(), presentationId: "1" }),
    );
    expect(state.error).toBeTruthy();
    expect(mocks.savePresentationDocument).not.toHaveBeenCalled();
  });
});
