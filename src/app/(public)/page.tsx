import Image from "next/image"

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 py-20 text-center">
      <Image src="/logo.png" alt="" width={674} height={669} className="h-32 w-auto" priority />
      <h1 className="text-3xl font-bold tracking-tight">
        Asociación Vecinal del Barrio Ciudadela
      </h1>
      <p className="text-lg text-muted-foreground">Sitio en construcción.</p>
    </main>
  )
}
