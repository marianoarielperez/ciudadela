// Lógica pura del modo carga (pasar la ficha de papel a la base).
//
// Vive acá y no en la server action para que se pueda testear sin base ni
// sesión: lo que esta pantalla escribe es el único camino de edición del padrón
// que no pasa por un acta, así que las invariantes tienen que estar asertadas.
//
// La invariante central es la LISTA BLANCA `Patch`: `joinedAt`, `status`,
// `category`, `withdrawalReason` y el número de socio (`Membership`) sólo
// cambian por un asiento con acta. `joinedAt` define la antigüedad estatutaria
// (voto, elegibilidad), así que dejarlo entrar acá abriría una puerta lateral
// para modificar el libro sin rastro. `buildPatch` construye el objeto campo por
// campo, nunca por spread del parseado.
import { z } from "zod";
import { civilDateUtc } from "@/lib/dates";
import type { EmailStatus, Member } from "@/generated/prisma/client";

export const cardSchema = z.object({
  memberId: z.coerce.number().int().positive("Socio inválido."),
  fullName: z.string().min(3, "Ingresá apellido y nombre"),
  dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (7 a 9 dígitos, sin puntos)").optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de nacimiento inválida").optional(),
  civilStatus: z.string().max(40, "El estado civil no puede superar los 40 caracteres").optional(),
  nationality: z.string().max(60, "La nacionalidad no puede superar los 60 caracteres").optional(),
  occupation: z.string().max(80, "La ocupación no puede superar los 80 caracteres").optional(),
  phone: z.string().max(40, "El teléfono no puede superar los 40 caracteres").optional(),
  streetId: z.coerce.number().int().positive("Calle inválida.").optional(),
  streetText: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  streetNumber: z.string().max(10, "La altura no puede superar los 10 caracteres").optional(),
  neighborhood: z.string().max(60, "El barrio no puede superar los 60 caracteres").optional(),
  email: z.email("Email inválido").max(191, "El email es demasiado largo").optional(),
});

export type CardInput = z.infer<typeof cardSchema>;

// Los datos que esta pantalla puede escribir. Enumerarlos explícitamente es la
// lista blanca: lo que no está acá no se toca aunque venga en el FormData.
export type Patch = {
  fullName: string;
  dni: string | null;
  birthDate: Date | null;
  civilStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  phone: string | null;
  streetId: number | null;
  streetText: string | null;
  streetNumber: string | null;
  neighborhood: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  emailVerifiedAt: Date | null;
};

// Lo que la lógica pura necesita leer del socio guardado.
export type MemberSnapshot = Pick<Member, keyof Patch | "status">;

export type BirthDateResult = { ok: true; value: Date | null } | { ok: false; error: string };

// El regex del schema acepta "1983-02-31" y "0198-01-01": el <input type="date">
// no los produce, pero una action es un endpoint y `civilDateUtc` desbordaría el
// día en silencio.
export function parseBirthDate(raw: string | undefined, now: number = Date.now()): BirthDateResult {
  if (!raw) return { ok: true, value: null };
  const [y, m, day] = raw.split("-").map(Number);
  const value = civilDateUtc(y, m, day);
  const rolled =
    value.getUTCFullYear() !== y || value.getUTCMonth() + 1 !== m || value.getUTCDate() !== day;
  if (rolled) return { ok: false, error: "Fecha de nacimiento inválida." };
  if (y < 1900 || value.getTime() > now) {
    return { ok: false, error: "La fecha de nacimiento tiene que estar entre 1900 y hoy." };
  }
  return { ok: true, value };
}

export function buildPatch(
  member: MemberSnapshot,
  d: CardInput,
  birthDate: Date | null,
): { patch: Patch; emailChanged: boolean } {
  // Comparamos en minúsculas contra lo guardado: varios emails del padrón
  // importado vienen con mayúsculas, y sin esto abrir y guardar una ficha sin
  // tocar el email le bajaría la verificación a "declared" por un cambio que no
  // existió.
  const email = d.email?.toLowerCase() ?? null;
  const emailChanged = email !== (member.email?.toLowerCase() ?? null);
  const streetId = d.streetId ?? null;

  const patch: Patch = {
    fullName: d.fullName,
    dni: d.dni ?? null,
    birthDate,
    civilStatus: d.civilStatus ?? null,
    nationality: d.nationality ?? null,
    occupation: d.occupation ?? null,
    phone: d.phone ?? null,
    streetId,
    // Con calle del catálogo el texto libre sobra: dejar los dos daría un
    // domicilio con dos fuentes de verdad.
    streetText: streetId ? null : d.streetText ?? null,
    streetNumber: d.streetNumber ?? null,
    neighborhood: d.neighborhood ?? null,
    email,
    // Email nuevo o cambiado vuelve a "declared"; borrado → "none"; igual → intacto.
    emailStatus: emailChanged ? (email ? "declared" : "none") : member.emailStatus,
    emailVerifiedAt: emailChanged ? null : member.emailVerifiedAt,
  };
  return { patch, emailChanged };
}

export function changedFields(member: MemberSnapshot, patch: Patch): string[] {
  return (Object.keys(patch) as Array<keyof Patch>).filter((key) => {
    const next = patch[key];
    const prev = member[key];
    if (next instanceof Date || prev instanceof Date) {
      const a = next instanceof Date ? next.getTime() : null;
      const b = prev instanceof Date ? prev.getTime() : null;
      return a !== b;
    }
    return next !== prev;
  });
}

export type VerificationTarget = { ok: true; email: string } | { ok: false; error: string };

// A quién se le puede mandar la verificación + invitación de acceso. El estado
// del socio manda: una baja (por ejemplo por fallecimiento) puede tener email en
// la ficha —muchas veces el del familiar que declaró la baja—, y el correo le
// abriría a esa persona el alta de contraseña del portal. Sólo se invita a quien
// hoy es socio: vigente o suspendido (la suspensión es temporal y no le saca el
// domicilio electrónico), nunca una baja.
export function verificationTarget(
  member: Pick<Member, "status" | "email" | "emailStatus">,
): VerificationTarget {
  if (member.status === "withdrawn") {
    return { ok: false, error: "El socio está dado de baja: no corresponde invitarlo al portal." };
  }
  if (!member.email) {
    return { ok: false, error: "El socio no tiene email cargado. Guardá la ficha primero." };
  }
  if (member.emailStatus === "verified") return { ok: false, error: "El email ya está verificado." };
  return { ok: true, email: member.email };
}
