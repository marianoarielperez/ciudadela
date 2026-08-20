"use server";
// Canje del enlace de verificación. Es una ruta PÚBLICA y ANÓNIMA: no hay
// `requireAdmin` ni sesión que mirar, la única credencial es el token del correo.
//
// El canje de una FICHA vive entero en `@/lib/members/access` (una transacción
// con el consume, la revalidación del estado del socio y la escritura adentro).
// El de una SOLICITUD se arma acá —es de esta ruta y de ninguna otra— pero con
// la misma doctrina: una sola transacción, el estado revalidado adentro, y la
// escritura sobre la ficha delegada en la pieza compartida de `access`
// (`applyEmailVerification`), para que las dos puntas escriban lo mismo.
// De la action siguen siendo suyas la IP (limitador y auditoría) y el redirect.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LIVE_APPLICATION_STATUSES, makeApplicationService } from "@/lib/applications/service";
import { audit } from "@/lib/audit";
import { publicTokenLimiter } from "@/lib/auth/rate-limiter";
import { applyEmailVerification, canRedeem, memberAccess } from "@/lib/members/access";
import { prisma } from "@/lib/prisma";
import { makeTokens, tokens } from "@/lib/tokens";

// `verified` sólo aparece en la rama de SOLICITUD: el canje de ficha termina en
// un `redirect` y nunca vuelve con estado. Sus dos valores son dos verdades
// distintas y por eso no es un booleano: `pending` es la solicitud viva (falta
// el asiento de la Comisión Directiva, y con él la invitación al portal) y
// `closed` es la que ya no espera nada (rechazada, vencida, o una asentada a la
// que este enlace ya no puede alcanzar). La tercera situación —la solicitud
// asentada que SÍ alcanzamos— no vuelve con estado: termina en el mismo
// `redirect` que el canje de ficha.
export type VerifyState = { error?: string; verified?: "pending" | "closed" };

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint), y una constante rompe el build.
const TOO_MANY = "Demasiados intentos desde tu conexión. Probá de nuevo en un rato.";
const DEAD_LINK = "El enlace ya fue usado o venció.";

