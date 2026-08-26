// La LÍNEA DE PROCESO del tablero de re-empadronamiento: las cinco etapas del
// Art. 9° bis con sus fechas y los días que le quedan a la que está corriendo.
//
// Es el elemento distintivo de la sección, y acá la secuencia numerada SÍ es
// información y no decoración: las etapas ocurren en ese orden, no se puede
// saltear ninguna y el número dice en cuál de las cinco está el proceso. (En la
// mayoría de las pantallas numerar es adorno; por eso vale aclararlo.)
//
// PURO A PROPÓSITO: entran datos serializables, sale marcado. No lee el reloj
// —`daysLeft` llega calculado por `reregistration.counters()`, que compara día
// civil contra día civil— así que el test lo renderiza con
// `renderToStaticMarkup` y el resultado es el mismo a las 09:00 y a las 23:00.
// Mismo criterio que `components/admin/health-panels.tsx`.
import type { ReregistrationStatus } from "@/generated/prisma/client";
import { formatDateAR } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Lo mínimo del proceso que la línea necesita. Se pide la forma serializable y
 *  no la fila de Prisma para que el test la construya a mano. */
export type StepperProcess = {
  status: ReregistrationStatus;
  calledAt: Date;
  firstEndsAt: Date;
  secondEndsAt: Date | null;
};

type StageKey = "called" | "first" | "second" | "closing" | "closed";
type StageState = "done" | "current" | "upcoming";

/** En qué etapa de la línea cae cada estado del proceso. `preparing` existe en
 *  el enum pero hoy nadie lo escribe (`activate` nace en `first_instance`); se
 *  mapea igual para que un proceso viejo o cargado a mano no rompa la pantalla. */
const STAGE_OF: Record<ReregistrationStatus, StageKey> = {
  preparing: "called",
  first_instance: "first",
  second_instance: "second",
  closing: "closing",
  closed: "closed",
};

const ORDER: StageKey[] = ["called", "first", "second", "closing", "closed"];

/** Los días restantes en palabras. Exportada porque la usan también el veredicto
 *  y las acciones de fase: si el cartel de la línea dijera "faltan 3 días" y el
 *  botón dijera otra cosa, el operador no sabría a cuál creerle.
 *
 *  El 0 es "vence hoy" y NO "faltan 0 días": el día del vencimiento el socio lo
 *  tiene entero (es la misma lectura de `hasExpired`, que recién da vencido al
 *  día siguiente). */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft > 1) return `Faltan ${daysLeft} días`;
  if (daysLeft === 1) return "Falta 1 día";
  if (daysLeft === 0) return "Vence hoy";
  const gone = -daysLeft;
  return gone === 1 ? "Venció ayer" : `Venció hace ${gone} días`;
}

/** Etiqueta y fecha de cada etapa. La fecha que todavía no existe se nombra por
 *  su regla ("+10 días corridos") en vez de inventarse un DD/MM: una fecha
 *  estimada en la misma tipografía que las asentadas se lee como asentada. */
function stageRows(process: StepperProcess): Array<{ key: StageKey; label: string; detail: string }> {
  return [
    { key: "called", label: "Convocado", detail: formatDateAR(process.calledAt) },
    { key: "first", label: "1ª instancia", detail: `hasta el ${formatDateAR(process.firstEndsAt)}` },
    {
      key: "second",
      label: "2ª instancia",
      detail: process.secondEndsAt
        ? `hasta el ${formatDateAR(process.secondEndsAt)}`
        : "10 días corridos más",
    },
    { key: "closing", label: "Cierre", detail: "bajas y libro nuevo" },
    { key: "closed", label: "Cerrado", detail: "Libro cerrado" },
  ];
}

function stateOf(stage: StageKey, current: StageKey): StageState {
  const i = ORDER.indexOf(stage);
  const c = ORDER.indexOf(current);
  return i < c ? "done" : i === c ? "current" : "upcoming";
}

export function ProcessStepper({ process, daysLeft }: {
  process: StepperProcess;
  /** Días que le quedan a la instancia abierta, de `counters()`. `null` cuando
   *  no hay ninguna corriendo (cierre, cerrado). */
  daysLeft: number | null;
}) {
  const current = STAGE_OF[process.status];
  return (
    // `<ol>` y no una fila de `<div>`: para un lector de pantalla la línea de
    // proceso ES una lista ordenada, y el número de cada ítem es el dato.
    //
    // En móvil apila (una fila por etapa, con la regla a la izquierda del
    // número); desde `sm` pasa a cinco columnas con la regla arriba. Nada de
    // posicionamiento absoluto ni de anchos fijos: así no hay desborde
    // horizontal a 375px, que es donde el operador la va a mirar en la sede.
    <ol aria-label="Etapas del proceso" className="grid list-none gap-3 p-0 sm:grid-cols-5">
      {stageRows(process).map((row, i) => {
        const state = stateOf(row.key, current);
        return (
          <li
            key={row.key}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex items-start gap-3 border-l-2 pl-3",
              "sm:block sm:border-l-0 sm:border-t-2 sm:pt-2 sm:pl-0",
              state === "upcoming" ? "border-border" : "border-primary",
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-mono tabular-nums",
                state === "current" && "border-primary bg-primary text-primary-foreground",
                state === "done" && "border-primary text-primary",
                state === "upcoming" && "border-border text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 sm:mt-2">
              <p className={cn(
                "text-sm",
                state === "current" ? "font-semibold text-primary" : "text-foreground",
                state === "upcoming" && "text-muted-foreground",
              )}>
                {row.label}
              </p>
              <p className="text-xs text-muted-foreground">{row.detail}</p>
              {state === "current" && daysLeft !== null && (
                <p className="mt-0.5 font-mono text-xs tabular-nums text-primary">
                  {daysLeftLabel(daysLeft)}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
