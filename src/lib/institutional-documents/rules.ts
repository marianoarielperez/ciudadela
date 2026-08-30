// Reglas de negocio de los documentos institucionales. Puro: sin Prisma, sin
// fs, sin lucide — las comparten las actions del admin, las dos pantallas y el
// script de importación, así que un cambio acá no puede divergir por camino
// (la lección de coverageFloor).
import type { InstitutionalDocumentType } from "@/generated/prisma/client";
import { slugify } from "@/lib/news/slug";

export const DOCUMENT_TYPE_LABELS: Record<InstitutionalDocumentType, string> = {
  norm: "Norma",
  annual_report: "Memoria",
  balance: "Balance",
  other: "Otro documento",
};

// El artículo por tipo, para mensajes en castellano ("una Memoria", "un Balance").
const TYPE_ARTICLE: Record<InstitutionalDocumentType, "un" | "una"> = {
  norm: "una",
  annual_report: "una",
  balance: "un",
  other: "un",
};

/** "de la Memoria" / "del Balance": la preposición sale del artículo del tipo,
 *  nunca hardcodeada — con "de la" fijo, el balance salía "de la Balance". */
function typePreposition(type: InstitutionalDocumentType): "de la" | "del" {
  return TYPE_ARTICLE[type] === "una" ? "de la" : "del";
}

export function requiresYear(type: InstitutionalDocumentType): boolean {
  return type === "annual_report" || type === "balance";
}

export type PreparedDocument = {
  type: InstitutionalDocumentType;
  title: string;
  description: string | null;
  year: number | null;
  yearKey: string | null;
  featured: boolean;
};

/** Normaliza y valida lo que llega del formulario. Deriva el título de
 *  memorias/balances ("Memoria 2025"), materializa el yearKey solo para los
 *  tipos con unicidad anual y apaga `featured` fuera de las normas (el
 *  formulario no lo ofrece ahí; un POST forjado no puede colarlo). */
export function prepareDocumentInput(input: {
  type: InstitutionalDocumentType;
  title?: string;
  description?: string;
  year?: number;
  featured?: boolean;
}): { ok: true; data: PreparedDocument } | { ok: false; error: string } {
  const { type } = input;
  const year = input.year ?? null;
  if (requiresYear(type)) {
    if (year === null) {
      return {
        ok: false,
        error: `Ingresá el año ${typePreposition(type)} ${DOCUMENT_TYPE_LABELS[type]}.`,
      };
    }
    return {
      ok: true,
      data: {
        type,
        title: `${DOCUMENT_TYPE_LABELS[type]} ${year}`,
        description: input.description?.trim() || null,
        year,
        yearKey: `${type}:${year}`,
        featured: false,
      },
    };
  }
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "Ingresá el título del documento." };
  return {
    ok: true,
    data: {
      type,
      title,
      description: input.description?.trim() || null,
      year,
      yearKey: null,
      // Solo una norma puede ser la vigente destacada de /mi/documentos.
      featured: type === "norm" && input.featured === true,
    },
  };
}

/** Mensaje del P2002 de `yearKey`, legible por el operador. */
export function duplicateYearMessage(type: InstitutionalDocumentType, year: number): string {
  const article = TYPE_ARTICLE[type];
  const suffix = article === "una" ? "cargada: editá la existente." : "cargado: editá el existente.";
  return `Ya hay ${article} ${DOCUMENT_TYPE_LABELS[type]} ${year} ${suffix}`;
}

/** Nombre con el que el navegador guarda el PDF ("memoria-2025.pdf"). */
export function pdfDownloadName(title: string): string {
  return `${slugify(title)}.pdf`;
}
