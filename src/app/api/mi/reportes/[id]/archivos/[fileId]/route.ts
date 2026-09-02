// El socio ve los archivos de SU reporte (spec §8). Tres diferencias con la
// ruta del panel, y las tres son deliberadas:
//
//  1. El `where` lleva `report: { memberId: actor.memberId }`, y un archivo
//     ajeno —o el de un reporte anónimo, que no tiene socio— responde 404, no
//     403: un 403 confirmaría que ese archivo existe, y los ids son
//     correlativos. `memberId` nulo no matchea nunca contra un número, así que
//     el reporte sin ficha queda afuera por la misma cláusula.
//  2. Sin asiento de auditoría: `report_dni_view` responde "¿quién miró el DNI
//     de otro?", y el socio mirando lo propio no es ese hecho (mismo criterio
//     que `/api/mi/recibos/[id]`).
//  3. `allowSuspended`: el suspendido entra en modo LECTURA (spec M5 §5), así
//     que puede ver los archivos que él mismo subió. El dado de baja no.
//
// `requireMember` resuelve contra la fila viva del padrón, no contra el token.
import { requireMember } from "@/lib/auth/require-member";
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
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id, fileId } = await params;
  const reportId = parsePositiveInt(id);
  const fid = parsePositiveInt(fileId);
  if (reportId === null || fid === null) {
    return new Response(REPORT_FILE_NOT_FOUND, { status: 404 });
  }

  const file = await prisma.reportFile.findFirst({
    where: { id: fid, reportId, report: { memberId: actor.memberId } },
  });
  // Igual que en el panel: la fila ausente cubre el ajeno, el inexistente y el
  // DNI ya purgado por retención (la purga BORRA las filas de las dos caras).
  if (!file) return new Response(REPORT_FILE_NOT_FOUND, { status: 404 });
  if (file.mime !== REPORT_FILE_MIME) {
    return new Response(REPORT_FILE_NOT_FOUND, { status: 404 });
  }

  let data: Buffer;
  try {
    data = await reportFileStore.read(file);
  } catch {
    // Sin log: el error de fs trae la ruta absoluta en el `message`. Sólo el
    // `read` va adentro del try: envolver también la respuesta convertiría un
    // bug de armado de cabeceras en un "no está disponible" que miente.
    return new Response(REPORT_FILE_MISSING, { status: 404 });
  }

  return reportFileResponse(data, reportFileName(reportId, file.kind, file.id));
}
