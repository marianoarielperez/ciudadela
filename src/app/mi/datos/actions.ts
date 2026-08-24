"use server";
// Edición de los datos PROPIOS del socio (spec M5 §8). Tres invariantes:
//  - El memberId sale de requireMember(), nunca del formulario.
//  - El suspendido no edita (REG-20): requireMember() SIN allowSuspended.
//  - La lista blanca de campos vive en @/lib/members/self-edit; la escritura
//    pasa por memberWriter.updateMember, que arrastra las invariantes de
//    tokens y de la cuenta de acceso.
// Auditoría (Ley 25.326): nombres de campo y flags, nunca los valores.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { memberEditLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import {
  type AccountEmailNoticeOutcome,
  accountEmailNotice,
} from "@/lib/members/account-email-notice";
import {
  buildSelfAddressPatch,
  selfAddressSchema,
  selfContactSchema,
  selfEmailSchema,
} from "@/lib/members/self-edit";
import { MemberWriteError, memberWriter, sameAddress } from "@/lib/members/write";
import { prisma } from "@/lib/prisma";

export type SelfEditState = { error?: string; done?: boolean; message?: string; warning?: string };

const RATE_MSG = "Demasiados cambios seguidos. Esperá un minuto y volvé a probar.";
// La ruta del panel de datos: las tres actions revalidan acá después de
// escribir, así que el servidor deja de servir la ficha vieja debajo del
// cartel de éxito (la fila de email, el aviso de domicilio pendiente).
const DATOS_PATH = "/mi/datos";

async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Del error sólo se conserva el código, nunca el objeto: los errores de Prisma
// y de nodemailer traen la consulta y el sobre SMTP, o sea datos del socio en
// claro (Ley 25.326). Mismo criterio que `carga/[numero]/actions.ts`.
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
}

async function auditSelf(
  userId: number,
  memberId: number,
  fields: string[],
  extra?: Record<string, unknown>,
) {
  await audit({
    userId,
    action: "member_self_update",
    entity: "member",
    entityId: memberId,
    detail: { fields, ...extra },
    ip: await clientIp(),
  });
}

export async function updateContactAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfContactSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  await memberWriter.updateMember(actor.memberId, { phone: parsed.data.phone?.trim() || null });
  await auditSelf(actor.userId, actor.memberId, ["phone"]);
  revalidatePath(DATOS_PATH);
  return { done: true, message: "Teléfono guardado." };
}

export async function updateAddressAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfAddressSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const patch = buildSelfAddressPatch(parsed.data);
  if (patch.streetId !== null) {
    // El id viaja oculto desde el autocompletado, pero una action es un
    // endpoint: un id fuera del catálogo no se escribe.
    const street = await prisma.street.findUnique({
      where: { id: patch.streetId },
      select: { id: true },
    });
    if (!street) return { error: "Elegí una calle del catálogo o escribila como texto." };
  }
  await memberWriter.updateMember(actor.memberId, patch);
  await auditSelf(actor.userId, actor.memberId, ["street", "streetNumber", "neighborhood"], {
    addressPendingReview: true,
  });
  revalidatePath(DATOS_PATH);
  return {
    done: true,
    message: "Domicilio guardado. La Comisión va a constatar el cambio (queda anotado en tu ficha).",
  };
}

