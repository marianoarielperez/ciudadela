import Link from "next/link";

import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader, parseRecipients } from "@/lib/config";
import { PageHeader } from "@/components/admin/page-header";
import { FormMessage } from "@/components/admin/form-message";
import { EmptyState } from "@/components/admin/empty-state";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { addMonths, civilDayOf, currentPeriod } from "@/lib/treasury/periods";
import { formatARS, formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { listDivergent } from "@/lib/mp/fee-value-batch";
import { ConfigForm } from "./config-form";
import { FeeValueForm } from "./fee-value-form";
import { HolidayForm, HolidayRow } from "./holidays-form";
import { StatusStrip } from "./status-strip";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuración — SIGeV" };

// Firma explícita, como el resto de las páginas del panel: el tipo global
// `PageProps<"...">` solo existe después de que Next genera los tipos de rutas,
// así que `tsc --noEmit` en frío no lo encuentra.
export default async function ConfigPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    // Pantalla de bloqueo, NO redirect, por el mismo motivo que documenta
    // `admin/layout.tsx`: /ingresar manda a /redirigir cuando hay sesión y
    // /redirigir manda a /admin por el rol del token, así que mandar ahí a un
    // admin común —que tiene sesión válida y entra al panel sin problema— lo
    // haría rebotar sin fin. Acá no le falta la sesión: le falta un rol.
    return (
      <div className="space-y-4">
        <PageHeader title="Configuración" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const [
    asociateActivo,
    contactPhone,
    contactEmail,
    termsText,
    privacyConsentText,
    mpPlanActiveId,
    mpPlanSharedId,
    digestRecipients,
  ] = await Promise.all([
    configReader.getBool(CONFIG_KEYS.asociateActivo),
    configReader.getString(CONFIG_KEYS.contactPhone),
    configReader.getString(CONFIG_KEYS.contactEmail),
    configReader.getString(CONFIG_KEYS.termsText),
    configReader.getString(CONFIG_KEYS.privacyConsentText),
    configReader.getString(CONFIG_KEYS.mpPlanActiveId),
    configReader.getString(CONFIG_KEYS.mpPlanSharedId),
    configReader.getString(CONFIG_KEYS.digestRecipients),
  ]);

  // Valor de cuota (M4): el vigente para mostrar, el historial para la lista y
  // las últimas actas para el select. La fecha sugerida es el 1° del mes que
  // viene, que es cuando arranca a regir un valor nuevo en la práctica.
  const [current, history, minuteRows] = await Promise.all([
    feeValueReader.current(),
    feeValueReader.history(),
    // `select` explícito: de la fila del acta acá sólo se arma la etiqueta del
    // combo, y sin él Prisma trae también el texto y los adjuntos del acta.
    prisma.minute.findMany({
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 30,
      select: { id: true, type: true, number: true, date: true },
    }),
  ]);
  const minutes = minuteRows.map((m) => ({
    id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  // El 1° del mes que viene, calculado con los períodos de tesorería —que
  // resuelven el mes en hora argentina— y no con aritmética UTC: la noche del
  // último día del mes, UTC ya está en el mes siguiente y la sugerencia se
  // adelantaría un mes entero.
  const suggestedValidFrom = `${addMonths(currentPeriod(), 1)}-01`;

  // ── Feriados (M6) ──────────────────────────────────────────────────────────
  // Se listan los de HOY EN ADELANTE, que son los únicos que se pueden corregir:
  // un feriado pasado ya participó de plazos computados y la tabla lo conserva
  // como calendario histórico (la action lo vuelve a chequear).
  //
  // Y se muestra la COBERTURA por año, que es el dato del que depende que el
  // aviso de cartelera se pueda computar: `businessDayEnd` trata un año civil
  // con cero filas como "nadie lo cargó" —la Ley 27.399 fija nueve feriados
  // inamovibles de fecha fija, así que un año sin ninguno no existe— y falla en
  // vez de contar el 1° de enero como día hábil.
  const today = civilDayOf();
  const [futureHolidays, allHolidays] = await Promise.all([
    prisma.holiday.findMany({
      where: { date: { gte: today } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, label: true },
    }),
    prisma.holiday.findMany({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  // Por año civil ARGENTINO. Las filas están en el mediodía UTC de su día civil,
  // así que `getUTCFullYear` es el año de acá y no el del reloj del server.
  const coverage = new Map<number, number>();
  for (const h of allHolidays) {
    const year = h.date.getUTCFullYear();
    coverage.set(year, (coverage.get(year) ?? 0) + 1);
  }
  // El 1° de enero del año siguiente al último cargado: el hueco más probable es
  // "se acabó el calendario", y sugerir esa fecha es sugerir empezar a taparlo.
  const lastYear = Math.max(today.getUTCFullYear(), ...coverage.keys());
  const suggestedHoliday = `${lastYear + 1}-01-01`;

  // Recién registrado un valor: cuántas suscripciones de Mercado Pago quedaron
  // cobrando otra cosa. Es el momento en que el superadmin tiene que enterarse
  // de que registrar el valor NO le cambió el débito a nadie todavía — las
  // suscripciones llevan el monto copiado y hay que empujárselo una por una.
  // Se calcula sólo en ese momento: es una consulta al padrón que no le
  // interesa a nadie que entró a cambiar el teléfono de contacto.
  const divergentCount =
    sp.cuota === "1" && current ? (await listDivergent(prisma, current)).length : 0;

  // Insumos de la tira de estado — datos ya consultados, cero queries nuevas.
  // El conteo sale del MISMO parser que decide quién recibe el resumen diario
  // (`parseRecipients`, que normaliza, deduplica y descarta lo que ni parece una
  // dirección): contarlo a mano acá haría que la tira prometa un número de
  // destinatarios que el envío no cumple.
  const digestCount = parseRecipients(digestRecipients).length;
  const coverageEntries = [...coverage.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="space-y-4">
      <PageHeader title="Configuración" />
      {sp.guardado === "1" && (
        <FormMessage kind="success" box>
          Configuración guardada.
        </FormMessage>
      )}
      {sp.cuota === "1" && (
        <FormMessage kind="success" box as="div">
          {divergentCount === 0 ? (
            <p>Valor de cuota registrado, y ninguna suscripción de Mercado Pago para actualizar.</p>
          ) : (
            <p>
              {`Valor de cuota registrado. Hay ${divergentCount} ${divergentCount === 1 ? "suscripción" : "suscripciones"} de Mercado Pago para actualizar: `}
              <Link
                className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                href="/admin/tesoreria/valores"
              >
                Ir a Valores de cuota
              </Link>
              .
            </p>
          )}
        </FormMessage>
      )}
      {sp.feriado === "1" && <FormMessage kind="success" box>Feriado cargado.</FormMessage>}
      {sp.feriado === "2" && <FormMessage kind="success" box>Feriado borrado.</FormMessage>}
      <StatusStrip
        current={current}
        asociateActivo={asociateActivo}
        coverage={coverageEntries}
        digestCount={digestCount}
      />
      <ConfigForm
        initial={{
          asociateActivo,
          contactPhone: contactPhone ?? "",
          contactEmail: contactEmail ?? "",
          termsText: termsText ?? "",
          privacyConsentText: privacyConsentText ?? "",
          mpPlanActiveId: mpPlanActiveId ?? "",
          mpPlanSharedId: mpPlanSharedId ?? "",
          digestRecipients: digestRecipients ?? "",
        }}
      />

      <section className="max-w-2xl space-y-4 border-t pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Tesorería — valor de cuota
        </h2>
        <p className="text-sm text-muted-foreground">
          {current ? (
            <>
              Vigente desde {formatDateAR(current.validFrom)}: activo{" "}
              <span className="font-mono tabular-nums">{formatARS(current.activeAmount)}</span> · adherente/colaborador{" "}
              <span className="font-mono tabular-nums">{formatARS(current.sharedAmount)}</span>.
            </>
          ) : (
            "Todavía no rige ningún valor de cuota."
          )}{" "}
          Es la única fuente de montos del sistema: devengo, deuda, efectivo y alta web. Los planes de Mercado
          Pago son solo referencia.
        </p>
        <FeeValueForm minutes={minutes} suggestedValidFrom={suggestedValidFrom} />
        {history.length > 0 && (
          <ul className="divide-y text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>Desde {formatDateAR(h.validFrom)}{h.minuteId ? ` · acta #${h.minuteId}` : " · sin acta"}</span>
                <span className="font-mono tabular-nums">{formatARS(h.activeAmount)} / {formatARS(h.sharedAmount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="max-w-2xl space-y-4 border-t pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Cartelera — feriados
        </h2>
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
          {coverage.size === 0 ? (
            <span className="text-warning">ninguno.</span>
          ) : (
            [...coverage.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([year, count]) => `${year} (${count})`)
              .join(" · ")
          )}
        </p>
        <HolidayForm suggestedDate={suggestedHoliday} />
        {futureHolidays.length === 0 ? (
          <EmptyState
            size="card"
            description="No hay feriados cargados de hoy en adelante."
          />
        ) : (
          <ul className="list-none divide-y p-0 text-sm">
            {futureHolidays.map((h) => (
              <HolidayRow
                key={h.id}
                id={h.id}
                label={h.label}
                dateLabel={formatDateAR(h.date)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
