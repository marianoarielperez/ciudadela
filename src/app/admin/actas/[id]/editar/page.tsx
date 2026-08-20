import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { PageHeader } from "@/components/admin/page-header";
import { MinuteEditForm } from "./minute-edit-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Editar acta — SIGeV" };

export default async function EditarActaPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Con un id no numérico Prisma tiraría un error técnico en inglés; acá es un 404.
  const minuteId = Number(id);
  if (!Number.isInteger(minuteId) || minuteId <= 0) notFound();

  const minute = await prisma.minute.findUnique({
    where: { id: minuteId },
    include: {
      _count: { select: { movements: true, booksOpened: true, booksClosed: true } },
    },
  });
  if (!minute) notFound();

  // La misma condición que revalida el servidor dentro de la transacción (ver
  // `@/lib/members/minute-edit`): acá sólo se anticipa para que el operador vea
  // el campo bloqueado y el motivo antes de tipear.
  const anchored =
    minute._count.movements + minute._count.booksOpened + minute._count.booksClosed;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Editar acta"
        breadcrumb={[
          { label: "Actas", href: "/admin/actas" },
          {
            label: `${MINUTE_TYPE_LABELS[minute.type]} N° ${minute.number}`,
            href: `/admin/actas/${minute.id}`,
          },
          { label: "Editar" },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Asentada el {formatDateAR(minute.date)}. Corregí lo que se tipeó mal al cargarla desde
        el libro en papel.
      </p>

      <MinuteEditForm
        minute={{
          id: minute.id,
          type: minute.type,
          number: minute.number,
          date: minute.date.toISOString().slice(0, 10),
          description: minute.description,
        }}
        dateLocked={anchored > 0}
        movementCount={minute._count.movements}
      />

      {/* Por qué no hay "Eliminar": ver el encabezado de
          `@/lib/members/minute-edit`. En dos líneas: un acta es una hoja del
          libro que la asociación presenta ante la IGJ y no se borra, y el único
          caso inofensivo —un acta vacía cargada por error— se resuelve
          reescribiéndola desde este mismo formulario. */}
      <p className="max-w-md text-xs text-muted-foreground">
        Las actas no se eliminan: son parte del libro que la asociación presenta ante la IGJ.
        Si cargaste un acta por error y todavía no tiene movimientos, corregile acá el tipo,
        el número y la fecha para convertirla en la que corresponde.
      </p>
    </div>
  );
}
