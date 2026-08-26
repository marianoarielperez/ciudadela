// Etiquetas es-AR de los enums del padrón. Un solo lugar: el listado, la ficha y
// la exportación tienen que nombrar lo mismo que el Libro en papel.
import type {
  BoardNoticeKind, EmailStatus, MemberCategory, MemberRequestStatus, MemberRequestType,
  MemberStatus, MinuteType, MovementType, NotificationStatus, NotificationType,
  PresentationChannel, PresentationStatus, ReregistrationStatus, WithdrawalReason,
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
  board_digest: "Resumen para la cartelera",
  presentation_received: "Presentación recibida", presentation_observed: "Presentación observada",
  presentation_rejected: "Presentación rechazada",
  generic: "Aviso",
};
export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  sent: "Enviada", delivered: "Entregada", bounced: "Rebotada",
  posted_board: "Publicada en cartelera", completed_board: "Cartelera cumplida",
  failed: "Fallida",
};
export const REQUEST_TYPE_LABELS: Record<MemberRequestType, string> = {
  withdrawal: "Baja por renuncia", category_change: "Cambio de categoría",
};
// `cancelled` es el retiro VOLUNTARIO del socio ("Retirada"); `superseded` es la
// solicitud que quedó sin objeto porque al socio lo dieron de baja por otro
// camino (M6A). Son dos hechos distintos y la pantalla no puede confundirlos:
// decirle "Retirada" a una que cerró una cesantía por mora le atribuye al socio
// una acción que no hizo.
export const REQUEST_STATUS_LABELS: Record<MemberRequestStatus, string> = {
  pending: "Pendiente", accepted: "Aceptada", rejected: "Rechazada", cancelled: "Retirada",
  superseded: "Sin efecto",
};

// Badge por solicitud de socio (M5B): estrenado por `/mi/solicitudes`
// y reutilizados tal cual por la bandeja del panel (`/admin/solicitudes/socios`,
// Task 8) para que las dos pantallas no puedan divergir. El color nunca es el
// único canal: el texto de REQUEST_STATUS_LABELS acompaña a cada badge. El
// ÍCONO de cada tipo vive en `@/components/admin/request-type-icon` (JSX).
export const REQUEST_STATUS_BADGE_VARIANT: Record<
  MemberRequestStatus, "default" | "success" | "destructive" | "secondary"
> = {
  pending: "default", accepted: "success", rejected: "destructive", cancelled: "secondary",
  // "Sin efecto" no es una negativa de la Comisión: comparte el gris de
  // `cancelled` (cerrada sin decisión) y no el rojo de `rejected`.
  superseded: "secondary",
};

// ── Módulo 6: re-empadronamiento (Art. 9° bis) ───────────────────────────────
// Viven acá y no en un archivo aparte porque nombran el mismo hecho que el
// resto del padrón: quién sigue siendo socio. La bandeja del panel, el listado
// de faltantes y el cartel de la sede tienen que decir todos lo mismo.

// `pending` es la fila que nace sola al convocar: el socio todavía no hizo
// nada, así que la etiqueta describe la AUSENCIA ("Sin presentar") y no un
// trámite en curso — decirle "Pendiente" haría creer que hay algo que revisar.
// `withdrawn` es el final del que nunca se presentó: la baja ya está declarada.
export const PRESENTATION_STATUS_LABELS: Record<PresentationStatus, string> = {
  pending: "Sin presentar", submitted: "Presentada", observed: "Observada",
  validated: "Validada", rejected: "Rechazada", withdrawn: "Baja declarada",
};

export const PRESENTATION_CHANNEL_LABELS: Record<PresentationChannel, string> = {
  web: "Por la web", in_person: "En el mostrador",
};

export const PROCESS_STATUS_LABELS: Record<ReregistrationStatus, string> = {
  preparing: "En preparación", first_instance: "Primera instancia",
  second_instance: "Segunda instancia", closing: "En cierre", closed: "Cerrado",
};

// Qué cartel es. "Bajas declaradas" es el del Art. 9° bis in fine: el que
// publica la nómina de quienes no se presentaron.
export const BOARD_NOTICE_KIND_LABELS: Record<BoardNoticeKind, string> = {
  first_instance: "Citación (1° instancia)", second_instance: "Citación (2° instancia)",
  withdrawal: "Bajas declaradas", other: "Otro",
};
