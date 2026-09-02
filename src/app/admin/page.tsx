import Link from "next/link";

import { auth } from "@/auth";
import { NAV_ICONS } from "@/components/admin/nav-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_GROUPS } from "@/lib/admin/dashboard-cards";
import { formatDashboardDate } from "@/lib/admin/dashboard-date";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { isSuperadmin } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { reports } from "@/lib/reports/service";

export const metadata = { title: "Panel de administración — SIGeV" };

// El ícono de cada tarjeta es el de su sección en la lateral, resuelto por
// href: el test de sincronía (dashboard-cards.test.ts) ya garantiza que cada
// tarjeta con href tiene exactamente un ítem de nav con ese href, así que acá
// no hay un segundo mapa que mantener.
const ICON_BY_HREF = new Map(
  ADMIN_NAV.flatMap((group) => group.items).map((item) => [item.href, NAV_ICONS[item.icon]]),
);

export default async function AdminHomePage() {
  const [session, altasCount, sociosCount, reportesCount] = await Promise.all([
    auth(),
    // Mismas tres queries que `solicitudes/layout.tsx`: el tablero y las
    // pestañas tienen que decir el mismo número. Ninguna de las tres es dato
    // personal (son sólo counts).
    prisma.application.count({
      where: { status: { in: ["pending_payment", "approved_pending_minute", "pending_board"] } },
    }),
    prisma.memberRequest.count({ where: { status: "pending" } }),
    reports.pendingCount(),
  ]);
  // Solo para mostrar u ocultar la tarjeta (roles del token, hasta 8 h de atraso
  // tras una degradación); el control de acceso real vive en la propia ruta.
  const superadmin = isSuperadmin(session?.user.roles ?? []);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Hola, {session?.user.name ?? "administrador/a"}</h1>
        <p className="text-muted-foreground">{formatDashboardDate(new Date())}</p>
      </div>
      {DASHBOARD_GROUPS.map((group) => {
        const cards = group.cards.filter((c) => !c.superadminOnly || superadmin);
        if (cards.length === 0) return null;
        return (
          <section key={group.label} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => {
                const Icon = card.href ? ICON_BY_HREF.get(card.href) : undefined;
                return (
                  <Card key={card.title} className="relative transition-shadow hover:shadow-md">
                    <CardHeader className="gap-2">
                      {Icon && (
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon aria-hidden className="size-5" />
                        </span>
                      )}
                      <CardTitle>
                        {card.href ? (
                          // El link semántico es el título, estirado a toda la
                          // card con el pseudo-elemento: un solo link por
                          // tarjeta, sin interactivos anidados. El anillo de
                          // foco va inset porque la Card recorta con
                          // overflow-hidden.
                          <Link
                            href={card.href}
                            className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                          >
                            {card.title}
                          </Link>
                        ) : (
                          card.title
                        )}
                      </CardTitle>
                      <CardDescription>{card.description}</CardDescription>
                      {/* Sólo la tarjeta de Solicitudes, y sólo si hay algo
                          pendiente: un "0 · 0" no le dice nada al operador que
                          ya ve la lateral, y `dashboard-cards.ts` no se toca
                          (sus tests de sincronía con la nav siguen intactos) —
                          el desglose lo inyecta esta página. */}
                      {card.href === "/admin/solicitudes" && (altasCount > 0 || sociosCount > 0 || reportesCount > 0) && (
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {altasCount} {altasCount === 1 ? "alta" : "altas"} · {sociosCount} de socios pendientes · {reportesCount} {reportesCount === 1 ? "reporte" : "reportes"} sin presentar
                        </p>
                      )}
                    </CardHeader>
                    <CardContent>
                      {card.href ? (
                        // Repite el destino del título para el ojo, no para el
                        // lector de pantalla (el link ya es el título).
                        <p aria-hidden className="text-sm font-medium text-primary group-hover/card:underline">
                          {card.cta ?? "Abrir"} →
                        </p>
                      ) : (
                        <Badge variant="secondary">Próximamente</Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
