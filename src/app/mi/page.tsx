import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireMember } from "@/lib/auth/require-member"

export const metadata = { title: "Mi cuenta — Vecinal Ciudadela" }

const sections = [
  { title: "Mis datos", description: "Tus datos personales y de contacto en el padrón." },
  { title: "Mi cuenta", description: "Estado de tus cuotas y tus recibos." },
  { title: "Pagar", description: "Pagá tu cuota social con Mercado Pago." },
]

export default async function MiHomePage() {
  // El layout no protege a la página: Next renderiza los dos en paralelo, así
  // que el `redirect` del layout no impide que el código de la página corra.
  // Cada pantalla (y cada server action) de socio se autoriza a sí misma; lo que
  // se muestra sale de la ficha viva, no del token.
  const actor = await requireMember()
  if (!actor.ok) return null // el layout ya explica por qué
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Hola, {actor.fullName}</h1>
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
