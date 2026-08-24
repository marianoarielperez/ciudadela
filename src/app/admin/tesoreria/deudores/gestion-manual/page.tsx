// Lista imprimible de los deudores SIN casilla utilizable (spec 4C §5,
// decisión 2 del operador). El recordatorio de vencimiento cubre a los que
// tienen email; a estos la Comisión los llama o los visita, y para eso necesita
// una hoja con nombre, número, cuántas debe, cuánto y el teléfono.
//
// No hay ningún dato nuevo acá: es exactamente lo que Deudores ya muestra en
// pantalla, con el teléfono que la ficha ya tiene. El encabezado del módulo NO
// se escribe acá arriba: lo pone el layout de Tesorería, y esta pantalla agrega
// el suyo porque es una subruta con identidad propia.
import { headers } from "next/headers";
import Link from "next/link";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { Button } from "@/components/ui/button";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { fetchDebtors } from "@/lib/treasury/debtors";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { ManualCollectionSheet } from "./sheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gestión manual — SIGeV" };

const BASE = "/admin/tesoreria/deudores";

export default async function GestionManualPage() {
  // La ruta se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee: es una
  // hoja con nombres, deudas y teléfonos de vecinos que se imprime y sale del
  // sistema (Ley 25.326), y `requireAdmin` resuelve contra la fila viva de User
  // — el layout mira el token, que puede estar hasta 8 h desactualizado.
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Gestión manual" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const feeValue = await feeValueReader.current();
  // Sin filtros: la hoja es para la Comisión y tiene que traerlos a todos.
  const rows = (await fetchDebtors(prisma, {}, feeValue)).filter((r) => !r.emailUsable);

  // Esta hoja es una lista de datos personales que SALE del sistema: nombres,
  // domicilios, teléfonos y deudas de ~118 vecinos, y en papel no queda ningún
  // control de acceso después (Ley 25.326, docs/08). Mismo criterio que la
  // exportación del padrón (`api/admin/padron-export/route.ts`), que audita por
  // exactamente el mismo motivo.
  //
  // Metadatos únicamente: quién la pidió, desde dónde y cuántas filas —NUNCA un
  // nombre, un teléfono ni un domicilio de esas filas—. El asiento se escribe en
  // cada carga de la pantalla (`force-dynamic`), que es lo más cerca que se puede
  // estar de "se imprimió": el navegador no le avisa al servidor cuando el
  // operador aprieta Imprimir, y a la hoja se la puede fotografiar sin imprimirla.
  //
  // Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el módulo
  // realip y la sobrescribe, así que no se puede rotar por request.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "manual_collection_sheet",
    detail: { rows: rows.length },
    ip,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gestión manual"
        breadcrumb={[{ label: "Deudores", href: BASE }, { label: "Gestión manual" }]}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button asChild variant="outline"><Link href={BASE}>Volver a Deudores</Link></Button>
            <PrintButton />
          </div>
        }
      >
        <p className="max-w-prose text-sm text-muted-foreground">
          Socios con cuotas pendientes que <strong>no</strong> tienen email utilizable: a estos el
          recordatorio de vencimiento no les llega. Deuda valuada al valor de cuota vigente
          {feeValue ? ` desde el ${formatDateAR(feeValue.validFrom)}` : ""}.
        </p>
      </PageHeader>

      <ManualCollectionSheet rows={rows} feeValue={feeValue} printedAt={new Date()} />
    </div>
  );
}