async function clientIp(): Promise<string> {
  // Sólo X-Real-IP, como el login y el modo carga: el resto de las cabeceras de
  // IP las puede fijar el cliente si le pega directo al origen, y rotándolas se
  // regalaría un presupuesto nuevo del limitador en cada intento.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

export async function confirmEmailAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const raw = String(formData.get("token") ?? "");
  const ip = await clientIp();
  if (!publicTokenLimiter.check(ip)) return { error: TOO_MANY };

  // ── Rama de SOLICITUD (M3) ────────────────────────────────────────────────
  // El mismo `purpose` (`email_verification`) tiene dos dueños posibles: una
  // ficha (`memberId`, circuito del M1) o una solicitud del wizard
  // (`applicationId`), que se emite cuando todavía no hay ni ficha ni cuenta.
  // El `peek` sólo decide de quién es el token; el `consume` —que es lo que
  // quema el enlace— sigue ocurriendo únicamente acá, en el POST.
  const peeked = await tokens.peek(raw, "email_verification");
  if (peeked?.applicationId) {
    const now = new Date();
    // Todo el canje en UNA transacción, igual que el de la ficha (ver la
    // cabecera de `@/lib/members/access`). Partido en dos —`consume` commiteado
    // y después el UPDATE— un fallo en el medio dejaba el enlace quemado y
    // `emailVerifiedAt` en null para siempre: el token de verificación de una
    // solicitud se emite una sola vez y no hay reenvío que lo repare.
    const outcome = await prisma.$transaction(async (tx) => {
      // Dos clicks (o el reintento del cliente de correo) no verifican dos
      // veces: el UPDATE condicional de `consume` lo gana exactamente uno, y
      // `verifyEmail` es idempotente por su propio `WHERE email_verified_at IS NULL`.
      const consumed = await makeTokens(tx).consume(raw, "email_verification", now);
      if (!consumed?.applicationId) return null;

      const application = await tx.application.findUnique({
        where: { id: consumed.applicationId },
        // Como `REDEEM_CARD_SELECT`: sólo lo que hace falta para decidir. Nunca
        // el nombre ni el DNI — esta es una ruta anónima.
        select: { id: true, status: true, email: true, memberId: true },
      });
      if (!application) return null;

      await makeApplicationService(tx).verifyEmail(application.id, now);
      const closed = { applicationId: application.id, member: null, live: false as const };

      // ── Solicitud VIVA ──────────────────────────────────────────────────
      // Todavía no hay ficha (o la hay, de un reingreso, pero el asiento no
      // ocurrió): la invitación al portal sale cuando la Comisión Directiva
      // asiente el alta. Marcar la solicitud es todo lo que corresponde.
      if (LIVE_APPLICATION_STATUSES.includes(application.status)) {
        return { ...closed, live: true as const };
      }

      // ── Solicitud ya ASENTADA ───────────────────────────────────────────
      // El caso que este bloque existe para cerrar: el vecino no hizo clic en
      // el correo, completó el wizard, la CD asentó el alta —la ficha nace con
      // la dirección `declared`, así que el asiento NO le mandó la invitación—
      // y recién entonces abre el enlace. Sin propagar, la verificación moría
      // en la solicitud y el socio quedaba sin acceso al portal hasta que
      // alguien lo notara a mano: no hay un segundo asiento que lo dispare.
      if (application.status !== "completed" || application.memberId === null) return closed;

      const member = await tx.member.findUnique({ where: { id: application.memberId } });
      if (!member) return closed;
      // Dos guardas antes de escribir sobre la ficha:
      //  - La baja cierra el canje, igual que en el circuito de socios.
      //  - Y la dirección tiene que seguir siendo la misma: si un admin le
      //    cambió el email a la ficha, este enlace —que autorizaba la casilla
      //    vieja— ya no autoriza nada sobre la nueva. Es la misma invariante
      //    que `revokeStaleMemberTokens` sostiene del lado de las fichas, que
      //    no alcanza a un token colgado de la solicitud.
      if (!canRedeem(member).ok) return closed;
      const sameAddress = member.email?.toLowerCase().trim() === application.email.toLowerCase().trim();
      if (!sameAddress) return closed;

      // Misma escritura, exactamente, que el canje de un token de ficha.
      return { ...closed, member: await applyEmailVerification(tx, member, now) };
    });

    if (!outcome) return { error: DEAD_LINK };
    // Sin `userId` ni `detail`: la persona no tiene sesión y la solicitud ya
    // queda identificada por su id. Ni el email ni el token van al log
    // (docs/08, Ley 25.326).
    await audit({
      action: "application_email_verified", entity: "application",
      entityId: outcome.applicationId, ip,
    });

    if (outcome.member) {
      // La verificación llegó a la ficha: es el mismo hecho que asienta el
      // canje del token de socio, y se audita con el mismo nombre.
      await audit({ action: "member_email_verified", entity: "member", entityId: outcome.member.memberId, ip });
      // Y termina donde termina el circuito de socios: en la creación de la
      // contraseña (o en el login, si la ficha ya tenía cuenta). La persona
      // acaba de demostrar que tiene el buzón, así que no hace falta un correo
      // más; si pierde la pantalla, el panel puede reenviarle la invitación
      // sola (`verificationTarget` ya la habilita: ficha verificada y sin cuenta).
      redirect(outcome.member.invite ? `/acceso/${outcome.member.invite}` : "/ingresar");
    }

    return { verified: outcome.live ? "pending" : "closed" };
  }

  // ── Rama de FICHA (M1, sin cambios) ───────────────────────────────────────
  // El `consume` ocurre acá adentro y NUNCA en el GET de la página: los
  // escáneres de enlaces de los clientes de correo abren la URL, y con una
  // página que consumiera, el token moriría antes de que la persona haga clic.
  const res = await memberAccess.verifyEmail(raw);
  if (!res.ok) return { error: res.error };

  // Sin `userId`: la persona todavía no tiene sesión. El asiento identifica al
  // socio por `entityId`; no van ni el email ni el token al log (Ley 25.326).
  await audit({ action: "member_email_verified", entity: "member", entityId: res.memberId, ip });

  // Fuera de cualquier try: `redirect` señaliza con una excepción.
  redirect(res.invite ? `/acceso/${res.invite}` : "/ingresar");
}
