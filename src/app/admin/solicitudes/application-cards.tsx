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
  const barVisible = effective.length > 0;

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

      {/* Padding extra cuando la barra está visible: aunque `sticky` no tapa el
          final REAL de la lista (reserva su propio lugar en el flujo), sí se
          superpone a las tarjetas de más arriba mientras se hace scroll —
          mismo efecto visual que pedía el brief para el `fixed` — así que el
          margen de seguridad se mantiene igual. */}
      <div className={barVisible ? "pb-4" : undefined}>{props.children}</div>

      {barVisible && (
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
            <Button type="submit" disabled={pending} className="min-h-11">
              {pending ? "Asentando…" : "Asentar en acta"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
