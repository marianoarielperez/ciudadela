// Minimal CSV parser: BOM, CRLF, double-quoted fields with embedded commas.
export function parseCsv(content: string): string[][] {
  const clean = content.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  for (const line of clean.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { fields.push(field); field = ""; }
      else field += ch;
    }
    fields.push(field);
    rows.push(fields.map((f) => f.trim()));
  }
  return rows;
}

export type StreetRow = { id: number; loadOrder: number; name: string };

// Plain non-negative integer, no sign, no decimal point, no exponent.
// Deliberately stricter than Number(): `Number("")` is 0 and passes
// Number.isInteger, so a blank cell would import silently as id 0.
const INTEGER = /^\d+$/;

// Validates one data row of calles_inicial.csv. Returns null for anything
// malformed so the caller can report and skip it.
export function parseStreetRow(row: readonly string[]): StreetRow | null {
  const idRaw = (row[0] ?? "").trim();
  const orderRaw = (row[1] ?? "").trim();
  const name = (row[2] ?? "").trim();

  if (!INTEGER.test(idRaw) || !INTEGER.test(orderRaw) || name === "") return null;

  const id = Number(idRaw);
  // id 0 is exactly the value the old blank-cell bug produced; no real street
  // uses it, so reject it rather than persist a suspicious primary key.
  if (id === 0) return null;

  return { id, loadOrder: Number(orderRaw), name };
}
