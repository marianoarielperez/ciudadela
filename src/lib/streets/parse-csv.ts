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
