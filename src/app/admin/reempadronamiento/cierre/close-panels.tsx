// Los bloques de la pantalla de cierre: el veredicto del checklist (etapa A) y
// la ficha de cada convocado que va al acta de bajas (etapa B).
//
// Viven fuera de `page.tsx` por el mismo motivo que `board-panels.tsx`: la
// página abre sesión y lee Prisma, así que no se puede renderizar en un test.
// Acá entran datos serializables y sale marcado.
//
// El orden de la pantalla no es estético, y es el mismo de `/admin/salud`: arriba
// de todo el VEREDICTO —qué falta para poder cerrar— y recién después el
// trabajo. Un tablero que obliga a auditar cinco bloques para descubrir que no
// se puede cerrar se deja de mirar.
import Link from "next/link";

import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import type { BoardNoticeKind } from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { PRESENTATIONS_BASE } from "@/lib/admin/presentation-queue";
import { formatDateAR } from "@/lib/format";
import { BOARD_NOTICE_KIND_LABELS } from "@/lib/members/labels";
import type { ClosePrecondition } from "@/lib/reregistration/close";

const NUM = "font-mono tabular-nums";

/** Encabezado común de las secciones. Calcado del del tablero del proceso y del
 *  de /admin/salud: el operador ya sabe leer esa pantalla. */
