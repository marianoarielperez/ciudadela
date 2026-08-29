// El CONTENIDO de la "Constancia de asientos del sistema", como función pura.
//
// Por qué existe: el acta del sistema es la constancia de lo que pasó POR el
// sistema. La Comisión decide muchas cosas que el sistema no ve, y en el acta
// real del libro vuelca esas decisiones MÁS estos asientos. Este módulo redacta
// cada asiento como un renglón transcribible —"Se asentó el alta de …"— para
// que la secretaría lo copie al acta junto con el resto (estilo del anexo de
// notificaciones del M6). PDF y Word consumen ESTE modelo: una sola redacción,
// dos formatos, sin poder divergir (la lección de `coverageFloor`).
//
// Lleva datos personales completos (nombre, DNI, N° de socio) por decisión del
// operador (spec 29/08/2026): es el insumo de un documento societario formal.
// La contrapartida vive en la ruta: descarga auditada y sin caché.
//
// `generatedAt` se INYECTA: regla del repo para todo lo testeable (nada de
// leer el reloj en módulos puros).
import type {
  ApplicationStatus, MemberCategory, MinuteType, MovementType, WithdrawalReason,
} from "@/generated/prisma/client";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, REASON_LABELS, minuteName } from "@/lib/members/labels";

export type MinuteExportInput = {
  type: MinuteType;
  number: number;
  date: Date;
  description: string | null;
  movements: Array<{
    type: MovementType;
    member: { fullName: string; dni: string | null };
    /** N° del libro más reciente del socio; null si no tiene membresía. */
    memberNumber: number | null;
    previousCategory: MemberCategory | null;
    newCategory: MemberCategory | null;
    reason: WithdrawalReason | null;
  }>;
  feeValues: Array<{ activeAmount: number; sharedAmount: number; validFrom: Date }>;
  applications: Array<{ fullName: string; dni: string; status: ApplicationStatus }>;
  booksOpened: Array<{ number: number }>;
  booksClosed: Array<{ number: number }>;
  processesCalled: Array<{ bookNumber: number }>;
  processesClosed: Array<{ bookNumber: number }>;
  generatedAt: Date;
};

export type MinuteExportModel = {
  title: string;
  /** "Comisión Directiva N° 124 — 15/08/2026" */
  minuteLabel: string;
  description: string | null;
  sections: Array<{ heading: string; lines: string[] }>;
  totalLine: string;
  footer: string;
  /** "acta-cd-124" — derivado de tipo+número validados, NUNCA de texto libre. */
  fileBase: string;
};

/** "12345678" → "12.345.678". El DNI es una cadena; si trae algo no numérico
 *  (histórico) se muestra tal cual antes que inventar un formato. */
function formatDni(dni: string): string {
  return /^\d+$/.test(dni) ? dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : dni;
}

function who(m: {
  member: { fullName: string; dni: string | null };
  memberNumber: number | null;
}): string {
  const parts: string[] = [];
  parts.push(m.member.dni ? `DNI ${formatDni(m.member.dni)}` : "sin DNI");
  if (m.memberNumber !== null) parts.push(`socio N° ${m.memberNumber}`);
  return `${m.member.fullName} (${parts.join(", ")})`;
}

function category(c: MemberCategory | null): string {
  return c ? CATEGORY_LABELS[c] : "—";
}

function movementLine(mv: MinuteExportInput["movements"][number]): string {
  const w = who(mv);
  switch (mv.type) {
    case "admission":
      return `Se asentó el alta de ${w}.`;
    case "withdrawal":
      return mv.reason
        ? `Se asentó la baja de ${w}, por ${REASON_LABELS[mv.reason].toLowerCase()}.`
        : `Se asentó la baja de ${w}.`;
    case "category_change":
      return `Se asentó el cambio de categoría de ${w}: de ${category(mv.previousCategory)} a ${category(mv.newCategory)}.`;
    case "readmission":
      return `Se asentó el reingreso de ${w}.`;
    case "suspension":
      return `Se asentó la suspensión de ${w}.`;
    case "suspension_end":
      return `Se asentó el fin de la suspensión de ${w}.`;
    case "book_migration":
      return `Se asentó la migración de ${w} al libro siguiente.`;
    case "fee_exemption":
      return `Se asentó la exención de cuota de ${w}.`;
    case "fee_exemption_revoked":
      return `Se asentó la anulación de la exención de cuota de ${w}.`;
  }
}

export function minuteExportModel(input: MinuteExportInput): MinuteExportModel {
  const sections: MinuteExportModel["sections"] = [];

  if (input.movements.length > 0) {
    sections.push({
      heading: "Movimientos de socios",
      lines: input.movements.map(movementLine),
    });
  }
  if (input.feeValues.length > 0) {
    sections.push({
      heading: "Valores de cuota",
      lines: input.feeValues.map(
        (v) =>
          `Se fijó el valor de la cuota social en ${formatARS(v.activeAmount)} (activos) y ` +
          `${formatARS(v.sharedAmount)} (adherentes y colaboradores), con vigencia desde el ` +
          `${formatDateAR(v.validFrom)}.`,
      ),
    });
  }
  if (input.applications.length > 0) {
    sections.push({
      heading: "Solicitudes de asociación",
      lines: input.applications.map((a) => {
        const person = `${a.fullName} (DNI ${formatDni(a.dni)})`;
        return a.status === "rejected"
          ? `Se rechazó la solicitud de asociación de ${person}.`
          : `Se asentó la solicitud de asociación de ${person}.`;
      }),
    });
  }
  const bookLines = [
    ...input.booksOpened.map((b) => `Se dispuso la apertura del Libro de Socios N° ${b.number}.`),
    ...input.booksClosed.map((b) => `Se dispuso el cierre del Libro de Socios N° ${b.number}.`),
  ];
  if (bookLines.length > 0) sections.push({ heading: "Libros", lines: bookLines });

  const processLines = [
    ...input.processesCalled.map(
      (p) => `Se convocó al re-empadronamiento de los socios del Libro N° ${p.bookNumber}.`,
    ),
    ...input.processesClosed.map(
      (p) => `Se cerró el proceso de re-empadronamiento del Libro N° ${p.bookNumber}.`,
    ),
  ];
  if (processLines.length > 0) {
    sections.push({ heading: "Re-empadronamiento", lines: processLines });
  }

  const total = sections.reduce((n, s) => n + s.lines.length, 0);
  const totalLine =
    total === 0
      ? "Sin asientos registrados en el sistema bajo esta acta."
      : total === 1
        ? "1 asiento registrado en el sistema bajo esta acta."
        : `${total} asientos registrados en el sistema bajo esta acta.`;

  return {
    title: "Constancia de asientos del sistema",
    minuteLabel: `${minuteName(input)} — ${formatDateAR(input.date)}`,
    description: input.description,
    sections,
    totalLine,
    footer:
      `Generada por SIGeV el ${formatDateAR(input.generatedAt)}. Documento de uso interno: ` +
      "refleja únicamente los asientos registrados en el sistema, para incorporar al acta del libro.",
    fileBase: `acta-${input.type === "board" ? "cd" : "asamblea"}-${input.number}`,
  };
}
