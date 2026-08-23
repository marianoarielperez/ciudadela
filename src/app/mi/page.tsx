import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireMember } from "@/lib/auth/require-member"

export const metadata = { title: "Mi cuenta — Vecinal Ciudadela" }

// `cta` es opcional: la mayoría de las tarjetas dicen "Ver →". La de pagar dice
// lo que hace, porque es la única que arranca un trámite con plata y el vecino
// tiene que reconocerla de un vistazo desde el celular.
const sections: Array<{ title: string; description: string; href?: string; cta?: string }> = [
  { title: "Mis datos", description: "Tus datos personales y de contacto en el padrón." },
  { title: "Mi cuenta", description: "Estado de tus cuotas y tus recibos.", href: "/mi/cuenta" },
  {
    title: "Pagar",
    description: "Pagá tu cuota social con Mercado Pago.",
    href: "/mi/cuenta#pagar",
    cta: "Pagar ahora →",
  },
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
          Acá ves tus datos, el estado de tu cuota y podés pagar con Mercado Pago.
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
              {section.href ? (
                <Link
                  className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
                  href={section.href}
                >
                  {section.cta ?? "Ver →"}
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
