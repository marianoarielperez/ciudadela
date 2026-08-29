// Mapa único estado→variante de Badge. Antes cada pantalla tenía su ternario y
// divergieron: un suspendido se veía "secondary" en el padrón y "outline" en su
// propia ficha. El del padrón era el más expresivo: queda como canónico.
import type {
  ApplicationStatus, FeeStatus, MemberStatus, NewsStatus, PresentationStatus, UnmatchedStatus,
} from "@/generated/prisma/client";
import type { CronState, PendingReceiptState } from "@/lib/admin/health";
import type { BackupState } from "@/lib/admin/health-backup";
import type { ArrearsLevel } from "@/lib/treasury/rules";
import type { UserAccountState } from "@/lib/users/labels";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "success" | "link";

export function memberStatusBadgeVariant(status: MemberStatus): BadgeVariant {
  if (status === "active") return "default";
  if (status === "suspended") return "secondary";
  return "outline";
}

export function newsStatusBadgeVariant(status: NewsStatus): BadgeVariant {
  return status === "published" ? "default" : "secondary";
}

export function activityBadgeVariant(active: boolean): BadgeVariant {
  return active ? "default" : "secondary";
}

// La bandeja resalta lo accionable: la aceptada que espera acta es "default"
// (celeste); lo terminal va apagado.
export function applicationStatusBadgeVariant(status: ApplicationStatus): BadgeVariant {
  if (status === "approved_pending_minute") return "default";
  if (status === "pending_board" || status === "pending_payment") return "secondary";
  if (status === "rejected") return "destructive";
  return "outline"; // started, completed, expired
}

// La mora escala con el estatuto (REG-15): desde la 2ª cuota es alerta, desde
// la 4ª habilita la cesantía. El argumento es el UMBRAL que devuelve
// `arrearsLevel`, no la cantidad de cuotas pendientes.
export function arrearsBadgeVariant(level: ArrearsLevel): BadgeVariant {
  if (level === 4) return "destructive";
  if (level === 2) return "default";
  if (level === 1) return "secondary";
  return "outline";
}

// Un recibo anulado no es "apagado": es un asiento que sigue existiendo y que
// hay que poder ver de lejos en la lista.
export function receiptBadgeVariant(voided: boolean): BadgeVariant {
  return voided ? "destructive" : "default";
}

export function feeStatusBadgeVariant(status: FeeStatus): BadgeVariant {
  if (status === "paid") return "default";
  if (status === "pending") return "secondary";
  return "outline"; // exempt, voided
}

// La bandeja resalta lo que espera una decisión; lo resuelto va apagado. Mismo
// criterio que las solicitudes: "default" (celeste) es "acá hay trabajo".
//
// Las tres salidas se distinguen entre sí porque significan cosas distintas y
// el operador las revisa en la misma columna:
//   matched      — outline: hay socio, hay Payment y hay recibo detrás. Borde
//                  fino, sin relleno: es el desenlace normal.
//   dismissed    — secondary: relleno gris. Esa plata no se le imputa a nadie y
//                  no suma en ningún lado.
//   other_income — success: relleno verde tenue. Es el único de los tres que
//                  deja plata sumando en un total (el de Otros ingresos), y la
//                  columna se barre de un vistazo porque las tres se distinguen
//                  por PESO además de por color: borde / gris / verde.
//                  Antes era "ghost" —sin fondo y con borde transparente—, que
//                  en pantalla se leía como texto suelto y no como etiqueta.
export function unmatchedStatusBadgeVariant(status: UnmatchedStatus): BadgeVariant {
  if (status === "open") return "default";
  if (status === "dismissed") return "secondary";
  if (status === "other_income") return "success";
  return "outline"; // matched
}

// La salud se lee de un vistazo y por PESO, no sólo por color: lo que exige
// acción va con relleno; lo sano, con borde fino.
export function cronStateBadgeVariant(state: CronState): BadgeVariant {
  if (state === "hung" || state === "errors") return "destructive";
  // "stale" y "never" no son un error: son una ausencia. Gris con relleno —se ve
  // de lejos— pero no rojo, que en este tablero significa "algo se rompió".
  if (state === "stale" || state === "never") return "secondary";
  return "success";
}

export function backupStateBadgeVariant(state: BackupState): BadgeVariant {
  if (state === "missing") return "destructive";
  // "no lo puedo leer" NO es "no corrió": lo que está roto son los permisos del
  // panel, no el backup. Gris con relleno, nunca rojo.
  if (state === "stale" || state === "unreadable") return "secondary";
  // "sin configurar" es una pregunta abierta sobre el entorno, no una alarma:
  // borde fino. Acusar un backup roto que nunca se instaló es peor que callarse.
  if (state === "unconfigured") return "outline";
  return "success";
}

// Los recibos sin sellar: sólo el fallido y el que nunca se intentó piden una
// acción del operador, y son los únicos dos que se ven de lejos.
export function pendingReceiptBadgeVariant(state: PendingReceiptState): BadgeVariant {
  if (state === "failed") return "destructive";
  if (state === "not_attempted") return "default";
  if (state === "no_email") return "secondary";
  return "outline"; // sent: salió; lo que falta es el sello
}

// El catálogo de estados es de Mercado Pago (string, no enum). Sólo tres se
// afirman; cualquier otro es "no sé" y va neutro, nunca en verde.
export function subscriptionStatusBadgeVariant(status: string): BadgeVariant {
  if (status === "authorized") return "default";
  if (status === "paused") return "secondary";
  if (status === "cancelled") return "destructive";
  return "outline";
}

// Los seis estados de una presentación de re-empadronamiento (M6). Mismo
// criterio que las solicitudes: "default" (celeste) es "acá hay trabajo", el
// verde es el desenlace bueno, y lo que todavía no ocurrió va con borde fino.
//
// `withdrawn` es la baja declarada por no re-empadronarse: es terminal y grave,
// pero no es una alarma para el operador —es el resultado previsto del
// Art. 9° bis— así que va apagado y no en rojo. El rojo queda para el rechazo,
// que sí es una decisión que alguien tomó y puede revisarse.
export function presentationStatusBadgeVariant(status: PresentationStatus): BadgeVariant {
  if (status === "submitted") return "default";
  if (status === "validated") return "success";
  if (status === "observed") return "secondary";
  if (status === "rejected") return "destructive";
  return "outline"; // pending, withdrawn
}

// Los roles de una cuenta (módulo de usuarios). Por PESO: superadmin con
// relleno celeste (acá hay poder), admin gris con relleno, socio borde fino.
export function userRoleBadgeVariant(role: string): BadgeVariant {
  if (role === "superadmin") return "default";
  if (role === "admin") return "secondary";
  return "outline";
}

// El estado derivado de la cuenta (accountState, @/lib/users/labels). Los dos
// accionables de la columna llevan el celeste de "acá hay trabajo", y son
// accionables por lo mismo: la cuenta no puede entrar y el superadmin lo
// resuelve reenviándole la invitación (o revocándola).
//   invitation_expired — el enlace se emitió y se venció.
//   no_access          — no hay enlace: se revocó, o se borró al cambiarle el
//                        email antes del canje. Misma acción, mismo peso.
// El verde queda sólo para la cuenta que efectivamente puede entrar; el borde
// fino, para la invitación viva, que todavía no ocurrió.
export function userAccountBadgeVariant(state: UserAccountState): BadgeVariant {
  if (state === "active") return "success";
  if (state === "disabled") return "secondary";
  if (state === "invitation_expired" || state === "no_access") return "default";
  return "outline"; // invited: todavía no ocurrió
}
