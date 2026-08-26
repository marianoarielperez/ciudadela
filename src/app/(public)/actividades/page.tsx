import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getActivitiesForYear, getActivityYears } from "@/lib/activities/query";
import { buildDailyAgenda, initialAgendaDay } from "@/lib/activities/rules";
import {
  activitiesYearHref,
  currentWeekdayAR,
  currentYearAR,
  resolveActivitiesYear,
} from "@/lib/activities/year-param";
import { SITE, siteBaseUrl } from "@/lib/site";
import { ActivityCard } from "./activity-card";
import { DayTabs } from "./day-tabs";

// Explícito, como en las tres rutas de /admin/actividades: esta página depende
// del DÍA argentino (el chip "Hoy" y el día que trae elegido el selector del
// celular). Hoy ya es dinámica de hecho porque espera `searchParams`, pero eso
// es un efecto de borde del `?anio=`: si mañana se saca el parámetro, la ruta
// se prerenderiza sin avisar y "Hoy" queda congelado en el día del build.
export const dynamic = "force-dynamic";

const DESCRIPTION = "Calendario semanal de actividades de la sede: salones, cocina y aulas.";

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

export default async function ActividadesPage({ searchParams }: PageProps<"/actividades">) {
  const sp = await searchParams;
  const years = await getActivityYears(); // descendente, solo años con actividades activas
  // Un solo `currentYearAR()` para el render entero: si se llamara otra vez más
  // abajo, un render que cruce la medianoche del 31/12 resolvería el año con un
  // valor y decidiría el chip "Hoy" con otro.
  const currentYear = currentYearAR();
  const { year, fallback, canonicalHref, isCanonical } = resolveActivitiesYear(
    sp.anio,
    years,
    currentYear,
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
  // Hoy en hora argentina, para marcar la columna de hoy en el escritorio y
  // abrir el selector del celular en el día que el vecino está mirando.
  const todayAR = currentWeekdayAR();
  // Un domingo no hay día que elegir —la semana va de lunes a sábado— y el
  // selector abre en el primero. La regla vive en `rules.ts`, con WEEKDAYS y
  // con su test: acá era la única lógica nueva de la pantalla y esta página no
  // tiene tests de render, así que una simplificación futura a `todayAR` pelado
  // pasaba la suite en verde.
  const initialDay = initialAgendaDay(agenda, todayAR);
  // El chip "Hoy" sólo tiene sentido sobre la semana del año en curso: en el
  // calendario de 2024 el jueves de esta semana no es ningún "hoy".
  const isCurrentYear = year === currentYear;

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
            Grilla semanal de lunes a sábado en la sede de{" "}
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
          {/* Dos lecturas distintas de la misma semana, cada una con su
              tratamiento en vez de un marcado de compromiso:
              — desde lg, "¿cómo viene la semana?": seis columnas, todo de un
                vistazo, y los días vacíos visibles con borde punteado porque
                ahí el hueco del miércoles es información;
              — hasta lg, "¿qué hay hoy?": un día por vez con el de hoy
                elegido, que seis tarjetas apiladas en 375 px no contestan.
              Sin `items-start`: el `stretch` que trae grid por default empareja
              la altura de las tarjetas de la fila. Con items-start las columnas
              quedaban dentadas, que es lo contrario de "la semana de un
              vistazo". */}
          <div className="mt-6 hidden gap-2 lg:grid lg:grid-cols-6">
            {agenda.map(({ day, label, entries }) => (
              <section
                key={day}
                className={`rounded-lg border p-3 ${entries.length === 0 ? "border-dashed" : ""}`}
              >
                <h2
                  className={`flex items-center justify-between gap-1 text-sm font-semibold ${
                    entries.length === 0 ? "text-muted-foreground" : ""
                  }`}
                >
                  {label}
                  {isCurrentYear && day === todayAR && (
                    // El par lleno `bg-primary text-primary-foreground` es el
                    // mismo que usan la solapa elegida de DayTabs y el año
                    // activo: es el único que el sistema garantiza en los dos
                    // temas. `bg-primary/10 text-primary` componía sobre blanco
                    // a ~4.18:1 —debajo de AA— y encima a 10px, justo en la
                    // única marca que orienta al vecino en la grilla de seis
                    // columnas. Sigue subordinado al encabezado por tamaño
                    // (11px contra 14px semibold), no por contraste.
                    // `shrink-0` para que el chip no se aplaste en la columna
                    // angosta: que se acomode el nombre del día, que sí puede
                    // cortarse sin perder nada.
                    <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary-foreground">
                      Hoy
                    </span>
                  )}
                </h2>
                {entries.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Sin actividades</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {entries.map((e) => (
                      <ActivityCard key={e.id} entry={e} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <div className="mt-6 lg:hidden">
            <DayTabs agenda={agenda} initialDay={initialDay} />
          </div>
        </>
      )}
    </main>
  );
}
