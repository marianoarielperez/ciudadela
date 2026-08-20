// Tipos y piezas comunes del wizard ASOCIATE, aparte para que `StreetPicker` y
// `BlockedPanel` vivan en sus propios archivos sin importar el wizard entero
// (y sin ciclo de imports).
import type {
  ApplicationStatus, DocumentType, MemberCategory,
} from "@/generated/prisma/client";
import type { LegalTexts } from "@/lib/config";
import type { FeeAmounts } from "@/lib/mp/plans";

export type { FeeAmounts, LegalTexts };

export type StreetOption = { id: number; name: string; loadOrder: number };

export type AsociateDraft = {
  livesInBarrio: "" | "si" | "no";
  streetId: number | null;
  /** Sólo para mostrar: al server viaja `streetId`. */
  streetName: string;
  streetText: string;
  neighborhood: string;
  streetNumber: string;
  requestedCategory: "" | "active" | "adherent" | "collaborator";
  wantsDebit: "" | "si" | "no";
  fullName: string;
  dni: string;
  birthDate: string;
  civilStatus: string;
  nationality: string;
  occupation: string;
  phone: string;
  email: string;
  emailConfirm: string;
  acceptTerms: boolean;
};

// El estado de las actions se redeclara acá porque un módulo "use server" sólo
// puede exportar funciones async, así que `./actions.ts` no puede exportar sus
// tipos. Es estructuralmente el mismo `CreateState` de allá; la equivalencia se
// sostiene a mano (un campo nuevo y opcional del lado del server NO rompe esta
// compilación: hay que acordarse de replicarlo acá).
export type CreateState = {
  error?: string;
  blocked?: {
    code: "in_progress" | "already_member" | "visit_office" | "debt" | "rejected_wait";
    message: string;
    retryAtIso?: string;
  };
  created?: { resumeToken: string };
};
export type ResendState = { error?: string; done?: boolean };
export type UploadState = { error?: string; uploaded?: { type: string; count: number } };
export type SubmitState = { error?: string; done?: boolean };
export type PayState = { error?: string; redirectUrl?: string };

/** Lo que el wizard sabe de una solicitud YA creada. Se arma en el servidor
 *  (`/asociate/retomar/[token]`) o se deriva del borrador apenas el paso 3
 *  contesta. Es lo que decide qué pantalla se muestra: `started` sigue en los
 *  pasos 4-5, cualquier otro estado va a `ApplicationStatusScreen`.
 *
 *  Ojo con qué NO viaja: ni el id de la solicitud ni el DNI ni el domicilio. El
 *  cliente no los necesita —todas las actions se dirigen con el token de
 *  retome— y meterlos acá los publicaría en el HTML de la página. */
export type ApplicationSnapshot = {
  status: ApplicationStatus;
  requestedCategory: MemberCategory;
  wantsDebit: boolean;
  preapprovalId: string | null;
  /** Con repetidos: `annex` puede aparecer hasta MAX_ANNEXES veces. */
  uploadedTypes: DocumentType[];
  fullName: string;
};

/** El catálogo catastral guarda cinco calles como "Hernandez , Jose": el espacio
 *  antes de la coma es del CSV de origen y no se toca en la base (el padrón y el
 *  panel citan ese nombre tal cual). Acá se limpia sólo para mostrar — el orden
 *  apellido/nombre se respeta, que es como la vecinal las nombra. */
export function streetLabel(name: string): string {
  return name.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
}

// Clases compartidas. Los controles del wizard son más altos que los del panel
// (48 px contra 32) porque acá se opera con el pulgar, no con el mouse.
export const CONTROL_HEIGHT = "h-12 text-base md:text-base";
export const FOCUS_RING = "outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50";
// Los enlaces de texto también son targets: sin esto quedan en los 20 px de la
// línea, muy por debajo de los 44 px del criterio del shell.
export const LINK_TARGET =
  "inline-flex min-h-11 items-center px-2 text-sm text-primary underline underline-offset-2";
