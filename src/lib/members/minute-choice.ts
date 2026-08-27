// Qué acta está eligiendo un formulario EN ESTE MOMENTO, del lado del cliente.
//
// Es la contracara PURA de `minute-form.ts`: aquél parsea el FormData que ya se
// mandó y resuelve contra la base; éste describe la elección viva mientras el
// operador todavía está mirando la pantalla, sin tocar Prisma ni React. Existe
// para que la elección se pueda MOSTRAR antes de confirmar.
//
// El porqué, que es una historia corta y cara: en el simulacro del Módulo 6 el
// cierre del Libro N° 1 —el acto que se asienta ante la IGJ y que solo se
// revierte restaurando un backup— quedó registrado con el acta de las bajas (la
// CD 126, creada minutos antes) y no con la que el operador creía estar
// creando (la 127). No fue distracción: el selector abría en "Acta existente"
// con la primera de la lista ya elegida, la lista viene ordenada por fecha
// descendente, y en una ceremonia de cierre la más reciente es casi siempre el
// acta del paso anterior. Encima la pantalla de confirmación no nombraba en
// ningún lado el acta que iba a usar, así que no había dónde darse cuenta.
//
// De ahí salen las dos cosas que viven acá: `initialMinuteChoice` (el estado
// inicial, decidido en UN solo lugar para que pantalla y selector no diverjan)
// y `describeMinuteChoice` (cómo se nombra esa elección en un resumen).
import { parseCivilDate } from "@/lib/dates";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";

export type MinuteOption = { id: number; label: string };
export type MinuteDraftType = keyof typeof MINUTE_TYPE_LABELS;

/** El borrador del modo "Acta nueva". Todo texto: es lo que hay tipeado en los
 *  campos, todavía sin validar. */
export type MinuteDraft = {
  type: MinuteDraftType;
  number: string;
  date: string;
  description: string;
};

export type MinuteChoice =
  | { mode: "existing"; option: MinuteOption | null }
  | { mode: "new"; draft: MinuteDraft };

/** Valores con los que arranca el modo "Acta nueva". El número va POR TIPO
 *  porque la numeración de actas lo es (`@@unique([type, number])`): sugerir el
 *  siguiente de Comisión Directiva mientras el desplegable dice "Asamblea" sería
 *  otro valor equivocado ofrecido en silencio, que es justo lo que este módulo
 *  existe para no repetir. */
export type MinuteDraftDefaults = {
  type?: MinuteDraftType;
  numberByType?: Partial<Record<MinuteDraftType, number>>;
  /** "YYYY-MM-DD", el formato del <input type="date">. */
  date?: string;
};

/** El número sugerido para un tipo, como string listo para el input ("" si no
 *  hay sugerencia para ese tipo). */
export function suggestedMinuteNumber(
  defaults: MinuteDraftDefaults | undefined,
  type: MinuteDraftType,
): string {
  const n = defaults?.numberByType?.[type];
  return n === undefined ? "" : String(n);
}

export function initialMinuteDraft(defaults?: MinuteDraftDefaults): MinuteDraft {
  const type = defaults?.type ?? "board";
  return {
    type,
    number: suggestedMinuteNumber(defaults, type),
    date: defaults?.date ?? "",
    description: "",
  };
}

/** Las actas que el desplegable OFRECE: la lista que llegó por props más, si
 *  hiciera falta, la que la acción anterior acaba de usar. Entre la carga de la
 *  página y el fin de una tanda el acta pudo haberse creado, y el operador no
 *  tiene por qué recargar para poder elegirla. */
export function offeredMinutes(minutes: MinuteOption[], applied?: MinuteOption | null): MinuteOption[] {
  return applied && !minutes.some((m) => m.id === applied.id) ? [applied, ...minutes] : minutes;
}

/** El estado INICIAL del selector, decidido una sola vez para todos:
 *
 *   - `applied` manda: es un "adoptá ésta" explícito de la pantalla (el lote de
 *     bajas, que se declara en tandas contra la misma acta).
 *   - si no, manda `defaultMode`. El cierre del libro y la ANULACIÓN de una
 *     exención piden "new": los dos son actos que se asientan una sola vez y
 *     merecen acta propia, y arrancar en "existente" preselecciona en silencio
 *     la más reciente —el acta del paso anterior en el cierre, la que concedió
 *     la exención en la anulación—, que es exactamente el error del simulacro y
 *     el que volvió a aparecer en la verificación en vivo de las exenciones.
 *   - si no hay ninguna de las dos, "existente" con la primera de la lista, que
 *     es el comportamiento histórico de los otros ocho consumidores.
 *
 * Sin actas cargadas no hay modo "existente" posible y cae en "nueva". */
export function initialMinuteChoice(opts: {
  minutes: MinuteOption[];
  applied?: MinuteOption | null;
  defaultMode?: "existing" | "new";
  newDefaults?: MinuteDraftDefaults;
}): MinuteChoice {
  const options = offeredMinutes(opts.minutes, opts.applied);
  if (opts.applied) return { mode: "existing", option: opts.applied };
  const wants = opts.defaultMode ?? "existing";
  if (wants === "new" || options.length === 0) {
    return { mode: "new", draft: initialMinuteDraft(opts.newDefaults) };
  }
  return { mode: "existing", option: options[0] ?? null };
}

/** Cómo se nombra la elección viva en un resumen, y si ya está completa. El
 *  texto se lee siempre detrás de una etiqueta ("Acta de cierre: …"), así que
 *  es un fragmento y no una oración suelta.
 *
 *  `ready: false` no es un error de validación —la palabra final la tienen el
 *  schema y la action— sino "todavía no hay acta que nombrar": sirve para que
 *  una pantalla no ofrezca confirmar un acto irreversible sin acta. */
export function describeMinuteChoice(choice: MinuteChoice): { text: string; ready: boolean } {
  if (choice.mode === "existing") {
    return choice.option
      ? { text: choice.option.label, ready: true }
      : { text: "todavía no elegiste ninguna.", ready: false };
  }
  const { type, number, date } = choice.draft;
  const day = formatDraftDate(date);
  if (number.trim() === "" || day === null) {
    return { text: "falta completar el número y la fecha del acta nueva.", ready: false };
  }
  // Se dice con todas las letras que el acta TODAVÍA NO EXISTE: el número que el
  // operador tipeó no es el de un acta del libro hasta que la acción corra.
  return {
    text: `se creará ${MINUTE_TYPE_LABELS[type]} N° ${number.trim()} con fecha ${day} (acta nueva).`,
    ready: true,
  };
}

/** "YYYY-MM-DD" → "DD/MM/AAAA", o `null` si todavía no es una fecha. Reusa la
 *  guarda compartida de fechas civiles, así que un "31 de febrero" tipeado no
 *  se muestra como si fuera un día real. El tope contra el futuro NO se aplica
 *  acá: esto describe, no valida (eso es `parseMinuteDate` en la action). */
function formatDraftDate(iso: string): string | null {
  const parsed = parseCivilDate(iso, { invalidError: "no" });
  return parsed.ok ? formatDateAR(parsed.value) : null;
}
