import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getActivitiesForYear, getActivityYears } from "@/lib/activities/query";
import { buildDailyAgenda, ROOM_LABELS } from "@/lib/activities/rules";
import {
  activitiesYearHref,
  currentYearAR,
  resolveActivitiesYear,
} from "@/lib/activities/year-param";
import { SITE, siteBaseUrl } from "@/lib/site";

const DESCRIPTION = `Calendario semanal de actividades del ${SITE.rooms.historic} y el ${SITE.rooms.glass}.`;

export async function generateMetadata({
  searchParams,
}: PageProps<"/actividades">): Promise<Metadata> {
  const sp = await searchParams;
  // Misma consulta cacheada que el render: el año resuelto es el que manda,
  // así el canonical de ?anio=1999 apunta al año que realmente se muestra.
  const { year, canonicalHref } = resolveActivitiesYear(
    sp.anio,
    await getActivityYears(),
    currentYearAR(),
  );
  return {
    title: `Actividades ${year} — Vecinal Ciudadela`,
    description: `${DESCRIPTION} Año ${year}.`,
    alternates: { canonical: new URL(canonicalHref, siteBaseUrl()).toString() },
  };
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
  const { year, fallback, canonicalHref, isCanonical } = resolveActivitiesYear(
    sp.anio,
    years,
    currentYearAR(),
  );

  // Redirigir cuando la URL pedida NO es la canónica del año que se va a
  // mostrar (mismo criterio que /noticias): ?anio=abc, ?anio=%202025,
  // ?anio=2025.0 y ?anio=1999 muestran todos lo mismo que alguna URL canónica
  // y sin esto quedarían cuatro direcciones vivas para el mismo contenido.
  if (!isCanonical) redirect(canonicalHref);

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
                    // Href canónico, no `?anio=${y}` siempre: el año por
                    // defecto vive en /actividades a secas y linkearlo con el
                    // query param mandaría al vecino por un redirect al pedo.
                    href={activitiesYearHref(y, fallback)}
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
                un vistazo, que es donde el hueco del miércoles sí informa.
              Sin `items-start`: el `stretch` que trae grid por default empareja
              la altura de las tarjetas de cada fila. Con items-start las siete
              columnas quedaban dentadas (290/66/290/66/210/106/66 px), que es
              exactamente lo contrario de "la semana de un vistazo". */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:gap-2">
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
