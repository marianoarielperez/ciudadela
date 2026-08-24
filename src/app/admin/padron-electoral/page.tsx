// Padrón electoral (REG-31 + enmienda del 23/08/2026). Superadmin.
//
// La fecha de la elección es un PARÁMETRO y viaja en la URL (`?fecha=`): el
// padrón se regenera en cualquier momento —incluida la mañana de la elección,
// que es justamente cuando los morosos terminan de purgar— y el link se comparte
// con la Junta Electoral.
//
// El sistema NO gestiona la elección: entrega el padrón y nada más (REG-31).
import { headers } from "next/headers";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { parseCivilDate } from "@/lib/dates";
import { formatARS, formatDateAR } from "@/lib/format";
import { buildElectoralRoll, ELECTORAL_MIN_DAYS } from "@/lib/members/electoral";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { civilDayOf } from "@/lib/treasury/periods";
import { ElectionsFlagForm } from "./elections-flag-form";
import { ElectoralRollSheet } from "./roll-sheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Padrón electoral — SIGeV" };

const DATE_ERROR = "La fecha de la elección no es válida.";

/** Hoy según el calendario ARGENTINO, no el reloj UTC del server: a las 21:00 de
 *  acá, `new Date().toISOString()` ya está en el día siguiente y la pantalla
 *  abriría con la fecha de mañana. */
function isoToday(): string {
  return civilDayOf().toISOString().slice(0, 10);
}

export default async function PadronElectoralPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La ruta se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee: el
  // layout mira el token (hasta 8 h desactualizado) y esto es una lista de
  // vecinos que se imprime y sale del sistema, más el interruptor de una regla
  // estatutaria.
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    // Pantalla de bloqueo, NO redirect (mismo motivo que /admin/configuracion:
    // acá no falta la sesión, falta un rol).
    return (
      <div className="space-y-4">
        <PageHeader title="Padrón electoral" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const raw = one(sp.fecha) ?? isoToday();
  // El regex de forma no alcanza: `parseCivilDate` rechaza el día que no existe
  // y el año mal tipeado, y devuelve el mediodía UTC con el que el proyecto
  // guarda toda fecha civil.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? parseCivilDate(raw, { minYear: 2020, invalidError: DATE_ERROR })
    : { ok: false as const, error: DATE_ERROR };

  const ongoing = await configReader.getBool(CONFIG_KEYS.electionsOngoing);
  // Todo se resuelve acá y no en un componente async anidado: el cuerpo del
  // padrón es lo único que esta pantalla muestra, así que no hay nada que
  // adelantar mientras se arma, y de paso se puede renderizar entera en un test.
  const generated = parsed.ok ? await generateRoll(parsed.value, actor.actorId) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Padrón electoral"
        actions={
          parsed.ok ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button asChild variant="outline">
                {/* `<a>` y no `<Link>`: es una descarga, no una navegación. */}
                <a href={`/api/admin/padron-electoral?fecha=${raw}`}>Exportar CSV</a>
              </Button>
              <PrintButton />
            </div>
          ) : undefined
        }
      >
        <p className="max-w-prose text-sm text-muted-foreground">
          Socios con derecho a voto a la fecha indicada: activos, honorarios, colaboradores,
          vitalicios y adherentes con {ELECTORAL_MIN_DAYS} días o más de antigüedad (REG-31). El
          sistema entrega el padrón; no gestiona la elección.
        </p>
      </PageHeader>

      <section className="max-w-2xl rounded-lg border p-4 print:hidden">
        <ElectionsFlagForm ongoing={ongoing} />
      </section>

      {/* GET y no server action: la fecha tiene que quedar en la URL para poder
          compartir el padrón y para que el botón atrás vuelva al anterior. */}
      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1.5">
          <Label htmlFor="fecha">Fecha de la elección</Label>
          <Input id="fecha" type="date" name="fecha" defaultValue={raw} className="h-11 w-auto" />
        </div>
        <Button type="submit" variant="secondary" className="h-11">Generar</Button>
      </form>

      {!parsed.ok && <FormMessage kind="error" box>{parsed.error}</FormMessage>}

      {generated && (
        <div className="space-y-6">
          <p className="flex flex-wrap items-center gap-2 text-sm print:hidden">
            <span>
              Padrón al <strong>{formatDateAR(generated.roll.at)}</strong>
            </span>
            <Badge variant="default">{generated.roll.enabled.length} habilitados</Badge>
            {generated.roll.toPurge.length > 0 && (
              <Badge variant="secondary">
                {`${generated.roll.toPurge.length} con deuda a purgar · ${generated.roll.purgeFees} cuotas`}
                {generated.valued ? ` · ${formatARS(generated.roll.purgeAmount)}` : ""}
              </Badge>
            )}
          </p>

          <ElectoralRollSheet
            roll={generated.roll}
            valued={generated.valued}
            generatedAt={generated.generatedAt}
          />
        </div>
      )}
    </div>
  );
}

async function generateRoll(at: Date, actorId: number) {
  const feeValue = await feeValueReader.current();
  const roll = await buildElectoralRoll(prisma, at, feeValue);

  // El asiento se escribe al GENERAR y no al exportar (spec §9: "generar el
  // padrón deja asiento"). Es deliberado que no dependa del CSV: esta pantalla
  // se imprime, y el navegador no le avisa al servidor cuando alguien aprieta
  // Imprimir — mismo criterio que la hoja de gestión manual. La exportación deja
  // el suyo aparte, porque es un archivo que además se puede reenviar.
  //
  // Metadatos únicamente: la fecha usada y los tamaños. NUNCA una fila.
  await audit({
    userId: actorId,
    action: "electoral_roll_generated",
    // Sin `entity`: no es un asiento sobre una fila (mismo criterio que
    // `padron_export` y `manual_collection_sheet`).
    detail: {
      at: at.toISOString().slice(0, 10),
      enabled: roll.enabled.length,
      toPurge: roll.toPurge.length,
      purgeFees: roll.purgeFees,
    },
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });

  return { roll, valued: feeValue !== null, generatedAt: new Date() };
}
