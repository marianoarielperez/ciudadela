"use client";
// Cáscara del lote de cesantía: envuelve la tabla (que la arma el Server
// Component, con los checkboxes `name="ids"` ya renderizados) y le pone arriba
// el selector de acta y el botón.
//
// Misma mecánica que `RecordForm` en solicitudes, y por las mismas razones: la
// selección se sigue desde el `onChange` del <form> —las filas vienen del
// servidor y no pueden llevar manejadores, pero los eventos de React burbujean—
// y se re-afirma con `useFormResetSync`, porque React 19 resetea el formulario
// al terminar la action. Acá el rechazo parcial es el caso ESPERABLE (alguien
// pagó y bajó de las 4 cuotas), así que sin eso cada intento le destildaría al
// operador la lista entera que acababa de elegir.
//
// La acción tiene dos pasos: el primer envío devuelve `confirm` —a quiénes se
// va a expulsar, con nombre y cuotas, resuelto por el servidor— y el segundo
// (el botón "Confirmar la cesantía", que agrega `confirmar=1`) es el que da de
// baja. Volver atrás es local: se descarta la confirmación y el formulario
// queda intacto, con la selección tildada y el acta elegida, porque nunca se
// navegó a ningún lado.
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";
import { ARREARS_THRESHOLD } from "@/lib/treasury/rules";
import { declareArrearsAction } from "./actions";

type ArrearsState = Awaited<ReturnType<typeof declareArrearsAction>>;
type ArrearsConfirmation = NonNullable<ArrearsState["confirm"]>;

