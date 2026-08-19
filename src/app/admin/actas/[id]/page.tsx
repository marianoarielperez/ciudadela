import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS, MOVEMENT_LABELS } from "@/lib/members/labels";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata = { title: "Acta — SIGeV" };

export default async function ActaPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Con un id no numérico Prisma tiraría un error técnico en inglés; acá es un 404.
  const minuteId = Number(id);
  if (!Number.isInteger(minuteId) || minuteId <= 0) notFound();

  const minute = await prisma.minute.findUnique({
    where: { id: minuteId },
    include: { movements: { include: { member: true }, orderBy: { id: "asc" } } },
  });
  if (!minute) notFound();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground"><Link href="/admin/actas" className="hover:underline">Actas</Link></p>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          Acta {MINUTE_TYPE_LABELS[minute.type]} N° {minute.number} — {formatDateAR(minute.date)}
        </h1>
        <Button asChild variant="outline">
          <Link href={`/admin/actas/${minute.id}/editar`}>Editar</Link>
        </Button>
      </div>
      {minute.description && <p>{minute.description}</p>}
      <h2 className="text-lg font-medium">Movimientos asentados</h2>
      {minute.movements.length === 0 && <p className="text-sm text-muted-foreground">Sin movimientos asociados.</p>}
      <ul className="space-y-1">
        {minute.movements.map((mv) => (
          <li key={mv.id} className="text-sm">
            {MOVEMENT_LABELS[mv.type]} — <Link className="text-primary hover:underline" href={`/admin/socios/${mv.memberId}`}>{mv.member.fullName}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
