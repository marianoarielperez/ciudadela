// La barra de filtros de los reportes (spec §5.3), COMPARTIDA por la lista y
// por el mapa.
//
// Vivía inline en `/admin/solicitudes/reportes`, y el mapa —que honra los
// mismos filtros por querystring desde el primer día— no tenía forma de
// ponerlos: el operador tenía que volver a la lista, filtrar ahí y recién
// entonces apretar "Mapa". Extraerla es lo que hace que las dos pantallas
// filtren con los MISMOS controles; con dos formularios copiados, alcanza con
// que alguien sume una opción en uno para que el mapa quede una versión atrás
// (la lección de `coverageFloor`, que en esta unidad ya sostienen `REPORT_VIEWS`
// y `reportWhere`).
//
// Server Component: es un `<form method="get">` sin un solo evento de cliente
// —los filtros viven en la URL, así que el deep link y el botón atrás salen
// solos— y no tiene por qué costar JavaScript en el navegador.
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import {
  hasReportFilters, reportKindParam, type ReportFilters, type ReportViewKey,
} from "@/lib/admin/reports-queue";
import { CLAIM_CATEGORIES, INITIATIVE_CATEGORIES } from "@/lib/reports/catalog";
import { cn } from "@/lib/utils";

type CategoryOption = { slug: string; label: string };

export function ReportFilterForm({
  filters, view, years, action, clearHref, showSearch,
}: {
  filters: ReportFilters;
  view: ReportViewKey;
  years: readonly number[];
  /** La ruta a la que envía el GET: la lista o el mapa. Filtrar no cambia de
   *  pantalla — el operador eligió la que está mirando. */
  action: string;
  clearHref: string;
  /** El mapa no busca texto (un `contains` sobre la descripción no dibuja un
   *  pin distinto), pero el `where` sí lo respeta si llega por URL. */
  showSearch: boolean;
}) {
  // El `<select>` de categorías es kind-aware: con un tipo elegido muestra sólo
  // SU catálogo (elegir una categoría que ese tipo no tiene deja el filtro en
  // nada, ver `parseReportFilters`). Sin tipo van los dos, y `other` —que
  // existe en los dos catálogos con etiquetas distintas ("Otro reporte" y
  // "Otra")— aparece UNA sola vez, fuera de los grupos y con un nombre propio:
  // dos <option> con el mismo value serían la misma consulta escrita dos veces,
  // y el navegador preseleccionaría siempre la primera.
  const claimOptions: readonly CategoryOption[] = filters.kind === "initiative" ? [] : CLAIM_CATEGORIES;
  const initiativeOptions: readonly CategoryOption[] = filters.kind === "claim" ? [] : INITIATIVE_CATEGORIES;
  const sharedOther = filters.kind === null;

  // El año vigente entra en la lista aunque no lo haya devuelto `availableYears`
  // (un `?anio=2001` tipeado a mano, o un año que se quedó sin reportes después
  // de un recorte de retención). Sin esto el `<select>` no tiene ese `<option>`,
  // el navegador cae en "Todos los años" y la barra dice que no hay filtro de
  // año mientras la lista sigue filtrada por uno: el operador ve cero reportes
  // y ningún control que lo explique.
  const yearOptions = filters.year !== null && !years.includes(filters.year)
    ? [...years, filters.year].sort((a, b) => b - a)
    : years;

  return (
    /* GET plano: los filtros viven en la URL, así que el deep link y el botón
       atrás salen solos. La vista viaja en un hidden para que filtrar no
       devuelva al operador a "Sin presentar". */
    <form className="flex flex-wrap items-end gap-2" method="get" action={action}>
      {view !== "pendientes" && <input type="hidden" name="estado" value={view} />}
      {/* Un GET manda SÓLO sus propios campos: sin este hidden, apretar
          "Filtrar" en el mapa le borraría al operador un `q` que la pantalla sí
          está aplicando (el `where` es el mismo que el de la lista) y que los
          chips y el botón "Lista" conservan. La salida sigue siendo "Limpiar". */}
      {!showSearch && filters.q && <input type="hidden" name="q" value={filters.q} />}
      <select
        name="anio"
        defaultValue={filters.year === null ? "" : String(filters.year)}
        className={cn(SELECT_CLASS, "min-h-11")}
        aria-label="Año"
      >
        <option value="">Todos los años</option>
        {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <select
        name="tipo"
        defaultValue={reportKindParam(filters.kind) ?? ""}
        className={cn(SELECT_CLASS, "min-h-11")}
        aria-label="Tipo de reporte"
      >
        <option value="">Reclamos e iniciativas</option>
        <option value="reclamo">Reclamos</option>
        <option value="iniciativa">Iniciativas</option>
      </select>
      <select
        name="categoria"
        defaultValue={filters.category ?? ""}
        className={cn(SELECT_CLASS, "min-h-11")}
        aria-label="Categoría"
      >
        <option value="">Todas las categorías</option>
        {sharedOther && <option value="other">Otro / Otra</option>}
        {claimOptions.length > 0 && (
          <optgroup label="Reclamos">
            {claimOptions
              .filter((c) => !(sharedOther && c.slug === "other"))
              .map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </optgroup>
        )}
        {initiativeOptions.length > 0 && (
          <optgroup label="Iniciativas">
            {initiativeOptions
              .filter((c) => !(sharedOther && c.slug === "other"))
              .map((c) => <option key={`i-${c.slug}`} value={c.slug}>{c.label}</option>)}
          </optgroup>
        )}
      </select>
      {showSearch && (
        <Input
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="N°, calle, texto o nombre"
          aria-label="Buscar"
          className="min-h-11 w-full sm:w-56"
        />
      )}
      <Button type="submit" variant="secondary" className="min-h-11">Filtrar</Button>
      {hasReportFilters(filters) && (
        <Button asChild variant="ghost" className="min-h-11">
          <Link href={clearHref}>Limpiar</Link>
        </Button>
      )}
    </form>
  );
}