export function Section({ id, title, hint, children }: {
  id: string;
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-3">
      <h2 id={`${id}-title`} className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
        {title}
      </h2>
      {hint && <p className="max-w-3xl text-sm text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

/** Cómo se lee cada condición del checklist. El texto en CERO no es "0 de esto":
 *  es la condición CUMPLIDA, dicha en positivo. Un checklist que enumera ceros
 *  con la misma redacción que los problemas no se puede escanear de un vistazo.
 *
 *  Cada fila lleva además a DÓNDE se resuelve. Un bloqueante sin salida es un
 *  cartel que dice "no podés seguir" y deja al operador buscando el botón. */
type Line = {
  /** El texto que sigue al número. Van los DOS: el checklist tiene filas que en
   *  el padrón real valen 1 —hoy los cesanteables por mora son 7, pero una sola
   *  presentación sin resolver es lo más común de todo—, y "1 presentaciones
   *  esperando decisión" es la clase de detalle que le hace perder autoridad a
   *  una pantalla que dice que va a expulsar socios. Lo cazó el navegador. */
  one: string;
  many: string;
  done: string;
  href: string;
  hrefLabel: string;
};

const LINES: Record<ClosePrecondition["kind"], Line> = {
  unresolved_presentations: {
    one: "presentación esperando decisión de la Comisión",
    many: "presentaciones esperando decisión de la Comisión",
    done: "No queda ninguna presentación esperando decisión.",
    href: PRESENTATIONS_BASE,
    hrefLabel: "resolvelas en la cola",
  },
  cohort_not_terminal: {
    one: "convocado sin desenlace: sigue siendo adherente vigente y no tiene su re-empadronamiento validado",
    many: "convocados sin desenlace: siguen siendo adherentes vigentes y no tienen su re-empadronamiento validado",
    done: "Todos los convocados tienen desenlace.",
    href: "#bajas",
    hrefLabel: "declaralos de baja acá abajo",
  },
  arrears_candidates: {
    one: "socio activo o colaborador en condición de cesantía por mora",
    many: "socios activos o colaboradores en condición de cesantía por mora",
    done: "No hay ningún socio en condición de cesantía por mora.",
    href: "/admin/tesoreria/deudores",
    hrefLabel: "decidilo en Deudores antes de cerrar si corresponde",
  },
  board_in_progress: {
    one: "aviso de cartelera todavía en curso",
    many: "avisos de cartelera todavía en curso",
    done: "No hay ningún aviso de cartelera en curso.",
    href: "/admin/reempadronamiento#cartelera",
    hrefLabel: "mirá el tablero",
  },
};

function labelFor(kind: ClosePrecondition["kind"], count: number): string {
  const line = LINES[kind];
  return count === 1 ? line.one : line.many;
}

/** El veredicto de DOS NIVELES del cierre, el mismo patrón de `/admin/salud`:
 *  lo que FRENA en rojo, lo que hay que mirar antes de seguir en neutro.
 *
 *  Quién frena no se decide acá: llega decidido por `closeBlockers`, que es puro
 *  y está testeado aparte. La pantalla no vuelve a escribir el criterio.
 *
 *  `role="none"`: es el ESTADO de la pantalla al abrirla, no la respuesta a una
 *  acción. Un `alert` interrumpiría al lector de pantalla en cada recarga. */
export function CloseVerdict({ preconditions, blockers }: {
  preconditions: ClosePrecondition[];
  blockers: ClosePrecondition[];
}) {
  const blocking = new Set(blockers.map((b) => b.kind));
  const warnings = preconditions.filter((p) => p.count > 0 && !blocking.has(p.kind));
  const kind = blockers.length > 0 ? "error" : warnings.length > 0 ? "neutral" : "success";
  const headline =
    blockers.length > 0
      ? blockers.length === 1
        ? "Falta una cosa para poder cerrar el libro"
        : `Faltan ${blockers.length} cosas para poder cerrar el libro`
      : warnings.length > 0
        ? "Se puede cerrar, pero mirá esto antes"
        : "Todo listo para cerrar el libro";

  return (
    <FormMessage kind={kind} box as="div" role="none">
      <p className="font-semibold">{headline}</p>
      {blockers.length > 0 && (
        <ul className="mt-2 space-y-1">
          {blockers.map((b) => (
            <li key={b.kind}>
              <span className={NUM}>{b.count}</span> {labelFor(b.kind, b.count)} —{" "}
              <Link className={INLINE_LINK} href={LINES[b.kind].href}>
                {LINES[b.kind].hrefLabel}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 text-muted-foreground">
          <p className="text-xs font-semibold tracking-widest uppercase">Para revisar</p>
          <ul className="mt-1 space-y-1">
            {warnings.map((w) => (
              <li key={w.kind}>
                <span className={NUM}>{w.count}</span> {labelFor(w.kind, w.count)} —{" "}
                <Link className={INLINE_LINK} href={LINES[w.kind].href}>
                  {LINES[w.kind].hrefLabel}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {blockers.length === 0 && warnings.length === 0 && (
        <p className="mt-1 text-muted-foreground">
          No queda ninguna presentación sin resolver, ningún convocado sin desenlace, ningún socio en
          condición de cesantía por mora y ningún aviso de cartelera corriendo.
        </p>
      )}
    </FormMessage>
  );
}

/** El checklist entero, las CUATRO filas siempre, incluso en cero.
 *
 *  Que estén siempre las cuatro es lo que lo hace un checklist y no una lista de
 *  problemas: el operador tiene que poder ver qué se verificó, no sólo qué
 *  falló. Y una fila en cero se redacta en positivo para que se distinga de un
 *  vistazo. */
export function CloseChecklist({ preconditions, blockers }: {
  preconditions: ClosePrecondition[];
  blockers: ClosePrecondition[];
}) {
  const blocking = new Set(blockers.map((b) => b.kind));
  return (
    <ul className="list-none space-y-2 p-0">
      {preconditions.map((p) => {
        const line = LINES[p.kind];
        const state = p.count === 0 ? "ok" : blocking.has(p.kind) ? "blocks" : "warns";
        return (
          <li
            key={p.kind}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border p-3 text-sm"
          >
            <Badge
              variant={state === "blocks" ? "destructive" : state === "warns" ? "secondary" : "outline"}
            >
              {state === "blocks" ? "Bloquea" : state === "warns" ? "Advierte" : "Cumplido"}
            </Badge>
            {p.count === 0 ? (
              <span className="text-muted-foreground">{line.done}</span>
            ) : (
              <span>
                <span className={NUM}>{p.count}</span> {labelFor(p.kind, p.count)}.{" "}
                <Link className={INLINE_LINK} href={line.href}>
                  {line.hrefLabel}
                </Link>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Los carteles del proceso que todavía no cumplieron su plazo, como CONTEXTO.
 *
 *  No bloquean el cierre y no tienen por qué: un aviso en curso puede ser el de
 *  las bajas que se acaban de declarar, que por definición se fija después. Lo
 *  que sí hace falta es que el operador sepa que hay plazos corriendo cuando
 *  decida cerrar. */
export function BoardInProgress({ notices }: {
  notices: Array<{ id: number; kind: BoardNoticeKind; postedAt: Date | null; dueAt: Date | null }>;
}) {
  return (
    <ul className="list-none space-y-2 p-0 text-sm">
      {notices.map((n) => (
        <li key={n.id} className="rounded-md border p-3">
          <span className="font-medium">{BOARD_NOTICE_KIND_LABELS[n.kind]}</span>
          {n.postedAt === null || n.dueAt === null ? (
            <> — todavía sin fijar. Imprimilo y asentá la fijación desde el tablero del proceso.</>
          ) : (
            <>
              {" "}— fijado el <span className={NUM}>{formatDateAR(n.postedAt)}</span>; la notificación
              queda practicada el <span className={NUM}>{formatDateAR(n.dueAt)}</span>.
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
