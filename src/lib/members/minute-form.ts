// Shared "pick or create a Minute" used by every statutory action form.
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { parseMinuteDate } from "@/lib/members/minute-date";

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
export async function discardUnusedMinute(
  db: Pick<PrismaClient, "minute" | "movement" | "book">,
  minuteId: number,
): Promise<void> {
  try {
    if (await db.movement.count({ where: { minuteId } })) return;
    const books = await db.book.count({
      where: { OR: [{ openingMinuteId: minuteId }, { closingMinuteId: minuteId }] },
    });
    if (books) return;
    await db.minute.delete({ where: { id: minuteId } });
  } catch (err) {
    // El error real que ve el usuario es el de la acción que falló; que el
    // descarte no salga no puede taparlo ni romper la respuesta.
    console.error("[minutes] no se pudo descartar el acta sin uso", minuteId, err);
  }
}
