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
  DocumentType, EmailStatus, Member, PresentationStatus, Prisma, PrismaClient, ReregistrationStatus,
} from "@/generated/prisma/client";
import { makeMemberWriter, MemberWriteError, sameAddress } from "@/lib/members/write";
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
  PROCESS_CLOSED,
  SETTLED_STATUSES,
  type PresentationData,
  type PresentationView,
} from "./presentation-rules";

export * from "./presentation-rules";

type Ok = { ok: true };
type Err = { ok: false; error: string };

type Db = Pick<PrismaClient, "presentation" | "document" | "member" | "$transaction">;

/** El cliente de la transacción en curso, con lo que el escritor de fichas
 *  necesita. Prisma no expone `$transaction` sobre él (está en su `DenyList`),
 *  así que el tipo se arma a mano y no con un `Pick<PrismaClient, …>`. */
type Tx = Omit<PrismaClient, "$transaction" | "$connect" | "$disconnect" | "$on" | "$use" | "$extends">;

/** Lo único que este módulo usa del escritor de fichas. Se inyecta —y se pide
 *  como una FÁBRICA sobre el cliente de la transacción— por dos motivos que van
 *  juntos:
 *
 *   1. `memberWriter.updateMember` abre SU PROPIA transacción sobre el
 *      singleton. Llamarlo desde adentro de la nuestra abriría una segunda
 *      transacción independiente: el cerrojo de la presentación y la escritura
 *      de la ficha dejarían de ser atómicos, que es justo lo que no puede pasar
 *      —un email en conflicto tiene que dejar la presentación SIN validar—.
 *      Fabricándolo sobre `tx` (ver `writerOn`), las tres escrituras del
 *      escritor —ficha, revocación de tokens, cuenta de acceso— caen adentro de
 *      la nuestra y un rechazo vuelve todo atrás.
 *   2. El test puede afirmar QUÉ patch se le entregó a la ficha sin base. */
export type MemberWriterLike = {
  updateMember(
    memberId: number,
    data: Prisma.MemberUncheckedUpdateInput,
  ): Promise<{
    member: Member;
    revokedTokens: number;
    accountEmailMove: { from: string; to: string } | null;
    accountEmailUpdated: boolean;
  }>;
};

export type PresentationDeps = {
  writerFor?: (tx: Tx) => MemberWriterLike;
  now?: () => Date;
};

/** El escritor de fichas real, atado al cliente de la TRANSACCIÓN en curso.
 *
 *  `makeMemberWriter` pide un `$transaction` porque su contrato es "esto corre
 *  todo junto o no corre"; acá ese "todo junto" ya lo garantiza la transacción
 *  de afuera, así que se le pasa uno que simplemente ejecuta el callback con el
 *  mismo `tx`. No es un atajo: es la única forma de reusar el escritor —con sus
 *  invariantes de tokens y de cuenta de acceso— sin abrir una segunda
 *  transacción. `write.ts` no se toca. */
function writerOn(tx: Tx): MemberWriterLike {
  return makeMemberWriter({
    member: tx.member,
    actionToken: tx.actionToken,
    user: tx.user,
    $transaction: ((fn: (c: Tx) => unknown) => fn(tx)) as never,
  });
}

/** Los estados desde los que la Comisión puede resolver una presentación.
 *
 *  `observed` está adentro —y no sólo `submitted`— porque la etapa A del cierre
 *  tiene que poder resolver lo que quedó observado sin subsanar (diseño §5.4):
 *  si no, esas filas no tendrían salida y bloquearían el cierre del libro.
 *  `pending` NO está: no hay nada que revisar en una fila que nació sola al
 *  convocar, y validarla volcaría a la ficha diez columnas vacías. */
export const DECIDABLE_STATUSES = ["submitted", "observed"] as const satisfies readonly PresentationStatus[];

/** Tope de la nota de observación. Es el ancho de la columna
 *  (`Presentation.observation`, VarChar(500)): sin este chequeo MariaDB corta
 *  en silencio y al vecino le llega la mitad de lo que hay que corregir. */
export const OBSERVATION_MAX = 500;

