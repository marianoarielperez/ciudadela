// Las guardas por socio del reparto (spec 2026-09-10 §5.2 paso 3) y, desde la
// Task 7, la vista previa y el token de confirmación. Prisma inyectado: la
// action las usa para PRE-validar con mensaje, y el núcleo las vuelve a correr
// —la misma función, no una copia— antes de escribir.
import type { PrismaClient } from "@/generated/prisma/client";
import { countPendingFees } from "./account";
import { activeExemption } from "./exemptions";
import { allocateFor, readFeeContext } from "./fee-allocation";
import { paymentConcept } from "./labels";
import { cashConceptsFor, type CashConcept } from "./rules";
import { SPLIT_GUARD_MESSAGES as M } from "./split-messages";
import { cents, INBOX_CONCEPT_TYPE } from "./split-group";

/** Una parte del reparto, como la decide el operador. `n` es 0 para los aportes. */
export type SplitPartPlan = { memberId: number; concept: CashConcept; n: number; amount: number };

/** La primera guarda que corta, redactada, o `null` si todas pasan: socio
 *  existente; cesante → sólo `fees` y no más cuotas que sus pendientes;
 *  concepto según categoría (`cashConceptsFor`, la MISMA función que Efectivo);
 *  exento → sólo aportes (`activeExemption`, la MISMA función que las otras
 *  cinco guardas de cobro). */
export async function splitPartGuards(
  db: Pick<PrismaClient, "member" | "fee" | "feeExemption">,
  parts: SplitPartPlan[],
  at: Date = new Date(),
): Promise<string | null> {
  for (const p of parts) {
    const member = await db.member.findUnique({
      where: { id: p.memberId },
      select: { id: true, category: true, status: true },
    });
    if (!member) return M.memberGone;
    if (member.status === "withdrawn" && p.concept !== "fees") return M.withdrawnConcept;
    if (!cashConceptsFor(member.category).includes(p.concept)) return M.conceptCategory;
    if (p.concept === "fees") {
      if (member.status === "withdrawn") {
        const pending = await countPendingFees(db, member.id);
        if (p.n > pending) return M.withdrawnCount(pending);
      }
      const exemption = await activeExemption(db, member.id, at);
      if (exemption) return M.exempt(exemption);
    }
  }
  return null;
}

/** Huella de "esto es exactamente lo que se confirmó": fila + partes ordenadas
 *  por socio, importes en centavos. No es una firma —no hay secreto y no
 *  pretende serlo— sino la guarda contra la deriva, como `arrearsConfirmToken`:
 *  si el operador cambia una cuota después de leer la confirmación, la action
 *  vuelve a pedirla en vez de emitir a ciegas. */
export function splitConfirmToken(rowId: number, parts: SplitPartPlan[]): string {
  const sorted = [...parts].sort((a, b) => a.memberId - b.memberId);
  return `${rowId}|${sorted.map((p) => `${p.memberId}:${p.concept}:${p.n}:${cents(p.amount)}`).join(",")}`;
}

/** Una parte tal como la lee el operador antes de confirmar. `concept` es el
 *  MISMO texto que va a decir el recibo. */
export type SplitPreviewPart = { memberId: number; name: string; memberNumber: number | null; concept: string; amount: number };

/** La vista previa, resuelta en el SERVIDOR contra la base: qué cuotas se
 *  imputan a cada socio (las más viejas primero, y las que se crean desde el
 *  piso de cobertura con el reingreso), con `readFeeContext` y `allocateFor`:
 *  las MISMAS funciones que usa el núcleo al asentar (`preparePart`). */
export async function previewSplit(
  db: Pick<PrismaClient, "member" | "fee" | "movement">,
  parts: SplitPartPlan[],
): Promise<SplitPreviewPart[]> {
  const out: SplitPreviewPart[] = [];
  for (const p of parts) {
    const member = await db.member.findUnique({
      where: { id: p.memberId },
      select: {
        id: true, fullName: true, joinedAt: true,
        memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
      },
    });
    if (!member) throw new Error(M.memberGone);
    const memberNumber = member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
    const type = INBOX_CONCEPT_TYPE[p.concept];
    let periods: string[] = [];
    if (p.concept === "fees") {
      // Las MISMAS dos funciones que usa `preparePart` al asentar, no una copia:
      // lo que esta pantalla anuncia es lo que el recibo va a congelar.
      periods = allocateFor(await readFeeContext(db, member.id), member, p.n).toPay;
    }
    out.push({ memberId: member.id, name: member.fullName, memberNumber, concept: paymentConcept(type, periods), amount: p.amount });
  }
  return out;
}
