// El ciclo de vida de UNA presentación de re-empadronamiento: la llave de
// retorno, la carga de datos, la completitud y el envío (M6 §5).
//
// Tres cosas que gobiernan todo este archivo:
//
// 1. LA PRESENTACIÓN NO TOCA LA FICHA DEL SOCIO (decisión 10). Todo lo que el
//    vecino carga queda en columnas de `presentations` y espera; el volcado a
//    `Member` lo hace el operador al VALIDAR. Si el wizard escribiera derecho
//    en la ficha, cualquiera que tipee un DNI ajeno —y el paso 1 deja entrar
//    con sólo eso— le editaría los datos a otro antes de que nadie mire nada.
//
// 2. `submittedAt` ES LA PRUEBA DEL PLAZO. Es lo único que acredita que el
//    socio cumplió dentro de los treinta días del Art. 9° bis, y de eso cuelga
//    su condición de socio. Por eso el segundo envío contesta ok pero NO la
//    pisa, y por eso no se acepta un envío con el proceso fuera de sus dos
//    instancias.
//
// 3. LA LLAVE ROTA Y VIVE UNA SOLA. `resumeTokenHash` es `@unique` y sólo se
//    guarda el sha256: el crudo existe un instante y viaja al navegador o al
//    correo. `claim` la rota al entrar por DNI; `mintResumeToken` +
//    `commitResumeToken` la rotan en el orden acuñar → ENVIAR → persistir, que
//    es el que impide que un SMTP caído deje al vecino sin ninguna llave viva
//    (la lección de `applications/service.ts`, calcada a propósito).
//
// El cliente de Prisma se INYECTA: el módulo se prueba entero sin base. El
// singleton se arma al final del archivo, como en `applications/service.ts`.
import { randomBytes } from "node:crypto";
import type { DocumentType, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";
// Las reglas puras viven aparte para que el WIZARD (cliente) pueda importarlas
// sin arrastrar el cliente de Prisma al navegador. Se re-exportan acá para que
// el server siga teniendo una sola puerta.
import {
  DATA_FIELDS,
  EDITABLE_STATUSES,
  editabilityOf,
  LINK_DEAD,
  NOT_EDITABLE,
  presentationDataComplete,
  presentationDocsComplete,
  SETTLED_STATUSES,
  type PresentationData,
  type PresentationView,
} from "./presentation-rules";

export * from "./presentation-rules";

type Err = { ok: false; error: string };

type Db = Pick<PrismaClient, "presentation" | "document">;

type SubmitResult =
  | {
      ok: true;
      presentationId: number;
      memberId: number;
      email: string;
      submittedAt: Date;
      /** `false` cuando la presentación YA estaba enviada (doble clic, reintento
       *  del navegador, o la Comisión ya la validó). El caller lo usa para no
       *  mandar una segunda constancia ni rotar la llave de nuevo. */
      firstSubmission: boolean;
    }
  | Err;

export function makePresentations(db: Db) {
  /** La fila cruda desde el token, con el estado de SU proceso al lado. El
   *  estado que decide si el wizard sigue abierto es el del proceso de la
   *  presentación, no el de la clave de configuración: una presentación
   *  pertenece a un proceso y no a "el proceso de hoy". */
  async function rowByToken(raw: string) {
    if (!raw) return null;
    return db.presentation.findUnique({
      where: { resumeTokenHash: hashToken(raw) },
      select: {
        id: true,
        memberId: true,
        status: true,
        observation: true,
        submittedAt: true,
        validatedAt: true,
        birthDate: true,
        civilStatus: true,
        nationality: true,
        occupation: true,
        streetId: true,
        streetText: true,
        streetNumber: true,
        neighborhood: true,
        phone: true,
        email: true,
        process: { select: { id: true, status: true } },
      },
    });
  }

  async function docTypesOf(presentationId: number): Promise<DocumentType[]> {
    const docs = await db.document.findMany({
      where: { ownerType: "presentation", ownerId: presentationId },
      select: { type: true },
      orderBy: { id: "asc" },
    });
    return docs.map((d) => d.type);
  }

  /** Lectura sin efectos, en una función local para que `openForEdit` la llame
   *  sin pasar por `this` (un método desestructurado perdería el receptor). */
  async function viewByToken(raw: string): Promise<PresentationView | null> {
    const row = await rowByToken(raw);
    if (!row) return null;
    return {
      id: row.id,
      memberId: row.memberId,
      status: row.status,
      observation: row.observation,
      submittedAt: row.submittedAt,
      validatedAt: row.validatedAt,
      processId: row.process.id,
      processStatus: row.process.status,
      data: pickData(row),
      uploadedTypes: await docTypesOf(row.id),
    };
  }

  return {
    /** La llave que sostiene la sesión del wizard, entregada al confirmar el
     *  nombre enmascarado del paso 1.
     *
     *  Rota en cada entrega y se persiste EN EL ACTO —al revés del reenvío por
     *  correo, que acuña, manda y recién ahí commitea—. La diferencia no es un
     *  descuido: acá el "buzón" que demuestra la tenencia es la sesión del
     *  navegador que acaba de pasar el DNI, y la llave se le entrega en esa
     *  misma respuesta. No hay un envío que pueda fallar en el medio, así que no
     *  hay nada que compensar; lo que sí hay es el riesgo ACEPTADO y documentado
     *  de la decisión 8: el DNI no es autenticación, y quien tipee uno ajeno se
     *  lleva una llave de esa presentación. Se acota con Turnstile, con el cupo
     *  del paso 1 y con que la pantalla nunca precargue datos por ese camino.
     *
     *  Devuelve `null` —y no una llave inútil— si la presentación dejó de ser
     *  editable entre el veredicto y este UPDATE (la Comisión la validó en ese
     *  instante): entregar una llave que no abre nada mandaría al vecino a un
     *  formulario que el server va a rechazar. */
    async claim(input: { presentationId: number }): Promise<{ raw: string } | null> {
      const raw = randomBytes(32).toString("base64url");
      const { count } = await db.presentation.updateMany({
        where: { id: input.presentationId, status: { in: [...EDITABLE_STATUSES] } },
        data: { resumeTokenHash: hashToken(raw) },
      });
      return count === 1 ? { raw } : null;
    },

    /** Guarda los datos declarados. La validación de FORMATO (zod) corre afuera,
     *  en la action; acá se decide QUIÉN puede escribir y CUÁNDO. */
    async saveData(input: {
      token: string;
      data: PresentationData;
    }): Promise<({ ok: true; presentationId: number }) | Err> {
      const row = await rowByToken(input.token);
      if (!row) return { ok: false, error: LINK_DEAD };
      const editable = editabilityOf({ status: row.status, processStatus: row.process.status });
      if (!editable.ok) return editable;

      // UPDATE condicional por estado (patrón `tokens.consume`): entre la
      // lectura de arriba y esta escritura el operador puede haber validado la
      // presentación, y ese caso no puede terminar en datos pisados.
      const { count } = await db.presentation.updateMany({
        where: { id: row.id, status: { in: [...EDITABLE_STATUSES] } },
        data: input.data,
      });
      if (count !== 1) return { ok: false, error: NOT_EDITABLE };
      return { ok: true, presentationId: row.id };
    },

    /** El envío. Exige la ficha completa, los documentos obligatorios y el
     *  proceso abierto; escribe `submittedAt`, que es la prueba del plazo. */
    async submit(input: { token: string; now?: Date }): Promise<SubmitResult> {
      const row = await rowByToken(input.token);
      if (!row) return { ok: false, error: LINK_DEAD };

      // Idempotencia ANTES que cualquier validación: el doble clic y el
      // reintento del navegador tienen que ver el mismo "listo" que el primero,
      // sin volver a exigir nada y sin mover `submittedAt`.
      if ((SETTLED_STATUSES as readonly string[]).includes(row.status)) {
        return {
          ok: true,
          presentationId: row.id,
          memberId: row.memberId,
          email: row.email ?? "",
          // `submittedAt` no puede ser null en estos estados: sólo lo escribe
          // este método (y la carga presencial). El fallback existe por el tipo.
          submittedAt: row.submittedAt ?? new Date(0),
          firstSubmission: false,
        };
      }
      const editable = editabilityOf({ status: row.status, processStatus: row.process.status });
      if (!editable.ok) return editable;

      const data = pickData(row);
      const complete = presentationDataComplete(data);
      if (!complete.ok) return complete;
      const docs = presentationDocsComplete((await docTypesOf(row.id)).map((type) => ({ type })));
      if (!docs.ok) return docs;

      const now = input.now ?? new Date();
      const { count } = await db.presentation.updateMany({
        where: { id: row.id, status: { in: [...EDITABLE_STATUSES] } },
        data: { status: "submitted", submittedAt: now, channel: "web" },
      });
      if (count !== 1) {
        // Perdió la carrera contra otro envío simultáneo. El que ganó ya
        // escribió su `submittedAt`: se lo relee en vez de inventar uno.
        const fresh = await rowByToken(input.token);
        return {
          ok: true,
          presentationId: row.id,
          memberId: row.memberId,
          email: row.email ?? "",
          submittedAt: fresh?.submittedAt ?? now,
          firstSubmission: false,
        };
      }
      return {
        ok: true,
        presentationId: row.id,
        memberId: row.memberId,
        // `presentationDataComplete` ya garantizó que hay email; el `??` es
        // para el compilador.
        email: row.email ?? "",
        submittedAt: now,
        firstSubmission: true,
      };
    },

    /** Lectura sin efectos para `/reempadronate/retomar/[token]`. El token NO se
     *  consume: es la llave de la presentación mientras viva, no un vale de un
     *  solo uso, así que el escáner de enlaces de un cliente de correo que abra
     *  la URL antes que la persona no rompe nada. */
    findByToken(raw: string): Promise<PresentationView | null> {
      return viewByToken(raw);
    },

    /** La presentación de un token, ya verificada como editable. Es lo que usa
     *  la subida de documentos: necesita el id para nombrar la carpeta y no
     *  puede aceptar un archivo para algo que la Comisión ya resolvió o para un
     *  proceso cuyo plazo venció. Comparte `editabilityOf` con las otras dos
     *  escrituras, así que las tres abren y cierran juntas. */
    async openForEdit(raw: string): Promise<({ ok: true; view: PresentationView }) | Err> {
      const view = await viewByToken(raw);
      if (!view) return { ok: false, error: LINK_DEAD };
      const editable = editabilityOf({
        status: view.status,
        processStatus: view.processStatus,
      });
      if (!editable.ok) return editable;
      return { ok: true, view };
    },

    /** Acuñar SIN tocar la base. Es la primera mitad del reenvío por correo: si
     *  el SMTP falla, no se commitea nada y la llave que el vecino ya tiene
     *  sigue viva. Al revés —rotar y después mandar— un rebote lo deja sin
     *  ninguna. Calcado de `applications/service.ts`, que lo pagó caro. */
    mintResumeToken(): { raw: string; hash: string } {
      const raw = randomBytes(32).toString("base64url");
      return { raw, hash: hashToken(raw) };
    },

    /** La segunda mitad: se llama SÓLO cuando el correo salió. */
    async commitResumeToken(presentationId: number, hash: string): Promise<void> {
      await db.presentation.updateMany({
        where: { id: presentationId },
        data: { resumeTokenHash: hash },
      });
    },
  };
}

/** Las diez columnas declaradas de una fila, sin arrastrar el resto. */
function pickData(row: Record<string, unknown>): PresentationData {
  const data = {} as Record<string, unknown>;
  for (const field of DATA_FIELDS) data[field] = row[field] ?? null;
  return data as PresentationData;
}

export const presentations = makePresentations(prisma);
