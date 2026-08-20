import Link from "next/link";
import { ActivityForm } from "../activity-form";
import { currentYearAR } from "@/lib/activities/year-param";

export const metadata = { title: "Nueva actividad — SIGeV" };

// El año en curso se resuelve en el servidor y en hora argentina: si lo hiciera
// el formulario (client component) saldría de la zona del navegador, que no es
// la del VPS. `force-dynamic` para que el año no quede congelado en el build.
export const dynamic = "force-dynamic";

export default function NewActivityPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nueva actividad</h1>
        <Link className="text-sm text-primary hover:underline" href="/admin/actividades">
          Volver al calendario
        </Link>
      </div>
      <ActivityForm mode="create" defaultYear={currentYearAR()} />
    </div>
  );
}
