import { PageHeader } from "@/components/admin/page-header";
import { NewsForm } from "../news-form";

export const metadata = { title: "Nueva noticia — SIGeV" };

export default function NewNewsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Nueva noticia"
        breadcrumb={[{ label: "Noticias", href: "/admin/noticias" }, { label: "Nueva" }]}
      />
      <NewsForm mode="create" />
    </div>
  );
}
