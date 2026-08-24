import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormMessage } from "@/components/admin/form-message";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { MiTabs } from "@/components/mi/mi-tabs";
import { requireMember } from "@/lib/auth/require-member";
import { MI_TABS } from "@/lib/mi/nav";
import { suspensionNotice } from "@/lib/mi/suspension";

function Shell({
  children,
  banner,
  showTabs = true,
}: {
  children: React.ReactNode;
  banner?: React.ReactNode;
  showTabs?: boolean;
}) {
  return (
    <div className="min-h-screen bg-secondary/40">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>
      <header className="border-b-4 border-primary bg-background">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 pt-3 pb-1">
          <Link
            href="/mi"
            className="flex min-h-12 items-center gap-3 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* El texto de al lado ya nombra a la institución: alt="" como en
                site-header.tsx. */}
            <Image src="/logo-header.png" alt="" width={40} height={40} sizes="40px" className="h-9 w-auto" />
            <span className="leading-tight">
              <span className="block font-semibold">Vecinal Ciudadela</span>
              <span className="block text-xs text-muted-foreground">Panel de socio</span>
            </span>
          </Link>
          <SignOutButton />
        </div>
        {showTabs && (
          <div className="mx-auto w-full max-w-2xl px-4">
            <MiTabs tabs={MI_TABS} />
          </div>
        )}
      </header>
      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-2xl space-y-4 p-4 outline-hidden">
        {banner}
        {children}
      </main>
    </div>
  );
}

export default async function MiLayout({ children }: { children: React.ReactNode }) {
  // La autorización real vive en cada página y cada action (el layout corre en
  // paralelo y no las protege). Acá sólo se decide el chrome. El suspendido
  // entra en modo lectura (spec M5 §5) y su banner vive acá para que TODAS las
  // secciones lo muestren sin repetirlo.
  const actor = await requireMember({ allowSuspended: true });
  if (actor.ok) {
    const banner = actor.suspension ? (
      <FormMessage kind="warning" box>
        {suspensionNotice(actor.suspension)}
      </FormMessage>
    ) : undefined;
    return <Shell banner={banner}>{children}</Shell>;
  }

  // Sin sesión: al login. Con sesión pero sin habilitación NO se puede
  // redirigir a /ingresar (rebote infinito /ingresar → /redirigir → /mi por el
  // rol del token): se explica el motivo y se ofrece salir. Sin pestañas: no se
  // le muestra el mapa del panel a quien no está habilitado (mismo criterio que
  // el layout admin).
  if (actor.reason === "anonymous") redirect("/ingresar");
  return (
    <Shell showTabs={false}>
      <div className="space-y-3 rounded-xl border bg-background p-4">
        <h1 className="text-xl font-bold">Tu panel no está disponible</h1>
        <FormMessage kind="error">{actor.error}</FormMessage>
      </div>
    </Shell>
  );
}
