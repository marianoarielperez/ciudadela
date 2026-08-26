// Las reglas PURAS de una presentación de re-empadronamiento: completitud
// documental, completitud de la ficha y quién puede tocarla.
//
// Viven aparte de `presentation.ts` por una razón mecánica y una de fondo:
//
//   - la mecánica: `presentation.ts` arma su singleton con `@/lib/prisma` y usa
//     `node:crypto`, así que un componente de cliente que lo importara se
//     llevaría el cliente de Prisma al bundle del navegador. El paso 3 del
//     wizard necesita `presentationDocsComplete` para habilitar el botón. Es el
//     mismo motivo por el que el alta tiene `applications/documents-rules.ts`
//     separado de `applications/service.ts`;
//   - la de fondo: estas funciones las comparten la PANTALLA (para habilitar el
//     botón y decir qué falta) y el SERVER (que no puede confiar en el cliente).
//     Que sea la misma función en las dos puntas es lo que garantiza que el
//     botón no habilite algo que la action va a rechazar, ni al revés.
import type {
  DocumentType,
  PresentationStatus,
  ReregistrationStatus,
} from "@/generated/prisma/client";
import { wizardOpen } from "./rules";

type Ok = { ok: true };
type Err = { ok: false; error: string };

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
export const SETTLED_STATUSES = ["submitted", "validated"] as const satisfies readonly PresentationStatus[];

export const LINK_DEAD =
  "No encontramos tu re-empadronamiento: el enlace puede estar incompleto o haber sido reemplazado por uno más nuevo. Revisá el último correo que te mandamos.";
export const NOT_EDITABLE =
  "Tu re-empadronamiento ya fue resuelto por la Comisión, así que no se puede modificar desde acá. Si necesitás corregir algo, acercate a la sede vecinal.";
export const PROCESS_CLOSED =
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

export const DATA_FIELDS = [
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

/** ¿El vecino puede TOCAR esta presentación ahora mismo?
 *
 *  Dos preguntas que siempre van juntas: el estado de la presentación y el del
 *  proceso. Vive en una sola función porque la comparten las tres escrituras
 *  del wizard —guardar los datos, subir un documento y enviar— y la pantalla de
 *  retorno. Escrita tres veces, divergiría, y la divergencia se vería como un
 *  formulario que acepta un archivo y después rechaza el envío. Es la misma
 *  lección de `coverageFloor` en el Módulo 4.
 *
 *  El proceso que manda es el de la PRESENTACIÓN, no el que apunta la clave de
 *  configuración: una presentación pertenece a un proceso y no a "el proceso de
 *  hoy". */
export function editabilityOf(p: {
  status: PresentationStatus;
  processStatus: ReregistrationStatus;
}): Ok | Err {
  if (!(EDITABLE_STATUSES as readonly string[]).includes(p.status)) {
    return { ok: false, error: NOT_EDITABLE };
  }
  if (!wizardOpen({ status: p.processStatus })) return { ok: false, error: PROCESS_CLOSED };
  return { ok: true };
}

