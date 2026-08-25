// Etiquetas es-AR de los enums del padrón. Un solo lugar: el listado, la ficha y
// la exportación tienen que nombrar lo mismo que el Libro en papel.
import { ArrowLeftRight, UserMinus } from "lucide-react";
import type { ComponentType } from "react";
import type {
  EmailStatus, MemberCategory, MemberRequestStatus, MemberRequestType, MemberStatus,
  MinuteType, MovementType, NotificationStatus, NotificationType, WithdrawalReason,
} from "@/generated/prisma/client";

export const CATEGORY_LABELS: Record<MemberCategory, string> = {
  active: "Activo", adherent: "Adherente", collaborator: "Colaborador",
  cadet: "Cadete", honorary: "Honorario", lifetime: "Vitalicio",
};
export const STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Vigente", suspended: "Suspendido", withdrawn: "Baja",
};
export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  none: "Sin email", declared: "Sin verificar", verified: "Verificado", bounced: "Rebotado",
};
export const REASON_LABELS: Record<WithdrawalReason, string> = {
  death: "Fallecimiento", resignation: "Renuncia", arrears: "Cesantía por mora",
  moved_away: "Cesantía por mudanza", not_reregistered: "No re-empadronado",
  expulsion: "Expulsión", duplicate_annulment: "Anulación por duplicado", other: "Otro",
};
export const MOVEMENT_LABELS: Record<MovementType, string> = {
  admission: "Alta", withdrawal: "Baja", category_change: "Cambio de categoría",
  readmission: "Reingreso", suspension: "Suspensión", suspension_end: "Fin de suspensión",
  book_migration: "Migración de libro",
};
export const MINUTE_TYPE_LABELS: Record<MinuteType, string> = {
  board: "Comisión Directiva", assembly: "Asamblea",
};
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  email_verification: "Verificación de email", password_invitation: "Invitación de contraseña",
  application_result: "Resultado de solicitud", reregistration_first: "Re-empadronamiento (1° aviso)",
  reregistration_second: "Re-empadronamiento (2° aviso)", withdrawal_declared: "Baja declarada",
  fee_reminder: "Recordatorio de cuota", arrears_alert: "Aviso de mora",
  receipt: "Recibo", payment_rejected: "Pago rechazado",
  request_accepted: "Solicitud aceptada", request_rejected: "Solicitud rechazada",
  board_digest: "Resumen para la cartelera", generic: "Aviso",
};
export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  sent: "Enviada", delivered: "Entregada", bounced: "Rebotada",
  posted_board: "Publicada en cartelera", completed_board: "Cartelera cumplida",
  failed: "Fallida",
};
export const REQUEST_TYPE_LABELS: Record<MemberRequestType, string> = {
  withdrawal: "Baja por renuncia", category_change: "Cambio de categoría",
};
export const REQUEST_STATUS_LABELS: Record<MemberRequestStatus, string> = {
  pending: "Pendiente", accepted: "Aceptada", rejected: "Rechazada", cancelled: "Retirada",
};

// Badge e ícono por solicitud de socio (M5B): estrenados por `/mi/solicitudes`
// y reutilizados tal cual por la bandeja del panel (`/admin/solicitudes/socios`,
// Task 8) para que las dos pantallas no puedan divergir. El color nunca es el
// único canal: el texto de REQUEST_STATUS_LABELS acompaña a cada badge.
export const REQUEST_STATUS_BADGE_VARIANT: Record<
  MemberRequestStatus, "default" | "success" | "destructive" | "secondary"
> = {
  pending: "default", accepted: "success", rejected: "destructive", cancelled: "secondary",
};
export const REQUEST_TYPE_ICONS: Record<MemberRequestType, ComponentType<{ className?: string }>> = {
  withdrawal: UserMinus, category_change: ArrowLeftRight,
};
