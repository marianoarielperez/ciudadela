// La carga de insumos del chequeo de elegibilidad por DNI. Es UNA función para
// los DOS call-sites —el chequeo temprano del paso "Tu DNI" y la guarda del
// envío de "Tus datos"— por la misma razón que `coverageFloor` es una sola:
// con una copia por camino, alcanza con que alguien toque una para que el
// paso 1 y el envío diverjan en silencio.
//
// El cliente de Prisma y el servicio se INYECTAN (patrón de `query.ts` y
// `summary.ts`): `@/lib/prisma` tira al evaluarse si falta DATABASE_URL, y un
// test que importe este módulo se caería sin .env.
import type { MemberStatus, PrismaClient, WithdrawalReason } from "@/generated/prisma/client";

type Db = Pick<PrismaClient, "member">;

type ApplicationLookups = {
  findLiveByDni(dni: string): Promise<{ id: number; email: string } | null>;
  lastRejectionAt(dni: string): Promise<Date | null>;
};

export type EligibilityMember = {
  id: number;
  /** Para el nombre enmascarado del paso 1; `checkEligibility` lo ignora. */
  fullName: string;
  status: MemberStatus;
  withdrawalReason: WithdrawalReason | null;
  reentryBlocked: boolean;
  rejectedUntil: Date | null;
  /** Cuotas pendientes en la cuenta corriente (M4). */
  pendingFees: number;
};

export type EligibilityInputs = {
  member: EligibilityMember | null;
  liveApplication: { id: number } | null;
  lastRejectionAt: Date | null;
};

export async function loadEligibilityInputs(
  db: Db,
  applications: ApplicationLookups,
  dni: string,
): Promise<EligibilityInputs> {
  const [memberRow, liveApplication, lastRejectionAt] = await Promise.all([
    db.member.findUnique({
      where: { dni },
      select: {
        id: true, fullName: true, status: true, withdrawalReason: true,
        reentryBlocked: true, rejectedUntil: true,
        // La deuda que bloquea es la VIVA de la cuenta corriente (M4), no el
        // flag `debtAtWithdrawal` que quedó congelado en la baja: el que saldó
        // en la sede tiene que poder reingresar sin que nadie le toque la ficha.
        _count: { select: { fees: { where: { status: "pending" } } } },
      },
    }),
    applications.findLiveByDni(dni),
    applications.lastRejectionAt(dni),
  ]);
  let member: EligibilityMember | null = null;
  if (memberRow) {
    const { _count, ...rest } = memberRow;
    member = { ...rest, pendingFees: _count.fees };
  }
  return {
    member,
    // El email de la solicitud viva no viaja con los insumos: quien lo necesita
    // (el reenvío del enlace) lo busca por su cuenta.
    liveApplication: liveApplication ? { id: liveApplication.id } : null,
    lastRejectionAt,
  };
}