/** El mensaje del CERROJO. Es una cola compartida: dos administradores pueden
 *  abrir la misma presentación y decidir distinto con segundos de diferencia.
 *  La segunda decisión no puede pisar a la primera en silencio, así que el
 *  `updateMany` lleva el estado esperado en el WHERE y un `count: 0` termina
 *  acá — el mismo cerrojo que usan las decisiones de la bandeja de altas. */
export const ALREADY_DECIDED =
  "Otro administrador ya resolvió esta presentación. Actualizá la pantalla para ver cómo quedó.";
export const PRESENTATION_NOT_FOUND = "La presentación no existe.";
export const NOT_SUBMITTED_YET =
  "Ese socio todavía no presentó su re-empadronamiento, así que no hay nada que decidir.";
export const PROCESS_FINISHED =
  "El proceso de re-empadronamiento ya está cerrado: sus presentaciones no se pueden modificar.";
export const OBSERVATION_REQUIRED =
  "Escribí qué tiene que corregir el socio: ese texto es lo único que le llega en el correo.";
export const OBSERVATION_TOO_LONG = `La observación no puede superar los ${OBSERVATION_MAX} caracteres.`;
/** El choque de la dirección de acceso, redactado para ESTA pantalla.
 *
 *  `MEMBER_WRITE_ERRORS.emailConflict` existe y dice lo mismo, pero termina en
 *  "cargale otra al socio" — que es lo que se hace en el modo carga y acá no se
 *  puede: el operador no edita la presentación del vecino. Las dos salidas
 *  reales son pedirle otra dirección (observando) o desarmar el conflicto desde
 *  la ficha, y eso es lo que el mensaje tiene que decir. */
export const VALIDATE_EMAIL_CONFLICT =
  "Ese email ya es la dirección de acceso de otra cuenta del sistema, así que no se puede volcar " +
  "a esta ficha. No se validó nada: observá la presentación para pedirle otra dirección al socio, " +
  "o resolvé el conflicto desde su ficha.";
export const IN_PERSON_NOT_IN_COHORT =
  "Ese socio no fue convocado a este proceso, así que no tiene presentación que cargar.";
export const IN_PERSON_NOT_EDITABLE =
  "Esa presentación ya está enviada o resuelta: no se puede volver a cargar desde el mostrador.";
export const IN_PERSON_CLOSED =
  "El plazo del re-empadronamiento ya no admite presentaciones nuevas.";

/** Marca interna del cerrojo. Viaja como excepción porque el `updateMany` que
 *  lo detecta vive DENTRO de la transacción de `validate` y tiene que voltearla
 *  entera: un `return` desde ahí commitearía lo que ya se hubiera escrito. */
class AlreadyDecidedError extends Error {}

/** El `select` de las decisiones: los diez datos declarados más lo que hace
 *  falta para decidir y para avisar. Uno solo para las cinco operaciones, así
 *  que ninguna puede mirar un subconjunto distinto del resto. */
const PRESENTATION_SELECT = {
  id: true,
  memberId: true,
  status: true,
  observation: true,
  submittedAt: true,
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
  process: { select: { id: true, status: true, firstEndsAt: true, secondEndsAt: true } },
} as const;

/** El proceso, tal como lo necesita el correo de observación: `currentDeadline`
 *  decide con estos tres campos hasta cuándo tiene el vecino. */
export type PresentationProcessRef = {
  id: number;
  status: ReregistrationStatus;
  firstEndsAt: Date;
  secondEndsAt: Date | null;
};

export type ValidateResult =
  | {
      ok: true;
      memberId: number;
      /** Los campos de la ficha que efectivamente cambiaron. Va al asiento de
       *  auditoría (nombres, nunca valores) y a la pantalla. */
      applied: string[];
      /** La dirección declarada es distinta de la que tenía la ficha: es lo que
       *  dispara la verificación de casilla (REG-08) del lado del llamador. */
      emailChanged: boolean;
      /** Presente sólo si el socio TENÍA cuenta y la dirección de ingreso se
       *  mudó: el llamador necesita la anterior para avisarle a esa casilla,
       *  porque después del commit ya no está en ninguna fila. */
      accountEmailMove: { from: string; to: string } | null;
      /** La ficha DESPUÉS de la escritura: `verificationTarget` decide sobre
       *  ella qué correo le corresponde al socio. */
      member: Member;
    }
  | Err;

