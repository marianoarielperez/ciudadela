// Construcción pura del padrón electoral exportable a Excel (REG-31: la Junta
// pidió "Excel/PDF"; el CSV de la 4C fue una divergencia deliberada que la
// decisión del 27/08/2026 cierra). Nada de acá toca la base ni ExcelJS —patrón
// `members/export.ts`—, así que se testea sin fakes de infraestructura;
// `route.ts` sólo materializa el Workbook con lo que esta función devuelve.
//
// Tres hojas —una por bloque, en el orden de la pantalla— porque cada bloque es
// un documento distinto: la hoja de la mesa, la lista de cobro y la nómina de
// los que aún no llegan a los 90 días. La hoja vacía SE CREA igual, con sólo el
// encabezado: una hoja faltante parece un error de exportación, una vacía
// informa (precedente: resumen-export).
//
// Sin DNI, sin email, sin domicilio (REG-31 + Ley 25.326, pertinencia): las
// columnas son las de la hoja impresa y ni una más.
import type { ElectoralRoll, ElectoralRow } from "@/lib/members/electoral";
import { enabledFrom } from "@/lib/members/electoral";
import { CATEGORY_LABELS } from "@/lib/members/labels";

export type ElectoralExportColumn = {
  header: string;
  key: string;
  width: number;
  style?: { numFmt: string };
};

export type ElectoralExportCell = string | number | Date | null;

export type ElectoralSheetSpec = {
  name: string;
  columns: ElectoralExportColumn[];
  rows: Record<string, ElectoralExportCell>[];
  /** Fila final de totales (sólo la hoja de purga, y sólo si tiene filas). El
   *  monto va en null cuando no hay valor de cuota vigente: celda vacía, nunca
   *  un cero. */
  totals?: Record<string, ElectoralExportCell>;
};

// Fechas nativas con numFmt, no texto DD/MM/AAAA: un texto ordena mal en Excel
// (compara el día antes que el año). `joinedAt` ya vive a mediodía UTC, así que
// no hay que re-anclar nada (mismo razonamiento que members/export.ts:17-22).
const DATE_FMT = { numFmt: "dd/mm/yyyy" } as const;
// Monto nativo con formato moneda: el bloque "a purgar" ES una lista de cobro y
// la Junta suma sobre él en la mesa.
const ARS_FMT = { numFmt: '"$" #,##0.00' } as const;

const BASE_COLUMNS: ElectoralExportColumn[] = [
  { header: "numero_socio", key: "n", width: 12 },
  { header: "apellido_nombre", key: "name", width: 32 },
  { header: "categoria", key: "cat", width: 14 },
  { header: "fecha_ingreso", key: "in", width: 14, style: DATE_FMT },
];

function baseRow(r: ElectoralRow): Record<string, ElectoralExportCell> {
  return {
    // El socio sin número del libro abierto va con la celda VACÍA: el guión es
    // presentación de pantalla, y acá un texto rompería el orden numérico.
    n: r.memberNumber,
    name: r.fullName,
    cat: CATEGORY_LABELS[r.category],
    in: r.joinedAt,
  };
}

export function electoralWorkbookSpec(roll: ElectoralRoll, valued: boolean): ElectoralSheetSpec[] {
  return [
    {
      name: "Habilitados",
      columns: BASE_COLUMNS,
      rows: roll.enabled.map(baseRow),
    },
    {
      name: "Con deuda a purgar",
      columns: [
        ...BASE_COLUMNS,
        { header: "cuotas_adeudadas", key: "fees", width: 12 },
        { header: "monto_a_purgar", key: "amount", width: 16, style: ARS_FMT },
      ],
      rows: roll.toPurge.map((r) => ({ ...baseRow(r), fees: r.arrears, amount: r.debt })),
      totals:
        roll.toPurge.length === 0
          ? undefined
          : {
              name: "Total a purgar",
              fees: roll.purgeFees,
              amount: valued ? roll.purgeAmount : null,
            },
    },
    {
      name: "No habilitados por antigüedad",
      columns: [
        ...BASE_COLUMNS,
        { header: "habilitado_desde", key: "from", width: 16, style: DATE_FMT },
      ],
      rows: roll.withoutSeniority.map((r) => ({ ...baseRow(r), from: enabledFrom(r.joinedAt) })),
    },
  ];
}
