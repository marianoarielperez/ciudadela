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
export { CONTROL_HEIGHT, FOCUS_RING, LINK_TARGET } from "../asociate/wizard-shared";

/** Los cuatro pasos del trámite. Esta task implementa el 1; los otros tres los
 *  llena la Task 11. El total se declara igual desde ahora porque es lo que ve
 *  el vecino en "Paso 1 de 4": empezar diciendo "de 1" y crecer después sería
 *  mentirle sobre cuánto le falta. */
export const TOTAL_STEPS = 4;

export const STEP_TITLES: Record<number, string> = {
  1: "Identificate",
  2: "Tus datos",
  3: "Documentación",
  4: "Declaración jurada",
};

// El estado de la action se redeclara acá porque un módulo "use server" sólo
// puede exportar funciones async, así que `./actions.ts` no puede exportar sus
// tipos. Es estructuralmente el mismo `LookupState` de allá; la equivalencia se
// sostiene a mano (mismo criterio y mismo riesgo que el `CreateState` de
// ASOCIATE: un campo nuevo del lado del server hay que acordarse de replicarlo).
//
// Ojo con lo que NO lleva `eligible`: ni el nombre completo, ni el id del
// socio, ni el email, ni el domicilio. El DNI no es una contraseña —cualquiera
// puede tipear el de otro— así que del padrón sólo sale el nombre ENMASCARADO,
// que alcanza para que el propio vecino se reconozca y no le dice nada a un
// desconocido. Y hay UN SOLO veredicto negativo (`not_found`) para el DNI que
// no existe, el que no es adherente, el que no fue convocado, el dado de baja y
// el rechazado: si alguno contestara distinto, esta pantalla sería un oráculo
// para averiguar quién es socio de la vecinal. Quien garantiza eso es
// `lookupVerdict` (`src/lib/reregistration/rules.ts`), que no devuelve motivo.
export type LookupState =
  | { kind: "idle" }
  | { kind: "eligible"; maskedName: string; presentationToken: string }
  | { kind: "already_submitted"; canResend: boolean }
  | { kind: "not_found" }
  | { kind: "error"; error: string };

/** Teléfono y email de contacto de la sede, para el cartel genérico. Salen de
 *  la tabla `configuration` y hoy pueden estar vacíos: la pantalla explica el
 *  hueco en vez de dejarlo, igual que /ubicacion. */
export type ContactInfo = { phone: string | null; email: string | null };
