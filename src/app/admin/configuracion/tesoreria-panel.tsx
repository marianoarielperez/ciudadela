import Link from "next/link";
import { Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/empty-state";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { FeeValueForm } from "./fee-value-form";
import { PanelHeader } from "@/components/admin/panel-header";

// El panel del valor de cuota. Presentación pura: la página le da todo ya
// formateado. El acta del historial se nombra por TIPO y NÚMERO (minuteName),
// nunca por id — tercera aparición del error documentado en CLAUDE.md,
// corregida acá.
export type FeeHistoryItem = {
  id: number;
  dateLabel: string;
  activeLabel: string;
  sharedLabel: string;
  minute: { id: number; name: string } | null;
};

export function TesoreriaPanel({ current, history, minutes, suggestedValidFrom }: {
  current: { dateLabel: string; activeLabel: string; sharedLabel: string } | null;
  history: FeeHistoryItem[];
  minutes: Array<{ id: number; label: string }>;
  suggestedValidFrom: string;
}) {
  return (
    <section aria-label="Tesorería — valor de cuota" className="max-w-2xl space-y-4">
      <PanelHeader
        icon={Wallet}
        title="Valor de cuota"
        description="La única fuente de montos del sistema: devengo, deuda, efectivo y alta web. Los planes de Mercado Pago son solo referencia."
      />
      {current ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card size="sm">
            <CardContent className="space-y-1">
              <div className="text-xs text-muted-foreground">Socio activo</div>
              <div className="font-mono text-2xl font-medium tabular-nums">{current.activeLabel}</div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="space-y-1">
              <div className="text-xs text-muted-foreground">Adherente / colaborador</div>
              <div className="font-mono text-2xl font-medium tabular-nums">{current.sharedLabel}</div>
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Vigente desde {current.dateLabel}.
          </p>
        </div>
      ) : (
        <p className="text-sm text-warning">Todavía no rige ningún valor de cuota.</p>
      )}
      <Card>
        <CardContent>
          <FeeValueForm minutes={minutes} suggestedValidFrom={suggestedValidFrom} />
        </CardContent>
      </Card>
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Historial
      </h3>
      {history.length === 0 ? (
        <EmptyState size="card" description="Todavía no se registró ningún valor de cuota." />
      ) : (
        <ul className="list-none divide-y rounded-xl border p-0 text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                Desde {h.dateLabel} ·{" "}
                {h.minute ? (
                  <Link className={INLINE_LINK} href={`/admin/actas/${h.minute.id}`}>
                    {h.minute.name}
                  </Link>
                ) : (
                  "sin acta"
                )}
              </span>
              <span className="font-mono tabular-nums">
                {h.activeLabel} / {h.sharedLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