export type ObserveResult =
  | {
      ok: true;
      presentationId: number;
      memberId: number;
      email: string;
      /** La nota ya recortada. El llamador TIENE que pasarla a la plantilla:
       *  sin ella el correo promete un detalle que no existe. */
      note: string;
      process: PresentationProcessRef;
    }
  | Err;

export type DecisionResult = ({ ok: true; presentationId: number; memberId: number }) | Err;

/** Un cohortado en el buscador del mostrador. Lleva el estado de SU
 *  presentación porque es lo que decide si hay algo que cargar: al que ya se
 *  presentó no se le carga de nuevo, y la pantalla tiene que poder decirlo
 *  ANTES de que el operador tipee media ficha. */
export type CohortHit = {
  presentationId: number;
  memberId: number;
  memberNumber: number | null;
  fullName: string;
  dni: string | null;
  status: PresentationStatus;
  submittedAt: Date | null;
};

export type InPersonResult =
  | {
      ok: true;
      presentationId: number;
      memberId: number;
      email: string;
      submittedAt: Date;
      /** `false` cuando la presentación ya se había enviado y esto es una
       *  subsanación en el mostrador: el llamador no manda una segunda
       *  constancia ni rota la llave. */
      firstSubmission: boolean;
    }
  | Err;

/** Los campos de `Member` que una validación puede tocar: los diez declarados
 *  más las dos columnas que gobiernan la verificación de la casilla.
 *
 *  Es una LISTA BLANCA, igual que `Patch` en `@/lib/members/card-edit`, y por
 *  el mismo motivo: lo que no está acá no se escribe aunque venga en la
 *  presentación. `fullName` y `dni` quedan afuera a propósito (el ancla de
 *  identidad y la credencial con la que se entró al trámite), y `status`,
 *  `category` y `joinedAt` también: eso sólo cambia por un asiento con acta. */
type MemberPatch = {
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
  emailStatus: EmailStatus;
  emailVerifiedAt: Date | null;
};

type MemberBefore = Pick<Member, keyof MemberPatch>;

/** Arma el patch campo por campo (nunca por spread de la presentación) y
 *  resuelve las dos columnas de la casilla con el MISMO criterio que
 *  `buildPatch` del modo carga: una dirección nueva vuelve a `declared` y borra
 *  la verificación anterior; la misma dirección con otra caja o con un espacio
 *  al borde NO es un cambio y no baja nada. Comparar con `sameAddress` —la
 *  función exportada por el escritor de fichas— es lo que garantiza que este
 *  módulo y el escritor entiendan lo mismo por "misma dirección": si acá se
 *  comparara crudo, una normalización de mayúsculas revocaría los enlaces del
 *  socio sin que su dirección hubiera cambiado. */
function memberPatchFrom(before: MemberBefore, data: PresentationData): MemberPatch {
  const email = data.email?.toLowerCase().trim() ?? null;
  const emailChanged = !sameAddress(before.email, email);
  const streetId = data.streetId ?? null;
  return {
    birthDate: data.birthDate,
    civilStatus: data.civilStatus,
    nationality: data.nationality,
    occupation: data.occupation,
    streetId,
    // Con calle del catálogo el texto libre sobra: dejar los dos daría un
    // domicilio con dos fuentes de verdad (mismo criterio que `buildPatch`).
    streetText: streetId ? null : data.streetText,
    streetNumber: data.streetNumber,
    neighborhood: data.neighborhood,
    phone: data.phone,
    email,
    emailStatus: emailChanged ? (email ? "declared" : "none") : before.emailStatus,
    emailVerifiedAt: emailChanged ? null : before.emailVerifiedAt,
  };
}

/** Qué campos del patch difieren de la ficha guardada. Las fechas se comparan
 *  por instante y no por identidad de objeto (dos `Date` iguales nunca son
 *  `===`), que es lo mismo que hace `changedFields` del modo carga. */
