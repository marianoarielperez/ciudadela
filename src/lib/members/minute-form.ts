// Shared "pick or create a Minute" used by every statutory action form.
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatDateAR } from "@/lib/format";
import { parseMinuteDate } from "@/lib/members/minute-date";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";

export const minuteSelectionSchema = z.union(
  [
    z.object({ minuteId: z.coerce.number().int().positive() }),
    z.object({
      minuteNew: z.literal("1"),
      minuteType: z.enum(["board", "assembly"]),
      minuteNumber: z.coerce.number().int().positive(),
      minuteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de acta inválida"),
      minuteDescription: z.string().max(500).optional(),
    }),
  ],
  // Sin este mensaje, un union que no matchea ninguna rama reporta el "Invalid
  // input" genérico de zod y el formulario lo muestra en inglés.
  { error: "Elegí un acta existente o cargá los datos de una nueva." },
);
export type MinuteSelection = z.infer<typeof minuteSelectionSchema>;

export async function resolveMinuteId(
  db: Pick<PrismaClient, "minute">,
  sel: MinuteSelection,
  actorId: number,
): Promise<number> {
  if ("minuteId" in sel) {
    // El id viene de un <select> que el navegador puede haber alterado. Sin este
    // chequeo el fallo aparece recién al crear el movimiento, como violación de
    // clave foránea: un error técnico en inglés en medio de una acción societaria.
    const existing = await db.minute.findUnique({ where: { id: sel.minuteId }, select: { id: true } });
    if (!existing) throw new Error("El acta seleccionada no existe.");
    return existing.id;
  }
  const parsedDate = parseMinuteDate(sel.minuteDate);
  if (!parsedDate.ok) throw new Error(parsedDate.error);
  try {
    const minute = await db.minute.create({
      data: {
        type: sel.minuteType, number: sel.minuteNumber, date: parsedDate.value,
        description: sel.minuteDescription ?? null, createdById: actorId,
      },
    });
    return minute.id;
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      throw new Error(`Ya existe el acta N° ${sel.minuteNumber} de ese tipo.`);
    }
    throw e;
  }
}

// Cómo se llama el acta que va a recibir el asiento, para PODER MOSTRARLA antes
// de escribir nada. Es la contracara de `resolveMinuteId`: misma selección, cero
// escrituras. Una pantalla de confirmación que creara el acta para poder
// nombrarla dejaría un asiento fantasma en el libro cada vez que el operador
// vuelve atrás — justo lo que evita `discardUnusedMinute` más abajo.
//
// La fecha se valida acá y no recién al confirmar: es mejor que el "31 de
// febrero" salte mientras el operador todavía está mirando el formulario.
export async function describeMinuteSelection(
  db: Pick<PrismaClient, "minute">,
  sel: MinuteSelection,
): Promise<string> {
  if ("minuteId" in sel) {
    const existing = await db.minute.findUnique({
      where: { id: sel.minuteId },
      select: { type: true, number: true, date: true },
    });
    if (!existing) throw new Error("El acta seleccionada no existe.");
    return `${MINUTE_TYPE_LABELS[existing.type]} N° ${existing.number} — ${formatDateAR(existing.date)}`;
  }
  const parsedDate = parseMinuteDate(sel.minuteDate);
  if (!parsedDate.ok) throw new Error(parsedDate.error);
  // Se aclara que todavía no existe: el número que el operador tipeó no es el de
  // un acta del libro hasta que la acción se ejecute.
  return `${MINUTE_TYPE_LABELS[sel.minuteType]} N° ${sel.minuteNumber} — ${formatDateAR(parsedDate.value)} (acta nueva, se crea al confirmar)`;
}

// `true` cuando la selección va a dar de alta un acta nueva en vez de reusar una
// existente. Solo quien la creó puede descartarla si la acción termina fallando.
export function createsNewMinute(sel: MinuteSelection): boolean {
  return !("minuteId" in sel);
}

// Compensación para el acta huérfana: si la acción societaria crea el acta y
// después el servicio rechaza (regla estatutaria, carrera contra otro admin,
// error de datos), el acta queda asentada sin ningún movimiento — un asiento
// fantasma en un libro que se presenta ante la IGJ. Peor todavía: al reintentar,
// el mismo tipo+número choca con el índice único y el usuario ve un segundo
// error ("Ya existe el acta N° 47") que no tiene nada que ver con el primero.
//
// Borra solo si el acta quedó realmente sin usar. El chequeo no es paranoia:
// entre la creación y el descarte otro admin pudo haberla elegido para su propia
// acción, y en ese caso el acta ya es parte del libro y no se toca.
//
// Son CINCO los referentes de `Minute`, y la lista tiene que crecer con el
// schema: cada relación nueva que apunte a `minutes` se agrega acá.
//
// Los tres que no son movimientos ni libros son fáciles de pasar por alto,
// porque un acta que sólo respalda a uno de ellos tiene cero movimientos y cero
// libros: "parece" sin usar. Y los tres son `onDelete: SetNull`, así que el
// borrado NO falla por clave foránea — deja al referente sin constancia en
// actas, en silencio, que es la peor forma de perderla:
//
//   - `Application.minuteId` (M3): el acta de un RECHAZO no asienta ningún
//     movimiento (Art. 5 inc. 7). Secuencia real: A crea el acta N en un asiento
//     masivo, B la elige desde un desplegable ya renderizado para rechazar una
//     solicitud, el lote de A falla y la compensación de A se lleva puesta la
//     constancia de B.
//   - `ReregistrationProcess.closeMinuteId` (M6): es el acta que documenta el
//     CIERRE del Libro N° 1 ante la IGJ, el documento más importante del módulo.
//     (`callMinuteId`, la convocatoria, es obligatoria: ahí la base sí rechaza el
//     borrado, pero el resultado es un acta fantasma más un error técnico en
//     medio de una acción societaria. Las dos se chequean en la misma consulta.)
//   - `FeeValue.minuteId` (M4): la constancia de la decisión de la Comisión que
//     fijó el valor de cuota vigente (REG-34).
//
// Una consulta por referente y en orden de probabilidad, cortando en la primera
// que dé positivo: el camino frecuente —el acta recién creada que efectivamente
// no usa nadie— paga las cinco, y son cinco `COUNT` por índice sobre un camino
// de compensación que ya viene de un error.
export async function discardUnusedMinute(
  db: Pick<PrismaClient, "minute" | "movement" | "book" | "application" | "reregistrationProcess" | "feeValue">,
  minuteId: number,
): Promise<void> {
  try {
    if (await db.movement.count({ where: { minuteId } })) return;
    const books = await db.book.count({
      where: { OR: [{ openingMinuteId: minuteId }, { closingMinuteId: minuteId }] },
    });
    if (books) return;
    if (await db.application.count({ where: { minuteId } })) return;
    const processes = await db.reregistrationProcess.count({
      where: { OR: [{ callMinuteId: minuteId }, { closeMinuteId: minuteId }] },
    });
    if (processes) return;
    if (await db.feeValue.count({ where: { minuteId } })) return;
    await db.minute.delete({ where: { id: minuteId } });
  } catch (err) {
    // El error real que ve el usuario es el de la acción que falló; que el
    // descarte no salga no puede taparlo ni romper la respuesta.
    console.error("[minutes] no se pudo descartar el acta sin uso", minuteId, err);
  }
}
