import { redirect } from "next/navigation";

// El estatuto vive ahora en el módulo de documentos institucionales. La ruta
// queda como redirect para no romper marcadores del M5.
export default function MiEstatutoPage() {
  redirect("/mi/documentos");
}
