// Padrón electoral (REG-31 + enmienda del 23/08/2026). Superadmin.
//
// La fecha de la elección es un PARÁMETRO y viaja en la URL (`?fecha=`): el
// padrón se regenera en cualquier momento —incluida la mañana de la elección,
// que es justamente cuando los morosos terminan de purgar— y el link se comparte
// con la Junta Electoral.
//
// El sistema NO gestiona la elección: entrega el padrón y nada más (REG-31).
//
// La firma visual de la pantalla (rediseño del 27/08/2026) es LA CUENTA: la
// igualdad `considerados = habilitados + a purgar + no habilitados` como tira
// de stat cards con los signos a la vista. "148 habilitados" sólo se puede
// creer; la igualdad se puede verificar, y es lo que distingue "tres son
// demasiado nuevos" de "tres faltan por un problema de datos".
import { CalendarClock, FileSpreadsheet, Users, Vote, Wallet } from "lucide-react";
import { headers } from "next/headers";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
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
      <PageHeader title="Padrón electoral">
        <p className="max-w-prose text-sm text-muted-foreground">
          Socios con derecho a voto a la fecha indicada: activos, colaboradores y adherentes con{" "}
          {ELECTORAL_MIN_DAYS} días o más de antigüedad, más honorarios y vitalicios, a quienes el
          estatuto exime de ese piso. Quien no llega a los {ELECTORAL_MIN_DAYS} días figura aparte,
          con la fecha desde la que va a poder votar. El sistema entrega el padrón; no gestiona la
          elección.
        </p>
      </PageHeader>

      {/* La fecha y sus salidas JUNTAS: lo que se exporta o imprime es el
          padrón A ESA FECHA, y la dependencia queda a la vista en vez de
          repartida entre el encabezado y un formulario suelto. */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Generar padrón</CardTitle>
          <CardDescription>
            La fecha viaja en la URL: el link se comparte con la Junta Electoral y el padrón se
            regenera en cualquier momento, incluida la mañana del acto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* GET y no server action: la fecha tiene que quedar en la URL para
              poder compartir el padrón y para que el botón atrás vuelva al
              anterior. */}
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="fecha">Fecha de la elección</Label>
              <Input id="fecha" type="date" name="fecha" defaultValue={raw} className="h-11 w-auto" />
            </div>
            <Button type="submit" variant="secondary" className="h-11">Generar</Button>
          </form>
          {generated && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <Button asChild variant="outline">
                {/* `<a>` y no `<Link>`: es una descarga, no una navegación. */}
                <a href={`/api/admin/padron-electoral?fecha=${raw}`}>
                  <FileSpreadsheet aria-hidden className="size-4" />
                  Exportar Excel
                </a>
              </Button>
              <PrintButton />
              <p className="text-sm text-muted-foreground">
                Padrón al{" "}
                <strong className="font-mono tabular-nums">
                  {formatDateAR(generated.roll.at)}
                </strong>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {!parsed.ok && <FormMessage kind="error" box>{parsed.error}</FormMessage>}

      {generated && (
        <div className="space-y-6">
          {/* LA CUENTA, no el resultado: la igualdad con los signos a la vista.
              En papel no va (la cabecera de la hoja ya trae los conteos). */}
          <div className="space-y-1.5 print:hidden">
            <div className="flex flex-wrap items-stretch gap-2">
              <StatCard icon={Users} n={generated.roll.considered} label="considerados" />
              <Operator glyph="=" />
              <StatCard
                icon={Vote}
                n={generated.roll.enabled.length}
                label="habilitados"
                href="#habilitados"
              />
              <Operator glyph="+" />
              <StatCard
                icon={Wallet}
                n={generated.roll.toPurge.length}
                label="con deuda a purgar"
                href="#a-purgar"
              />
              <Operator glyph="+" />
              <StatCard
                icon={CalendarClock}
                n={generated.roll.withoutSeniority.length}
                label="no habilitados por antigüedad"
                href="#no-habilitados"
              />
            </div>
            {generated.roll.toPurge.length > 0 && (
              <p className="text-sm text-muted-foreground">
                A purgar en la mesa:{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {generated.roll.purgeFees}
                </span>{" "}
                cuotas
                {generated.valued ? (
                  <>
                    {" · "}
                    <span className="font-mono tabular-nums text-foreground">
                      {formatARS(generated.roll.purgeAmount)}
                    </span>
                  </>
                ) : null}
              </p>
            )}
          </div>

          <ElectoralRollSheet
            roll={generated.roll}
            valued={generated.valued}
            pastDate={generated.roll.at.getTime() < civilDayOf().getTime()}
            generatedAt={generated.generatedAt}
          />
        </div>
      )}

      {/* El interruptor del Art. 5° ter, al final: no es parte del padrón (lo
          que hace es bloquear los cambios de categoría en todo el panel). */}
      <Card className="max-w-2xl print:hidden">
        <CardHeader>
          <CardTitle>Elecciones en curso</CardTitle>
        </CardHeader>
        <CardContent>
          <ElectionsFlagForm ongoing={ongoing} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Un signo de la igualdad. Decorativo (`aria-hidden`): un lector de pantalla
 *  ya recorre los cuatro números con sus etiquetas. Oculto en móvil, donde las
 *  tarjetas apilan y la ecuación no se lee en línea. */
function Operator({ glyph }: { glyph: string }) {
  return (
    <span aria-hidden className="hidden items-center font-mono text-2xl text-muted-foreground sm:flex">
      {glyph}
    </span>
  );
}

/** Un sumando de la reconciliación como stat card. Las de bloque son ANCLAS a
 *  su sección (patrón full-card link del tablero: el pseudo-elemento cubre la
 *  tarjeta y el anillo de foco va inset porque Card recorta con overflow).
 *  En cero, el chip se apaga (regla anti-ruido de la 4C). */
function StatCard({ icon: Icon, n, label, href }: {
  icon: typeof Users;
  n: number;
  label: string;
  href?: string;
}) {
  const off = n === 0;
  return (
    <Card size="sm" className="relative min-w-40 flex-1">
      <CardContent className="flex items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
            off ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
          }`}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block font-mono text-3xl leading-none tabular-nums">{n}</span>
          {href ? (
            <a
              href={href}
              className="text-sm text-muted-foreground outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset hover:text-foreground hover:underline focus-visible:after:ring-2"
            >
              {label}
            </a>
          ) : (
            <span className="block text-sm text-muted-foreground">{label}</span>
          )}
        </span>
      </CardContent>
    </Card>
  );
}

async function generateRoll(at: Date, actorId: number) {
  const feeValue = await feeValueReader.current();
  const roll = await buildElectoralRoll(prisma, at, feeValue);

  // El asiento se escribe al GENERAR y no al exportar (spec 4C §9). Es
  // deliberado que no dependa del export: esta pantalla se imprime, y el
  // navegador no le avisa al servidor cuando alguien aprieta Imprimir. La
  // exportación deja el suyo aparte, porque es un archivo que además se puede
  // reenviar.
  //
  // Metadatos únicamente: la fecha usada y los tamaños de los TRES bloques.
  // NUNCA una fila.
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
      withoutSeniority: roll.withoutSeniority.length,
    },
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });

  return { roll, valued: feeValue !== null, generatedAt: new Date() };
}
