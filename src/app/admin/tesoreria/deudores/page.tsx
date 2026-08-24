// Deudores y cesantía por mora (spec §6.5, REG-15). La pantalla más grave del
// módulo: acá se expulsa gente de la asociación.
//
// El estatuto (Art. 9 inc. c) habilita a la Comisión Directiva a declarar la
// cesantía del socio que se atrasó 4 cuotas —consecutivas o no— sin aviso
// previo. El sistema cuenta, alerta desde la 2ª y OFRECE la acción desde la 4ª:
// no la ejecuta solo. Quien decide es la Comisión y cada declaración se asienta
// en un acta.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { arrearsBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, MINUTE_TYPE_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { fetchDebtors, parseDebtorFilters } from "@/lib/treasury/debtors";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { ARREARS_THRESHOLD, type ArrearsLevel } from "@/lib/treasury/rules";
import { ArrearsForm } from "./arrears-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deudores — SIGeV" };

const BASE = "/admin/tesoreria/deudores";

// Tokens del shell y no `border` pelado: en modo oscuro un select sin
// `border-input` ni fondo propio se ve plano contra la página.
const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

// El umbral que muestra el badge, no la cantidad de cuotas (eso va en su propia
// columna). Las claves son las que devuelve `arrearsLevel`.
const LEVEL_LABEL: Record<ArrearsLevel, string> = {
  0: "Al día", 1: "1 cuota", 2: "En mora", 4: "Cesantía posible",
};

export default async function DeudoresPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;

  const sp = await props.searchParams;
  const filters = parseDebtorFilters(sp);
  const [feeValue, minuteRows] = await Promise.all([
    feeValueReader.current(),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
  ]);
  const rows = await fetchDebtors(prisma, filters, feeValue);
  const minutes = minuteRows.map((m) => ({
    id: m.id,
    label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  const candidates = rows.filter((r) => r.pendingCount >= ARREARS_THRESHOLD).map((r) => r.memberId);
  const hasFilters = Boolean(filters.level || filters.q);
  const declared = Array.isArray(sp.declaradas) ? sp.declaradas[0] : sp.declaradas;

  // Nunca un thead sin filas: el estado vacío reemplaza a la tabla entera.
  const table = rows.length === 0 ? (
    <EmptyState
      description={hasFilters
        ? "Ningún deudor coincide con el filtro."
        : "No hay socios vigentes ni suspendidos con cuotas pendientes."}
      action={hasFilters
        ? <Button asChild variant="outline"><Link href={BASE}>Limpiar filtros</Link></Button>
        : undefined}
    />
  ) : (
    <Table>
      <TableHeader>
        <TableRow>
          {candidates.length > 0 && <TableHead><span className="sr-only">Seleccionar</span></TableHead>}
          <TableHead>N°</TableHead>
          <TableHead>Socio</TableHead>
          <TableHead>Categoría</TableHead>
          <TableHead className="text-right">Cuotas</TableHead>
          <TableHead className="text-right">Deuda</TableHead>
          <TableHead>Último pago</TableHead>
          <TableHead>Situación</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.memberId}>
            {/* La columna existe sólo si hay algo que tildar, y la casilla sólo
                en las filas que el estatuto habilita: el que debe 3 cuotas no
                tiene checkbox que tildar por error. */}
            {candidates.length > 0 && (
              <TableCell>
                {r.pendingCount >= ARREARS_THRESHOLD && (
                  <label className="flex min-h-11 items-center">
                    <input type="checkbox" name="ids" value={r.memberId} className="size-4" />
                    <span className="sr-only">Seleccionar a {r.fullName}</span>
                  </label>
                )}
              </TableCell>
            )}
            <TableCell className="font-mono tabular-nums">{r.memberNumber ?? "—"}</TableCell>
            <TableCell>
              <Link className="text-primary hover:underline" href={`/admin/socios/${r.memberId}?tab=cuenta`}>
                {r.fullName}
              </Link>
              {r.status === "suspended" && (
                <span className="ml-1 text-xs text-muted-foreground">({STATUS_LABELS.suspended})</span>
              )}
            </TableCell>
            <TableCell>{CATEGORY_LABELS[r.category]}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{r.pendingCount}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {r.debt !== null ? formatARS(r.debt) : "—"}
            </TableCell>
            <TableCell>{r.lastPaidAt ? formatDateAR(r.lastPaidAt) : "—"}</TableCell>
            <TableCell><Badge variant={arrearsBadgeVariant(r.level)}>{LEVEL_LABEL[r.level]}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      {declared && (
        <FormMessage kind="success" box>
          {`${declared} ${declared === "1" ? "cesantía declarada" : "cesantías declaradas"}.`}
        </FormMessage>
      )}

      {/* GET plano, como el resto del panel: el filtro queda en la URL y se
          puede compartir, recargar y volver con el botón atrás. */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input
          name="q"
          placeholder="Nombre o DNI"
          defaultValue={filters.q ?? ""}
          className="w-56"
          aria-label="Nombre o DNI"
        />
        <select
          name="nivel"
          defaultValue={filters.level ? String(filters.level) : ""}
          className={SELECT_CLASS}
          aria-label="Situación"
        >
          <option value="">Todos los deudores</option>
          <option value="2">En mora (2 o más)</option>
          <option value="4">Candidatos a cesantía (4 o más)</option>
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      {/* Sólo si hay a quién llamar: la hoja no se ofrece cuando el recordatorio
          por email ya alcanza a todos los deudores de la lista. */}
      {rows.some((r) => !r.emailUsable) && (
        <p className="text-sm">
          <Link
            className="font-medium text-primary underline underline-offset-2 outline-hidden hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
            href={`${BASE}/gestion-manual`}
          >
            Lista para gestión manual
          </Link>{" "}
          <span className="text-muted-foreground">
            — los deudores sin email, para llamar o visitar (imprimible).
          </span>
        </p>
      )}

      {!feeValue && (
        <FormMessage kind="warning" box>
          No hay un valor de cuota vigente: la deuda en pesos no se puede calcular. Registralo en
          Tesorería → Valores.
        </FormMessage>
      )}

      {rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {`${rows.length} ${rows.length === 1 ? "socio" : "socios"} con cuotas pendientes`}
          {candidates.length > 0 && ` · ${candidates.length} con ${ARREARS_THRESHOLD} o más`}.
        </p>
      )}

      {candidates.length > 0 ? (
        <ArrearsForm minutes={minutes} selectableIds={candidates}>{table}</ArrearsForm>
      ) : table}
    </div>
  );
}
