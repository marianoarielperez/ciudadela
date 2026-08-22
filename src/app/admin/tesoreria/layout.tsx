import { PageHeader } from "@/components/admin/page-header";
import { TreasuryTabs } from "@/components/admin/treasury-tabs";
import { TREASURY_TABS } from "@/lib/admin/treasury-tabs";

// El marco de Tesorería: encabezado + pestañas por URL. La autorización NO vive
// acá (Next renderiza layout y página en paralelo): cada página llama a
// `requireAdmin()` por su cuenta.
export default function TesoreriaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <PageHeader title="Tesorería" />
      <TreasuryTabs tabs={TREASURY_TABS} />
      {children}
    </div>
  );
}
