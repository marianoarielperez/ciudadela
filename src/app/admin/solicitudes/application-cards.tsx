"use client";
// Selección de tarjetas + barra de asiento fija. Reemplaza a `record-form.tsx`
// con el mismo esqueleto (mismo `useActionState`, mismo seguimiento de
// selección por delegación, mismo `useFormResetSync` para el rechazo
// parcial), sólo que la selección se muestra como una barra pegada abajo y no
// como un bloque arriba de la tabla.
//
// El contenido de las tarjetas (con sus badges — `showsNoDebitBadge` y
// compañía) lo sigue armando el Server Component (`page.tsx`) y llega acá
// como `children`, EXACTO mismo patrón que `RecordForm` recibía `table`: la
// selección se sigue desde el `onChange` delegado del <form>, así que este
// componente no necesita conocer los datos de cada solicitud, sólo los ids
// asentables.
//
// ── Por qué `sticky` y no el `fixed inset-x-0` que describe el brief ────────
// El shell del panel (`admin/layout.tsx`) pone la lateral y el `<main>` en un
// `lg:flex`: un elemento `fixed inset-x-0` se posiciona contra el VIEWPORT
// entero, así que en desktop taparía la lateral (o quedaría por debajo, según
// el z-index). Y el ancho de la lateral no es una constante CSS: alterna
// `w-14`/`w-[230px]` por estado de React (`AdminSidebar`), sin variable ni
// atributo que un `fixed` pueda leer para descontarse ese ancho. `sticky
// bottom-0` resuelve las dos cosas gratis: como elemento normal del flujo,
// hereda el ancho del `<main>` (nunca se mete debajo de la lateral) sin
// necesitar coordinarse con su estado, y sigue empujando la vista al hacer
// scroll — mismo resultado percibido ("queda al alcance del pulgar") sin el
// problema de superposición.
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";

type State = { error?: string; recorded?: number; failures?: Array<{ id: number; error: string }> };
type Action = (prev: State, fd: FormData) => Promise<State>;

