// Otros ingresos: la plata que entra a la vecinal y NO es de un socio —alquiler
// del salón, eventos, rifas, donaciones—. Hasta esta pantalla, ese dinero no
// tenía dónde registrarse: por Mercado Pago caía en la bandeja sin conciliar,
// donde la única salida era descartarlo (que declara que no se le imputa a
// nadie: falso, entró y es de la asociación), y en efectivo no quedaba en
// ningún lado.
//
// Es un REGISTRO y no contabilidad (docs/01): no emite recibo, no hay plan de
// cuentas y no hay egresos.
//
// La unidad de la pantalla es el EJERCICIO: la asociación cierra del 1 de enero
// al 31 de diciembre, así que el año no es un campo que se completa sino dónde
// el operador está parado. De arriba a abajo: la barra de ejercicios, el año de
// un vistazo (total + cinta de doce meses + por dónde entró), la carga, y el
// detalle del año. Antes de esto había un filtro Desde/Hasta que obligaba a
// tipear los bordes del año a mano y no sabía qué es "el ejercicio en curso".
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería. La guarda
// tampoco se hereda de él (Next renderiza layout y página en paralelo).
import Link from "next/link";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import { requireAdmin } from "@/lib/auth/require-admin";
import { currentYearAR } from "@/lib/dates";
import { formatARS, formatDateAR } from "@/lib/format";
import {
  exerciseYears,
  INCOME_BASE,
  incomeListHref,
  resolveIncomeMonth,
  resolveIncomeYear,
} from "@/lib/treasury/income-nav";
import { INCOME_METHOD_LABELS } from "@/lib/treasury/labels";
import { INCOME_PAGE_SIZE, otherIncome, type IncomeFilters } from "@/lib/treasury/other-income";
import { civilDayOf, monthName, periodMonth, periodOf } from "@/lib/treasury/periods";
import { ExerciseStrip } from "./exercise-strip";
import { EditIncomeForm, MethodFilterForm, RegisterIncomeForm, VoidIncomeForm } from "./income-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Otros ingresos — SIGeV" };

/** "AAAA-MM-DD" del día civil argentino: `civilDayOf` devuelve el mediodía UTC
 *  de ese día, así que el ISO recortado no puede correrse de fecha. */
function isoCivilDay(at: Date = new Date()): string {
  return civilDayOf(at).toISOString().slice(0, 10);
}

