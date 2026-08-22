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
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { civilDateUtc } from "@/lib/dates";
import { electionsOngoing, memberService } from "@/lib/members/service";
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

  try {
    await opts.run({ actorId, memberId, minuteId }, member, data);
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
    detail: { minuteId, ...(opts.detail ? await opts.detail(member, data) : {}) }, ip,
  });

  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/socios/${memberId}`);
}

export async function withdrawAction(_p: State, formData: FormData): Promise<State> {
  return runAction(
    formData,
    {
      reason: z.enum(REASONS, { error: "Elegí el motivo de la baja." }),
      detail: z.string().max(300, "El detalle no puede superar los 300 caracteres").optional(),
    },
    {
      guard: (member) => canWithdraw(member),
      run: ({ memberId, minuteId, actorId }, _member, data) =>
        memberService.withdraw({
          memberId, minuteId, actorId,
          reason: data.reason as WithdrawalReason,
          detail: data.detail as string | undefined,
        }),
      auditAction: "member_withdraw",
      detail: (_m, data) => ({ reason: data.reason }),
    },
  );
}

export async function changeCategoryAction(_p: State, formData: FormData): Promise<State> {
  return runAction(
    formData,
    { newCategory: z.enum(CATEGORIES, { error: "Elegí la nueva categoría." }) },
    {
      guard: async (member, data) =>
        canChangeCategory(
          member, data.newCategory as MemberCategory, await electionsOngoing(prisma),
          await prisma.fee.count({ where: { memberId: member.id, status: "pending" } }),
        ),
      run: ({ memberId, minuteId, actorId }, _member, data) =>
        memberService.changeCategory({
          memberId, minuteId, actorId, newCategory: data.newCategory as MemberCategory,
        }),
      auditAction: "member_category_change",
      detail: (member, data) => ({ from: member.category, to: data.newCategory }),
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