export function ApplicationCards(props: {
  action: Action;
  minutes: MinuteOption[];
  /** Ids de la cola que se pueden asentar (todas las de "Pendientes": no hay
   *  paginación en la cola, así que no hace falta distinguir "de esta
   *  página"). */
  selectableIds: number[];
  /** Tamaño TOTAL de la cola (asentables + no asentables), sólo para la fila
   *  del contador que este componente pone arriba de las tarjetas — ver
   *  `QueueCountRow` en `page.tsx`, que es la misma fila para las ramas que
   *  no llegan a montar este formulario. */
  queueCount: number;
  /** Querystring de los filtros vigentes, para volver a la misma vista. La
   *  cola de Pendientes no tiene filtros propios, así que llega vacía; se
   *  mantiene el campo por si el día de mañana los tiene. */
  filters: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [selected, setSelected] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // Igual que en `RecordForm`: la selección efectiva se DERIVA de lo que la
  // página sigue ofreciendo. Con éxito parcial, `revalidatePath` deja
  // asentadas las que entraron y sus tarjetas pierden el checkbox — sin este
  // filtro el contador seguiría diciendo veinte cuando quedan tres.
  const all = props.selectableIds.map(String);
  const effective = selected.filter((id) => all.includes(id));
  useFormResetSync(formRef, { ids: effective.join(",") });

  // Delegado: cubre los checkboxes de las tarjetas, que las renderiza el
  // servidor.
  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.name !== "ids" || el.type !== "checkbox") return;
    setSelected((prev) =>
      el.checked ? [...new Set([...prev, el.value])] : prev.filter((v) => v !== el.value),
    );
  };

  const failures = state.failures ?? [];
  // Arreglo 3 (revisión tarea 6): la barra tiene que quedar MONTADA mientras
  // haya algo asentable en la cola, no sólo mientras haya algo tildado. Antes
  // desmontaba en cuanto se destildaba la última tarjeta, y con ella se perdía
  // el `MinutePicker` — y el borrador de "Acta nueva" (tipo, número, fecha,
  // descripción) que el operador haya tipeado. El botón de asentar es el que
  // se deshabilita cuando no hay nada tildado.
  const barMountable = props.selectableIds.length > 0;
  const allSelected = all.length > 0 && all.every((id) => effective.includes(id));

  return (
    <form ref={formRef} action={formAction} onChange={onChange} className="space-y-4">
      {/* Los filtros vigentes viajan con el POST para que el redirect de éxito
          vuelva a la misma vista y no a la bandeja entera. La action los
          re-parsea con el parser de la pantalla antes de usarlos. */}
      <input type="hidden" name="filtros" value={props.filters} />

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      {state.recorded !== undefined && state.recorded > 0 && (
        <FormMessage kind="warning" box>
          {`${state.recorded} ${state.recorded === 1 ? "solicitud asentada" : "solicitudes asentadas"} en acta. `}
          {`${failures.length} ${failures.length === 1 ? "quedó" : "quedaron"} sin asentar y ${failures.length === 1 ? "sigue" : "siguen"} tildada${failures.length === 1 ? "" : "s"} acá abajo.`}
        </FormMessage>
      )}

      {/* Los ids y el motivo, no un contador: el operador tiene que poder abrir
          la que falló y saber por qué, sin salir a buscarla por la bandeja. */}
      {failures.length > 0 && (
        <FormMessage kind="warning" box as="div">
          <p className="font-medium">Sin asentar:</p>
          <ul className="mt-1 space-y-1">
            {failures.map((f) => (
              <li key={f.id}>
                <Link className="underline" href={`/admin/solicitudes/${f.id}`}>
                  {`Solicitud N° ${f.id}`}
                </Link>
                {` — ${f.error}`}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}

      {/* Arreglo 2 (revisión tarea 6): misma fila que `QueueCountRow` en
          `page.tsx` —el contador y "Resumen para acta"—, con el "Seleccionar
          todas" del viejo `record-form.tsx` de vuelta al lado. Va ACÁ y no
          en la barra de asentar de más abajo, que sólo aparece con algo ya
          tildado: la casilla necesita poder tildar la PRIMERA. Y va acá y no
          en `page.tsx` porque el estado de selección (`selected`) vive sólo
          en este client component — pasarlo para arriba duplicaría estado. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span>
            {props.queueCount} {props.queueCount === 1 ? "solicitud" : "solicitudes"} en la cola
          </span>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-4"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? [] : all)}
            />
            Seleccionar todas las asentables
          </label>
        </p>
        <Button asChild variant="outline">
          <Link href="/admin/solicitudes/resumen">Resumen para acta</Link>
        </Button>
      </div>

      {/* Padding extra cuando la barra está visible: aunque `sticky` no tapa el
          final REAL de la lista (reserva su propio lugar en el flujo), sí se
          superpone a las tarjetas de más arriba mientras se hace scroll —
          mismo efecto visual que pedía el brief para el `fixed` — así que el
          margen de seguridad se mantiene igual. */}
      <div className={barMountable ? "pb-4" : undefined}>{props.children}</div>

      {barMountable && (
        <div
          className="sticky bottom-0 z-40 -mx-4 border-t bg-background/95 p-3 shadow-[0_-4px_16px_rgb(0_0_0_/_0.08)] backdrop-blur lg:-mx-6"
        >
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium">
              {effective.length} {effective.length === 1 ? "seleccionada" : "seleccionadas"}
            </p>
            <div className="min-w-64 grow">
              <MinutePicker minutes={props.minutes} />
            </div>
            {/* Arreglo 3: el botón se deshabilita sin nada tildado, pero la
                barra —y el `MinutePicker` de adentro, con su borrador de "Acta
                nueva"— se queda montada mientras haya algo ASENTABLE en la
                cola. */}
            <Button type="submit" disabled={pending || effective.length === 0} className="min-h-11">
              {pending ? "Asentando…" : "Asentar en acta"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
