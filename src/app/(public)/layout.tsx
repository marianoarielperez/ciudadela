import Image from "next/image"
import Link from "next/link"

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Logo de la Asociación Vecinal del Barrio Ciudadela"
              width={674}
              height={669}
              className="h-10 w-auto"
              priority
            />
            <span className="font-semibold leading-tight">
              Asociación Vecinal
              <br />
              Barrio Ciudadela
            </span>
          </Link>
          <Link href="/ingresar" className="text-sm font-medium text-primary underline">
            Ingresar
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground">
          <p>Asociación Vecinal del Barrio Ciudadela — Comodoro Rivadavia, Chubut</p>
          <p>Sistema SIGeV</p>
        </div>
      </footer>
    </div>
  )
}
