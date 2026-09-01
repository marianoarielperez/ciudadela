// El stepper de proceso del wizard ASOCIATE (spec 2026-09-01 §4.1). La barra de
// progreso mide el formulario, y el formulario es sólo el primer tramo del
// camino: las dos etapas que siguen —la resolución de la Comisión Directiva y
// el asiento en acta— quedan SIEMPRE a la vista, para que ningún paso pueda
// leerse como "completando esto quedás adentro" (Art. 5 inc. 7: la admisión la
// resuelve la CD; el acta marco de REG-12 no existe).
//
// El gráfico es decorativo (`aria-hidden`, como la barra que reemplaza): el
// dato viaja en el eyebrow, en el `role="status"` del wizard y en la frase
// sr-only de acá abajo — que se dice UNA vez por montaje, no por paso, para no
// castigar al lector de pantalla en cada avance.
import { Landmark, Stamp, type LucideIcon } from "lucide-react";

export type ProcessPhase = {
  icon: LucideIcon;
  /** Dos líneas cortas (con `<br />`), como las de ASOCIATE. */
  label: React.ReactNode;
  /** Cómo se dice esa fase en la frase sr-only. */
  srText: string;
};

const ASOCIATE_PHASES: ProcessPhase[] = [
  {
    icon: Landmark,
    label: (
      <>
        La Comisión
        <br />
        resuelve
      </>
    ),
    srText: "la resuelve la Comisión Directiva",
  },
  {
    icon: Stamp,
    label: (
      <>
        Alta
        <br />
        en acta
      </>
    ),
    srText: "y el alta se asienta en acta",
  },
];

/** `subject` y `phases` son ADITIVAS (M7, spec §6.1): sin ellas el stepper es el
 *  de ASOCIATE, byte por byte en lo que dice —incluida la frase sr-only, cuyo
 *  arranque sale del propio `subject` en minúscula ("Después de enviar tu
 *  solicitud, …") para que no haya un texto de ASOCIATE escrito dos veces. */
export function ProcessRail({
  step,
  total,
  subject = "Tu solicitud",
  phases = ASOCIATE_PHASES,
}: {
  step: number;
  total: number;
  subject?: string;
  phases?: ProcessPhase[];
}) {
  return (
    <div>
      <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        Paso {step} de {total} · {subject}
      </p>
      <div aria-hidden className="mt-2.5 flex items-start">
        <div className="min-w-0 flex-1">
          <div className="flex h-6 items-center">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${(step / total) * 100}%` }}
              />
            </div>
          </div>
          <p className="mt-1 text-[10px] font-semibold leading-tight">{subject}</p>
        </div>
        {phases.map((phase, i) => {
          const Icon = phase.icon;
          return (
            <FuturePhase key={i} icon={<Icon className="size-3.5" />}>
              {phase.label}
            </FuturePhase>
          );
        })}
      </div>
      <p className="sr-only">
        Después de enviar {subject.toLocaleLowerCase("es-AR")},{" "}
        {phases.map((p) => p.srText).join(" ")}.
      </p>
    </div>
  );
}

function FuturePhase({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <span className="flex h-6 w-3 shrink-0 items-center sm:w-4">
        <span className="h-0.5 w-full bg-border" />
      </span>
      <span className="shrink-0 px-0.5 text-center">
        <span className="mx-auto flex size-6 items-center justify-center rounded-full border-2 border-border text-muted-foreground">
          {icon}
        </span>
        <span className="mt-1 block text-[10px] font-semibold leading-tight text-muted-foreground">
          {children}
        </span>
      </span>
    </>
  );
}
