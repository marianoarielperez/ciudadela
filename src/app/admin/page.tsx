import Link from "next/link";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_GROUPS } from "@/lib/admin/dashboard-cards";
import { isSuperadmin } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Panel de administración — SIGeV" };

export default async function AdminHomePage() {
  const [session, altasCount, sociosCount] = await Promise.all([
    auth(),
    // Mismas dos queries que `solicitudes/layout.tsx`: el tablero y las
    // pestañas tienen que decir el mismo número. Ninguna de las dos es dato
    // personal (son sólo counts).
    prisma.application.count({
      where: { status: { in: ["pending_payment", "approved_pending_minute", "pending_board"] } },
    }),
    prisma.memberRequest.count({ where: { status: "pending" } }),
  ]);
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
                    {/* Sólo la tarjeta de Solicitudes, y sólo si hay algo
                        pendiente: un "0 · 0" no le dice nada al operador que
                        ya ve la lateral, y `dashboard-cards.ts` no se toca
                        (sus tests de sincronía con la nav siguen intactos) —
                        el desglose lo inyecta esta página. */}
                    {card.href === "/admin/solicitudes" && (altasCount > 0 || sociosCount > 0) && (
                      <p className="font-mono text-xs tabular-nums text-muted-foreground">
                        {altasCount} {altasCount === 1 ? "alta" : "altas"} · {sociosCount} de socios pendientes
                      </p>
                    )}
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
