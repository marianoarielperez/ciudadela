// Construcción pura del padrón exportable a Excel: nada de acá toca la base ni
// ExcelJS, así que se testea sin fakes de infraestructura. `route.ts` sólo arma
// el Workbook con `PADRON_EXPORT_COLUMNS` y llena filas con `buildExportRow`.
import type { Member, Street } from "@/generated/prisma/client";
import {
  CATEGORY_LABELS, EMAIL_STATUS_LABELS, REASON_LABELS, STATUS_LABELS,
} from "@/lib/members/labels";
import type { PadronFilters } from "@/lib/members/query";

export type ExportMember = Member & { street: Street | null };

export type PadronExportInput = { memberNumber: number; member: ExportMember };

// `in`/`out` quedan como `Date | null`, no como texto DD/MM/AAAA: un socio
// recibe el padrón para trabajar fuera del sistema y ordenar/filtrar por fecha
// de ingreso o egreso. Un texto DD/MM/AAAA ordena mal (compara día antes que
// año), así que la fecha va nativa con formato de celda `dd/mm/yyyy` — se ve
// igual que en el resto del panel, pero Excel la trata como fecha de verdad.
// La conversión Date -> serial de Excel usa el epoch absoluto (ver
// exceljs/lib/utils/utils.js:dateToExcel), y las fechas civiles de este
// sistema se guardan a mediodía UTC (src/lib/dates.ts): mediodía cae siempre
// dentro del mismo día calendario, así que no hace falta re-anclar nada acá.
export type PadronExportRow = {
  n: number;
  name: string;
  dni: string;
  cat: string;
  st: string;
  email: string;
  es: string;
  phone: string;
  addr: string;
  nb: string;
  in: Date;
  out: Date | null;
  reason: string;
  debt: string;
  ad: string;
};

// Encabezados y anchos acordados con la comisión (ver task-16-brief.md). Un
// solo lugar para el orden de columnas: la route arma `ws.columns` con esto y
// el test de arriba lo compara contra la lista pactada.
export const PADRON_EXPORT_COLUMNS = [
  { header: "numero_socio", key: "n", width: 12 },
  { header: "apellido_nombre", key: "name", width: 32 },
  // numFmt "@" (texto): el DNI es una cadena de dígitos, no una cantidad. Sin
  // esto Excel igual lo guarda como texto (viene de un string de JS), pero
  // marca la celda con el triángulo verde "número guardado como texto".
  { header: "dni", key: "dni", width: 12, style: { numFmt: "@" } },
  { header: "categoria", key: "cat", width: 14 },
  { header: "estado", key: "st", width: 12 },
  { header: "email", key: "email", width: 30 },
  { header: "email_estado", key: "es", width: 14 },
  // Mismo motivo que el DNI: hay teléfonos que empiezan con 0 (característica).
  { header: "telefono", key: "phone", width: 16, style: { numFmt: "@" } },
  { header: "domicilio", key: "addr", width: 30 },
  { header: "barrio", key: "nb", width: 16 },
  { header: "fecha_ingreso", key: "in", width: 14, style: { numFmt: "dd/mm/yyyy" } },
  { header: "fecha_egreso", key: "out", width: 14, style: { numFmt: "dd/mm/yyyy" } },
  { header: "motivo_baja", key: "reason", width: 22 },
  { header: "deuda_tesoreria", key: "debt", width: 14 },
  { header: "debito_automatico", key: "ad", width: 16 },
] as const;

// El domicilio puede venir del catálogo de calles (streetId -> Street.name,
// socios del barrio) o como texto libre (streetText, socios fuera del
// barrio). Sólo uno de los dos está poblado por diseño del alta; si ninguno
// lo está (ficha incompleta) el campo queda vacío en vez de "undefined".
export function memberAddress(member: Pick<ExportMember, "street" | "streetText" | "streetNumber">): string {
  const streetName = member.street?.name ?? member.streetText ?? "";
  return [streetName, member.streetNumber].filter(Boolean).join(" ").trim();
}

// El padrón es dato sensible (DNIs, domicilios, teléfonos — Ley 25.326): el
// asiento de auditoría tiene que decir QUIÉN exportó, CON QUÉ FILTROS y
// CUÁNTAS filas, pero nunca los datos personales de esas filas. `category`,
// `status`, `email` y `dni` son valores de un enum cerrado (no hay problema en
// guardarlos), pero `q` es texto libre que el operador tipeó a mano — un
// apellido o un DNI completo — así que acá se cambia por un booleano: queda
// registrado que se buscó algo, no qué.
export type AuditablePadronFilters = Omit<PadronFilters, "q"> & { hasQuery: boolean };

export function sanitizeFiltersForAudit(f: PadronFilters): AuditablePadronFilters {
  const { q, ...rest } = f;
  return { ...rest, hasQuery: q !== undefined && q !== "" };
}

export function buildExportRow({ memberNumber, member }: PadronExportInput): PadronExportRow {
  return {
    n: memberNumber,
    name: member.fullName,
    dni: member.dni ?? "",
    cat: CATEGORY_LABELS[member.category],
    st: STATUS_LABELS[member.status],
    email: member.email ?? "",
    es: EMAIL_STATUS_LABELS[member.emailStatus],
    phone: member.phone ?? "",
    addr: memberAddress(member),
    nb: member.neighborhood ?? "",
    in: member.joinedAt,
    out: member.leftAt ?? null,
    reason: member.withdrawalReason ? REASON_LABELS[member.withdrawalReason] : "",
    // Mismo guardia que las dos badges del panel (socios/page.tsx y
    // socios/[id]/page.tsx): `debtAtWithdrawal` sobrevive a propósito al
    // reingreso (REG-16, service.ts::readmit) para que M4 pueda calcular la
    // deuda a saldar. Sin el `status === "withdrawn"` acá, un socio readmitido
    // exporta "Vigente" + deuda "Sí" — contradice al resto del sistema y a la
    // planilla que lee la Comisión.
    debt: member.status === "withdrawn" && member.debtAtWithdrawal ? "Sí" : "No",
    ad: member.autoDebit ? "Sí" : "No",
  };
}
