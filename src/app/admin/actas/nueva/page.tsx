import { PageHeader } from "@/components/admin/page-header";
import { MinuteForm } from "./minute-form";

export const metadata = { title: "Nueva acta — SIGeV" };

export default function NuevaActaPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Nueva acta"
        breadcrumb={[{ label: "Actas", href: "/admin/actas" }, { label: "Nueva" }]}
      />
      <MinuteForm />
    </div>
  );
}
