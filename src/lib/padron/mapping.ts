// Pure mapping from a padron_socios.xlsx row to Member data. No DB access.
import type { EmailStatus, MemberCategory, MemberStatus, WithdrawalReason } from "@/generated/prisma/client";
import { excelDateToCivilUtc } from "@/lib/dates";

export type RawPadronRow = {
  numero_socio: number;
  apellido_nombre: string;
  dni: number | string | null;
  calle: string | null;
  altura: number | string | null;
  barrio: string | null;
  nacionalidad: string | null;
  fecha_nacimiento: Date | null;
  estado_civil: string | null;
  ocupacion: string | null;
  telefono: string | null;
  email: string | null;
  debito_automatico: string | null;
  fecha_ingreso: Date;
  categoria_socio: string;
  activo: string;
  deuda_tesoreria: string | null;
  fecha_egreso: Date | null;
  motivo_baja: string | null;
};

export type MemberImportData = {
  fullName: string;
  dni: string | null;
  birthDate: Date | null;
  civilStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  phone: string | null;
  streetText: string | null;
  streetNumber: string | null;
  neighborhood: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  category: MemberCategory;
  status: MemberStatus;
  withdrawalReason: WithdrawalReason | null;
  /** REG-04: la expulsión prende el flag además del motivo. Ver `mapPadronRow`. */
  reentryBlocked: boolean;
  joinedAt: Date;
  leftAt: Date | null;
  debtAtWithdrawal: boolean;
  autoDebit: boolean;
};

export type MappedRow = { memberNumber: number; warnings: string[]; member: MemberImportData };

const yes = (v: string | null | undefined) => (v ?? "").trim().toLowerCase() === "si";
const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" || s === "-" ? null : s;
};

export function mapWithdrawalReason(raw: string | null | undefined): { reason: WithdrawalReason | null; warning?: string } {
  const v = (raw ?? "").trim();
  if (v === "" || v === "-") return { reason: null };
  if (/^mora$/i.test(v)) return { reason: "arrears" };
  if (/^fallecid[oa]$/i.test(v)) return { reason: "death" };
  // REG-04 (Art. 5 inc. 2): la expulsión no se puede perder en `other`, porque es
  // el ÚNICO motivo que cierra el reingreso para siempre y la puerta del wizard
  // lo decide por este valor (`eligibility.ts:64`). El motivo lo escribe a mano
  // quien lleva el libro, así que se aceptan el participio en los dos géneros y
  // el sustantivo con y sin tilde, y se busca dentro de la frase —igual que el
  // cambio de domicilio de abajo— para tomar también "Anulada por expulsión".
  if (/expulsad[oa]|expulsi[oó]n/i.test(v)) return { reason: "expulsion" };
  if (/domicili|gasoducto|standard|bols/i.test(v)) return { reason: "moved_away" };
  return { reason: "other", warning: `motivo_baja no mapeado: "${v}" (queda como "other")` };
}

const CATEGORY: Record<string, MemberCategory> = { activo: "active", adherente: "adherent" };

/** ¿La fila del padrón da de BAJA al socio? Un solo lugar para las dos únicas
 *  formas que el libro escribe —"Si" / "No"— y para el aborto ante cualquier
 *  otra: leerla como `activo !== "no"` haría pasar por VIGENTE a un "0", a un
 *  "false" o a una celda vacía, y el error de tipeo se le presentaría al
 *  operador como una discrepancia de estado que sólo se resuelve con un acta.
 *  `context` es el prefijo del mensaje ("socio 38", "fila 40"): quien llama sabe
 *  si está mirando el libro o la planilla. */
export function isWithdrawnRow(activo: string | null | undefined, context: string): boolean {
  const v = (activo ?? "").trim().toLowerCase();
  if (v === "si") return false;
  if (v === "no") return true;
  throw new Error(`${context}: activo debe ser Si/No, vino "${activo ?? ""}"`);
}

