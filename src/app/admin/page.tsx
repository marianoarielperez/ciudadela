import Link from "next/link"

import { auth } from "@/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SITE } from "@/lib/site"

export const metadata = { title: "Panel de administración — SIGeV" }

const sections: { title: string; description: string; href?: string; cta?: string }[] = [
  { title: "Solicitudes", description: "Altas de socios pendientes de revisión y aprobación." },
  { title: "Socios", description: "Padrón, fichas y estado de cada socio.", href: "/admin/socios", cta: "Ver el padrón" },
  {
    title: "Actas",
    description: "Actas de Comisión Directiva y Asamblea donde se asientan los movimientos.",
    href: "/admin/actas",
    cta: "Ver las actas",
  },
  {
    title: "Actividades",
    // Los nombres salen de SITE.rooms, que es de donde también sale el selector
    // del formulario y la grilla pública: si alguna vez se renombra un salón, se
    // renombra en un solo lugar y esta tarjeta no queda mintiendo.
    description: `Calendario del ${SITE.rooms.historic} y el ${SITE.rooms.glass}.`,
    href: "/admin/actividades",
    cta: "Ver el calendario",
  },
  { title: "Tesorería", description: "Cuotas, pagos y conciliación con Mercado Pago." },
  { title: "Noticias", description: "Novedades y comunicados del sitio público.", href: "/admin/noticias", cta: "Gestionar noticias" },
  { title: "Configuración", description: "Parámetros del sistema y usuarios del panel." },
]

export default async function AdminHomePage() {
  const session = await auth()
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Hola, {session?.user.name ?? "administrador/a"}</h1>
        <p className="text-muted-foreground">
          Estas son las secciones del panel. Se van a ir habilitando a medida que avancemos.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {section.href ? (
                <Link
                  href={section.href}
                  className="inline-block rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:underline"
                >
                  {section.cta ?? "Abrir"}
                </Link>
              ) : (
                <span className="inline-block rounded bg-muted px-2 py-1 text-xs font-medium">
                  Próximamente
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
