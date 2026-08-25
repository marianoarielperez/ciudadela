// Reglas puras de las solicitudes que el socio presenta desde su panel (baja
// por renuncia o cambio de categoría) y el texto formal del escrito de
// renuncia. Módulo sin Prisma: la Tarea 4 lo envuelve en un servicio que
// cuenta la deuda real y consulta el padrón. Cada guarda replica, desde la
// voz del socio, una regla que `src/lib/members/rules.ts` ya aplica del lado
// del operador — no se duplica el criterio, se traduce el texto.
import type { MemberCategory, MemberRequestType, MemberStatus } from "@/generated/prisma/client";
import { formatDateAR } from "@/lib/format";
import type { RuleResult } from "@/lib/members/rules";

// Categorías que un socio puede pedir para sí mismo. `cadet` (menor sin cuota
// propia), `honorary` y `lifetime` las otorga la Comisión por acta, nunca a
// pedido: quedan fuera aunque figuren en `MemberCategory`.
export const REQUESTABLE_CATEGORIES: readonly MemberCategory[] = ["active", "adherent", "collaborator"];

export function canCreateRequest(input: {
  type: MemberRequestType;
  member: { status: MemberStatus; category: MemberCategory };
  requestedCategory: MemberCategory | null; // solo category_change
  electionsOngoing: boolean; // solo category_change
  pendingFees: number; // solo category_change (REG-07)
  hasPendingOfType: boolean;
}): RuleResult {
  const { type, member, requestedCategory, electionsOngoing, pendingFees, hasPendingOfType } = input;

  // El suspendido no opera (REG-20) y el cesante (status "withdrawn") ni
  // siquiera llega a esta pantalla — el panel de socio no se abre sin sesión
  // activa —, pero la guarda se deja explícita por si algún día cambia eso.
  if (member.status !== "active") {
    return { ok: false, error: "Solo un socio vigente puede presentar solicitudes." };
  }

  // Una solicitud pendiente por tipo, no una por socio: una baja pendiente no
  // le impide pedir un cambio de categoría en simultáneo, y viceversa.
  if (hasPendingOfType) {
    return {
      ok: false,
      error: "Ya tenés una solicitud pendiente de este tipo. Podés retirarla desde tu panel.",
    };
  }

  if (type === "category_change") {
    if (requestedCategory === null || !REQUESTABLE_CATEGORIES.includes(requestedCategory)) {
      return { ok: false, error: "Elegí la categoría nueva." };
    }
    if (requestedCategory === member.category) {
      return { ok: false, error: "Esa ya es tu categoría." };
    }
    // Mismo texto que `canChangeCategory` del lado del operador (Art. 5° ter):
    // el bloqueo por elecciones es una única regla, contada dos veces.
    if (electionsOngoing) {
      return { ok: false, error: "Hay elecciones en curso: los cambios de categoría están bloqueados (Art. 5° ter)." };
    }
    if (pendingFees > 0) {
      return {
        ok: false,
        error: `Registrás ${pendingFees} ${pendingFees === 1 ? "cuota" : "cuotas"} pendientes: tenés que saldarlas antes de pedir el cambio (Art. 5° ter).`,
      };
    }
  }

  // "withdrawal" no lleva más guardas: renunciar con deuda es un derecho
  // estatutario, no algo que el sistema module. La deuda queda asentada tal
  // cual al aceptarse la baja (mismo flujo que ya existe del lado admin).
  return { ok: true };
}

export function renderWithdrawalText(input: {
  fullName: string;
  memberNumber: number | null;
  date: Date; // se formatea con formatDateAR
  message: string | null;
}): string {
  const { fullName, memberNumber, date, message } = input;
  const number = memberNumber ?? "s/n";
  const reasonLine = message ? `Motivo declarado: ${message}` : "";
  return `Comodoro Rivadavia, ${formatDateAR(date)}.
A la Comisión Directiva de la Asociación Vecinal del Barrio Ciudadela:
Por la presente, ${fullName} (socio N° ${number}) solicita la baja
por renuncia de su condición de socio, conforme al estatuto.
${reasonLine}
Presentada electrónicamente desde el panel de socio.`;
}
