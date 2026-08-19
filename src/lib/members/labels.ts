// Etiquetas es-AR de los enums del padrón. Un solo lugar: el listado, la ficha y
// la exportación tienen que nombrar lo mismo que el Libro en papel.
import type {
  EmailStatus, MemberCategory, MemberStatus, MinuteType, MovementType,
  NotificationStatus, NotificationType, WithdrawalReason,
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
  receipt: "Recibo", generic: "Aviso",
};
export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  sent: "Enviada", delivered: "Entregada", bounced: "Rebotada",
  posted_board: "Publicada en cartelera", completed_board: "Cartelera cumplida",
};