export default async function OtrosIngresosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // Un solo ingreso, por id: es el destino del enlace que sale de la bandeja
  // sin conciliar. NO hay filtro por texto del concepto — un `?q=Ramírez` queda
  // escrito en el access log de Nginx y de Cloudflare, que no están alcanzados
  // por la retención que sí cubre `audit_logs` (Ley 25.326, docs/08).
  const ingresoId = Number(one(sp.ingreso));
  const single = Number.isInteger(ingresoId) && ingresoId > 0 ? ingresoId : null;

  const now = new Date();
  const currentYear = currentYearAR(now);
  const years = exerciseYears(await otherIncome.years(), currentYear);
  // El enlace de la bandeja manda sobre el `?anio=`: un cobro de diciembre
  // mirado en enero tiene que abrir SU ejercicio, no el que está en curso, o el
  // resumen de arriba hablaría de un año y la lista mostraría otro.
  const singleYear = single ? await otherIncome.yearOf(single) : null;
  const year = singleYear ?? resolveIncomeYear(sp.anio, years, currentYear);
  const month = single ? null : resolveIncomeMonth(sp.mes);
  const medio = one(sp.medio);
  const method = medio === "cash" || medio === "mp" ? medio : undefined;

  const filters: IncomeFilters = single ? { id: single } : { year };
  if (!single && month) filters.month = month;
  if (!single && method) filters.method = method;

  const page = parsePage(sp);
  // Dos consultas y no una: el resumen es del EJERCICIO entero y la lista es de
  // la página. Agregar sobre las filas de la página haría que el total dijera
  // una cosa distinta según dónde esté parado el operador.
  const [summary, listed] = await Promise.all([
    otherIncome.exercise(year),
    otherIncome.list(filters, page),
  ]);
  const { rows, total, counted } = listed;
  const pg = paginate(total, page, INCOME_PAGE_SIZE);

  const here = (over: { month?: number | null; method?: typeof method } = {}) =>
    incomeListHref(
      { year, month: "month" in over ? over.month : month, method: "method" in over ? over.method : method },
      currentYear,
    );
  const yearHref = here({ month: null });
  const params = {
    anio: year === currentYear ? undefined : String(year),
    mes: month ? String(month) : undefined,
    medio: method,
    ingreso: single ? String(single) : undefined,
  };

  // El desglose por medio es lo único que la cinta no dice, y es justamente la
  // distinción que esta pantalla vino a cubrir: la plata entra por el mostrador
  // o por Mercado Pago. Los porcentajes se derivan de uno solo para que sumen
  // 100 exactos y no 99 ó 101 por dos redondeos independientes.
  const { cash, mp } = summary.byMethod;
  const cashPct = summary.total > 0 ? Math.round((cash / summary.total) * 100) : 0;
  const split = cash > 0 && mp > 0;
  const currentMonth = year === currentYear ? periodMonth(periodOf(now)) : null;
  const filtered = month !== null || method !== undefined;

  return (
    <div className="space-y-4">
      {one(sp.registrado) === "1" && (
        <FormMessage kind="success" box>Ingreso registrado en el ejercicio {year}.</FormMessage>
      )}
      {one(sp.corregido) === "1" && (
        <FormMessage kind="success" box>Se guardó el texto del ingreso.</FormMessage>
      )}
      {/* El operador llegó por el enlace de la bandeja sin conciliar: le
          mostramos ese ingreso solo, y le decimos qué puede hacer con él. */}
      {single && total > 0 && (
        <FormMessage kind="neutral" box>
          Estás viendo un solo ingreso, del ejercicio {year}. Si el concepto o la nota están mal,
          corregilos con <strong>Editar</strong>, al lado del concepto: no hace falta anularlo.{" "}
          <Link className="underline" href={yearHref}>Ver el ejercicio {year}</Link>.
        </FormMessage>
      )}
      {one(sp.anulado) === "1" && (
        <FormMessage kind="success" box>
          Ingreso anulado. Si venía de Mercado Pago, su fila volvió a Pendientes en{" "}
          <Link className="underline" href="/admin/tesoreria/sin-conciliar">Sin conciliar</Link>.
        </FormMessage>
      )}

      {/* La barra de ejercicios: el mismo patrón de chips que /actividades, para
          que el panel no estrene un lenguaje propio. El año en curso está
          siempre, aunque no tenga nada: es el año en el que se carga. */}
      <nav aria-label="Elegir ejercicio" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-muted-foreground">Ejercicio</span>
        {years.map((y) => (
          <Link
            key={y}
            // Href canónico: el ejercicio en curso vive en la URL limpia. El mes
            // y el medio NO se arrastran al cambiar de año — un filtro de marzo
            // heredado sin decirlo hace que el año nuevo parezca vacío.
            href={incomeListHref({ year: y }, currentYear)}
            aria-current={y === year ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 font-mono text-sm tabular-nums outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
              y === year
                ? "border-primary bg-primary font-semibold text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            {y}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>Ejercicio {year}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div>
              {/* El titular es la plata, con la misma tipografía monoespaciada
                  con que el panel escribe todos los importes. Es el total del
                  AÑO: ni el mes ni el medio filtrados lo mueven. */}
              <p className="font-mono text-4xl tabular-nums">{formatARS(summary.total)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {summary.counted === 1 ? "1 ingreso" : `${summary.counted} ingresos`}
                {" del 1 de enero al 31 de diciembre"}
                {summary.voided > 0
                  && ` · ${summary.voided} anulado${summary.voided === 1 ? "" : "s"} que no suma${summary.voided === 1 ? "" : "n"}`}
                .
              </p>
            </div>
            {summary.total > 0 && (
              <dl className="min-w-56 space-y-1 text-sm">
                {(
                  [
                    ["cash", cash, cashPct],
                    ["mp", mp, 100 - cashPct],
                  ] as const
                ).map(([key, amount, pct]) => (
                  <div key={key} className="flex items-baseline gap-3">
                    <dt className="flex-1 text-muted-foreground">
                      <span
                        aria-hidden
                        className={`mr-2 inline-block size-2 rounded-full align-middle ${key === "cash" ? "bg-primary" : "bg-primary/40"}`}
                      />
                      {INCOME_METHOD_LABELS[key]}
                    </dt>
                    <dd className="font-mono tabular-nums">{formatARS(amount)}</dd>
                    <dd className="w-10 text-right font-mono tabular-nums text-muted-foreground">
                      {pct}%
                    </dd>
                  </div>
                ))}
                {/* Las cifras están escritas al lado: la barra es sólo la
                    proporción, y por eso no la anuncia el lector de pantalla.
                    Con un solo medio en juego una barra completa no diría nada
                    y no se dibuja. */}
                {split && (
                  <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-primary" style={{ width: `${cashPct}%` }} />
                    <div className="bg-primary/40" style={{ width: `${100 - cashPct}%` }} />
                  </div>
                )}
              </dl>
            )}
          </div>

          <ExerciseStrip
            summary={summary}
            currentMonth={currentMonth}
            selectedMonth={month}
            monthHref={(m) => here({ month: m })}
            yearHref={yearHref}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Registrar un ingreso</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* El foco no salta al monto cuando la pantalla llegó con un aviso
              arriba: es el destino del redirect de la bandeja, y mover el foco
              se lleva por delante el mensaje sin leer. */}
          <RegisterIncomeForm
            today={isoCivilDay(now)}
            autoFocus={!hasNotice(sp, single)}
          />
          <p className="text-sm text-muted-foreground">
            Esto es para la plata que <strong>no</strong> es de un socio. Si un socio paga su cuota
            o hace un aporte,{" "}
            <Link
              className={INLINE_LINK}
              href="/admin/tesoreria/efectivo"
            >
              cobrale en Efectivo
            </Link>{" "}
            para que salga con recibo. El ingreso queda en el ejercicio de la fecha que cargues.
          </p>
        </CardContent>
      </Card>

      {!single && (
        <div className="flex flex-wrap items-end gap-3">
          <MethodFilterForm year={year} currentYear={currentYear} month={month} medio={method ?? ""} />
          {month !== null && (
            <Button asChild variant="ghost">
              <Link href={yearHref}>Ver el ejercicio entero</Link>
            </Button>
          )}
        </div>
      )}

      <h2 className="text-sm font-medium text-muted-foreground">
        {single
          ? "El ingreso"
          : month !== null
            ? `Ingresos de ${monthName(month)} de ${year}`
            : `Ingresos del ejercicio ${year}`}
        {method && ` · ${INCOME_METHOD_LABELS[method]}`}
        {total > 0 && (
          <span className="font-normal">
            {" — "}
            {total === 1 ? "1 fila" : `${total} filas`}
            {total > counted && `, ${total - counted} anulada${total - counted === 1 ? "" : "s"}`}
          </span>
        )}
      </h2>

      {total === 0 ? (
        // Nunca un thead sin filas.
        <EmptyState
          description={
            single
              ? "Ese ingreso ya no existe."
              : filtered
                ? "Ningún ingreso del ejercicio coincide con el filtro."
                : year === currentYear
                  ? "El ejercicio todavía no tiene ingresos. Los alquileres del salón, las rifas y los eventos se cargan desde el formulario de arriba."
                  : `No se registró ningún ingreso en el ejercicio ${year}.`
          }
          action={
            filtered || single ? (
              <Button asChild variant="outline">
                <Link href={yearHref}>Ver el ejercicio {year}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Medio</TableHead>
                <TableHead>Registró</TableHead>
                <TableHead><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const voided = r.voidedAt !== null;
                return (
                  <TableRow key={r.id} className={voided ? "text-muted-foreground" : undefined}>
                    <TableCell>{formatDateAR(r.receivedAt)}</TableCell>
                    <TableCell className={`text-right font-mono tabular-nums ${voided ? "line-through" : ""}`}>
                      {formatARS(r.amount)}
                    </TableCell>
                    <TableCell>
                      {/* Concepto y nota son texto libre del operador y pueden
                          nombrar a un tercero: se leen acá, que es panel de
                          admin, y no viajan a la auditoría ni al log. */}
                      <span className={voided ? "line-through" : undefined}>{r.concept}</span>
                      {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                      {/* La corrección vive acá, pegada al texto que corrige, y
                          no en la columna de acciones: ahí competiría con
                          "Anular", que es la salida terminal de la fila. Un
                          ingreso anulado ya no se corrige. */}
                      {!voided && (
                        <EditIncomeForm
                          incomeId={r.id}
                          concept={r.concept}
                          note={r.note}
                          back={params}
                        />
                      )}
                      {voided && (
                        <span className="block text-xs">
                          Anulado el {formatDateAR(r.voidedAt!)}
                          {r.voidedBy && ` por ${r.voidedBy}`}
                          {r.voidReason && `: ${r.voidReason}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{INCOME_METHOD_LABELS[r.method]}</TableCell>
                    <TableCell>{r.registeredBy ?? "—"}</TableCell>
                    <TableCell>
                      {voided ? (
                        <Badge variant="destructive">Anulado</Badge>
                      ) : (
                        <VoidIncomeForm
                          incomeId={r.id}
                          concept={r.concept}
                          fromMercadoPago={r.mpPaymentId !== null}
                          back={params}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <PaginationNav
            page={pg.page}
            pageCount={pg.pageCount}
            href={(n) => pageHref(INCOME_BASE, params, n)}
            label="Páginas de otros ingresos"
          />
        </>
      )}
    </div>
  );
}

/** Hay un aviso arriba de la pantalla, así que el formulario no se roba el foco. */
function hasNotice(sp: Record<string, string | string[] | undefined>, single: number | null): boolean {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    one(sp.registrado) === "1"
    || one(sp.corregido) === "1"
    || one(sp.anulado) === "1"
    || single !== null
  );
}
