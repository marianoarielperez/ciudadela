// El mismo PDF para el panel de admin (verificar lo subido sin sesión de
// socio). Sin auditoría por vista: no es documentación personal.
import { requireAdmin } from "@/lib/auth/require-admin";
import { pdfDownloadName } from "@/lib/institutional-documents/rules";
import {
  INSTITUTIONAL_DOC_NOT_FOUND,
  institutionalDocResponse,
  loadInstitutionalDocFile,
} from "@/lib/institutional-documents/response";

export async function GET(
  _req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  // La guarda va primero y acá: sin sesión no se toca la base.
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const { id } = await props.params;
  // Misma carga que la ruta del socio, misma función: la revalidación del
  // fileName ya no se puede olvidar en una de las dos.
  const file = await loadInstitutionalDocFile(id);
  if (!file) return new Response(INSTITUTIONAL_DOC_NOT_FOUND, { status: 404 });
  // La normalización del Buffer vive en el helper, no repetida por handler.
  return institutionalDocResponse(file.bytes, pdfDownloadName(file.title));
}
