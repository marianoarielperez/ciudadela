import Link from "next/link";

import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSuperadmin } from "@/lib/auth/roles";
import { SITE } from "@/lib/site";

export const metadata = { title: "Panel de administración — SIGeV" };

// Tarjetas agrupadas con el MISMO orden que la lateral (src/lib/admin/nav.ts).
// Acá sí aparecen las secciones futuras como "Próximamente": este es el lugar
// del roadmap; la lateral solo lista lo que funciona.
type DashboardCard = { title: string; description: string; href?: string; cta?: string; superadminOnly?: boolean };
const groups: { label: string; cards: DashboardCard[] }[] = [
  {
    label: "Gestión",
    cards: [
      { title: "Solicitudes", description: "Altas de socios pendientes de revisión y aprobación." },
      { title: "Socios", description: "Padrón, fichas y estado de cada socio.", href: "/admin/socios", cta: "Ver el padrón" },
      {
        title: "Actas",
        description: "Actas de Comisión Directiva y Asamblea donde se asientan los movimientos.",
        href: "/admin/actas",
        cta: "Ver las actas",
      },
      { title: "Tesorería", description: "Cuotas, pagos y conciliación con Mercado Pago." },
    ],
  },
  {
    label: "Contenido",
    cards: [
      { title: "Noticias", description: "Novedades y comunicados del sitio público.", href: "/admin/noticias", cta: "Gestionar noticias" },
      {
        title: "Actividades",
        // Los nombres salen de SITE.rooms, que es de donde también sale el selector
        // del formulario y la grilla pública: si alguna vez se renombra un salón, se
        // renombra en un solo lugar y esta tarjeta no queda mintiendo.
        description: `Calendario del ${SITE.rooms.historic} y el ${SITE.rooms.glass}.`,
        href: "/admin/actividades",
        cta: "Ver el calendario",
      },
    ],
  },
  {
    label: "Sistema",
    cards: [
      {
        title: "Configuración",
        description: "Parámetros del sistema.",
        href: "/admin/configuracion",
        cta: "Abrir",
        superadminOnly: true,
      },
    ],
  },
];

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
      {groups.map((group) => {
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
