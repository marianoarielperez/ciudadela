import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ActivityForm, DeleteActivityButton } from "../activity-form";
import type { ActivitySlot } from "@/lib/activities/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar actividad — SIGeV" };

// Firma explícita, como el resto de las páginas dinámicas del panel: el tipo
// global `PageProps<"...">` solo existe después de que Next genera los tipos de
// rutas, así que `tsc --noEmit` en frío no lo encuentra.
export default async function EditActivityPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  const a = await prisma.activity.findUnique({ where: { id: numericId } });
  if (!a) notFound();
  const activity: ActivitySlot = {
    id: a.id,
    name: a.name,
    room: a.room as "historic" | "glass",
    // Mismo criterio defensivo que `toSlot` en query.ts: un JSON corrupto deja
    // el grupo de días vacío en vez de romper el render del formulario.
    weekdays: Array.isArray(a.weekdays) ? (a.weekdays as number[]) : [],
    startTime: a.startTime,
    endTime: a.endTime,
    year: a.year,
    active: a.active,
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Editar actividad</h1>
        <Link className="text-sm text-primary hover:underline" href="/admin/actividades">
          Volver al calendario
        </Link>
      </div>
      <ActivityForm mode="edit" activity={activity} />
      <DeleteActivityButton id={activity.id} name={activity.name} />
    </div>
  );
}
