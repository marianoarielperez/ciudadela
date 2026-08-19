// Shared "pick or create a Minute" used by every statutory action form.
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { civilDateUtc } from "@/lib/dates";

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
  const [y, m, d] = sel.minuteDate.split("-").map(Number);
  try {
    const minute = await db.minute.create({
      data: {
        type: sel.minuteType, number: sel.minuteNumber, date: civilDateUtc(y, m, d),
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
