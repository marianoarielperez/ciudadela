import { CalendarOff } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/empty-state";
import { HolidayForm, HolidayRow } from "./holidays-form";
import { PanelHeader } from "@/components/admin/panel-header";

// El panel de feriados de la cartelera. Los textos legales (Art. 5° ter y la
// advertencia de los "puentes") se conservan textuales de la pantalla vieja.
export function FeriadosPanel({ coverageLabel, futureHolidays, suggestedDate }: {
  coverageLabel: string | null;
  futureHolidays: Array<{ id: number; label: string; dateLabel: string }>;
  suggestedDate: string;
}) {
  return (
    <section aria-label="Cartelera — feriados" className="max-w-2xl space-y-4">
      <PanelHeader
        icon={CalendarOff}
        title="Feriados"
        description="El calendario sobre el que se cuentan los plazos de la cartelera."
      />
      <p className="text-sm text-muted-foreground">
        Los veinte días hábiles de la notificación por cartelera (Art. 5° ter) se cuentan sobre
        esta tabla: lunes a viernes menos los feriados nacionales. Un feriado que falte se cuenta
        como día hábil y le acorta el plazo al vecino, así que el aviso de cartelera se niega a
        computar un plazo que entre en un año sin cargar.{" "}
        <strong>Los días no laborables con fines turísticos (los &ldquo;puentes&rdquo;) no van
        acá</strong>: son días de opción, no feriados, y alargarían los plazos sin fundamento.
      </p>
      <p className="text-sm">
        Años cargados:{" "}
        {coverageLabel ?? <span className="text-warning">ninguno.</span>}
      </p>
      <Card>
        <CardContent>
          <HolidayForm
            // La key remonta el form cuando la LISTA cambia: un alta o un borrado
            // exitoso reinicia los campos (y relee suggestedDate); un envío
            // rechazado no toca la lista, así que lo tipeado se conserva para
            // corregirlo. Es el reset selectivo que useActionState no ofrece.
            key={futureHolidays.map((h) => h.id).join("-")}
            suggestedDate={suggestedDate}
          />
        </CardContent>
      </Card>
      {futureHolidays.length === 0 ? (
        <EmptyState size="card" description="No hay feriados cargados de hoy en adelante." />
      ) : (
        <ul className="list-none divide-y rounded-xl border p-0 text-sm">
          {futureHolidays.map((h) => (
            <HolidayRow key={h.id} id={h.id} label={h.label} dateLabel={h.dateLabel} />
          ))}
        </ul>
      )}
    </section>
  );
}
