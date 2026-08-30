// El mismo PDF para el panel de admin (verificar lo subido sin sesión de
// socio). Sin auditoría por vista: no es documentación personal.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";
import { pdfDownloadName } from "@/lib/institutional-documents/rules";
import { institutionalDocResponse } from "@/lib/institutional-documents/response";
import { institutionalDocsDir } from "@/lib/institutional-documents/storage";

export async function GET(
  _req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const { id } = await props.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return new Response("El documento no existe", { status: 404 });
  }
  const doc = await prisma.institutionalDocument.findUnique({ where: { id: numericId } });
  if (!doc) return new Response("El documento no existe", { status: 404 });
  // Defensa en profundidad: el fileName viene de la base (lo escribió el
  // storage con un UUID), pero concatenar al filesystem exige revalidar.
  if (!isValidInstitutionalDocFileName(doc.fileName)) {
    return new Response("El documento no existe", { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(institutionalDocsDir(), doc.fileName));
  } catch {
    return new Response("El archivo no está disponible", { status: 404 });
  }
  // La normalización del Buffer vive en el helper, no repetida por handler.
  return institutionalDocResponse(bytes, pdfDownloadName(doc.title));
}
