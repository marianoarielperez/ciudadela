// One-shot: migra datos/estatuto.pdf al módulo de documentos institucionales
// como norma vigente. Idempotente: si ya existe una norma destacada, no hace
// nada (re-correrlo por error no duplica). Run: npx tsx scripts/import-estatuto.ts
//
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { audit } from "../src/lib/audit";
import { institutionalDocsDir } from "../src/lib/institutional-documents/storage";

const SOURCE = join(process.cwd(), "datos", "estatuto.pdf");

async function main() {
  const existing = await prisma.institutionalDocument.findFirst({
    where: { type: "norm", featured: true },
  });
  if (existing) {
    console.log(`Ya existe una norma vigente ("${existing.title}", id ${existing.id}). No se hace nada.`);
    return;
  }
  const info = await stat(SOURCE); // tira ENOENT si falta: abortar es correcto
  const fileName = `${randomUUID()}.pdf`;
  await mkdir(institutionalDocsDir(), { recursive: true });
  await copyFile(SOURCE, join(institutionalDocsDir(), fileName));
  const doc = await prisma.institutionalDocument.create({
    data: {
      type: "norm",
      title: "Estatuto social",
      description: "El texto completo del estatuto de la asociación.",
      fileName,
      size: info.size,
      featured: true,
      // Sin uploadedById: lo importó el sistema, no un operador.
    },
  });
  await audit({
    action: "institutional_document_create",
    entity: "institutional_document",
    entityId: doc.id,
    detail: { type: "norm", title: doc.title, source: "import-estatuto" },
  });
  console.log(`Estatuto importado como documento ${doc.id} (${fileName}, ${info.size} bytes).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