/** Datos para pisar una ficha que YA existe (`import-padron.ts --update-existing`).
 *  Es el mapeo del Excel con UNA excepción: `reentryBlocked` se prende, nunca se
 *  apaga.
 *
 *  El porqué: el flag no sale sólo del padrón. `memberService.withdraw` lo prende
 *  al asentar una expulsión desde el panel, o sea DESPUÉS de la foto del libro, y
 *  esa fila del Excel puede seguir diciendo "Mora" por meses. Como `updateMember`
 *  escribe lo que le pasen (su contrato: la lista blanca es del llamador), sin
 *  esta función una corrida con el flag apagaría el bloqueo puesto por acta y
 *  además pisaría el motivo: se perderían las DOS señales que mira
 *  `eligibility.ts:64`, y el expulsado pasaría la puerta del wizard. Mismo
 *  criterio que la regla 2 de `scripts/fix-withdrawal-reasons.ts`. */
export function updateDataForExisting(
  data: MemberImportData,
  current: { reentryBlocked: boolean },
): MemberImportData {
  return { ...data, reentryBlocked: current.reentryBlocked || data.reentryBlocked };
}

export function mapPadronRow(row: RawPadronRow): MappedRow {
  const warnings: string[] = [];
  const n = row.numero_socio;

  const category = CATEGORY[row.categoria_socio.trim().toLowerCase()];
  if (!category) throw new Error(`socio ${n}: categoria_socio desconocida "${row.categoria_socio}"`);

  const status: MemberStatus = isWithdrawnRow(row.activo, `socio ${n}`) ? "withdrawn" : "active";

  const { reason, warning } = mapWithdrawalReason(row.motivo_baja);
  if (warning) warnings.push(`socio ${n}: ${warning}`);

  const dni = text(row.dni);
  if (!dni) warnings.push(`socio ${n}: sin DNI${status === "active" ? " (requerido antes del Módulo 6)" : ""}`);

  if (status === "withdrawn" && !row.fecha_egreso) warnings.push(`socio ${n}: baja sin fecha_egreso`);

  const email = text(row.email)?.toLowerCase() ?? null;

  return {
    memberNumber: n,
    warnings,
    member: {
      fullName: row.apellido_nombre.trim(),
      dni,
      birthDate: row.fecha_nacimiento ? excelDateToCivilUtc(row.fecha_nacimiento) : null,
      civilStatus: text(row.estado_civil),
      nationality: text(row.nacionalidad),
      occupation: text(row.ocupacion),
      phone: text(row.telefono),
      streetText: text(row.calle),
      streetNumber: text(row.altura),
      neighborhood: text(row.barrio),
      email,
      emailStatus: email ? "declared" : "none",
      category,
      status,
      withdrawalReason: status === "withdrawn" ? reason : null,
      // Defensa en profundidad (REG-04). El motivo es editable desde el panel y
      // `checkEligibility` mira las DOS señales —`reentryBlocked` O el motivo—:
      // si alguien le cambia el motivo a una ficha de expulsado, el flag es lo
      // único que sobrevive. Mismo criterio que `memberService.withdraw`
      // (`service.ts:109`), que también lo prende al asentar la expulsión.
      // Este valor es el del ALTA. Para pisar una ficha existente
      // (`--update-existing`) no se usa tal cual: pasa por
      // `updateDataForExisting`, que nunca baja un flag ya prendido. Si siguiera
      // al Excel como el motivo, esa corrida apagaría el bloqueo asentado por un
      // acta posterior a la foto del padrón —y con el motivo pisado en la misma
      // escritura no quedaría NINGUNA de las dos señales de `eligibility.ts:64`.
      reentryBlocked: status === "withdrawn" && reason === "expulsion",
      joinedAt: excelDateToCivilUtc(row.fecha_ingreso),
      leftAt: row.fecha_egreso ? excelDateToCivilUtc(row.fecha_egreso) : null,
      debtAtWithdrawal: yes(row.deuda_tesoreria),
      autoDebit: yes(row.debito_automatico),
    },
  };
}
