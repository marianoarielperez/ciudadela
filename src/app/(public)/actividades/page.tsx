import Link from "next/link";
import type { Metadata } from "next";
import { getActivitiesForYear, getActivityYears } from "@/lib/activities/query";
import { buildDailyAgenda, ROOM_LABELS } from "@/lib/activities/rules";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Actividades — Vecinal Ciudadela",
  description: `Calendario semanal de actividades del ${SITE.rooms.historic} y el ${SITE.rooms.glass}.`,
};

// Año "actual" en hora argentina, no UTC del server: entre las 21 y las 24 del
// 31 de diciembre el server ya está en enero y la página mostraría el año que
// viene mientras el vecino todavía está en el anterior.
function currentYearAR(): number {
  return Number(
    new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
    }).format(new Date()),
  );
}

// "martes, jueves y domingo". Sin Intl.ListFormat para no depender de qué ICU
// trae el Node del VPS.
function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export default async function ActividadesPage({ searchParams }: PageProps<"/actividades">) {
  const sp = await searchParams;
  const years = await getActivityYears(); // descendente, solo años con actividades activas
  const current = currentYearAR();
  // El año en curso manda por sobre el más reciente cargado: si la Comisión ya
  // dejó armado el calendario del año que viene, el vecino que entra hoy tiene
  // que ver el de hoy, no el que todavía no empezó.
  const fallback = years.includes(current) ? current : (years[0] ?? current);
  const requested = typeof sp.anio === "string" ? Number(sp.anio) : NaN;
  const year = Number.isInteger(requested) && years.includes(requested) ? requested : fallback;

  const activities = await getActivitiesForYear(year);
  const agenda = buildDailyAgenda(activities);
  // No alcanza con `activities.length`: una actividad activa con `weekdays`
  // vacío o corrupto no cae en ningún día y dejaría la grilla en blanco sin
  // explicar nada. Lo que decide el estado vacío es lo que se puede mostrar.
  const busyDays = agenda.filter((d) => d.entries.length > 0);
  const freeDays = agenda.filter((d) => d.entries.length === 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      {/* Título y bajada van juntos en el mismo bloque: si el selector de años
          se mete entre los dos, en el celular (donde el flex apila) la bajada
          queda separada del título que describe. En sm+ el selector se va a la
          derecha y quedan los dos en la misma línea. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Actividades {year}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Grilla semanal del {SITE.rooms.historic} y el {SITE.rooms.glass}, en la sede de{" "}
            <Link href="/ubicacion" className="text-primary underline">
              {SITE.address}
            </Link>
            .
          </p>
        </div>
        {years.length > 1 && (
          // min-h-11 en cada año: es el único control de la página y se toca
          // desde el celular, igual que los links del menú.
          <nav aria-label="Elegir año">
            <ul className="flex flex-wrap gap-2">
              {years.map((y) => (
                <li key={y}>
                  <Link
                    href={`/actividades?anio=${y}`}
                    aria-current={y === year ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${
                      y === year
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {y}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      {busyDays.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          Todavía no hay actividades cargadas para {year}. Consultá en la sede vecinal.
        </p>
      ) : (
        <>
          {/* Un solo marcado para las dos lecturas de la misma semana:
              — hasta lg es una lista de días, uno abajo del otro, y los días sin
                nada se resumen en la línea de abajo en vez de ocupar una tarjeta
                cada uno (siete tarjetas de las cuales cuatro dicen "—" son puro
                andamiaje en una pantalla de 375 px);
              — desde lg los siete días son siete columnas y la semana entra de
                un vistazo, que es donde el hueco del miércoles sí informa. */}
          <div className="mt-6 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:gap-2">
            {agenda.map(({ day, label, entries }) => (
              <section
                key={day}
                // El día vacío sigue en la fila de lg para que la semana se lea
                // completa, pero con borde punteado y título atenuado: informa
                // el hueco sin pesar lo mismo que un día con actividades.
                className={`rounded-lg border p-3 ${
                  entries.length === 0 ? "hidden border-dashed lg:block" : ""
                }`}
              >
                <h2
                  className={`text-sm font-semibold ${entries.length === 0 ? "text-muted-foreground" : ""}`}
                >
                  {label}
                </h2>
                {entries.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Sin actividades</p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {entries.map((a) => (
                      // El nombre lo escribe la Comisión y puede ser largo
                      // ("Taekwondo infantil y juvenil"): en una columna de
                      // ~110 px sin esto empuja el ancho de la grilla entera.
                      <li key={`${a.id}-${day}`} className="border-l-2 border-primary/50 pl-2.5">
                        <p className="text-sm font-medium [overflow-wrap:anywhere]">{a.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.startTime} a {a.endTime}
                        </p>
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {ROOM_LABELS[a.room]}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {freeDays.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground lg:hidden">
              Sin actividades: {joinEs(freeDays.map((d) => d.label.toLocaleLowerCase("es-AR")))}.
            </p>
          )}
        </>
      )}
    </main>
  );
}