export async function changeEmailAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfEmailSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const email = parsed.data.email.toLowerCase().trim();

  const before = await prisma.member.findUniqueOrThrow({
    where: { id: actor.memberId },
    select: { email: true },
  });
  if (sameAddress(before.email, email)) return { error: "Ese ya es tu email actual." };

  // memberWriter arrastra las invariantes: revoca los enlaces viejos y le lleva
  // la dirección a la cuenta de acceso (User.email) en la misma transacción.
  let result;
  try {
    result = await memberWriter.updateMember(actor.memberId, {
      email,
      emailStatus: "declared", // REG-08: toda dirección nueva se re-verifica
      emailVerifiedAt: null,
    });
  } catch (e) {
    if (e instanceof MemberWriteError) {
      // El texto de write.ts habla en voz de operador; acá se traduce a voz de
      // vecino sin revelar de quién es la otra cuenta (criterio de access.ts).
      return {
        error:
          e.reason === "email_conflict"
            ? "Ese email ya está en uso en el sistema. Escribí otra dirección o consultá en la sede."
            : "No se pudo guardar el email. Consultá en la sede.",
      };
    }
    throw e;
  }

  // El asiento de la edición va INMEDIATAMENTE después del commit, ANTES de
  // intentar ningún aviso (mismo criterio que `carga/[numero]/actions.ts`): si
  // el `announce` que sigue —o el `findUniqueOrThrow` que lo precede— revienta,
  // el email YA se mudó (incluida la identidad de acceso en `User.email`) y no
  // puede quedar un hecho de seguridad sin rastro.
  await auditSelf(actor.userId, actor.memberId, ["email"], {
    accountEmailUpdated: result.accountEmailUpdated,
  });
  revalidatePath(DATOS_PATH);

  // Post-commit: el aviso a la casilla anterior + la verificación a la nueva.
  // announce() decide solo, con los mismos cupos que el botón del panel admin.
  //
  // Todo esto va en `try`: una excepción acá —del `findUniqueOrThrow` o de
  // `announce`, que ya degrada adentro lo que puede pero no puede prometer que
  // nada se le escape— no puede convertir un guardado exitoso en la pantalla de
  // error genérica de Next sobre un cambio que ya commiteó. El socio tiene que
  // salir viendo que su email SE GUARDÓ, con la advertencia que corresponda. Se
  // asume lo peor —ningún correo salió— para que la advertencia no prometa una
  // verificación que en realidad no se mandó.
  let warning: string | undefined;
  if (result.accountEmailMove) {
    let outcome: AccountEmailNoticeOutcome;
    let noticeCrashed = false;
    try {
      const fresh = await prisma.member.findUniqueOrThrow({
        where: { id: actor.memberId },
        select: { id: true, status: true, email: true, emailStatus: true, userId: true },
      });
      outcome = await accountEmailNotice.announce({
        member: fresh,
        previousEmail: result.accountEmailMove.from,
        actorId: actor.userId,
      });
    } catch (e) {
      noticeCrashed = true;
      const code = codeOf(e);
      console.error(
        "[mi/datos] falló el aviso de la mudanza de la dirección de ingreso del socio",
        actor.memberId,
        "code:",
        code,
      );
      outcome = {
        previousNotified: false,
        verificationSent: false,
        throttled: false,
        failures: [
          { target: "previous", code },
          { target: "current", code },
        ],
      };
    }
    // Voz de socio, no la del operador: `accountEmailNoticeWarning` (la que usa
    // el panel admin) está escrita en segunda persona hacia QUIEN EDITA a otro
    // ("avisale al socio"), y acá el que edita es el propio socio. Y sólo
    // importa si la verificación llegó: que el aviso a la casilla VIEJA no haya
    // salido no es información que el socio necesite —la mudanza la pidió él
    // mismo—, a diferencia del operador que edita en nombre de otro.
    if (!outcome.verificationSent) {
      warning = outcome.throttled
        ? "El cambio se guardó, pero ya te mandamos varios correos en la última hora: la verificación te va a llegar cuando la pidas de nuevo más tarde."
        : "El cambio se guardó, pero no pudimos mandarte el correo de verificación. Probá más tarde o consultá en la sede.";
    }

    // Asiento propio del hecho, separado de la edición: mover la identidad de
    // acceso de un socio es lo que hay que poder reconstruir después, y ahora
    // también con qué se le avisó. Mismos nombres de campo que usa la action
    // del admin (`member_login_email_moved`) para el mismo hecho; nunca una
    // dirección (Ley 25.326). Distingue "los correos no salieron" de "el aviso
    // entero se cayó": en el segundo caso las banderas de arriba son una
    // suposición conservadora, no una observación.
    const noticeDetail: Record<string, unknown> = {
      notifiedPrevious: outcome.previousNotified,
      verificationSent: outcome.verificationSent,
    };
    if (outcome.throttled) noticeDetail.throttled = true;
    if (outcome.failures.length > 0) noticeDetail.failures = outcome.failures;
    if (noticeCrashed) noticeDetail.crashed = true;
    await audit({
      userId: actor.userId,
      action: "member_self_login_email_moved",
      entity: "member",
      entityId: actor.memberId,
      detail: noticeDetail,
      ip: await clientIp(),
    });
  }
  return {
    done: true,
    message:
      "Email guardado. A partir de ahora ingresás con la dirección nueva; te mandamos un correo para verificarla.",
    warning,
  };
}
