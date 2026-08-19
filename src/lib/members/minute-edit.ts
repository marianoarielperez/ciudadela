// Edición de un acta ya asentada (la "M" del ABM que pedía la spec §2.6).
//
// ── Por qué existe ────────────────────────────────────────────────────────────
// Los números de acta se tipean a mano desde los libros en papel. Un dedazo hoy
// no se podía corregir desde el panel, y encima el índice `UNIQUE(type, number)`
// bloqueaba cargar el acta con el número correcto: el error se volvía permanente.
//
// ── Qué se puede editar y qué no ──────────────────────────────────────────────
// **Tipo, número y descripción: siempre.** De ellos no cuelga ningún dato
// derivado; corregirlos es exactamente el caso de uso que motiva la pantalla.
//
// **Fecha: sólo mientras el acta no tenga nada asentado.** La fecha del acta ES
// la fecha de ingreso de los socios que admite (REG-11: `joinedAt = minute.date`,
// ver `service.ts:66`) y la de egreso de los que da de baja (`leftAt`). Y
// `joinedAt` es inmutable por regla del proyecto, porque es la antigüedad
// estatutaria: de ella dependen el derecho a voto (90 días) y el pase automático
// a vitalicio (25 años).
//
// Las tres salidas posibles y por qué esta:
//
//   - *Permitirlo y propagar a los socios*: viola la inmutabilidad de `joinedAt`
//     y reescribiría en silencio la antigüedad de gente que hoy puede votar.
//   - *Permitirlo con una confirmación explícita*: deja el padrón diciendo una
//     antigüedad y el acta que la respalda diciendo otra. La divergencia sería
//     invisible —nada la vuelve a comparar nunca— y viviría en el registro que
//     la asociación presenta ante la IGJ. Una confirmación no arregla un dato
//     inconsistente: sólo reparte la culpa.
//   - *Bloquearlo cuando hay movimientos*: el acta sin movimientos se corrige
//     entera (que es el 100% del caso "la acabo de cargar mal"), y el acta con
//     movimientos conserva la fecha que el padrón ya usó. **Esta.**
//
// Si la fecha de un acta con movimientos está realmente mal, la corrección no es
// una edición de pantalla: es reasentar esos movimientos —con su acta— y eso
// pasa por la Comisión, no por el panel. El mensaje se lo dice al operador.
//
// El mismo bloqueo cubre el acta que abre o cierra un Libro: de ahí cuelga
// `Book.openedAt`/`closedAt` por el mismo mecanismo.
//
// ── Por qué NO hay borrado ────────────────────────────────────────────────────
// La "B" del ABM no se implementa, y es deliberado:
//
//   1. Un acta es una hoja del libro de actas que la asociación presenta ante la
//      IGJ. Un asiento societario no se borra: se corrige con otro asiento. Es
//      la misma razón por la que la baja de un socio es lógica y nunca un DELETE.
//   2. Un acta con movimientos es el respaldo documental de esos movimientos. La
//      FK `Movement.minuteId` es opcional en el schema, así que un borrado en
//      cascada mal hecho dejaría movimientos sin acta — justo la invariante que
//      el diseño protege (ver el comentario del acta huérfana en
//      `socios/[id]/actions.ts`).
//   3. El único caso donde borrar sería inofensivo —un acta recién creada, vacía
//      y equivocada— ya está cubierto dos veces: `discardUnusedMinute` la
//      descarta sola cuando la acción societaria que la creó falla, y esta misma
//      edición permite reescribirle tipo, número, fecha y descripción, o sea
//      convertirla en el acta correcta sin dejar un hueco en la numeración.
//
// Si alguna vez hace falta anular un acta, la forma correcta es un campo de
// anulación (con acta que la anule), no un DELETE.
import { z } from "zod";
import type { MinuteType, PrismaClient } from "@/generated/prisma/client";

// Re-exportada acá porque las pantallas de edición de acta ya importaban
// `parseMinuteDate` de este módulo; la implementación vive en `minute-date.ts`
// para que `minute-form.ts` (alta de acta desde una acción societaria) y
// `actas/actions.ts` (alta y edición) la compartan sin que este archivo, que
// es específico de la EDICIÓN, se convierta en su dueño.
export { parseMinuteDate } from "@/lib/members/minute-date";

