import Link from "next/link";
import { Suspense } from "react";

import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader, parseRecipients } from "@/lib/config";
import { PageHeader } from "@/components/admin/page-header";
import { FormMessage } from "@/components/admin/form-message";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { addMonths, civilDayOf, currentPeriod } from "@/lib/treasury/periods";
import { formatARS, formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS, minuteName } from "@/lib/members/labels";
import { listDivergent } from "@/lib/mp/fee-value-batch";
import { initialConfigTab } from "@/lib/admin/config-tabs";
import { ConfigTabs } from "./config-tabs";
import { TesoreriaPanel } from "./tesoreria-panel";
import { FeriadosPanel } from "./feriados-panel";
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
    collaboratorEnabled,
    contactPhone,
    contactEmail,
    termsText,
    privacyConsentText,
    mpPlanActiveId,
    mpPlanSharedId,
    digestRecipients,
  ] = await Promise.all([
    configReader.getBool(CONFIG_KEYS.asociateActivo),
    configReader.getBool(CONFIG_KEYS.collaboratorEnabled),
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
    // combo (tipo, número y fecha). Un acta no tiene texto ni adjuntos —es
    // tipo + número + fecha + una descripción corta—, pero el select chico
    // sigue siendo lo correcto: la descripción libre no viaja a esta pantalla.
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

  // Nombres de acta del historial: minuteName (tipo + número), nunca el id de
  // la fila. Consulta aparte porque el `take: 30` del combo no garantiza traer
  // las actas viejas que el historial referencia.
  const historyMinuteIds = [...new Set(
    history.flatMap((h) => (h.minuteId === null ? [] : [h.minuteId])),
  )];
  const historyMinutes = historyMinuteIds.length
    ? await prisma.minute.findMany({
        where: { id: { in: historyMinuteIds } },
        select: { id: true, type: true, number: true },
      })
    : [];
  const minuteNameById = new Map(historyMinutes.map((m) => [m.id, minuteName(m)]));
  const historyView = history.map((h) => ({
    id: h.id,
    dateLabel: formatDateAR(h.validFrom),
    activeLabel: formatARS(h.activeAmount),
    sharedLabel: formatARS(h.sharedAmount),
    minute: h.minuteId === null
      ? null
      : { id: h.minuteId, name: minuteNameById.get(h.minuteId) ?? `Acta #${h.minuteId}` },
  }));
  const currentView = current
    ? {
        dateLabel: formatDateAR(current.validFrom),
        activeLabel: formatARS(current.activeAmount),
        sharedLabel: formatARS(current.sharedAmount),
      }
    : null;
  const coverageLabel = coverageEntries.length === 0
    ? null
    : coverageEntries.map(([year, count]) => `${year} (${count})`).join(" · ");
  const futureView = futureHolidays.map((h) => ({
    id: h.id,
    label: h.label,
    dateLabel: formatDateAR(h.date),
  }));

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
        collaboratorEnabled={collaboratorEnabled}
        coverage={coverageEntries}
        digestCount={digestCount}
      />
      {/* Suspense: ConfigTabs usa useSearchParams; con force-dynamic el SSR ya
          resuelve la pestaña real y el fallback no llega a verse. */}
      <Suspense fallback={null}>
        <ConfigTabs
          initial={initialConfigTab({ cuota: sp.cuota, feriado: sp.feriado })}
          configInitial={{
            asociateActivo,
            collaboratorEnabled,
            contactPhone: contactPhone ?? "",
            contactEmail: contactEmail ?? "",
            termsText: termsText ?? "",
            privacyConsentText: privacyConsentText ?? "",
            mpPlanActiveId: mpPlanActiveId ?? "",
            mpPlanSharedId: mpPlanSharedId ?? "",
            digestRecipients: digestRecipients ?? "",
          }}
          tesoreria={
            <TesoreriaPanel
              current={currentView}
              history={historyView}
              minutes={minutes}
              suggestedValidFrom={suggestedValidFrom}
            />
          }
          feriados={
            <FeriadosPanel
              coverageLabel={coverageLabel}
              futureHolidays={futureView}
              suggestedDate={suggestedHoliday}
            />
          }
        />
      </Suspense>
    </div>
  );
}
