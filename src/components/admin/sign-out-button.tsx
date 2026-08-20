import { LogOut } from "lucide-react";

import { signOut } from "@/auth";
import { cn } from "@/lib/utils";

// El form de logout estaba copiado byte-idéntico en admin/layout.tsx y
// mi/layout.tsx. `className` gobierna la apariencia completa porque cada shell
// lo viste distinto (link subrayado en /mi, ítem claro sobre la lateral
// oscura). `iconOnly` es para la lateral colapsada: conserva el nombre
// accesible con sr-only + title.
export function SignOutButton({ className, iconOnly = false }: {
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        className={cn("text-sm underline", className)}
        title={iconOnly ? "Cerrar sesión" : undefined}
      >
        {iconOnly ? (
          <>
            <LogOut aria-hidden className="size-4" />
            <span className="sr-only">Cerrar sesión</span>
          </>
        ) : (
          "Cerrar sesión"
        )}
      </button>
    </form>
  );
}
