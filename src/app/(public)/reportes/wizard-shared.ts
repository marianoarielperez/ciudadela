// Tipos y piezas comunes del wizard de Reportes (M7). Los estados de las
// actions se redeclaran acá porque un módulo "use server" sólo exporta
// funciones async (misma regla y misma advertencia que ASOCIATE: la
// equivalencia con `actions.ts` se sostiene a mano).
import type { ReportKindSlug } from "@/lib/reports/catalog";

export { CONTROL_HEIGHT, FOCUS_RING, LINK_TARGET, type StreetOption } from "../asociate/wizard-shared";

export type ReportMode = "public" | "member";
export type FileKindSlug = "photo" | "dni_front" | "dni_back";

export type StartState = { error?: string; started?: { claim: string } };
export type ReporterState = { error?: string; saved?: true };
export type UploadState = { error?: string; uploaded?: { id: number; kind: FileKindSlug } };
export type RemoveState = { error?: string; removed?: true };
export type SubmitState = { error?: string; done?: { number: number } };

export type UploadedFile = { id: number; kind: FileKindSlug };

/** Lo que el wizard sabe de un borrador ya creado (rehidratación desde
 *  `/reportes/nuevo/[claim]`). Sin id, sin DNI, sin descripción: nada que no
 *  haga falta para decidir la pantalla (mismo criterio que `ApplicationSnapshot`). */
export type ReportSnapshot = {
  status: "draft" | "received" | "filed" | "dismissed";
  kind: ReportKindSlug;
  anonymous: boolean;
  /** Sólo `true` si nombre, DNI, teléfono y email ya están en la base. */
  reporterComplete: boolean;
  reporter: { name: string; phone: string; email: string; dni: string } | null;
  files: UploadedFile[];
  /** El N° visible, sólo cuando ya fue enviado. */
  number: number | null;
};

export type ReportDraft = {
  kind: ReportKindSlug | "";
  anonymous: "" | "si" | "no";
  name: string;
  dni: string;
  phone: string;
  email: string;
  category: string;
  subtype: string;
  description: string;
  lat: number | null;
  lng: number | null;
  streetId: number | null;
  streetName: string;
  addressDetail: string;
  scplTicket: string;
  consent: boolean;
};

export const EMPTY_REPORT_DRAFT: ReportDraft = {
  kind: "", anonymous: "", name: "", dni: "", phone: "", email: "",
  category: "", subtype: "", description: "", lat: null, lng: null,
  streetId: null, streetName: "", addressDetail: "", scplTicket: "", consent: false,
};
