import { SolicitudesTabs } from "@/components/admin/solicitudes-tabs";
import { SOLICITUDES_TABS_BASE } from "@/lib/admin/solicitudes-tabs";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";

// El marco de Solicitudes: SÓLO las pestañas por URL, calcado de
// `tesoreria/layout.tsx`. El encabezado (`PageHeader`, con su <h1>) NO va
// acá — arreglo 1 de la revisión de la tarea 6: el layout ponía uno y cada
// subruta (la lista, el detalle, el resumen) ponía el suyo, así que el
// detalle y el resumen quedaban con DOS <h1> por pantalla. Cada pantalla
// hija pone el suyo: la lista dice "Solicitudes", el detalle el nombre de la
// persona, el resumen "Resumen para acta".
//
// La autorización NO vive acá (Next renderiza layout y página en paralelo):
// cada página sigue llamando a `requireAdmin()` por su cuenta — la bandeja de
// Altas muestra nombres y DNIs de gente que todavía no es socia (Ley 25.326),
// y ese chequeo no se puede heredar de un layout que ya renderizó cuando la
// página decide bloquear.
export default async function SolicitudesLayout({ children }: { children: React.ReactNode }) {
  // Arreglo 6 de la misma revisión: esto SIGUE sin ser la autorización real
  // (la de arriba sigue en pie) — es sólo para no filtrarle el TAMAÑO de la
  // cola (cuántas Altas, cuántas de socios) a un usuario al que el panel ya
  // le revocó el rol. El token de la sesión puede quedar hasta 8 h
  // desactualizado tras una degradación (es exactamente el caso para el que
  // existe `requireAdmin`, que resuelve contra la fila viva de `User`), y sin
  // esta guarda esa persona seguía viendo "Solicitudes · Altas 6 · De socios 1"
  // arriba del mensaje de bloqueo de la página. Mismo criterio que
  // `admin/layout.tsx`: a un bloqueado no se le muestra el mapa de
  // navegación — acá, sin pestañas en vez de pestañas sin números.
  const actor = await requireAdmin();
  if (!actor.ok) return <>{children}</>;

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
      <div className="print:hidden">
        <SolicitudesTabs tabs={tabs} />
      </div>
      {children}
    </div>
  );
}
