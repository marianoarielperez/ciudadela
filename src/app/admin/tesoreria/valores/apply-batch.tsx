"use client";
// El lote REG-34, del lado del operador.
//
// La pantalla es un ORDEN DE CAMBIO, no un reporte: cada fila es la tarjeta de
// un vecino y lo que se está por firmar es cuánto le van a debitar todos los
// meses. De ahí las tres decisiones de forma:
//
//   1. La tabla muestra el DELTA, no el estado. "Cobra hoy" y "Pasa a cobrar"
//      son dos columnas con encabezado propio (un `$6.000 → $7.000` en una sola
//      celda se lee lindo y se escucha pésimo en un lector de pantalla), y el
//      nombre va antes que el id: el operador reconoce vecinos, no preapprovals.
//   2. El estado se pinta FILA POR FILA mientras corre, porque la operación ES
//      fila por fila: una llamada a Mercado Pago por suscripción, en serie. Una
//      barra de progreso sola escondería cuál se está tocando y cuál falló.
//   3. La confirmación dice la consecuencia en el botón, no "Confirmar".
//
// El cliente maneja la cola: parte la lista que el operador VIO en tandas de
// `BATCH_SIZE` y llama con `only`. No usa el `remaining` del servidor para
// avanzar a propósito — la divergencia se recalcula en cada llamada, así que
// una suscripción que falla siempre volvería a caer en la primera tanda una y
// otra vez y con el token de MP vencido el bucle no terminaría nunca. Con la
// lista fija, cada suscripción se intenta UNA vez por corrida y el operador
// reintenta las que fallaron cuando quiera.
//
// Nada de lo que se lee acá lo calcula este componente: los montos vienen
// formateados del servidor, y el monto que se empuja lo recalcula la action.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { BadgeVariant } from "@/lib/admin/status-badges";
import { BATCH_SIZE, shouldContinue } from "@/lib/mp/fee-value-batch-chunks";
import { applyFeeValueBatchAction } from "./actions";

/** Una fila, ya resuelta y formateada por el servidor. */
export type DivergentRow = {
  preapprovalId: string;
  memberId: number;
  fullName: string;
  categoryLabel: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  /** Nada cancela la suscripción al declarar una baja: un cesante puede seguir
   *  con débito vivo, y subirle la cuota a alguien que ya no es socio es
   *  exactamente lo que hay que poder ver antes de confirmar. */
  withdrawn: boolean;
  /** Ya en es-AR, o `null` si nunca se supo qué cobra. */
  currentLabel: string | null;
  expectedLabel: string;
};

type RowMark =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done" }
  /** La miramos y no hubo nada que empujar: ya estaba en el valor vigente
   *  cuando le tocó el turno. NO es "Aplicado": nadie la tocó. */
  | { kind: "skipped" }
  | { kind: "failed"; code: string };

type Failure = { preapprovalId: string; memberId: number; fullName: string; code: string };

type Phase = "idle" | "confirm" | "running" | "finished";

/** La action TIRÓ en vez de devolver un rechazo: 504 de Nginx (25 updates en
 *  serie contra MP a ~3 s pasan el `proxy_read_timeout` por defecto), la red
 *  que se corta, Prisma que explota antes del `return`. Lo que el operador
 *  necesita saber es que el servidor siguió trabajando: lo aplicado quedó
 *  aplicado y la lista al recargar dice qué falta. */
const CONNECTION_LOST =
  "Se cortó la conexión con el servidor mientras se aplicaba una tanda. " +
  "Lo que ya se aplicó quedó aplicado: recargá la pantalla para ver cuáles faltan.";

