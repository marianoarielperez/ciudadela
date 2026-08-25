"use server";
// Las cuatro acciones societarias sobre un socio existente. Cada una espeja un
// asiento del libro de actas: siempre hay acta, siempre hay movimiento y siempre
// hay auditoría.
//
// ── El problema del acta huérfana ──────────────────────────────────────────────
// El servicio (Task 8) abre su propia transacción y valida ahí las reglas del
// estatuto. Si acá creáramos el acta primero y el servicio rechazara después, el
// acta quedaría asentada sin ningún movimiento: basura en un libro que la
// asociación presenta ante la IGJ. Y no es un caso raro — el rechazo es
// frecuente (elecciones en curso, socio ya dado de baja, expulsado que quiere
// reingresar).
//
// No se puede meter todo en una sola transacción sin abrir la del servicio y
// romper su encapsulamiento (Prisma no anida `$transaction`), así que la
// resolución es en dos partes:
//
//   1. Pre-validación: cargamos el socio y corremos las MISMAS reglas puras de
//      `rules.ts` que usa el servicio ANTES de tocar el acta. En el camino feliz
//      de los rechazos —que es el frecuente— el acta nunca llega a crearse.
//   2. Compensación: si aun así el servicio falla (carrera contra otro admin,
//      error de datos), `discardUnusedMinute` borra el acta recién creada
//      siempre que no la esté usando nadie.
//
// El servicio sigue revalidando todo: la pre-validación es para el libro y para
// el mensaje, nunca la única defensa.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { civilDateUtc } from "@/lib/dates";
import { electionsOngoing, memberService } from "@/lib/members/service";
import { memberRequests } from "@/lib/members/member-requests/service";
import { notifyRequestDecided } from "@/lib/members/member-requests/notify";
import { withdrawWithDebits, type DebitCancellation } from "@/lib/members/withdraw-with-debits";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import {
  canChangeCategory, canReadmit, canSuspend, canWithdraw, type RuleResult,
} from "@/lib/members/rules";
import type { Member, MemberCategory, WithdrawalReason } from "@/generated/prisma/client";

const CATEGORIES = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"] as const;
const REASONS = [
  "death", "resignation", "arrears", "moved_away", "not_reregistered",
  "expulsion", "duplicate_annulment", "other",
] as const;

// Art. 10 inc. b: la suspensión no puede exceder los 180 días.
const MAX_SUSPENSION_DAYS = 180;
const DAY_MS = 86_400_000;

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint, y el
// formulario cliente declara su propio tipo estructural equivalente.
type State = { error?: string };

type Data = Record<string, unknown>;
type Ctx = { actorId: number; memberId: number; minuteId: number };

function dateFrom(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return civilDateUtc(y, m, d);
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Error inesperado.";
}

// Sólo para los dos logs de `markAccepted`/`notifyRequestDecided` de más abajo:
// el resto de esta action sigue devolviendo `messageOf` a la PANTALLA, que
// necesita prosa. Un log de PM2 no —y `messageOf` de un error de Prisma puede
// traer datos que no corresponde acumular ahí—, mismo criterio que el resto
// del proyecto (`notify.ts`, `webhook-processor.ts`, `receipt-email.ts`, etc).
function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code !== "") return code.slice(0, 200);
  return e instanceof Error ? e.message.slice(0, 200) : "unknown";
}

