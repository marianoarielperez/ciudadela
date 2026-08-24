import { PageHeader } from "@/components/admin/page-header";
import { TreasuryTabs } from "@/components/admin/treasury-tabs";
import { TREASURY_TABS } from "@/lib/admin/treasury-tabs";

// El marco de Tesorería: encabezado + pestañas por URL. La autorización NO vive
// acá (Next renderiza layout y página en paralelo): cada página llama a
// `requireAdmin()` por su cuenta.
export default function TesoreriaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      {/* El marco no se imprime. `deudores/gestion-manual` es una hoja de trabajo
          que se saca por impresora, y es la única pantalla imprimible del panel
          que vive bajo un layout con pestañas: sin esto la primera página arranca
          con "Tesorería" y una fila de siete links antes del título real. La
          lateral y la barra móvil ya se ocultan por su cuenta (`admin-sidebar`,
          `admin-mobile-nav`); esta era la pieza que faltaba. */}
      <div className="space-y-4 print:hidden">
        <PageHeader title="Tesorería" />
        <TreasuryTabs tabs={TREASURY_TABS} />
      </div>
      {children}
    </div>
  );
}
