// Tipos y piezas comunes del wizard REEMPADRONATE (Art. 9° bis, docs/06 M6 §5).
// Aparte del wizard para que los pasos vivan en sus propios archivos sin
// importarse entre ellos (y sin ciclo de imports), igual que en ASOCIATE.
//
// Las clases de control NO se redefinen acá: se re-exportan de ASOCIATE. Son
// los 48 px del pulgar y el anillo de foco del sitio público, y los dos
// wizards son la misma UI para el mismo vecino — dos copias del literal se
// separarían el día que alguien ajuste una y no la otra. Que la definición viva
// en `asociate/wizard-shared.ts` es un accidente histórico (fue el primero);
// lo que importa es que haya UNA.
import type { DocumentType, PresentationStatus } from "@/generated/prisma/client";
import { REREGISTRATION_NEIGHBOURHOOD } from "@/lib/reregistration/presentation-rules";

export { CONTROL_HEIGHT, FOCUS_RING, LINK_TARGET } from "../asociate/wizard-shared";
// El catálogo catastral y la limpieza de "Hernandez , Jose" también son de allá:
// es la MISMA lista de 40 calles y el mismo `StreetPicker`.
export type { StreetOption } from "../asociate/wizard-shared";

/** Los cuatro pasos del trámite. El total se declara así desde el paso 1 porque
 *  es lo que ve el vecino en "Paso 1 de 4": empezar diciendo "de 1" y crecer
 *  después sería mentirle sobre cuánto le falta. */
export const TOTAL_STEPS = 4;

export const STEP_TITLES: Record<number, string> = {
  1: "Identificate",
  2: "Tus datos",
  3: "Documentación",
  4: "Declaración jurada",
};

// El estado de las actions se redeclara acá porque un módulo "use server" sólo
// puede exportar funciones async, así que `./actions.ts` no puede exportar sus
// tipos. Son estructuralmente los mismos de allá; la equivalencia se sostiene a
// mano (mismo criterio y mismo riesgo que el `CreateState` de ASOCIATE: un
// campo nuevo del lado del server hay que acordarse de replicarlo).
//
// Ojo con lo que NO lleva `eligible`: ni el nombre completo, ni el id del
// socio, ni el id de la presentación, ni el domicilio. El DNI no es una
// contraseña —cualquiera puede tipear el de otro— así que del padrón sólo sale
// el nombre ENMASCARADO, que alcanza para que el propio vecino se reconozca y
// no le dice nada a un desconocido, más el email como ÚNICA precarga
// (decisión 8). Y hay UN SOLO veredicto negativo (`not_found`) para el DNI que
// no existe, el que no es adherente, el que no fue convocado, el dado de baja y
// el rechazado: si alguno contestara distinto, esta pantalla sería un oráculo
// para averiguar quién es socio de la vecinal. Quien garantiza eso es
// `lookupVerdict` (`src/lib/reregistration/rules.ts`), que no devuelve motivo.
export type LookupState =
  | { kind: "idle" }
  | { kind: "eligible"; maskedName: string; presentationToken: string; email: string }
  | { kind: "already_submitted"; canResend: boolean }
  | { kind: "not_found" }
  | { kind: "error"; error: string };

export type SaveState = { error?: string; saved?: true };
export type UploadState = { error?: string; uploaded?: { type: string; count: number } };
/** `submittedAt` es `string | null`: en el segundo envío se relee de la fila y
 *  puede no haber marca. La pantalla NO inventa una fecha en ese caso — es la
 *  constancia del plazo del Art. 9° bis, y una fecha falsa ahí es peor que
 *  ninguna. */
export type SubmitState = { error?: string; done?: { submittedAt: string | null; mailed: boolean } };
export type ResendState = { error?: string; done?: boolean };

/** Lo que el vecino tipea en el paso 2. Todo string porque es lo que viaja en
 *  el `<form>`; la conversión a fecha y a id la hace el server. */
export type PresentationDraft = {
  birthDate: string;
  civilStatus: string;
  nationality: string;
  occupation: string;
  streetId: number | null;
  /** Sólo para mostrar en el combo: al server viaja `streetId`. */
  streetName: string;
  streetNumber: string;
  /** Fijo en `REREGISTRATION_NEIGHBOURHOOD`, no elegible (Art. 5 inc. 3): el
   *  paso 2 lo muestra como texto y la action lo escribe desde la constante,
   *  sin leerlo del formulario. Sigue en el borrador porque el paso 4 arma con
   *  él el domicilio completo que el vecino jura. */
  neighborhood: string;
  phone: string;
  email: string;
  emailConfirm: string;
};

export const EMPTY_DRAFT: PresentationDraft = {
  birthDate: "",
  civilStatus: "",
  // La nacionalidad de casi todo el padrón es la misma y el campo es
  // obligatorio: se propone y se puede cambiar, no se asume en silencio.
  nationality: "Argentina",
  occupation: "",
  streetId: null,
  streetName: "",
  streetNumber: "",
  // Nace con el valor final: no hay pantalla que lo cambie, así que dejarlo
  // vacío sólo habría hecho que el paso 4 mostrara "Rivadavia 1234, " hasta
  // que el server contestara.
  neighborhood: REREGISTRATION_NEIGHBOURHOOD,
  phone: "",
  email: "",
  emailConfirm: "",
};

/** Lo que el wizard sabe de una presentación al entrar por el ENLACE
 *  (`/reempadronate/retomar/[token]`). Acá sí viaja la ficha declarada, y eso
 *  no contradice la anti-precarga del paso 1: el enlace llegó al buzón que el
 *  propio vecino declaró, así que el buzón ya demostró ser suyo (§5.4).
 *
 *  Lo que NO viaja igual: ni el id de la presentación ni el del socio. Las
 *  actions se dirigen todas con la llave, así que el cliente no los necesita, y
 *  meterlos acá los publicaría en el HTML de la página. */
export type PresentationSnapshot = {
  status: PresentationStatus;
  observation: string | null;
  submittedAt: string | null;
  validatedAt: string | null;
  /** ¿El proceso sigue en 1ª o 2ª instancia? Con el plazo vencido la pantalla
   *  es de sólo lectura: el wizard no edita (§5.4). */
  open: boolean;
  /** Con repetidos: `annex` puede aparecer hasta PRESENTATION_MAX_ANNEXES veces. */
  uploadedTypes: DocumentType[];
  draft: PresentationDraft;
};

/** Cómo crece la lista de documentos ya subidos cuando el server acepta uno más.
 *
 *  El frente y el dorso se REEMPLAZAN —el store borra el archivo anterior, así
 *  que volver a subir el frente no puede dejar dos "Frente del DNI" en la
 *  lista— y los anexos se ACUMULAN, hasta el tope (que hace cumplir el server;
 *  acá sólo se cuenta). Es la misma función que ASOCIATE tiene en su
 *  `wizard-shared`, re-exportada en vez de copiada. */
export { withUploadedType } from "../asociate/wizard-shared";

/** Teléfono y email de contacto de la sede, para el cartel genérico. Salen de
 *  la tabla `configuration` y hoy pueden estar vacíos: la pantalla explica el
 *  hueco en vez de dejarlo, igual que /ubicacion. */
export type ContactInfo = { phone: string | null; email: string | null };
