// /admin/salud (spec 4C §8): qué está mal y desde cuándo.
//
// Es un tablero de una mirada, no una herramienta de diagnóstico (D3): el
// detalle fino vive en `pm2 logs sigev` y en las tablas, y eso es un techo real
// —los ids de lo que falló en el reconcile van al log y NO al summary, por la
// decisión de `mp/reconcile.ts:124-127`—. Lo único que escribe acá es el reenvío
// de un recibo que no salió.
//
// La pantalla arranca por el VEREDICTO (`healthAlerts`) y recién después abre
// los seis paneles. El orden no es estético: el martes que todo anda —que es la
// mayoría de los martes— el operador tiene que poder cerrarla después de leer
// una línea. Un tablero que obliga a auditar seis bloques para descubrir que no
// pasa nada se deja de mirar, y entonces tampoco sirve el día que sí pasa.
//
// Sin gráficos.
import { FormMessage } from "@/components/admin/form-message";
import {
  BackupPanel, CronsPanel, FailedNoticesPanel, HealthVerdict, MoneyPanel, MpPanel, PendingReceiptsPanel,
  type ResendRenderer,
} from "@/components/admin/health-panels";
import { PageHeader } from "@/components/admin/page-header";
import { fetchHealth } from "@/lib/admin/health";
import { healthAlerts } from "@/lib/admin/health-alerts";
import { readBackupHealth } from "@/lib/admin/health-backup";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { ResendForm } from "./resend-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Salud — SIGeV" };

// El botón se inyecta en los paneles en vez de importarse desde ellos: así los
// paneles quedan puros y se renderizan en un test sin arrastrar la server action
// (y con ella el cliente de Prisma).
const renderResend: ResendRenderer = ({ kind, id, label }) => (
  <ResendForm kind={kind} id={id} label={label} />
);

export default async function SaludPage() {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    // Pantalla de bloqueo, NO redirect (mismo motivo que /admin/configuracion:
    // acá no falta la sesión, falta un rol, y /redirigir lo mandaría de vuelta).
    return (
      <div className="space-y-4">
        <PageHeader title="Salud" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const now = new Date();
  // El backup se lee del disco y la salud de la base: en paralelo, y ninguna de
  // las dos puede tumbar la pantalla —`readBackupHealth` devuelve un estado para
  // cada forma de no poder leer, en vez de tirar—.
  const [health, backup] = await Promise.all([fetchHealth(prisma, now), readBackupHealth(now)]);
  const alerts = healthAlerts(health, backup);

  return (
    <div className="space-y-6">
      <PageHeader title="Salud">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Las tareas automáticas, el backup, Mercado Pago y los avisos por email. Todo lo que el sistema
          hace solo mientras nadie mira.
        </p>
      </PageHeader>

      <HealthVerdict alerts={alerts} now={now} />

      <CronsPanel crons={health.crons} now={now} />

      {/* Los dos que se leen de un vistazo van uno al lado del otro: cada uno es
          un estado y un puñado de números, no una lista. */}
      <div className="grid gap-4 md:grid-cols-2">
        <BackupPanel backup={backup} now={now} />
        <MpPanel mp={health.mp} now={now} />
      </div>

      <MoneyPanel money={health.money} />

      <FailedNoticesPanel
        failed={health.failed}
        failedEver={health.failedEver}
        renderResend={renderResend}
      />

      <PendingReceiptsPanel receipts={health.receipts} renderResend={renderResend} />
    </div>
  );
}
