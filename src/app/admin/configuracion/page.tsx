import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { PageHeader } from "@/components/admin/page-header";
import { FormMessage } from "@/components/admin/form-message";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { addMonths, currentPeriod } from "@/lib/treasury/periods";
import { formatARS, formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { ConfigForm } from "./config-form";
import { FeeValueForm } from "./fee-value-form";

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
  ] = await Promise.all([
    configReader.getBool(CONFIG_KEYS.asociateActivo),
    configReader.getString(CONFIG_KEYS.contactPhone),
    configReader.getString(CONFIG_KEYS.contactEmail),
    configReader.getString(CONFIG_KEYS.termsText),
    configReader.getString(CONFIG_KEYS.privacyConsentText),
    configReader.getString(CONFIG_KEYS.mpPlanActiveId),
    configReader.getString(CONFIG_KEYS.mpPlanSharedId),
  ]);

  // Valor de cuota (M4): el vigente para mostrar, el historial para la lista y
  // las últimas actas para el select. La fecha sugerida es el 1° del mes que
  // viene, que es cuando arranca a regir un valor nuevo en la práctica.
  const [current, history, minuteRows] = await Promise.all([
    feeValueReader.current(),
    feeValueReader.history(),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
  ]);
  const minutes = minuteRows.map((m) => ({
    id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  // El 1° del mes que viene, calculado con los períodos de tesorería —que
  // resuelven el mes en hora argentina— y no con aritmética UTC: la noche del
  // último día del mes, UTC ya está en el mes siguiente y la sugerencia se
  // adelantaría un mes entero.
  const suggestedValidFrom = `${addMonths(currentPeriod(), 1)}-01`;

  return (
    <div className="space-y-4">
      <PageHeader title="Configuración" />
      {sp.guardado === "1" && (
        <FormMessage kind="success" box>
          Configuración guardada.
        </FormMessage>
      )}
      <ConfigForm
        initial={{
          asociateActivo,
          contactPhone: contactPhone ?? "",
          contactEmail: contactEmail ?? "",
          termsText: termsText ?? "",
          privacyConsentText: privacyConsentText ?? "",
          mpPlanActiveId: mpPlanActiveId ?? "",
          mpPlanSharedId: mpPlanSharedId ?? "",
        }}
      />

      <section className="max-w-2xl space-y-4 border-t pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Tesorería — valor de cuota
        </h2>
        {sp.cuota === "1" && <FormMessage kind="success" box>Valor de cuota registrado.</FormMessage>}
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
    </div>
  );
}