async function runAction(
  formData: FormData,
  extraSchema: z.ZodRawShape,
  opts: {
    // Corre antes de crear el acta. Devuelve el mismo `RuleResult` que rules.ts.
    guard: (member: Member, data: Data) => RuleResult | Promise<RuleResult>;
    run: (ctx: Ctx, member: Member, data: Data) => Promise<unknown>;
    auditAction: string;
    // Puede ser async: el reingreso necesita CONTAR las cuotas pendientes vivas
    // para el asiento, y esa cuenta es una lectura a la base.
    detail?: (member: Member, data: Data) => Record<string, unknown> | Promise<Record<string, unknown>>;
    /** Lo que `detail` no puede ver: el RESULTADO de `run`. Se fusiona sobre el
     *  `detail`. Lo usa la baja para asentar qué débitos se cancelaron y cuáles
     *  quedaron abiertos — sin los ids, el asiento diría que algo falló sin
     *  decir qué reintentar. */
    detailFromResult?: (result: unknown) => Record<string, unknown>;
    /** Querystring del redirect final, derivado de lo que devolvió `run`. Lo usa
     *  la baja: si Mercado Pago no aceptó cancelar el débito, la ficha tiene que
     *  decirlo — la baja salió igual y el cobro sigue vivo. */
    redirectQuery?: (result: unknown) => string;
  },
): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const actorId = actor.actorId;

  const base = z.object({ memberId: z.coerce.number().int().positive(), ...extraSchema });
  const parsed = parseForm(base, formData);
  if (!parsed.ok) return { error: parsed.error };
  const data = parsed.data as Data;
  const memberId = data.memberId as number;

  // El acta se parsea aparte y NUNCA se combina con `base`: minuteSelectionSchema
  // es un `z.union` y parseForm solo sabe reconocer campos opcionales sobre un
  // ZodObject con `.shape`. Fusionarlos deja a los campos requeridos del acta sin
  // su mensaje en castellano y saca a la pantalla el texto genérico de zod.
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }

  // Sin esto, un id de socio inexistente llega al `findUniqueOrThrow` del
  // servicio y explota como error técnico de Prisma, en inglés.
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return { error: "El socio no existe." };

  const check = await opts.guard(member, data);
  if (!check.ok) return { error: check.error };

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actorId);
  } catch (e) {
    return { error: messageOf(e) };
  }

  let result: unknown;
  try {
    result = await opts.run({ actorId, memberId, minuteId }, member, data);
  } catch (e) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: messageOf(e) };
  }

  // La auditoría con IP la escribe la action, no el servicio: es la única capa
  // que ve las cabeceras. Solo X-Real-IP, como en el login — el resto de las
  // cabeceras de IP las puede fijar el cliente si le pega directo al origen.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actorId, action: opts.auditAction, entity: "member", entityId: memberId,
    detail: {
      minuteId,
      ...(opts.detail ? await opts.detail(member, data) : {}),
      ...(opts.detailFromResult ? opts.detailFromResult(result) : {}),
    },
    ip,
  });

  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/socios/${memberId}${opts.redirectQuery?.(result) ?? ""}`);
}

export async function withdrawAction(_p: State, formData: FormData): Promise<State> {
  return runAction(
    formData,
    {
      reason: z.enum(REASONS, { error: "Elegí el motivo de la baja." }),
      detail: z.string().max(300, "El detalle no puede superar los 300 caracteres").optional(),
      // M5B Task 9: opcional y sólo lo manda el camino "Aplicar" de la bandeja
      // de solicitudes (hidden field precargado por `[accion]/page.tsx`). Un
      // operador que entra por el camino de siempre nunca lo manda, así que
      // `data.requestId` queda `undefined` y el comportamiento es idéntico al
      // de hoy.
      requestId: z.coerce.number().int().positive().optional(),
    },
    {
      guard: async (member, data) => {
        const status = canWithdraw(member);
        if (!status.ok) return status;
        if (data.requestId) {
          const req = await prisma.memberRequest.findUnique({ where: { id: data.requestId as number } });
          if (!req || req.status !== "pending" || req.memberId !== member.id || req.type !== "withdrawal") {
            return { ok: false, error: "La solicitud no corresponde a esta operación. Volvé a la bandeja." };
          }
          // Revisión de Task 9: el `<select>` de motivo viene precargado en
          // "renuncia" pero no FIJO, así que un operador podía cambiarlo a
          // expulsión o cesantía por mora y enviar igual. Eso asentaba la baja
          // con otro motivo —expulsión además prende `reentryBlocked` de por
          // vida— mientras la solicitud quedaba `accepted` y el correo le decía
          // al socio que se le concedió justo lo que pidió: el Libro decía una
          // cosa y el aviso otra. La solicitud del socio SIEMPRE es por
          // renuncia (es la única causal que `/mi/solicitudes` ofrece), así que
          // cualquier otro motivo con `requestId` puesto es una falsificación,
          // no una decisión legítima de la Comisión sobre ESA solicitud.
          if (data.reason !== "resignation") {
            return {
              ok: false,
              error: "La solicitud es de baja por renuncia: para asentar otro motivo, rechazá la solicitud y hacé la baja aparte.",
            };
          }
        }
        return { ok: true };
      },
      // `withdrawWithDebits` y no `memberService.withdraw`: dejar de ser socio
      // tiene que cortar el débito automático por el camino que sea (REG-16 no
      // devenga más, así que un débito vivo le cobra a alguien que ya no es
      // socio). La cancelación corre DESPUÉS del commit.
      run: async ({ memberId, minuteId, actorId }, _member, data) => {
        const result = await withdrawWithDebits.withdraw({
          memberId, minuteId, actorId,
          reason: data.reason as WithdrawalReason,
          detail: data.detail as string | undefined,
        });
        // La baja YA commiteó: lo que sigue es piggyback sobre un acto que ya
        // pasó, y por eso NADA de esto puede tumbar el redirect de éxito. Las
        // dos llamadas van en el MISMO try: `notifyRequestDecided` ya es
        // best-effort por dentro (nunca tira hoy), pero dejarla afuera del try
        // la acopla a que eso siga siendo cierto para siempre — si algún día
        // dejara escapar un error, `runAction` lo cazaría, llamaría a
        // `discardUnusedMinute` y mostraría pantalla de error por una baja que
        // ya commiteó (mismo corolario que el PDF del recibo, CLAUDE.md).
        if (data.requestId) {
          const requestId = data.requestId as number;
          try {
            await memberRequests.markAccepted({ requestId, memberId, decidedById: actorId, type: "withdrawal" });
            await notifyRequestDecided({ memberId, type: "withdrawal", accepted: true });
          } catch (e) {
            console.error("[solicitudes] markAccepted o el aviso al socio fallaron después de la baja —", {
              requestId, memberId, error: codeOf(e),
            });
          }
        }
        return result;
      },
      auditAction: "member_withdraw",
      detail: (_m, data) => ({
        reason: data.reason,
        ...(data.requestId ? { requestId: data.requestId } : {}),
      }),
      // Los preapprovalIds SÍ van al asiento: `cancelFailed: true` sin decir QUÉ
      // cancelar no le sirve a nadie, y el asiento es donde el operador va a
      // buscar el id para reintentar en el panel de MP. Es un id de MP, no un
      // dato personal (ni el `payerEmail` ni el DNI viajan acá).
      detailFromResult: (r) => {
        const d = (r as { debits: DebitCancellation }).debits;
        return { debitsCancelled: d.cancelled, debitsFailed: d.failed };
      },
      redirectQuery: (r) => {
        const failed = (r as { debits: DebitCancellation }).debits.failed.length;
        return failed > 0 ? `?debito=pendiente&n=${failed}` : "";
      },
    },
  );
}

export async function changeCategoryAction(_p: State, formData: FormData): Promise<State> {
  return runAction(
    formData,
    {
      newCategory: z.enum(CATEGORIES, { error: "Elegí la nueva categoría." }),
      // M5B Task 9: mismo criterio que `withdrawAction` — opcional, sólo lo
      // manda el camino "Aplicar" de la bandeja, y ausente deja el camino de
      // siempre byte-idéntico.
      requestId: z.coerce.number().int().positive().optional(),
    },
    {
      guard: async (member, data) => {
        const status = canChangeCategory(
          member, data.newCategory as MemberCategory, await electionsOngoing(prisma),
          await prisma.fee.count({ where: { memberId: member.id, status: "pending" } }),
        );
        if (!status.ok) return status;
        if (data.requestId) {
          const req = await prisma.memberRequest.findUnique({ where: { id: data.requestId as number } });
          if (
            !req || req.status !== "pending" || req.memberId !== member.id ||
            req.type !== "category_change" || req.requestedCategory !== data.newCategory
          ) {
            return { ok: false, error: "La solicitud no corresponde a esta operación. Volvé a la bandeja." };
          }
        }
        return { ok: true };
      },
      run: async ({ memberId, minuteId, actorId }, _member, data) => {
        const result = await memberService.changeCategory({
          memberId, minuteId, actorId, newCategory: data.newCategory as MemberCategory,
        });
        // Mismo criterio que `withdrawAction`: el cambio YA commiteó, así que
        // ni el `markAccepted` ni el aviso pueden tumbar el redirect de éxito
        // — por eso van en el MISMO try (ver el comentario largo en
        // `withdrawAction`).
        if (data.requestId) {
          const requestId = data.requestId as number;
          try {
            await memberRequests.markAccepted({
              requestId, memberId, decidedById: actorId, type: "category_change",
            });
            await notifyRequestDecided({ memberId, type: "category_change", accepted: true });
          } catch (e) {
            console.error("[solicitudes] markAccepted o el aviso al socio fallaron después del cambio de categoría —", {
              requestId, memberId, error: codeOf(e),
            });
          }
        }
        return result;
      },
      auditAction: "member_category_change",
      detail: (member, data) => ({
        from: member.category, to: data.newCategory,
        ...(data.requestId ? { requestId: data.requestId } : {}),
      }),
    },
  );
}

export async function suspendAction(_p: State, formData: FormData): Promise<State> {
  return runAction(
    formData,
    {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá la fecha de inicio de la suspensión"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá la fecha de fin de la suspensión"),
      detail: z.string().max(300, "El detalle no puede superar los 300 caracteres").optional(),
    },
    {
      // El rango se valida acá y no en el schema porque es una regla entre dos
      // campos: un `.refine()` sobre el objeto entero lo dejaría sin `.shape` y
      // parseForm perdería los mensajes en castellano del resto de los campos.
      guard: (member, data) => {
        const status = canSuspend(member);
        if (!status.ok) return status;
        const from = dateFrom(data.from as string);
        const to = dateFrom(data.to as string);
        if (to < from) return { ok: false, error: "La fecha de fin no puede ser anterior a la de inicio." };
        if ((to.getTime() - from.getTime()) / DAY_MS > MAX_SUSPENSION_DAYS) {
          return { ok: false, error: `La suspensión no puede exceder los ${MAX_SUSPENSION_DAYS} días (Art. 10 inc. b).` };
        }
        return { ok: true };
      },
      run: ({ memberId, minuteId, actorId }, _member, data) =>
        memberService.suspend({
          memberId, minuteId, actorId,
          from: dateFrom(data.from as string), to: dateFrom(data.to as string),
          detail: data.detail as string | undefined,
        }),
      auditAction: "member_suspend",
      detail: (_m, data) => ({ from: data.from, to: data.to }),
    },
  );
}

export async function endSuspensionAction(_p: State, formData: FormData): Promise<State> {
  return runAction(
    formData,
    {},
    {
      guard: (member) =>
        member.status === "suspended" ? { ok: true } : { ok: false, error: "El socio no está suspendido." },
      run: ({ memberId, minuteId, actorId }) => memberService.endSuspension({ memberId, minuteId, actorId }),
      auditAction: "member_suspension_end",
    },
  );
}

export async function readmitAction(_p: State, formData: FormData): Promise<State> {
  return runAction(
    formData,
    { category: z.enum(CATEGORIES, { error: "Elegí la categoría de reingreso." }) },
    {
      guard: (member) => canReadmit(member),
      run: ({ memberId, minuteId, actorId }, _member, data) =>
        memberService.readmit({ memberId, minuteId, actorId, category: data.category as MemberCategory }),
      auditAction: "member_readmit",
      // Spec §6.3. El reingreso de un deudor NO se bloquea —la decisión es de la
      // Comisión (REG-16)—, así que este asiento es el único lugar del sistema
      // donde queda dicho que se readmitió a alguien con N cuotas pendientes:
      // ninguna pantalla lo conserva una vez que el socio vuelve a estar
      // vigente. Se cuenta al confirmar y en vivo (el reingreso no toca cuotas,
      // así que contar después del servicio da lo mismo que contar antes).
      detail: async (member, data) => ({
        category: data.category,
        pendingCount: await prisma.fee.count({ where: { memberId: member.id, status: "pending" } }),
      }),
    },
  );
}

// ── Corrección del flag de débito automático ──────────────────────────────────
//
// `Member.autoDebit` tiene tres escrituras y ninguna lo BAJA (padrón importado,
// alta web, vinculación manual), y cuatro superficies lo muestran, incluida la
// exportación que va a la Comisión. Hasta acá no había ningún camino para
// corregirlo: un socio que dejó de pagar por débito hace tres años seguía
// figurando con débito en la ficha y en el padrón.
//
// No pasa por `runAction`: no es una acción societaria. No hay acta, no hay
// movimiento y no cambia el estado del socio — es la corrección de un dato de
// ficha. Lo que sí lleva es auditoría, porque toca un dato que sale en la
// exportación.
const autoDebitSchema = z.object({
  memberId: z.coerce.number("Socio inválido.").int("Socio inválido.").positive("Socio inválido."),
  // El checkbox manda "on" o no manda nada; cualquier otra cosa es un POST a mano.
  autoDebit: z.literal("on", { error: "Valor inválido." }).optional(),
});

/** El flag NO significa "tiene débito automático andando": significa que en
 *  algún momento hubo intención de débito (ver `members/auto-debit.ts`). Por eso
 *  esta acción no toca ninguna suscripción de Mercado Pago —no crea ni cancela
 *  nada— y por eso el texto de la pantalla dice lo que dice. */
export async function setAutoDebitAction(_p: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(autoDebitSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const to = parsed.data.autoDebit === "on";
  const member = await prisma.member.findUnique({
    where: { id: parsed.data.memberId }, select: { id: true, autoDebit: true },
  });
  if (!member) return { error: "El socio no existe." };
  // Sin cambio no se escribe ni se audita: el formulario se puede reenviar
  // (recarga, doble clic) y una auditoría de "false → false" es ruido en el
  // único registro donde se busca quién tocó qué.
  if (member.autoDebit === to) return {};
  await prisma.member.update({ where: { id: member.id }, data: { autoDebit: to } });
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "member_auto_debit_set", entity: "member", entityId: member.id,
    detail: { from: member.autoDebit, to }, ip,
  });
  revalidatePath(`/admin/socios/${member.id}`);
  return {};
}

/** M5: apaga el "pendiente de constatación" que prende la autoedición del
 *  domicilio en /mi/datos. Sin acta: constatar no es un acto estatutario. */
export async function confirmAddressAction(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  if (!actor.ok) return;
  const memberId = Number(formData.get("memberId"));
  if (!Number.isInteger(memberId) || memberId <= 0) return;
  try {
    await prisma.member.update({ where: { id: memberId }, data: { addressPendingReview: false } });
  } catch (e) {
    // Sólo la ficha inexistente se traga (P2025): a esta action se llega desde
    // un botón de la ficha, así que un id que ya no existe es un POST fabricado
    // y no merece pantalla de error. Un fallo REAL de la base sí tiene que
    // subir: tragarlo dejaría al operador con el cartel de "pendiente" intacto
    // y sin ninguna pista de por qué el botón no hizo nada. El duck-typing
    // sobre `.code` es la convención del proyecto con el adapter de MariaDB
    // (ver `@/lib/treasury/unique-violation`, donde `meta.target` NO existe).
    if ((e as { code?: string })?.code !== "P2025") throw e;
    return;
  }
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "member_address_confirmed",
    entity: "member",
    entityId: memberId,
    detail: {},
    ip,
  });
  revalidatePath(`/admin/socios/${memberId}`);
}