function changedMemberFields(before: MemberBefore, patch: MemberPatch): string[] {
  return (Object.keys(patch) as Array<keyof MemberPatch>).filter((key) => {
    const next = patch[key];
    const prev = before[key];
    if (next instanceof Date || prev instanceof Date) {
      const a = next instanceof Date ? next.getTime() : null;
      const b = prev instanceof Date ? prev.getTime() : null;
      return a !== b;
    }
    return next !== prev;
  });
}

type SubmitOk = {
  ok: true;
  presentationId: number;
  memberId: number;
  email: string;
};

/** El resultado del envío, DISCRIMINADO por `firstSubmission`.
 *
 *  Son dos formas y no una con un booleano al lado porque `submittedAt` no vale
 *  lo mismo en las dos:
 *
 *   - en el PRIMER envío lo acaba de escribir este método, así que es una fecha
 *     y el tipo lo dice — es lo que deja mandar la constancia sin un `??` que
 *     invente nada;
 *   - en el segundo (doble clic, reintento del navegador, o una presentación
 *     que la Comisión ya validó) se RELEE de la fila, y una fila sin marca es
 *     `null`. Antes esa rama devolvía `new Date(0)` "porque el caso no puede
 *     ocurrir", y el resultado era que la pantalla de constancia le imprimía al
 *     vecino **01/01/1970** presentado como la prueba de que se presentó dentro
 *     del plazo del Art. 9° bis. Una fecha inventada en un papel que el socio
 *     puede llegar a esgrimir es peor que ninguna: `null` viaja hasta la
 *     pantalla, que en ese caso simplemente no afirma nada sobre el plazo.
 *
 *  `firstSubmission` lo usa el caller para no mandar una segunda constancia ni
 *  rotar la llave de nuevo. */
type SubmitResult =
  | (SubmitOk & { firstSubmission: true; submittedAt: Date })
  | (SubmitOk & { firstSubmission: false; submittedAt: Date | null })
  | Err;

