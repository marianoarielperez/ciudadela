import { PageHeader } from "@/components/admin/page-header";
import { SolicitudesTabs } from "@/components/admin/solicitudes-tabs";
import { SOLICITUDES_TABS_BASE } from "@/lib/admin/solicitudes-tabs";
import { prisma } from "@/lib/prisma";

// El marco de Solicitudes: encabezado + pestañas por URL, calcado de
// `tesoreria/layout.tsx`. La autorización NO vive acá (Next renderiza layout
// y página en paralelo): cada página sigue llamando a `requireAdmin()` por su
// cuenta — la bandeja de Altas muestra nombres y DNIs de gente que todavía no
// es socia (Ley 25.326), y ese chequeo no se puede heredar de un layout que
// ya renderizó cuando la página decide bloquear.
//
// Los DOS contadores se consultan acá y no en cada página: son lo que las
// pestañas necesitan para mostrarse, y sacarlos del layout evitaría que
// alguna vista nueva bajo esta sección se olvide de pedirlos. Ninguno de los
// dos es dato personal (son sólo counts), así que no hace falta guardarlos
// detrás de `requireAdmin` acá.
export default async function SolicitudesLayout({ children }: { children: React.ReactNode }) {
  const [altasCount, sociosCount] = await Promise.all([
    // Las tres bandejas vivas de Altas (RECORDABLE_STATUSES más
    // `pending_payment`, que todavía no se puede asentar pero sigue siendo
    // trabajo pendiente de la cola).
    prisma.application.count({
      where: { status: { in: ["pending_payment", "approved_pending_minute", "pending_board"] } },
    }),
    prisma.memberRequest.count({ where: { status: "pending" } }),
  ]);
  const tabs = SOLICITUDES_TABS_BASE.map((tab) => ({
    ...tab,
    count: tab.href === "/admin/solicitudes" ? altasCount : sociosCount,
  }));

  return (
    <div className="space-y-4">
      <div className="space-y-4 print:hidden">
        <PageHeader title="Solicitudes" />
        <SolicitudesTabs tabs={tabs} />
      </div>
      {children}
    </div>
  );
}
