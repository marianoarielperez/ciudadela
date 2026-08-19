// Idempotent street catalog import. Run: npx tsx scripts/import-calles.ts
// `tsx` no carga `.env` por su cuenta (a diferencia de `prisma db seed`, que
// pasa por prisma.config.ts): sin esto el singleton de Prisma no ve DATABASE_URL.
import "dotenv/config";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { parseCsv, parseStreetRow } from "../src/lib/streets/parse-csv";
import { normalizeStreetName } from "../src/lib/streets/normalize";

async function main() {
  const content = readFileSync(join(process.cwd(), "datos", "calles_inicial.csv"), "utf8");
  const [header, ...rows] = parseCsv(content);
  if (header.join(",") !== "id_calle,orden_carga,nombre_calle") {
    throw new Error(`Unexpected header: ${header.join(",")}`);
  }
  let upserted = 0;
  for (const row of rows) {
    const parsed = parseStreetRow(row);
    if (!parsed) {
      console.warn(`skipping malformed row: ${row.join(",")}`);
      continue;
    }
    const { id, loadOrder, name } = parsed;
    await prisma.street.upsert({
      where: { id },
      create: { id, loadOrder, name, normalizedName: normalizeStreetName(name) },
      update: { loadOrder, name, normalizedName: normalizeStreetName(name) },
    });
    upserted++;
  }
  console.log(`streets upserted: ${upserted}`);
}

main().finally(() => prisma.$disconnect());
