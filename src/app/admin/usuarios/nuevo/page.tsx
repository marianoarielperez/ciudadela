// Alta de una cuenta de gestión. La pantalla de bloqueo se repite acá tal como
// en Configuración y en Salud (decisión del operador: no se extrae a un
// componente), y no es un redirect: el rebote /ingresar → /redirigir → /admin
// marearía a un admin común con sesión válida.
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { requireSuperadminUsers } from "@/lib/auth/require-admin";
import { NewUserForm } from "./new-user-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Nuevo usuario — SIGeV" };

export default async function NuevoUsuarioPage() {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Nuevo usuario de gestión" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        // La entidad va en el <h1>; la última miga es un sustantivo corto.
        title="Nuevo usuario de gestión"
        // "Nuevo", no "Nueva": las tres migas que ya existen ("Nueva" en actas,
        // actividades y noticias) concuerdan con entidades femeninas y ésta es
        // la primera masculina.
        breadcrumb={[{ label: "Usuarios", href: "/admin/usuarios" }, { label: "Nuevo" }]}
      >
        <p className="text-sm text-muted-foreground">
          La cuenta nace con rol Admin y una invitación por correo para crear su contraseña.
          Si además tiene que ser superadmin, el rol se otorga después desde su detalle.
        </p>
      </PageHeader>

      {/* La action rechaza el email de la ficha de un socio con este mismo
          criterio (`memberCardEmail`). Decirlo ACÁ, antes de que el operador lo
          intente, le ahorra el rechazo y le da el camino correcto. */}
      <FormMessage kind="neutral" box as="div" className="max-w-md space-y-2">
        <p className="font-medium text-foreground">¿La persona a la que querés dar acceso ya es socia?</p>
        <p>
          No le crees una cuenta aparte. Si ya tiene cuenta, buscala en Usuarios y otorgale el
          rol sobre esa cuenta: los roles se acumulan, así que sigue entrando a su panel de
          socio como siempre.
        </p>
        <p>
          Si todavía no canjeó su acceso, mandale primero el acceso de socio desde su ficha y
          después otorgale el rol.
        </p>
      </FormMessage>

      <NewUserForm />
    </div>
  );
}
