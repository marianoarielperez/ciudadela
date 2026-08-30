import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/admin/page-header";
import { documentFeaturedBadgeVariant } from "@/lib/admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { DeleteDocumentButton, DocumentForm, type EditableDocument } from "../document-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar documento — SIGeV" };

export default async function EditDocumentPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  const doc = await prisma.institutionalDocument.findUnique({ where: { id: numericId } });
  if (!doc) notFound();
  const editable: EditableDocument = {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    description: doc.description,
    year: doc.year,
    featured: doc.featured,
    fileName: doc.fileName,
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title={doc.title}
        breadcrumb={[{ label: "Documentos", href: "/admin/documentos" }, { label: "Editar" }]}
        actions={
          <>
            {/* La pastilla sale del mapa compartido, como en el listado: el
                verde de "Vigente" se decide en un solo lugar. */}
            {doc.featured && (
              <Badge variant={documentFeaturedBadgeVariant(doc.featured)}>Vigente</Badge>
            )}
            <DeleteDocumentButton doc={editable} />
          </>
        }
      />
      <DocumentForm mode="edit" doc={editable} />
    </div>
  );
}
