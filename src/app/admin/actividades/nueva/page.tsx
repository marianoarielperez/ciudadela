import Link from "next/link";
import { ActivityForm } from "../activity-form";

export const metadata = { title: "Nueva actividad — SIGeV" };

export default function NewActivityPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nueva actividad</h1>
        <Link className="text-sm text-primary hover:underline" href="/admin/actividades">
          Volver al calendario
        </Link>
      </div>
      <ActivityForm mode="create" />
    </div>
  );
}
