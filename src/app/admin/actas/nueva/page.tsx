import Link from "next/link";
import { MinuteForm } from "./minute-form";

export const metadata = { title: "Nueva acta — SIGeV" };

export default function NuevaActaPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/actas" className="hover:underline">Actas</Link> / Nueva
      </p>
      <h1 className="text-2xl font-semibold">Nueva acta</h1>
      <MinuteForm />
    </div>
  );
}
