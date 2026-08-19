"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { civilDateUtc } from "@/lib/dates";

const schema = z.object({
  type: z.enum(["board", "assembly"], { error: "Elegí el tipo de acta." }),
  number: z.coerce.number().int().positive("Número de acta inválido"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  description: z.string().max(500).optional(),
});

export async function createMinuteAction(
  _prev: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sesión inválida." };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { type, number, date, description } = parsed.data;
  const [y, m, d] = date.split("-").map(Number);
  // Solo X-Real-IP, como en el login: el resto de las cabeceras de IP las puede
  // fijar el cliente si le pega directo al origen.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  const userId = Number(session.user.id);
  try {
    const minute = await prisma.minute.create({
      data: { type, number, date: civilDateUtc(y, m, d), description: description ?? null, createdById: userId },
    });
    await audit({ userId, action: "minute_create", entity: "minute", entityId: minute.id, detail: { type, number }, ip });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: `Ya existe el acta N° ${number} de ese tipo.` };
    }
    throw e;
  }
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect("/admin/actas");
}
