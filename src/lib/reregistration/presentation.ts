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
import type {
  DocumentType,
  PresentationStatus,
  PrismaClient,
  ReregistrationStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";
import { wizardOpen } from "./rules";

/** Tope de anexos por presentación (mismo número que el alta web). Lo APLICA la
 *  action contando las filas ya guardadas; acá vive el número para que la
 *  pantalla y el server citen el mismo. */
export const PRESENTATION_MAX_ANNEXES = 2;

/** Los estados desde los que el VECINO todavía puede tocar su presentación.
 *
 *  Se enumeran en vez de escribir `!== "validated"`: un estado nuevo en el enum
 *  queda afuera hasta que alguien decida a mano que entra, y fallar hacia
 *  "no se puede editar" es un cartel, mientras que fallar al revés sería dejar
 *  reabrir por la web algo que la Comisión ya resolvió. */
export const EDITABLE_STATUSES = [
  "pending",
  "observed",
] as const satisfies readonly PresentationStatus[];

/** Los estados en los que la presentación YA está presentada y no hay nada que
 *  volver a enviar. Un segundo `submit` sobre uno de éstos contesta ok
 *  idempotente en vez de un error que asustaría al vecino que hizo doble clic. */
const SETTLED_STATUSES = ["submitted", "validated"] as const satisfies readonly PresentationStatus[];

const LINK_DEAD =
  "No encontramos tu re-empadronamiento: el enlace puede estar incompleto o haber sido reemplazado por uno más nuevo. Revisá el último correo que te mandamos.";
const NOT_EDITABLE =
  "Tu re-empadronamiento ya fue resuelto por la Comisión, así que no se puede modificar desde acá. Si necesitás corregir algo, acercate a la sede vecinal.";
const PROCESS_CLOSED =
  "El plazo del re-empadronamiento venció y ya no se pueden recibir presentaciones por la web. Acercate a la sede vecinal.";

/** Los datos declarados de la ficha, sin el nombre.
 *
 *  El nombre NO está y no es un olvido: es el ancla de identidad de la ficha, y
 *  con una identificación tan liviana como un DNI dejarlo editar permitiría
 *  apropiarse de la ficha de otro. Las correcciones de nombre se hacen en la
 *  sede (decisión 9). */
export type PresentationData = {
  birthDate: Date | null;
  civilStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  streetId: number | null;
  streetText: string | null;
  streetNumber: string | null;
  neighborhood: string | null;
  phone: string | null;
  email: string | null;
};

const DATA_FIELDS = [
  "birthDate",
  "civilStatus",
  "nationality",
  "occupation",
  "streetId",
  "streetText",
  "streetNumber",
  "neighborhood",
  "phone",
  "email",
] as const satisfies readonly (keyof PresentationData)[];

export type PresentationView = {
  id: number;
  memberId: number;
  status: PresentationStatus;
  observation: string | null;
  submittedAt: Date | null;
  validatedAt: Date | null;
  processId: number;
  processStatus: ReregistrationStatus;
  data: PresentationData;
  /** Con repetidos: `annex` puede aparecer hasta PRESENTATION_MAX_ANNEXES veces. */
  uploadedTypes: DocumentType[];
};

type Ok = { ok: true };
type Err = { ok: false; error: string };

/** Completitud documental del re-empadronamiento. PURA a propósito: la
 *  consumen la pantalla (para habilitar "Continuar" y decir qué falta) y el
 *  envío (que no puede confiar en el cliente). Que sea la misma función en las
 *  dos puntas es lo que garantiza que el botón no habilite algo que el server
 *  va a rechazar.
 *
 *  NO se reusa `requiredDocsComplete` de las solicitudes de alta: aquella pide
 *  el anexo cuando la CATEGORÍA pedida es colaborador, y acá no se pide ninguna
 *  categoría — la cohorte es toda adherente y el anexo del domicilio es el
 *  respaldo del Art. 5.3, siempre opcional. Compartir la función obligaría a
 *  inventarle una categoría a la presentación.
 *
 *  Devuelve UN pendiente por vez, en el orden en que la pantalla los pide: el
 *  mensaje va debajo del botón y dos reclamos juntos se leen como un muro. */
export function presentationDocsComplete(docs: Array<{ type: DocumentType }>): Ok | Err {
  const types = new Set(docs.map((d) => d.type));
  if (!types.has("dni_front")) return { ok: false, error: "Falta la foto del frente del DNI." };
  if (!types.has("dni_back")) return { ok: false, error: "Falta la foto del dorso del DNI." };
  return { ok: true };
}

/** Completitud de la ficha declarada. Misma lógica de una-por-vez que la de
 *  documentos, y misma razón de ser: la usa el paso 4 para habilitar el envío y
 *  el server para aceptarlo.
 *
 *  El email es OBLIGATORIO por decisión del operador (decisión 4): el
 *  re-empadronamiento constituye el domicilio electrónico del Art. 5° ter, que
 *  es la vía por la que la asociación notifica. Sin él, la observación y la
 *  baja no tendrían dónde llegar. */
export function presentationDataComplete(data: PresentationData): Ok | Err {
  if (!data.birthDate) return { ok: false, error: "Falta tu fecha de nacimiento." };
  if (!data.civilStatus) return { ok: false, error: "Falta tu estado civil." };
  if (!data.nationality) return { ok: false, error: "Falta tu nacionalidad." };
  if (!data.occupation) return { ok: false, error: "Falta tu ocupación." };
  if (!data.streetId && !data.streetText) return { ok: false, error: "Falta tu calle." };
  if (!data.streetNumber) return { ok: false, error: "Falta la altura de tu domicilio." };
  if (!data.phone) return { ok: false, error: "Falta tu teléfono." };
  if (!data.email) return { ok: false, error: "Falta tu email." };
  return { ok: true };
}

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
      if (!(EDITABLE_STATUSES as readonly string[]).includes(row.status)) {
        return { ok: false, error: NOT_EDITABLE };
      }
      if (!wizardOpen(row.process)) return { ok: false, error: PROCESS_CLOSED };

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
      if (!(EDITABLE_STATUSES as readonly string[]).includes(row.status)) {
        return { ok: false, error: NOT_EDITABLE };
      }
      if (!wizardOpen(row.process)) return { ok: false, error: PROCESS_CLOSED };

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
    async findByToken(raw: string): Promise<PresentationView | null> {
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
