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
  if (/domicili|gasoducto|standard|bols/i.test(v)) return { reason: "moved_away" };
  return { reason: "other", warning: `motivo_baja no mapeado: "${v}" (queda como "other")` };
}

const CATEGORY: Record<string, MemberCategory> = { activo: "active", adherente: "adherent" };

export function mapPadronRow(row: RawPadronRow): MappedRow {
  const warnings: string[] = [];
  const n = row.numero_socio;

  const category = CATEGORY[row.categoria_socio.trim().toLowerCase()];
  if (!category) throw new Error(`socio ${n}: categoria_socio desconocida "${row.categoria_socio}"`);

  const activo = row.activo.trim().toLowerCase();
  if (activo !== "si" && activo !== "no") throw new Error(`socio ${n}: activo debe ser Si/No, vino "${row.activo}"`);
  const status: MemberStatus = activo === "si" ? "active" : "withdrawn";

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
      joinedAt: excelDateToCivilUtc(row.fecha_ingreso),
      leftAt: row.fecha_egreso ? excelDateToCivilUtc(row.fecha_egreso) : null,
      debtAtWithdrawal: yes(row.deuda_tesoreria),
      autoDebit: yes(row.debito_automatico),
    },
  };
}