export function ApplyBatch({ divergent, superadmin }: { divergent: DivergentRow[]; superadmin: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [marks, setMarks] = useState<Record<string, RowMark>>({});
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [updated, setUpdated] = useState(0);
  const [failures, setFailures] = useState<Failure[]>([]);
  /** Quedaron sin intentar porque la corrida se cortó sola. */
  const [untried, setUntried] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /** El bloque de confirmación recibe el foco al montarse: el botón que lo
   *  abrió se desmonta, el foco caería a <body> y un lector de pantalla no
   *  anunciaría la advertencia de consecuencia — justo la que dice a cuántos
   *  vecinos se les va a cambiar el débito. Mismo patrón que `ConfirmForm` de
   *  la vinculación. */
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === "confirm") confirmRef.current?.focus();
  }, [phase]);

  const n = divergent.length;
  const withdrawn = divergent.filter((d) => d.withdrawn).length;

  /** Vuelve a dejar la pantalla lista para otra corrida. Limpia las marcas: si
   *  quedaran, una fila que ya se aplicó seguiría en verde sobre una lista que
   *  el servidor volvió a calcular. */
  function reset() {
    setPhase("idle");
    setError(null);
    setUpdated(0);
    setFailures([]);
    setUntried(0);
    setMarks({});
  }

  async function run(ids: string[]) {
    setPhase("running");
    setError(null);
    setUpdated(0);
    setFailures([]);
    setUntried(0);
    setProcessed(0);
    setTotal(ids.length);
    const next: Record<string, RowMark> = {};
    for (const id of ids) next[id] = { kind: "idle" };
    setMarks({ ...next });

    let ok = 0;
    const fails: Failure[] = [];

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      for (const id of chunk) next[id] = { kind: "running" };
      setMarks({ ...next });

      let r: Awaited<ReturnType<typeof applyFeeValueBatchAction>>;
      try {
        r = await applyFeeValueBatchAction({ only: chunk });
      } catch {
        // La action TIRÓ (no devolvió un rechazo): 504 de Nginx, la red que se
        // cae, Prisma que explota antes del return. Sin este catch la promesa
        // quedaba rechazada, `phase` clavado en "running" y el operador
        // mirando "Aplicando… No cierres la pestaña" para siempre, en la
        // operación más peligrosa del sistema. El detalle NO se muestra: puede
        // ser un HTML de error del proxy y no le dice nada al operador.
        for (const id of chunk) next[id] = { kind: "idle" };
        setMarks({ ...next });
        setError(CONNECTION_LOST);
        // Sólo las que NI SE MANDARON. De la tanda en vuelo no sabemos qué
        // alcanzó a aplicarse allá, y por eso el mensaje manda a recargar.
        setUntried(Math.max(0, ids.length - i - chunk.length));
        setPhase("finished");
        router.refresh();
        return;
      }
      if ("error" in r) {
        // Sesión caída o pedido rechazado: la tanda no se ejecutó. Las filas
        // vuelven a "sin tocar" para no dejar 25 renglones diciendo "aplicando".
        for (const id of chunk) next[id] = { kind: "idle" };
        setMarks({ ...next });
        setError(r.error);
        setUntried(ids.length - i);
        setPhase("finished");
        // Las tandas anteriores YA se aplicaron: sin esto siguen listadas como
        // divergentes hasta que el operador recargue a mano.
        router.refresh();
        return;
      }

      const byId = new Map(r.failed.map((f) => [f.preapprovalId, f]));
      // "Aplicado" es sólo lo que el servidor dice que empujó. Inferirlo de "no
      // falló" pintaba de verde filas que nadie tocó — y con el valor vigente
      // desaparecido entre el render y el clic, las 25 de la primera tanda sin
      // una sola llamada a Mercado Pago.
      const pushed = new Set(r.applied);
      for (const id of chunk) {
        const f = byId.get(id);
        if (f) {
          next[id] = { kind: "failed", code: f.code };
          fails.push(f);
        } else if (pushed.has(id)) {
          next[id] = { kind: "done" };
        } else {
          next[id] = { kind: "skipped" };
        }
      }
      ok += r.updated;
      setMarks({ ...next });
      setProcessed(i + chunk.length);
      setUpdated(ok);
      setFailures([...fails]);

      const left = ids.length - (i + chunk.length);
      // La guarda que evita seguir llamando a Mercado Pago cuando nada avanza
      // (token vencido, API caída): la tanda que falló entera no va a mejorar
      // en la siguiente. Una tanda sin nada que hacer NO corta: otro superadmin
      // pudo correr el lote entre medio y ahí no falló nada.
      if (left > 0 && !shouldContinue({ updated: r.updated, failed: r.failed.length, remaining: left })) {
        setUntried(left);
        break;
      }
    }

    setPhase("finished");
    // La tabla se relee del servidor: las que se actualizaron dejan de figurar.
    router.refresh();
  }

  if (n === 0 && phase === "idle") {
    return <EmptyState size="card" description="Todas las suscripciones cobran el valor vigente." />;
  }

  const busy = phase === "running";

  return (
    <div className="space-y-4">
      {n > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Socio</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Estado del socio</TableHead>
                <TableHead className="text-right">Cobra hoy</TableHead>
                <TableHead className="text-right">Pasa a cobrar</TableHead>
                <TableHead>Aplicación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {divergent.map((d) => {
                const mark = marks[d.preapprovalId] ?? { kind: "idle" as const };
                return (
                  <TableRow key={d.preapprovalId}>
                    <TableCell>
                      <Link
                        className="font-medium text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        href={`/admin/socios/${d.memberId}?tab=cuenta`}
                      >
                        {d.fullName}
                      </Link>
                      <span className="block font-mono text-xs break-all text-muted-foreground">
                        {d.preapprovalId}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.categoryLabel}</TableCell>
                    <TableCell>
                      <Badge variant={d.statusVariant}>{d.statusLabel}</Badge>
                    </TableCell>
                    {/* El monto viejo va apagado y el nuevo con peso: lo que el
                        operador tiene que poder leer de un saque es la columna
                        de la derecha, que es la que se le va a cobrar. */}
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {d.currentLabel ?? "sin dato"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      <span aria-hidden="true" className="mr-1 text-muted-foreground">→</span>
                      {d.expectedLabel}
                    </TableCell>
                    <TableCell className="text-sm">
                      <RowStatus mark={mark} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {!superadmin ? (
        <FormMessage kind="neutral" role="none">
          Aplicar el valor a las suscripciones de Mercado Pago lo hace el superadmin.
        </FormMessage>
      ) : phase === "idle" && n > 0 ? (
        <Button type="button" onClick={() => setPhase("confirm")}>
          {`Aplicar valor vigente a ${n} ${n === 1 ? "suscripción" : "suscripciones"}`}
        </Button>
      ) : null}

      {superadmin && phase === "confirm" && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="lote-confirm-title"
          className="space-y-3 rounded-md border border-primary bg-primary/5 p-3 outline-hidden focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p id="lote-confirm-title" className="font-medium">
            {`Se le va a cambiar el monto del débito a ${n} ${n === 1 ? "vecino" : "vecinos"} en Mercado Pago. Es lo que van a ver en su resumen de tarjeta desde el próximo cobro.`}
          </p>
          <p className="text-sm text-muted-foreground">
            {`Se procesan de a ${BATCH_SIZE}, una por una. Podés cerrar la pestaña cuando termine; si se corta antes, las que ya se actualizaron quedan actualizadas y el resto sigue figurando en esta lista.`}
          </p>
          {withdrawn > 0 && (
            <FormMessage kind="warning" role="none">
              {`${withdrawn === 1 ? "Uno de ellos está dado de baja" : `${withdrawn} de ellos están dados de baja`} y su débito sigue vivo en Mercado Pago. Si aplicás el valor, le vas a cobrar la cuota nueva a alguien que ya no es socio: lo que corresponde ahí es dar de baja la suscripción, no actualizarla.`}
            </FormMessage>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => run(divergent.map((d) => d.preapprovalId))}>
              Confirmar y aplicar
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {busy && (
        <div className="space-y-2">
          <progress
            className="h-2 w-full max-w-md"
            value={processed}
            max={total}
            aria-label="Suscripciones procesadas"
          />
          <FormMessage kind="neutral" role="status">
            {`Aplicando en Mercado Pago: ${processed} de ${total}. No cierres la pestaña.`}
          </FormMessage>
        </div>
      )}

      {error && (
        <div className="space-y-3">
          <FormMessage kind="error" box>{error}</FormMessage>
          {/* Sin fallos que reintentar el bloque de abajo no se dibuja, y sin
              este botón la pantalla queda en "finished" sin forma de arrancar
              otra corrida: el de "Aplicar valor vigente" sólo existe en idle. */}
          {phase === "finished" && failures.length === 0 && untried === 0 && (
            <Button type="button" variant="outline" onClick={reset}>
              Volver a empezar
            </Button>
          )}
        </div>
      )}

      {phase === "finished" && !error && failures.length === 0 && untried === 0 && (
        <FormMessage kind="success" box>
          {/* Cero actualizadas y cero fallos no es un lote vacío de trabajo: es
              que ya estaban al día cuando les tocó el turno (otro superadmin
              corrió el lote entre medio). Decir "Actualizadas 0" ahí suena a
              que algo salió mal. */}
          {updated === 0
            ? "No hubo nada que aplicar: esas suscripciones ya cobraban el valor vigente."
            : `Actualizadas ${updated} ${updated === 1 ? "suscripción" : "suscripciones"}. Desde el próximo cobro se debita el valor vigente.`}
        </FormMessage>
      )}

      {/* El contenedor NO anuncia (`role="none"`): adentro van una lista y dos
          botones, y un `role="alert"` alrededor de controles hace que el lector
          reanuncie todo al interactuar. El anuncio queda en el resumen de una
          sola línea, con `role="status"`. */}
      {phase === "finished" && (failures.length > 0 || untried > 0) && (
        <FormMessage kind="warning" box as="div" role="none">
          <p role="status">
            {`Actualizadas ${updated}. `}
            {failures.length > 0 && `Quedaron ${failures.length} sin actualizar. `}
            {/* Con `error` la corrida se cortó por la sesión o por un pedido
                rechazado, no porque Mercado Pago fallara: el motivo ya lo dice
                el mensaje de error y repetir "no pudo actualizar ninguna" ahí
                mandaría a buscar el problema donde no está. */}
            {untried > 0 &&
              (error
                ? `Quedaron ${untried} sin intentar. `
                : `Se detuvo antes de intentar ${untried}: la última tanda no pudo actualizar ninguna. `)}
            Las que no se actualizaron siguen cobrando el monto viejo.
          </p>
          {failures.length > 0 && (
            <ul className="mt-2 space-y-1">
              {failures.map((f) => (
                <li key={f.preapprovalId} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/admin/socios/${f.memberId}?tab=cuenta`}
                  >
                    {f.fullName}
                  </Link>
                  <span className="font-mono text-xs">{f.code}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {failures.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => run(failures.map((f) => f.preapprovalId))}
              >
                Reintentar las que fallaron
              </Button>
            )}
            {untried > 0 && (
              <Button type="button" variant="outline" onClick={reset}>
                Volver a empezar
              </Button>
            )}
          </div>
        </FormMessage>
      )}
    </div>
  );
}

/** El estado de UNA suscripción. Texto y no íconos: el operador tiene que poder
 *  copiar el código del fallo, y un tilde verde no se copia. */
function RowStatus({ mark }: { mark: RowMark }) {
  if (mark.kind === "running") return <span className="text-muted-foreground">Aplicando…</span>;
  if (mark.kind === "done") return <span className="text-success">Aplicado</span>;
  // Se la miró y ya cobraba el valor vigente: decir "Aplicado" ahí sería
  // afirmar una llamada a Mercado Pago que no ocurrió.
  if (mark.kind === "skipped") return <span className="text-muted-foreground">Sin cambios</span>;
  if (mark.kind === "failed") return <span className="font-mono text-xs text-destructive">{mark.code}</span>;
  return <span className="text-muted-foreground">—</span>;
}
