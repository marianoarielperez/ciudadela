import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { PageHeader } from "@/components/admin/page-header";
import { AdmitForm } from "./admit-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Alta manual — SIGeV" };

export default async function NuevoSocioPage() {
  const minutes = (await prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }))
    .map((m) => ({ id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}` }));

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="Alta manual"
        breadcrumb={[{ label: "Socios", href: "/admin/socios" }, { label: "Alta manual" }]}
      />
      <p className="text-sm text-muted-foreground">
        El número de socio se asigna automáticamente (siguiente del libro abierto) y la fecha de ingreso
        es la fecha del acta de admisión (REG-11). El resto de la ficha se completa después en modo carga.
      </p>
      <AdmitForm minutes={minutes} />
    </div>
  );
}