export const minuteEditSchema = z.object({
  minuteId: z.coerce.number().int().positive(),
  type: z.enum(["board", "assembly"], { error: "Elegí el tipo de acta." }),
  number: z.coerce.number().int().positive("Número de acta inválido"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  description: z.string().max(500).optional(),
});

export type MinuteSnapshot = {
  type: MinuteType;
  number: number;
  date: Date;
  description: string | null;
};

export type MinuteField = "type" | "number" | "date" | "description";

export type MinuteEditReason = "not_found" | "date_locked" | "duplicate";

export const MINUTE_EDIT_ERRORS = {
  notFound: "El acta no existe.",
  dateLocked:
    "No se puede cambiar la fecha: el acta ya tiene movimientos asentados y esa fecha es la " +
    "fecha de ingreso o de egreso de los socios que figuran en ella (la antigüedad estatutaria " +
    "no se modifica). Podés corregir el tipo, el número y la descripción; si la fecha está mal, " +
    "los movimientos tienen que reasentarse por acta de la Comisión.",
  duplicate: (n: number) => `Ya existe el acta N° ${n} de ese tipo.`,
} as const;

/** Rechazo con mensaje ya redactado en castellano. `reason` es para la auditoría
 *  y para que el llamador pueda distinguirlo de un error técnico de la base. */
export class MinuteEditError extends Error {
  constructor(readonly reason: MinuteEditReason, message: string) {
    super(message);
    this.name = "MinuteEditError";
  }
}

function isoDay(d: Date): string {
  // Las fechas civiles se guardan a mediodía UTC, así que el día calendario del
  // ISO es siempre el del libro (ver src/lib/dates.ts).
  return d.toISOString().slice(0, 10);
}

/** Qué campos cambiaría esta edición. La fecha se compara por instante y no por
 *  identidad de objeto: abrir el formulario y guardar sin tocar nada no puede
 *  contar como un cambio de fecha (quedaría bloqueado por la regla de arriba). */
export function minuteChanges(current: MinuteSnapshot, next: MinuteSnapshot): MinuteField[] {
  const changed: MinuteField[] = [];
  if (current.type !== next.type) changed.push("type");
  if (current.number !== next.number) changed.push("number");
  if (current.date.getTime() !== next.date.getTime()) changed.push("date");
  if ((current.description ?? null) !== (next.description ?? null)) changed.push("description");
  return changed;
}

/** Detalle del asiento de auditoría. Lleva los valores viejo y nuevo de tipo,
 *  número y fecha —enums, un entero y una fecha, nada personal— pero de la
 *  descripción lleva sólo el NOMBRE del campo: es texto libre copiado del libro
 *  y puede nombrar socios (Ley 25.326, mismo criterio que
 *  `sanitizeFiltersForAudit` en `export.ts`). */
export function minuteEditAuditDetail(
  before: MinuteSnapshot, after: MinuteSnapshot, changed: MinuteField[],
): { fields: MinuteField[]; from: Record<string, unknown>; to: Record<string, unknown> } {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const field of changed) {
    if (field === "description") continue;
    if (field === "date") {
      from.date = isoDay(before.date);
      to.date = isoDay(after.date);
      continue;
    }
    from[field] = before[field];
    to[field] = after[field];
  }
  return { fields: changed, from, to };
}

export type MinuteEditResult = {
  changed: MinuteField[];
  before: MinuteSnapshot;
  after: MinuteSnapshot;
};

type MinuteEditDb = Pick<PrismaClient, "$transaction" | "book" | "minute" | "movement">;

export function makeMinuteEditor(db: MinuteEditDb) {
  return {
    /** Devuelve qué cambió (lista vacía = no se escribió nada) o lanza
     *  `MinuteEditError` con el mensaje ya listo para la pantalla. */
    async update(minuteId: number, next: MinuteSnapshot): Promise<MinuteEditResult> {
      // Todo adentro de una transacción: el conteo de movimientos y la escritura
      // tienen que ver la misma foto. No cierra del todo la carrera contra un
      // admin que asienta un movimiento en el mismo instante (haría falta un
      // lock explícito), pero la reduce a la ventana de la transacción en vez de
      // dejarla abierta entre dos consultas sueltas.
      return db.$transaction(async (tx) => {
        const current = await tx.minute.findUnique({
          where: { id: minuteId },
          select: { type: true, number: true, date: true, description: true },
        });
        if (!current) throw new MinuteEditError("not_found", MINUTE_EDIT_ERRORS.notFound);

        const before: MinuteSnapshot = { ...current };
        const changed = minuteChanges(before, next);
        // Sin cambios no se escribe ni se audita: el operador que entra a mirar
        // y guarda por reflejo no puede ensuciar el rastro que sí importa (mismo
        // criterio que el Ctrl+S del modo carga).
        if (changed.length === 0) return { changed, before, after: before };

        if (changed.includes("date")) {
          const [movements, books] = await Promise.all([
            tx.movement.count({ where: { minuteId } }),
            tx.book.count({
              where: { OR: [{ openingMinuteId: minuteId }, { closingMinuteId: minuteId }] },
            }),
          ]);
          if (movements > 0 || books > 0) {
            throw new MinuteEditError("date_locked", MINUTE_EDIT_ERRORS.dateLocked);
          }
        }

        try {
          await tx.minute.update({
            where: { id: minuteId },
            data: {
              type: next.type, number: next.number, date: next.date,
              description: next.description,
            },
          });
        } catch (e) {
          // UNIQUE(type, number). El operador está corrigiendo un número mal
          // tipeado: que el choque salga como el P2002 crudo de Prisma, en
          // inglés, sería el peor momento posible para un error técnico.
          if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
            throw new MinuteEditError("duplicate", MINUTE_EDIT_ERRORS.duplicate(next.number));
          }
          throw e;
        }
        return { changed, before, after: next };
      });
    },
  };
}
