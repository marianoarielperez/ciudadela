// GET de un archivo de un reporte para el panel (spec §8). Dos decisiones que
// no se ven en el render y que son todo lo que hace segura a esta ruta:
//
//  1. El `reportId` sale de la URL del DUEÑO y viaja en el `where`. Sin ese
//     filtro, `/api/admin/reportes/1/archivos/999` serviría la cara del DNI de
//     otro reporte a cualquier admin que tipeara un número: el `fileId` es
//     autoincremental y adivinarlo es contar.
//  2. Se AUDITA sólo la vista de un DNI. La foto de un bache no es un dato
//     personal; la cara de un documento sí (docs/08), y el asiento es lo que
//     permite responder "¿quién vio este DNI?". Auditar también las fotos
//     llenaría la tabla de ruido y enseñaría a ignorarla.
//
// Las cabeceras defensivas —nosniff, sin caché, CSP de sandbox— salen de
// `reportFileResponse`, y la CSP que llega al navegador la repone la entrada de
// `next.config.ts` (lección CSP/setHeader: el handler solo no alcanza).
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import {
  parsePositiveInt,
  REPORT_FILE_MIME,
  REPORT_FILE_MISSING,
  REPORT_FILE_NOT_FOUND,
  reportFileName,
  reportFileResponse,
} from "@/lib/reports/file-response";
import { reportFileStore } from "@/lib/reports/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id, fileId } = await params;
  const reportId = parsePositiveInt(id);
  const fid = parsePositiveInt(fileId);
  if (reportId === null || fid === null) {
    return new Response(REPORT_FILE_NOT_FOUND, { status: 404 });
  }

  const file = await prisma.reportFile.findFirst({ where: { id: fid, reportId } });
  // Fila ausente = 404, y ese caso incluye el DNI ya purgado por retención:
  // `retention.purge()` BORRA las filas de las dos caras, no las marca (el
  // `dniPurgedAt` queda en el reporte). No hay nada que servir ni que asentar.
  if (!file) return new Response(REPORT_FILE_NOT_FOUND, { status: 404 });
  // El store re-codifica todo a JPEG: una fila con otro mime es una fila que
  // esta ruta no sabe servir, y mentir en el `Content-Type` con `nosniff` puesto
  // sólo daría una imagen rota sin explicación.
  if (file.mime !== REPORT_FILE_MIME) {
    return new Response(REPORT_FILE_NOT_FOUND, { status: 404 });
  }

  let data: Buffer;
  try {
    data = await reportFileStore.read(file);
  } catch {
    // La fila existe pero el archivo no está. Es un 404 honesto y NO se audita:
    // no se vio ningún documento. El error crudo NO se loguea: trae la ruta
    // absoluta en el `message` (Ley 25.326).
    return new Response(REPORT_FILE_MISSING, { status: 404 });
  }

  if (file.kind !== "photo") {
    // Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el
    // módulo realip y la sobrescribe, así que no se puede rotar por request.
    const ip = (await headers()).get("x-real-ip") ?? "unknown";
    // Ids y tipo, nada más (regla del proyecto): ni el nombre del vecino, ni su
    // DNI, ni la ruta del archivo en disco.
    await audit({
      userId: actor.actorId,
      action: "report_dni_view",
      entity: "report_file",
      entityId: file.id,
      detail: { reportId, kind: file.kind },
      ip,
    });
  }

  return reportFileResponse(data, reportFileName(reportId, file.kind, file.id));
}
