"use server";
// Alta manual de socio. Mismo criterio que las acciones sobre socio existente
// (ver el comentario largo en ../[id]/actions.ts): validamos lo que se puede
// ANTES de crear el acta de admisión, y si el servicio falla igual descartamos
// el acta recién creada para no dejarla huérfana en el libro.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { memberService, requireOpenBook } from "@/lib/members/service";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";

const CATEGORIES = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"] as const;

const schema = z.object({
  fullName: z.string().min(3, "Ingresá apellido y nombre"),
  category: z.enum(CATEGORIES, { error: "Elegí la categoría del socio." }),
  dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números, sin puntos)").optional(),
  email: z.email("Email inválido").optional(),
});

type State = { error?: string };

export async function admitAction(_prev: State, formData: FormData): Promise<State> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sesión inválida." };
  const actorId = Number(session.user.id);

  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // El acta va por su propio schema: minuteSelectionSchema es un z.union y
  // parseForm solo detecta campos opcionales sobre un ZodObject con `.shape`.
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }

  // Pre-validación, antes de tocar el acta. `requireOpenBook` es la misma
  // función que corre el servicio: reusarla evita duplicar los mensajes.
  try {
    await requireOpenBook(prisma);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error inesperado." };
  }
  if (parsed.data.dni) {
    const taken = await prisma.member.findUnique({ where: { dni: parsed.data.dni }, select: { id: true } });
    if (taken) return { error: "Ya existe un socio con ese DNI." };
  }

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error inesperado." };
  }

  let memberId: number;
  try {
    const member = await memberService.admit({ ...parsed.data, minuteId, actorId });
    memberId = member.id;
  } catch (e) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    // El DNI puede haberse tomado entre la pre-validación y el alta.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: "Ya existe un socio con ese DNI." };
    }
    return { error: e instanceof Error ? e.message : "Error inesperado." };
  }

  // `admit` devuelve el socio, no la membresía: el número de socio que le tocó
  // hay que volver a consultarlo. Va a la auditoría porque el N° del libro es lo
  // que identifica al socio en el papel.
  const membership = await prisma.membership.findFirst({
    where: { memberId }, orderBy: { bookId: "desc" }, select: { memberNumber: true },
  });
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actorId, action: "member_admit", entity: "member", entityId: memberId,
    // Sin datos personales: el DNI no va a la auditoría (Ley 25.326).
    detail: { memberNumber: membership?.memberNumber, category: parsed.data.category, minuteId },
    ip,
  });

  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/socios/${memberId}`);
}
