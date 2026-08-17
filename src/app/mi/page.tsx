import { auth } from "@/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata = { title: "Mi cuenta — Vecinal Ciudadela" }

const sections = [
  { title: "Mis datos", description: "Tus datos personales y de contacto en el padrón." },
  { title: "Mi cuenta", description: "Estado de tus cuotas y tus recibos." },
  { title: "Pagar", description: "Pagá tu cuota social con Mercado Pago." },
]

export default async function MiHomePage() {
  const session = await auth()
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Hola, {session?.user.name ?? "vecino/a"}</h1>
        <p className="text-muted-foreground">
          Acá vas a poder ver tus datos y el estado de tu cuota. Todavía estamos terminando esta
          parte.
        </p>
      </div>
      <div className="space-y-4">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="inline-block rounded bg-muted px-2 py-1 text-xs font-medium">
                Próximamente
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
