import { PageHeader } from "@/components/admin/page-header";
import { DOCUMENTOS_TABS, initialDocumentosTab } from "@/lib/admin/documentos-tabs";
import { DocumentForm } from "../document-form";

export const metadata = { title: "Subir documento — SIGeV" };

// `?tab=` llega desde la pestaña activa del listado (el botón "Subir documento"
// conserva la query) y preselecciona el tipo; sin él, arranca en Norma.
export default async function NewDocumentPage(props: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const sp = await props.searchParams;
  const tab = initialDocumentosTab(sp);
  // `initialDocumentosTab` sólo devuelve valores de la tabla, así que el find
  // siempre encuentra; el `?? "norm"` es para no escribir un `!` que TypeScript
  // no puede verificar.
  const initialType = DOCUMENTOS_TABS.find((t) => t.value === tab)?.type ?? "norm";
  return (
    <div className="space-y-4">
      <PageHeader
        title="Subir documento"
        breadcrumb={[{ label: "Documentos", href: "/admin/documentos" }, { label: "Nuevo" }]}
      />
      <DocumentForm mode="create" initialType={initialType} />
    </div>
  );
}
