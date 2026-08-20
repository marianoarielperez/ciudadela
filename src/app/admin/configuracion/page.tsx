import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { PageHeader } from "@/components/admin/page-header";
import { FormMessage } from "@/components/admin/form-message";
import { ConfigForm } from "./config-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuración — SIGeV" };

// Firma explícita, como el resto de las páginas del panel: el tipo global
// `PageProps<"...">` solo existe después de que Next genera los tipos de rutas,
// así que `tsc --noEmit` en frío no lo encuentra.
export default async function ConfigPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    // Pantalla de bloqueo, NO redirect, por el mismo motivo que documenta
    // `admin/layout.tsx`: /ingresar manda a /redirigir cuando hay sesión y
    // /redirigir manda a /admin por el rol del token, así que mandar ahí a un
    // admin común —que tiene sesión válida y entra al panel sin problema— lo
    // haría rebotar sin fin. Acá no le falta la sesión: le falta un rol.
    return (
      <div className="space-y-4">
        <PageHeader title="Configuración" />
        <FormMessage kind="error">{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const [asociateActivo, contactPhone, contactEmail] = await Promise.all([
    configReader.getBool(CONFIG_KEYS.asociateActivo),
    configReader.getString(CONFIG_KEYS.contactPhone),
    configReader.getString(CONFIG_KEYS.contactEmail),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="Configuración" />
      {sp.guardado === "1" && (
        <FormMessage kind="success" box>
          Configuración guardada.
        </FormMessage>
      )}
      <ConfigForm
        initial={{
          asociateActivo,
          contactPhone: contactPhone ?? "",
          contactEmail: contactEmail ?? "",
        }}
      />
    </div>
  );
}
