// Un documento institucional para el socio logueado. Sin auditoría por vista a
// propósito: no es documentación personal (esa regla queda para DNIs y
// facturas); la auditoría de este módulo es de gestión, en las actions.
// El suspendido lee (modo lectura del panel); el dado de baja no (requireMember).
import { requireMember } from "@/lib/auth/require-member";
import { loadInstitutionalDocFile } from "@/lib/institutional-documents/file-load";
import {
  INSTITUTIONAL_DOC_NOT_FOUND,
  institutionalDocResponse,
} from "@/lib/institutional-documents/response";
import { pdfDownloadName } from "@/lib/institutional-documents/rules";

export async function GET(
  _req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  // La guarda va primero y acá: sin sesión no se toca la base.
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const { id } = await props.params;
  // El parseo del id, la consulta, la revalidación del fileName y la lectura
  // del disco viven en el módulo: las dos rutas no pueden divergir.
  const file = await loadInstitutionalDocFile(id);
  if (!file) return new Response(INSTITUTIONAL_DOC_NOT_FOUND, { status: 404 });
  // La normalización del Buffer vive en el helper, no repetida por handler.
  return institutionalDocResponse(file.bytes, pdfDownloadName(file.title));
}