export function makePresentations(db: Db, deps: PresentationDeps = {}) {
  const writerFor = deps.writerFor ?? writerOn;
  const clock = deps.now ?? (() => new Date());

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
          // Se devuelve TAL CUAL, `null` incluido. En estos estados debería
          // haber siempre una marca —sólo la escriben este método y la carga
          // presencial—, pero "debería" no alcanza para emitir una fecha: si la
          // fila llegara sin ella, inventar una sería fabricarle al vecino una
          // constancia falsa del plazo del Art. 9° bis.
          submittedAt: row.submittedAt,
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

      // La SUBSANACIÓN NO PISA `submittedAt`. Quien ya se presentó y vuelve
      // porque la Comisión le pidió corregir algo no puede perder la prueba de
      // que cumplió el plazo: si la marca se moviera al día de la corrección, un
      // socio que presentó el día 25 y corrigió el 33 quedaría, en el papel,
      // fuera de los treinta días del Art. 9° bis — y de esa marca cuelga su
      // condición de socio. Cuándo llegó la corrección lo dicen `updatedAt` y
      // los dos asientos de auditoría.
      //
      // Es la misma regla que ya vale para el doble clic, por el mismo motivo;
      // lo único que cambia es cuánto tiempo pasó entre los dos envíos.
      const now = input.now ?? new Date();
      const submittedAt = row.submittedAt ?? now;
      const { count } = await db.presentation.updateMany({
        where: { id: row.id, status: { in: [...EDITABLE_STATUSES] } },
        data: { status: "submitted", submittedAt, channel: "web" },
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
          submittedAt: fresh?.submittedAt ?? null,
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
        submittedAt,
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

    // ── Las decisiones de la Comisión ────────────────────────────────────────
    //
    // Las cuatro comparten el mismo esqueleto: leer, comprobar que el proceso
    // no esté cerrado, y escribir con un `updateMany` que lleva el ESTADO
    // ESPERADO en el WHERE. Ese WHERE es el cerrojo, y por eso no se reemplaza
    // por un `update` a secas: entre la lectura y la escritura hay una decisión
    // humana, y en una cola compartida eso son minutos en los que el otro
    // administrador puede haber resuelto la misma presentación.

    /** VALIDAR: el acto que vuelca la presentación a la ficha del socio.
     *
     *  Es la primera vez en todo el módulo que datos venidos de una pantalla
     *  pública entran al padrón, y por eso pasa por `memberWriter` y no por un
     *  `member.update` propio: ese módulo hace tres cosas en una transacción
     *  que acá no se pueden omitir —escribe la ficha, revoca los enlaces que la
     *  escritura invalida y le lleva la dirección nueva a la cuenta de acceso—.
     *  Fabricarlo sobre `tx` (`writerOn`) es lo que mantiene todo eso adentro
     *  de ESTA transacción: si la dirección declarada choca con la cuenta de
     *  otra persona, el escritor levanta `MemberEmailConflictError`, la
     *  transacción vuelve atrás y la presentación queda SIN validar, en la cola,
     *  para que el operador la observe.
     *
     *  Qué NO viaja a la ficha: el nombre y el DNI. El nombre es el ancla de
     *  identidad —el wizard ni siquiera lo pide (decisión 9)— y el DNI es lo
     *  único con lo que se entró al trámite; dejar que cualquiera de los dos se
     *  reescriba desde una pantalla que abre con un DNI ajeno sería permitir
     *  apropiarse de la ficha de otro. Tampoco `status`, `category` ni
     *  `joinedAt`: eso sólo cambia por un asiento con acta. */
    async validate(input: {
      presentationId: number;
      actorId: number;
      now?: Date;
    }): Promise<ValidateResult> {
      const row = await decisionRow(input.presentationId);
      if (!row) return { ok: false, error: PRESENTATION_NOT_FOUND };
      const open = decidable(row);
      if (!open.ok) return open;

      // La MISMA función de completitud que usa el wizard para dejar enviar.
      // Una presentación enviada siempre la cumple, así que en la práctica esto
      // no se dispara; está igual porque lo que sigue escribe en el padrón y un
      // camino nuevo que llegue hasta acá con la ficha a medias no puede
      // vaciarle diez columnas al socio en silencio.
      const data = pickData(row);
      const complete = presentationDataComplete(data);
      if (!complete.ok) {
        return { ok: false, error: `No se puede validar: la presentación está incompleta. ${complete.error}` };
      }

      const at = input.now ?? clock();
      try {
        return await db.$transaction(async (tx) => {
          const { count } = await tx.presentation.updateMany({
            where: { id: row.id, status: { in: [...DECIDABLE_STATUSES] } },
            data: { status: "validated", validatedById: input.actorId, validatedAt: at },
          });
          if (count !== 1) throw new AlreadyDecidedError();

          const before = await tx.member.findUniqueOrThrow({ where: { id: row.memberId } });
          const patch = memberPatchFrom(before, data);
          const applied = changedMemberFields(before, patch);
          const emailChanged = !sameAddress(before.email, patch.email);
          if (applied.length === 0) {
            // Nada que escribir: la ficha ya decía exactamente esto. Se saltea
            // el escritor a propósito —no hay tokens que revocar ni cuenta que
            // sincronizar por un cambio que no existe—, igual que el modo carga
            // cuando el operador aprieta Ctrl+S dos veces.
            return { ok: true as const, memberId: row.memberId, applied, emailChanged: false, accountEmailMove: null, member: before };
          }
          const written = await writerFor(tx as Tx).updateMember(row.memberId, patch);
          return {
            ok: true as const,
            memberId: row.memberId,
            applied,
            emailChanged,
            accountEmailMove: written.accountEmailMove,
            member: written.member,
          };
        });
      } catch (e) {
        if (e instanceof AlreadyDecidedError) return { ok: false, error: ALREADY_DECIDED };
        // Los dos rechazos del escritor abortan la escritura ENTERA (la
        // transacción ya volvió atrás). Se traducen a un mensaje accionable en
        // vez de propagarse como un error crudo: el operador tiene que saber
        // que no se guardó nada y cuál es su salida.
        if (e instanceof MemberWriteError) {
          return { ok: false, error: e.reason === "email_conflict" ? VALIDATE_EMAIL_CONFLICT : e.message };
        }
        throw e;
      }
    },

    /** OBSERVAR: pedirle al socio que corrija algo.
     *
     *  La nota es OBLIGATORIA acá, y no es una validación de formulario: la
     *  plantilla del correo (`presentationObservedEmail`) la acepta opcional
     *  —la omite a propósito en el reenvío del enlace— así que una observación
     *  sin nota le manda al vecino un correo que le promete un detalle que no
     *  existe en ningún lado, con el plazo del Art. 9° bis corriendo. */
    async observe(input: {
      presentationId: number;
      actorId: number;
      note: string;
    }): Promise<ObserveResult> {
      const note = input.note.trim();
      if (note === "") return { ok: false, error: OBSERVATION_REQUIRED };
      if (note.length > OBSERVATION_MAX) return { ok: false, error: OBSERVATION_TOO_LONG };

      const row = await decisionRow(input.presentationId);
      if (!row) return { ok: false, error: PRESENTATION_NOT_FOUND };
      const open = decidable(row);
      if (!open.ok) return open;

      const { count } = await db.presentation.updateMany({
        where: { id: row.id, status: { in: [...DECIDABLE_STATUSES] } },
        data: { status: "observed", observation: note },
      });
      if (count !== 1) return { ok: false, error: ALREADY_DECIDED };
      return {
        ok: true,
        presentationId: row.id,
        memberId: row.memberId,
        // `decidable` ya garantizó que la presentación se envió, y no se puede
        // enviar sin email: el `??` es para el compilador.
        email: row.email ?? "",
        note,
        process: row.process,
      };
    },

    /** RECHAZAR. La nota es opcional y se guarda en la misma columna que la
     *  observación: es el motivo, y la pantalla lo muestra al lado del estado.
     *  No manda ningún correo —el proyecto no tiene plantilla de rechazo de
     *  presentación— y es reversible con `unreject` mientras el proceso viva. */
    async reject(input: {
      presentationId: number;
      actorId: number;
      note?: string;
    }): Promise<DecisionResult> {
      const note = input.note?.trim() ?? "";
      if (note.length > OBSERVATION_MAX) return { ok: false, error: OBSERVATION_TOO_LONG };

      const row = await decisionRow(input.presentationId);
      if (!row) return { ok: false, error: PRESENTATION_NOT_FOUND };
      const open = decidable(row);
      if (!open.ok) return open;

      const { count } = await db.presentation.updateMany({
        where: { id: row.id, status: { in: [...DECIDABLE_STATUSES] } },
        data: { status: "rejected", observation: note === "" ? row.observation : note },
      });
      if (count !== 1) return { ok: false, error: ALREADY_DECIDED };
      return { ok: true, presentationId: row.id, memberId: row.memberId };
    },

    /** VOLVER A OBSERVADA lo rechazado. Deshace el rechazo dejando la
     *  presentación donde el socio puede subsanarla, que es el estado del que
     *  hay camino de vuelta. NO manda correo: el aviso lo da una observación
     *  posterior, con su nota. */
    async unreject(input: { presentationId: number; actorId: number }): Promise<DecisionResult> {
      const row = await decisionRow(input.presentationId);
      if (!row) return { ok: false, error: PRESENTATION_NOT_FOUND };
      if (row.process.status === "closed") return { ok: false, error: PROCESS_FINISHED };
      // Misma distinción que en `decidable`: `pending` es "nunca se presentó";
      // cualquier otro estado distinto de `rejected` es que alguien ya movió
      // esta presentación desde que la pantalla se dibujó.
      if (row.status !== "rejected") {
        return { ok: false, error: row.status === "pending" ? NOT_SUBMITTED_YET : ALREADY_DECIDED };
      }

      const { count } = await db.presentation.updateMany({
        where: { id: row.id, status: { in: ["rejected"] } },
        data: { status: "observed" },
      });
      if (count !== 1) return { ok: false, error: ALREADY_DECIDED };
      return { ok: true, presentationId: row.id, memberId: row.memberId };
    },

    /** LA CARGA PRESENCIAL (Art. 9° bis a: "en forma presencial o electrónica").
     *
     *  El operador carga los mismos datos y los mismos documentos del vecino
     *  que se acercó a la sede, y la presentación entra a la MISMA cola: el que
     *  carga no valida en el mismo acto (cuatro ojos, diseño §6).
     *
     *  Reusa las dos reglas puras del wizard —`presentationDataComplete` y
     *  `presentationDocsComplete`— y no una validación propia. Es el camino que
     *  no pasa por el `dataSchema` del formulario público, así que si acá se
     *  escribiera otra lista, una presentación sin barrio (o sin el dorso del
     *  DNI) llegaría hasta la ficha del socio por la puerta del mostrador. */
    async registerInPerson(input: {
      processId: number;
      memberId: number;
      actorId: number;
      data: PresentationData;
      now?: Date;
    }): Promise<InPersonResult> {
      const complete = presentationDataComplete(input.data);
      if (!complete.ok) return complete;

      const row = await db.presentation.findUnique({
        where: { processId_memberId: { processId: input.processId, memberId: input.memberId } },
        select: PRESENTATION_SELECT,
      });
      if (!row) return { ok: false, error: IN_PERSON_NOT_IN_COHORT };

      // El mismo veredicto que gobierna al vecino en la web, con el texto
      // traducido al mostrador: la REGLA es compartida (`editabilityOf`), lo
      // que cambia es a quién le habla el cartel.
      const editable = counterEditability(row);
      if (!editable.ok) return editable;

      const docs = presentationDocsComplete((await docTypesOf(row.id)).map((type) => ({ type })));
      if (!docs.ok) return docs;

      // Misma regla que el envío web: la subsanación NO pisa `submittedAt`. De
      // esa marca cuelga la prueba de que el socio cumplió el plazo.
      const at = input.now ?? clock();
      const submittedAt = row.submittedAt ?? at;
      const { count } = await db.presentation.updateMany({
        where: { id: row.id, status: { in: [...EDITABLE_STATUSES] } },
        data: { ...input.data, status: "submitted", channel: "in_person", submittedAt },
      });
      if (count !== 1) return { ok: false, error: ALREADY_DECIDED };
      return {
        ok: true,
        presentationId: row.id,
        memberId: row.memberId,
        email: input.data.email ?? "",
        submittedAt,
        firstSubmission: row.submittedAt === null,
      };
    },

    /** La presentación de un cohortado, ya verificada como cargable desde el
     *  mostrador. Es lo que usa la SUBIDA de documentos del panel: necesita el
     *  id para nombrar la carpeta y no puede aceptar un archivo para algo que
     *  la Comisión ya resolvió ni para un proceso cuyo plazo venció.
     *
     *  Comparte `counterEditability` con `registerInPerson`, así que las dos
     *  escrituras del mostrador abren y cierran juntas: sin eso, el formulario
     *  aceptaría un DNI y después rechazaría el registro. */
    async openForCounter(presentationId: number): Promise<({ ok: true; presentationId: number; memberId: number }) | Err> {
      const row = await decisionRow(presentationId);
      if (!row) return { ok: false, error: PRESENTATION_NOT_FOUND };
      const editable = counterEditability(row);
      if (!editable.ok) return editable;
      return { ok: true, presentationId: row.id, memberId: row.memberId };
    },

    /** El buscador del mostrador: los cohortados de ESTE proceso, por nombre,
     *  DNI o número de socio.
     *
     *  Es una variante propia y no `searchMembers` de tesorería (que no se
     *  toca): aquel busca en todo el libro abierto, y acá buscar fuera de la
     *  cohorte sería ofrecerle al operador cargarle una presentación a alguien
     *  que nadie convocó —una fila que después no tiene dónde ir—. El filtro
     *  por `processId` sale de la tabla misma: sólo hay fila para el convocado.
     *
     *  Hasta 10 resultados, como el buscador de tesorería: el operador afina la
     *  consulta. */
    async searchCohort(input: { processId: number; bookId: number; q: string }): Promise<CohortHit[]> {
      // Sin consulta no se consulta: un `contains: ""` devolvería la cohorte
      // entera (ciento y pico de nombres) en una pantalla que no la pide.
      const q = input.q.trim();
      if (q === "") return [];

      const or: Prisma.PresentationWhereInput[] = [
        { member: { fullName: { contains: q } } },
        { member: { dni: { contains: q } } },
      ];
      const n = Number(q);
      if (Number.isInteger(n) && n > 0) {
        or.push({ member: { memberships: { some: { bookId: input.bookId, memberNumber: n } } } });
      }

      const rows = await db.presentation.findMany({
        where: { processId: input.processId, OR: or },
        orderBy: { member: { fullName: "asc" } },
        take: 10,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          member: {
            select: {
              id: true, fullName: true, dni: true,
              memberships: { where: { bookId: input.bookId }, select: { memberNumber: true } },
            },
          },
        },
      });
      return rows.map((r) => ({
        presentationId: r.id,
        status: r.status,
        submittedAt: r.submittedAt,
        memberId: r.member.id,
        fullName: r.member.fullName,
        dni: r.member.dni,
        memberNumber: r.member.memberships[0]?.memberNumber ?? null,
      }));
    },
  };

  /** La fila que necesitan las cuatro decisiones. Una sola consulta y un solo
   *  `select` para que ninguna decisión mire un subconjunto distinto. */
  async function decisionRow(id: number) {
    return db.presentation.findUnique({ where: { id }, select: PRESENTATION_SELECT });
  }

  /** ¿Esta presentación admite una decisión de la Comisión AHORA?
   *
   *  Dos preguntas, como `editabilityOf` del lado del vecino: el estado del
   *  proceso y el de la presentación. Compartida por las tres decisiones que la
   *  necesitan para que no puedan divergir. */
  /** ¿El MOSTRADOR puede tocar esta presentación?
   *
   *  La regla es exactamente la del vecino en la web —`editabilityOf`, que
   *  decide con el estado de la presentación y el de su proceso—; lo único que
   *  cambia es a quién le habla el cartel. Los textos del wizard tutean al
   *  socio ("Tu re-empadronamiento ya fue resuelto…") y en el panel se leen
   *  como un error del sistema. Traducir el mensaje sin duplicar la regla es lo
   *  que garantiza que el formulario del mostrador no acepte un documento para
   *  algo que después va a rechazar. */
  function counterEditability(row: {
    status: PresentationStatus;
    process: { status: ReregistrationStatus };
  }): Ok | Err {
    const editable = editabilityOf({ status: row.status, processStatus: row.process.status });
    if (editable.ok) return editable;
    return {
      ok: false,
      error: editable.error === PROCESS_CLOSED ? IN_PERSON_CLOSED : IN_PERSON_NOT_EDITABLE,
    };
  }

  function decidable(row: { status: PresentationStatus; process: { status: string } }): Ok | Err {
    if (row.process.status === "closed") return { ok: false, error: PROCESS_FINISHED };
    if ((DECIDABLE_STATUSES as readonly string[]).includes(row.status)) return { ok: true };
    // Los dos "no" NO dicen lo mismo, y la diferencia es la que el operador
    // necesita. `pending` es una fila que nació al convocar y nadie tocó: no
    // hay nada que decidir. Cualquier otro estado significa que ALGUIEN YA
    // DECIDIÓ —y en una cola compartida, ese alguien es casi siempre el otro
    // administrador que tenía la misma presentación abierta—. Decirle "no está
    // esperando una decisión" a quien acaba de apretar Validar sobre una
    // pantalla de hace tres minutos lo manda a buscar un error de sistema en
    // vez de a recargar.
    return { ok: false, error: row.status === "pending" ? NOT_SUBMITTED_YET : ALREADY_DECIDED };
  }
}

/** Las diez columnas declaradas de una fila, sin arrastrar el resto. */
function pickData(row: Record<string, unknown>): PresentationData {
  const data = {} as Record<string, unknown>;
  for (const field of DATA_FIELDS) data[field] = row[field] ?? null;
  return data as PresentationData;
}

export const presentations = makePresentations(prisma);