export function ArrearsForm({ minutes, selectableIds, children }: {
  minutes: MinuteOption[];
  /** Ids de los socios que la pantalla ofrece tildar (los de 4 cuotas o más). */
  selectableIds: number[];
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(declareArrearsAction, {});
  const [selected, setSelected] = useState<string[]>([]);
  // Qué confirmación descartó el operador con "Volver". Se guarda el objeto y
  // no un booleano: cada corrida de la action devuelve uno nuevo, así que una
  // confirmación posterior se muestra sola sin ningún efecto que resetear.
  const [dismissed, setDismissed] = useState<ArrearsConfirmation | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  // La selección efectiva se DERIVA de lo que la página sigue ofreciendo. Con
  // éxito parcial el `revalidatePath` de la action deja las bajas hechas y esas
  // filas desaparecen de la lista: sin este filtro el botón seguiría contando
  // diez cuando quedan tres, y "seleccionar todos" no se destildaría nunca.
  const all = selectableIds.map(String);
  const effective = selected.filter((id) => all.includes(id));
  useFormResetSync(formRef, { ids: effective.join(",") });

  // Delegado: cubre los checkboxes de las filas, que los renderiza el servidor.
  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.name !== "ids" || el.type !== "checkbox") return;
    setSelected((prev) =>
      el.checked ? [...new Set([...prev, el.value])] : prev.filter((v) => v !== el.value),
    );
    // Tocar la selección invalida lo que el operador acaba de leer: la
    // confirmación se cae y hay que volver a pedirla. (El cambio de acta no se
    // ve desde acá — lo agarra el token del lado del servidor.)
    setDismissed(state.confirm);
  };

  const allSelected = all.length > 0 && all.every((id) => effective.includes(id));
  const failures = state.failures ?? [];
  const confirm = state.confirm && state.confirm !== dismissed ? state.confirm : null;
  // Cuenta sólo a quienes de verdad se va a intentar dar de baja: los que la
  // propia lista marca "se va a rechazar" (bajaron de 4 cuotas entre la
  // selección y la lectura) no cuentan para el titular, aunque sigan
  // listados abajo con su advertencia.
  const toDeclareCount = confirm?.targets.filter((t) => t.pendingCount >= ARREARS_THRESHOLD).length ?? 0;

  // Con la confirmación abierta, el ÚNICO botón de envío que queda es el que da
  // de baja, y el navegador lo asigna al Enter de cualquier campo enfocado —no
  // sólo un <input> de texto: en "Acta existente" (el modo por defecto en
  // cuanto hay algún acta cargada) el único control de `MinutePicker` es un
  // <select>, y en algunos navegadores (Firefox) Enter sobre un <select>
  // también dispara el envío implícito. Sin cubrirlo, tabular hasta el acta y
  // apretar Enter declara la cesantía sin haber apretado "Confirmar la
  // cesantía". La confirmación se aprieta, no se tipea ni se selecciona.
  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (
      confirm && e.key === "Enter" &&
      (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)
    ) {
      e.preventDefault();
    }
  };

  // El botón "Declarar cesantía" que tenía el foco se desmonta apenas aparece
  // el panel (deja de renderizarse), y el foco cae a <body>: un lector de
  // pantalla no anuncia nada y el operador tiene que tabular desde arriba de
  // la página —el skip link, toda la lateral— para llegar a "Confirmar la
  // cesantía". Se dispara con CADA confirmación nueva, no sólo la primera:
  // `confirm` cambia de identidad en cada corrida de la action (por eso
  // `dismissed` guarda el objeto y no un booleano), así que un segundo lote
  // después de "Volver sin declarar" también mueve el foco al panel.
  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  return (
    <form ref={formRef} action={formAction} onChange={onChange} onKeyDown={onKeyDown} className="space-y-4">
      {/* Borde destructivo: este bloque no registra un pago, expulsa socios. */}
      <div className="flex flex-wrap items-end gap-4 rounded-md border border-destructive/40 p-3">
        <div className="min-w-64 grow">
          <MinutePicker minutes={minutes} />
        </div>
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={allSelected}
              onChange={() => {
                setSelected(allSelected ? [] : all);
                setDismissed(state.confirm);
              }}
            />
            Seleccionar todos los candidatos
          </label>
          {/* Con la confirmación en pantalla desaparece: hay un solo botón que
              da de baja, y es el que está debajo de la lista de nombres. */}
          {!confirm && (
            <Button type="submit" variant="destructive" disabled={pending || effective.length === 0}>
              {pending
                ? "Revisando…"
                : `Declarar cesantía${effective.length > 0 ? ` (${effective.length})` : ""}`}
            </Button>
          )}
        </div>
      </div>

      {/* El paso que pidió el cliente: antes de expulsar a nadie, quiénes son.
          Los nombres, los números y las cuotas los resolvió el servidor contra
          la base — no salen de este formulario. */}
      {confirm && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          className="space-y-3 rounded-md border border-destructive bg-destructive/5 p-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          role="group"
          aria-labelledby="arrears-confirm-title"
        >
          {confirm.changed && (
            <FormMessage kind="warning">
              La selección o el acta cambiaron después de confirmar: revisá de nuevo la lista.
            </FormMessage>
          )}
          <p id="arrears-confirm-title" className="font-medium">
            {`Vas a declarar la cesantía de ${toDeclareCount} ${
              toDeclareCount === 1 ? "socio" : "socios"
            }. Dejan de ser socios de la asociación.`}
          </p>
          <p className="text-sm text-muted-foreground">
            {"Se asienta en el acta: "}
            <span className="font-medium text-foreground">{confirm.minuteLabel}</span>
          </p>
          <ul className="space-y-1 text-sm">
            {confirm.targets.map((t) => (
              <li key={t.memberId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono tabular-nums text-muted-foreground">
                  {t.memberNumber !== null ? `N° ${t.memberNumber}` : "Sin número"}
                </span>
                <span className="font-medium">{t.name}</span>
                <span>
                  <span className="font-mono tabular-nums">{t.pendingCount}</span>
                  {t.pendingCount === 1 ? " cuota adeudada" : " cuotas adeudadas"}
                </span>
                {/* Alguien pudo pagar entre las dos pantallas: se dice acá y la
                    acción lo vuelve a rechazar por su nombre al ejecutar. */}
                {t.pendingCount < ARREARS_THRESHOLD && (
                  <FormMessage kind="warning" as="span" role="none">
                    {`No llega a ${ARREARS_THRESHOLD} cuotas: se va a rechazar.`}
                  </FormMessage>
                )}
              </li>
            ))}
          </ul>
          {/* Devuelve la huella de lo que se está confirmando: si para cuando
              se envía ya no es la misma selección ni la misma acta, la acción
              vuelve a pedir confirmación en vez de expulsar a ciegas. */}
          <input type="hidden" name="confirmToken" value={confirm.token} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="confirmar" value="1" variant="destructive" disabled={pending}>
              {pending ? "Declarando…" : "Confirmar la cesantía"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setDismissed(confirm)}
            >
              Volver sin declarar
            </Button>
          </div>
        </div>
      )}

      {/* Ayuda estática, no respuesta a una acción: `role="none"` para que el
          lector de pantalla no la anuncie como alerta en cada render. */}
      <FormMessage kind="warning" role="none">
        Sólo se pueden tildar socios con 4 cuotas adeudadas o más (Art. 9 inc. c), y la cantidad se
        vuelve a verificar al declarar. La deuda queda congelada en la ficha: el reingreso exige
        saldarla a valor vigente.
      </FormMessage>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      {state.declared !== undefined && state.declared > 0 && (
        <FormMessage kind="warning" box>
          {`${state.declared} ${state.declared === 1 ? "cesantía declarada" : "cesantías declaradas"}. `}
          {`${failures.length} ${failures.length === 1 ? "quedó" : "quedaron"} sin declarar.`}
        </FormMessage>
      )}

      {/* Los nombres y el motivo, no un contador: el operador tiene que poder
          abrir la ficha del que quedó afuera y ver por qué. */}
      {failures.length > 0 && (
        <FormMessage kind="warning" box as="div">
          <p className="font-medium">Sin declarar:</p>
          <ul className="mt-1 space-y-1">
            {failures.map((f) => (
              <li key={f.memberId}>
                <Link className="underline" href={`/admin/socios/${f.memberId}?tab=cuenta`}>{f.name}</Link>
                {` — ${f.error}`}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}

      {children}
    </form>
  );
}
