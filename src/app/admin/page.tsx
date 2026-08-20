import Link from "next/link";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_GROUPS } from "@/lib/admin/dashboard-cards";
import { isSuperadmin } from "@/lib/auth/roles";

export const metadata = { title: "Panel de administración — SIGeV" };

export default async function AdminHomePage() {
  const session = await auth();
  // Solo para mostrar u ocultar la tarjeta (roles del token, hasta 8 h de atraso
  // tras una degradación); el control de acceso real vive en la propia ruta.
  const superadmin = isSuperadmin(session?.user.roles ?? []);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Hola, {session?.user.name ?? "administrador/a"}</h1>
        <p className="text-muted-foreground">
          Estas son las secciones del panel. Se van a ir habilitando a medida que avancemos.
        </p>
      </div>
      {DASHBOARD_GROUPS.map((group) => {
        const cards = group.cards.filter((c) => !c.superadminOnly || superadmin);
        if (cards.length === 0) return null;
        return (
          <section key={group.label} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <Card key={card.title}>
                  <CardHeader>
                    <CardTitle>{card.title}</CardTitle>
                    <CardDescription>{card.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {card.href ? (
                      <Button asChild size="sm">
                        <Link href={card.href}>{card.cta ?? "Abrir"}</Link>
                      </Button>
                    ) : (
                      <Badge variant="secondary">Próximamente</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
