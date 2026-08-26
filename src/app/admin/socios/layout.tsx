import { SociosTabs } from "@/components/admin/socios-tabs";
import { SOCIOS_TABS } from "@/lib/admin/socios-tabs";

// El marco de Socios: SÓLO las pestañas por URL, calcado de
// `solicitudes/layout.tsx`. Sin `PageHeader` acá —cada pantalla hija pone su
// propio `<h1>` (el padrón dice "Socios", el detalle el nombre de la
// persona)— por el mismo motivo documentado en `solicitudes/layout.tsx`: dos
// `<h1>` por pantalla fue un bug real cuando el layout ponía uno y la página
// otro.
//
// Sin autorización propia tampoco: `socios/page.tsx` no llama a
// `requireAdmin()` hoy y esta task no lo cambia — hereda la del layout
// `admin/layout.tsx` de más arriba, como toda la sección. A diferencia de
// Solicitudes, acá no hay conteos por bandeja que filtrar a un rol
// degradado: Libros e Histórico todavía no existen (tasks 3 y 4).
export default function SociosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <SociosTabs tabs={SOCIOS_TABS} />
      </div>
      {children}
    </div>
  );
}
