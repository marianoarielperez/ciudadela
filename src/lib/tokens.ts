// Single-use action tokens (email verification, password invitation/reset).
// Only the sha256 hash is stored; the raw token travels once, inside the email link.
//
// ── REGLA DEL PROYECTO: cuándo se revoca AL EMITIR ────────────────────────────
//
//   Revocar al emitir sólo donde quien emite ya está autenticado o ya demostró
//   tener el buzón.
//
// Los dos circuitos de este archivo se ven distintos y NO son dos reglas
// contradictorias: son dos consecuencias de esa única regla.
//
// - Enlaces de FICHA (`revokeForMember`, verificación e invitación): se emiten
//   desde `sendVerificationAction` —detrás de `requireAdmin` y de dos
//   limitadores— y desde `memberAccess.verifyEmail`, que la dispara quien acaba
//   de canjear un token que sólo estaba en ese buzón. Un tercero anónimo no
//   puede provocar la emisión, así que revocar ahí no es un arma y sí evita que
//   "no me llegó" deje varios enlaces de 7 días vivos en paralelo.
//
// - Enlace de RECUPERO (`revokeForUser`): se emite desde un formulario público y
//   anónimo (`/ingresar/recuperar`, sin captcha hasta M3). Ahí revocar al emitir
//   sí es un arma: cualquiera que conozca la dirección le mata al socio el
//   enlace que ya tiene en el buzón. Por eso NO se revoca al emitir y la
//   invariante "un solo enlace vivo" se sostiene un paso más adelante, en el
//   CANJE (`passwordReset.reset` → `revokeForUser`): el primero que se usa
//   cierra la puerta de los que sigan vivos.
//
// El costo de esa diferencia está acotado por el TTL: 7 días los de ficha,
// 30 minutos los de recupero.
import { createHash, randomBytes } from "node:crypto";
import type { ActionToken, PrismaClient, TokenPurpose } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const TOKEN_TTL: Record<TokenPurpose, number> = {
  email_verification: 7 * 24 * 60 * 60 * 1000,
  password_invitation: 7 * 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
};

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type TokenDb = Pick<PrismaClient, "actionToken">;

export function makeTokens(db: TokenDb) {
  async function find(raw: string, purpose: TokenPurpose, now: Date): Promise<ActionToken | null> {
    const t = await db.actionToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!t || t.purpose !== purpose || t.usedAt !== null || t.expiresAt < now) return null;
    return t;
  }
  return {
    async issue(input: { purpose: TokenPurpose; memberId?: number; userId?: number; now?: Date }): Promise<string> {
      const raw = randomBytes(32).toString("base64url");
      const now = input.now ?? new Date();
      await db.actionToken.create({
        data: {
          purpose: input.purpose,
          tokenHash: hashToken(raw),
          memberId: input.memberId ?? null,
          userId: input.userId ?? null,
          expiresAt: new Date(now.getTime() + TOKEN_TTL[input.purpose]),
        },
      });
      return raw;
    },
    // `peek` valida sin consumir: las páginas que renderizan un formulario con GET
    // tienen que usarla, porque los escáneres de links de los clientes de correo
    // abren la URL y consumirían el token antes de que la persona haga clic.
    peek(raw: string, purpose: TokenPurpose, now = new Date()): Promise<ActionToken | null> {
      return find(raw, purpose, now);
    },
    // Un token vive atado al `memberId`, NO a la dirección a la que se mandó. Si
    // el email del socio cambia (o se borra), los enlaces ya emitidos seguirían
    // sirviendo para verificar —y para crear la contraseña de— una cuenta cuyo
    // domicilio electrónico ahora es otro: con un dedazo en la dirección, quien
    // tenga el buzón viejo se queda con la cuenta. Por eso el cambio de email
    // revoca.
    //
    // Acá SÍ se revoca también al emitir (un envío nuevo invalida el anterior),
    // y eso no contradice al recupero: es la regla del encabezado de este
    // archivo aplicada a un circuito donde quien emite ya está autenticado
    // (`sendVerificationAction`, detrás de `requireAdmin`) o ya demostró tener el
    // buzón (`memberAccess.verifyEmail`). Que valga acá y no allá es una
    // consecuencia de la regla, no una excepción a ella.
    //
    // Sólo se borran los NO usados: los consumidos son rastro.
    async revokeForMember(memberId: number, purposes: TokenPurpose[]): Promise<number> {
      if (purposes.length === 0) return 0;
      const { count } = await db.actionToken.deleteMany({
        where: { memberId, purpose: { in: purposes }, usedAt: null },
      });
      return count;
    },
    // La misma idea que `revokeForMember` pero por CUENTA: el recupero de
    // contraseña no cuelga de la ficha sino del `userId` (lo pide el titular de
    // la casilla de la cuenta y existe también para las cuentas de gestión, que
    // no tienen ficha), así que `revokeForMember` no lo alcanza.
    //
    // Ojo con dónde se llama: NO se usa al emitir. El recupero se pide desde un
    // formulario público y anónimo, o sea del lado de la regla del encabezado
    // donde revocar al emitir es un arma: cualquiera que conozca la dirección le
    // mataría al socio el enlace que ya recibió (ver también el comentario de
    // `auth/password-reset.ts:request`). Los dos usos legítimos son posteriores
    // al hecho: el canje exitoso —que cierra los enlaces paralelos que quedaran
    // vivos, y es donde vive la invariante "un solo enlace vivo" de este
    // circuito— y el cambio de la dirección de la cuenta desde el panel, que le
    // saca autorización a todo enlace emitido hacia la casilla anterior
    // (`members/write.ts`).
    // Sólo borra los NO usados: los consumidos quedan como rastro.
    async revokeForUser(userId: number, purposes: TokenPurpose[]): Promise<number> {
      if (purposes.length === 0) return 0;
      const { count } = await db.actionToken.deleteMany({
        where: { userId, purpose: { in: purposes }, usedAt: null },
      });
      return count;
    },
    // Un token de un solo uso tiene que consumirse una sola vez incluso con dos POST
    // simultáneos (doble clic, reintento del cliente de correo). Leer y después
    // escribir deja una ventana en la que los dos pasan la validación y los dos
    // proceden. La marca de uso va con un UPDATE condicional: la condición
    // `usedAt: null` la evalúa la base, así que gana exactamente uno y el otro ve
    // cero filas afectadas. La firma no cambia: el segundo recibe null, igual que
    // si el token ya estuviera usado.
    async consume(raw: string, purpose: TokenPurpose, now = new Date()): Promise<ActionToken | null> {
      const t = await find(raw, purpose, now);
      if (!t) return null;
      const { count } = await db.actionToken.updateMany({
        where: { id: t.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count !== 1) return null;
      return { ...t, usedAt: now };
    },
  };
}

export const tokens = makeTokens(prisma);

/** Los dos enlaces que la vecinal le manda a la ficha del socio. Es a la vez un
 *  `TokenPurpose` y un `NotificationType`, y el panel elige entre los dos según
 *  en qué punto del circuito quedó el socio (ver `verificationTarget`). */
export type MemberEmailTokenPurpose = "email_verification" | "password_invitation";

/** Los propósitos que viajan al email del socio: son los que hay que revocar
 *  cuando esa dirección deja de ser la suya (`password_reset` va atado al
 *  `userId` y al email de la cuenta, no a la ficha). */
export const MEMBER_EMAIL_TOKEN_PURPOSES: TokenPurpose[] = ["email_verification", "password_invitation"];
