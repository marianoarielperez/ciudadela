import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CalendarDays, MapPin } from "lucide-react";
import { getActivitiesForYear, getActivityYears } from "@/lib/activities/query";
import {
  agendaSummary,
  initialVisibleDay,
  visibleAgendaDays,
  visibleRooms,
  weekSpanLabel,
} from "@/lib/activities/presentation";
import { buildDailyAgenda, ROOM_LABELS } from "@/lib/activities/rules";
import { ROOM_META } from "@/lib/activities/room-meta";
import {
  activitiesYearHref,
  currentWeekdayAR,
  currentYearAR,
  resolveActivitiesYear,
} from "@/lib/activities/year-param";
import { siteBaseUrl } from "@/lib/site";
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

// Tailwind no compila clases interpoladas: el número de columnas sale de un
// mapa estático. Con 1–2 días visibles el ancho se acota para que las
// columnas no queden de borde a borde en escritorio.
const GRID_COLS: Record<number, string> = {
  1: "lg:mx-auto lg:max-w-md lg:grid-cols-1",
  2: "lg:mx-auto lg:max-w-2xl lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

// Entrada escalonada por columna: 50ms por índice, tope 250ms. La única
// animación orquestada de la página; motion-reduce la apaga en cada uso.
const STAGGER = [
  "",
  "[animation-delay:50ms]",
  "[animation-delay:100ms]",
  "[animation-delay:150ms]",
  "[animation-delay:200ms]",
  "[animation-delay:250ms]",
];

const ENTER =
  "animate-in fade-in-0 slide-in-from-bottom-2 duration-300 [animation-fill-mode:backwards] motion-reduce:animate-none";

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
  // Desde el rediseño del 28/08 el calendario lo dibujan los datos: un día
  // sin actividades no se renderiza (ni columna ni pill). No alcanza con
  // `activities.length` para el estado vacío: una actividad activa con
  // `weekdays` vacío o corrupto no cae en ningún día y dejaría el calendario
  // en blanco sin explicar nada. Lo que decide es lo que se puede MOSTRAR.
  const visibleDays = visibleAgendaDays(agenda);
  const hasDays = visibleDays.length > 0;
  // Hoy en hora argentina, para la columna resaltada del escritorio y el día
  // que trae elegido el selector del celular.
  const todayAR = currentWeekdayAR();
  // El resaltado de "hoy" sólo tiene sentido sobre el año en curso: en el
  // calendario de 2024 el jueves de esta semana no es ningún "hoy".
  const isCurrentYear = year === currentYear;
  const todayVisible = isCurrentYear && visibleDays.some((d) => d.day === todayAR);
  const initialDay = hasDays ? initialVisibleDay(visibleDays, todayAR) : 0;
  const initialDayLabel = visibleDays.find((d) => d.day === initialDay)?.label ?? "";
  const { activityCount, roomCount } = agendaSummary(visibleDays);
  const rooms = visibleRooms(visibleDays);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      {/* Título y bajada van juntos en el mismo bloque: si el selector de años
          se mete entre los dos, en el celular (donde el flex apila) la bajada
          queda separada del título que describe. En sm+ el selector se va a la
          derecha y quedan los dos en la misma línea. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          {hasDays && (
            // La firma de la página (el eyebrow mono que estrenó /ubicacion):
            // el rango REAL de la semana según los datos. Decorativo y
            // aria-hidden: la bajada dice lo mismo con palabras.
            <p
              aria-hidden
              className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase"
            >
              {weekSpanLabel(visibleDays)} · {year}
            </p>
          )}
          <h1 className="mt-1 text-2xl font-semibold">Actividades</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasDays
              ? `${activityCount} ${activityCount === 1 ? "actividad" : "actividades"} en ${roomCount} ${roomCount === 1 ? "espacio" : "espacios"} de la sede en ${year}.`
              : "La agenda de actividades de la sede vecinal."}
          </p>
          <Link
            href="/ubicacion"
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MapPin aria-hidden className="size-4 shrink-0" />
            Ver dónde queda la sede
          </Link>
        </div>
        {years.length > 1 && (
          // min-h-11 en cada año: se toca desde el celular, igual que los
          // links del menú.
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
                    className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
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

      {!hasDays ? (
        <div className="mt-8 rounded-xl border border-dashed px-4 py-12 text-center">
          <CalendarDays aria-hidden className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Todavía no hay actividades cargadas para {year}. Consultá en la sede vecinal.
          </p>
        </div>
      ) : (
        <>
          {isCurrentYear && !todayVisible && (
            <p className="mt-4 text-sm text-muted-foreground">
              Hoy no hay actividades — te esperamos el{" "}
              {initialDayLabel.toLocaleLowerCase("es-AR")}.
            </p>
          )}

          {/* Leyenda estática: solo los espacios presentes en el calendario,
              con el mismo juego de colores de sus tarjetas. No son controles:
              sin hover y sin min-h-11. */}
          <ul className="mt-6 flex flex-wrap gap-2">
            {rooms.map((room) => {
              const meta = ROOM_META[room];
              const Icon = meta.icon;
              return (
                <li
                  key={room}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${meta.cardBorder} ${meta.cardBg} ${meta.roomText}`}
                >
                  <Icon aria-hidden className="size-3.5 shrink-0" />
                  {ROOM_LABELS[room]}
                </li>
              );
            })}
          </ul>

          {/* Dos lecturas de la misma semana:
              — desde lg, "¿cómo viene la semana?": una columna por día CON
                actividades, todo de un vistazo;
              — hasta lg, "¿qué hay hoy?": un día por vez con el de hoy (o el
                próximo) elegido.
              Sin `items-start`: el `stretch` del grid empareja la altura de
              las columnas de la fila; con items-start quedaban dentadas, que
              es lo contrario de "la semana de un vistazo". */}
          <div className={`mt-8 hidden gap-3 lg:grid ${GRID_COLS[visibleDays.length]}`}>
            {visibleDays.map(({ day, label, entries }, i) => {
              const isToday = isCurrentYear && day === todayAR;
              return (
                <section
                  key={day}
                  className={`rounded-xl border bg-card p-3 ${ENTER} ${STAGGER[i]} ${
                    isToday ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <h2 className="flex items-center justify-between gap-2 text-sm font-semibold">
                    <span className="flex items-center gap-1.5">
                      {label}
                      {isToday && (
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
                    </span>
                    <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
                      {entries.length}
                      <span className="sr-only">
                        {entries.length === 1 ? " actividad" : " actividades"}
                      </span>
                    </span>
                  </h2>
                  <ul className="mt-2.5 space-y-2">
                    {entries.map((e) => (
                      <ActivityCard key={e.id} entry={e} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <div className={`mt-6 lg:hidden ${ENTER}`}>
            <DayTabs
              days={visibleDays}
              initialDay={initialDay}
              todayDay={todayVisible ? todayAR : null}
            />
          </div>
        </>
      )}
    </main>
  );
}
