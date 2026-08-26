// Los bloques del tablero del proceso vivo, aparte de la línea de proceso.
//
// Viven fuera de `page.tsx` por el mismo motivo que `health-panels.tsx`: la
// página abre sesión y lee Prisma, así que no se puede renderizar en un test.
// Acá no hay nada de eso —entran datos serializables, sale marcado— y
// `tests/reregistration-board-screen.test.ts` los renderiza con
// `renderToStaticMarkup`.
//
// El orden de la pantalla no es estético. Un tablero que obliga a auditar seis
// bloques para descubrir que no pasa nada se deja de mirar (la lección de
// /admin/salud), así que arriba de todo va el VEREDICTO: en qué etapa está,
// cuántos días quedan, cuánta gente falta y qué es lo próximo que el operador
// tiene que hacer. El resto es consulta.
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import type {
  BoardNoticeKind, EmailStatus, NotificationStatus, PresentationStatus, ReregistrationStatus,
} from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { queueHrefForStatus } from "@/lib/admin/presentation-queue";
import { type BadgeVariant, presentationStatusBadgeVariant } from "@/lib/admin/status-badges";
import { formatDateAR } from "@/lib/format";
import {
  BOARD_NOTICE_KIND_LABELS, PRESENTATION_STATUS_LABELS, PROCESS_STATUS_LABELS,
} from "@/lib/members/labels";
import { emailUsable } from "@/lib/reregistration/rules";
import { cn } from "@/lib/utils";
import { daysLeftLabel } from "./process-stepper";

const NUM = "font-mono tabular-nums";

/** Encabezado común de las secciones del tablero. Calcado del de /admin/salud:
 *  el operador ya sabe leer esa pantalla. */
function Section({ id, title, hint, children }: {
  id: string; title: string; hint?: React.ReactNode; children: React.ReactNode;
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

// ─────────────────────────────────────────────────────────────────────────────
// Veredicto: lo primero y —el día que no hay nada que hacer— lo único que leer
// ─────────────────────────────────────────────────────────────────────────────

export type ProcessCountersView = {
  byStatus: Record<PresentationStatus, number>;
  cohortSize: number;
  daysLeft: number | null;
};

/** Lo próximo que le toca al operador, en una línea.
 *
 *  PURO y exportado: la misma respuesta la usan el veredicto de arriba y el
 *  texto de las acciones de fase de abajo. Si el veredicto dijera "iniciá la
 *  segunda instancia" y el botón siguiera deshabilitado sin explicar por qué,
 *  el operador tendría que adivinar cuál de los dos miente — que es exactamente
 *  el defecto que esta pantalla existe para no tener.
 *
 *  `tone` separa lo que hay QUE HACER de lo que hay que ESPERAR. Nada nace en
 *  rojo: esperar un plazo que corre bien no es una avería. */
export function nextStep(input: {
  status: ReregistrationStatus;
  counters: ProcessCountersView;
  firstEndsAt: Date;
  secondEndsAt: Date | null;
  /** `true` cuando el plazo de la instancia abierta YA venció (`hasExpired`, no
   *  una comparación propia: quién decide si un plazo venció es esa función). */
  expired: boolean;
}): { tone: "act" | "wait"; label: string } {
  const toReview = input.counters.byStatus.submitted;
  const review = toReview === 1
    ? "Revisá la presentación que llegó."
    : `Revisá las ${toReview} presentaciones que llegaron.`;

  switch (input.status) {
    case "first_instance":
      if (input.expired) {
        return { tone: "act", label: "Venció la primera instancia: iniciá la segunda." };
      }
      if (toReview > 0) return { tone: "act", label: review };
      return {
        tone: "wait",
        label: `Esperar. La primera instancia corre hasta el ${formatDateAR(input.firstEndsAt)}.`,
      };
    case "second_instance":
      if (input.expired) {
        return { tone: "act", label: "Venció la segunda instancia: prepará el cierre del libro." };
      }
      if (toReview > 0) return { tone: "act", label: review };
      return {
        tone: "wait",
        label: input.secondEndsAt
          ? `Esperar. La segunda instancia corre hasta el ${formatDateAR(input.secondEndsAt)}.`
          : "Esperar al vencimiento de la segunda instancia.",
      };
    case "closing":
      return { tone: "act", label: "Continuá con el cierre del libro." };
    case "preparing":
      return { tone: "wait", label: "El proceso todavía no abrió la primera instancia." };
    case "closed":
      return { tone: "wait", label: "El proceso está cerrado." };
  }
}

export function ProcessVerdict({ status, counters, firstEndsAt, secondEndsAt, expired, bookNumber }: {
  status: ReregistrationStatus;
  counters: ProcessCountersView;
  firstEndsAt: Date;
  secondEndsAt: Date | null;
  expired: boolean;
  bookNumber: number;
}) {
  const { byStatus, cohortSize, daysLeft } = counters;
  // "Se presentaron" = los que hicieron algo que la Comisión ya puede mirar o ya
  // miró. `observed` cuenta como presentada: presentó, y le pedimos corregir.
  const presented = byStatus.submitted + byStatus.observed + byStatus.validated;
  const missing = cohortSize - presented;
  const next = nextStep({ status, counters, firstEndsAt, secondEndsAt, expired });
  const headline = `${PROCESS_STATUS_LABELS[status]}${daysLeft === null ? "" : ` — ${daysLeftLabel(daysLeft).toLocaleLowerCase("es-AR")}`}`;

  return (
    // `role="none"`: es el estado de la pantalla al abrirla, no la respuesta a
    // una acción. Un `alert` acá interrumpiría al lector de pantalla en cada
    // recarga (misma regla que el veredicto de /admin/salud).
    <FormMessage kind={next.tone === "act" ? "warning" : "neutral"} box as="div" role="none">
      <p className="font-semibold">{headline}</p>
      <p className="mt-1">
        Libro N° <span className={NUM}>{bookNumber}</span>.{" "}
        Se presentaron <span className={NUM}>{presented}</span> de{" "}
        <span className={NUM}>{cohortSize}</span> adherentes convocados
        {missing > 0 ? <> — faltan <span className={NUM}>{missing}</span>.</> : "."}
      </p>
      <p className="mt-2">
        <span className="text-xs font-semibold tracking-widest uppercase">Lo próximo</span>
        <br />
        {next.label}
      </p>
    </FormMessage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contadores por estado
// ─────────────────────────────────────────────────────────────────────────────

/** El orden en que se muestran: primero lo que espera al operador, después lo
 *  que espera al socio, y al final lo terminal. Un `Record` no tiene orden
 *  garantizado y el de la pantalla no es el del enum. */
const CHIP_ORDER: PresentationStatus[] = [
  "submitted", "observed", "validated", "pending", "rejected", "withdrawn",
];

/** Un contador en CERO nunca se pinta: "Rechazada 0" en rojo es una alarma que
 *  dice que no pasó nada, y el proyecto ya corrigió tres veces esa clase de
 *  ruido (4C §veredicto). El color queda para lo que efectivamente hay.
 *
 *  El mapa estado→variante NO vive acá: es el mismo que usa la cola de
 *  validación en sus tarjetas y por eso está en `@/lib/admin/status-badges`,
 *  con los otros nueve del panel. Lo que sí es propio del tablero es la regla
 *  del cero, que es una regla de producto y fue un defecto real cazado a mano.
 *
 *  Exportada para poder fijarla en el test. */
export function chipVariant(status: PresentationStatus, count: number): BadgeVariant {
  return count === 0 ? "outline" : presentationStatusBadgeVariant(status);
}

export function CounterChips({ byStatus }: { byStatus: Record<PresentationStatus, number> }) {
  return (
    // Cada chip ENLAZA a la vista de la cola que contiene ese estado (la URL la
    // resuelve `queueHrefForStatus`, no esta pantalla: un chip que lleva a una
    // vista donde su estado no se lista mostraría un listado vacío después de
    // hacer clic sobre un número distinto de cero). El target de 44px lo pone
    // el link, no la pastilla.
    <ul className="flex list-none flex-wrap gap-2 p-0">
      {CHIP_ORDER.map((status) => (
        <li key={status}>
          <Link
            href={queueHrefForStatus(status)}
            className="inline-flex min-h-11 items-center rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Badge variant={chipVariant(status, byStatus[status])} className="h-7 gap-1.5 px-2.5 text-sm">
              <span>{PRESENTATION_STATUS_LABELS[status]}</span>
              <span className={NUM}>{byStatus[status]}</span>
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quién quedó sin aviso por correo
// ─────────────────────────────────────────────────────────────────────────────

/** El veredicto de notificación de UN cohortado para la instancia en curso.
 *
 *  - `board`: no tiene casilla utilizable, así que su vía es el cartel de la
 *    sede. No es un problema: es el canal previsto (hoy 100 de 124).
 *  - `sent`: quedó acreditado el envío (Art. 5° quater).
 *  - `failed`: se intentó y el SMTP lo rechazó. El mailer ya dejó la fila con el
 *    código; es lo único reintentable.
 *  - `no_trace`: tiene casilla HOY y NO hay ninguna fila de esta instancia. Son
 *    tres situaciones distintas y desde acá no se distinguen: lo frenó
 *    `EMAIL_ALLOWLIST` (entorno de prueba: la guarda andando, no un fallo), lo
 *    difirió el tope de correos, o no tenía casilla cuando salió el lote y se
 *    la cargaron después —que es lo que este módulo busca que pase, y a ése le
 *    tocó el cartel—. El diferido es el que queda en tierra de nadie: NO cae a
 *    la cartelera —la cartelera se armó con los que no tenían casilla— así que
 *    si nadie mira esta lista, ese vecino no se entera de nada con el plazo
 *    corriendo. Por eso la fila se muestra igual y SIN afirmar una causa.
 *
 *  Es una función pura y exportada porque de acá cuelga una baja: el test la
 *  recorre caso por caso. */
export type NoticeVerdict = "board" | "sent" | "failed" | "no_trace";

export function classifyNotice(input: {
  email: string | null;
  emailStatus: EmailStatus;
  /** Las notificaciones del socio DE ESTA INSTANCIA (ya filtradas por tipo). */
  notices: Array<{ status: NotificationStatus }>;
}): NoticeVerdict {
  if (!emailUsable(input)) return "board";
  // `delivered` es un ascenso de `sent` (lo escribiría un webhook de Brevo);
  // enumerar los dos evita que un día el acuse de entrega se lea como ausencia.
  if (input.notices.some((n) => n.status === "sent" || n.status === "delivered")) return "sent";
  if (input.notices.some((n) => n.status === "failed")) return "failed";
  return "no_trace";
}

export type UnnotifiedRow = {
  memberId: number;
  /** Número del socio en el libro que se depura. `null` si no tiene membresía
   *  en ese libro (no debería pasar; se muestra "—" en vez de romper). */
  memberNumber: number | null;
  fullName: string;
  verdict: Exclude<NoticeVerdict, "board" | "sent">;
};

/** El motivo que se muestra al lado de cada nombre.
 *
 *  `no_trace` NO nombra una causa, porque la pantalla no la sabe: lo único que
 *  le consta es que no hay ninguna fila de envío. Puede haberlo frenado
 *  `EMAIL_ALLOWLIST`, puede haberlo diferido el tope de correos… o el socio
 *  puede no haber tenido casilla cuando salió el lote y habérsela cargado
 *  después —que es JUSTO lo que este módulo busca que pase—: a ése le tocó el
 *  cartel de la sede y nunca se le intentó un correo. Afirmar "no salió por el
 *  tope" lo mandaba al operador a buscar una avería que no existe. */
const VERDICT_TEXT: Record<UnnotifiedRow["verdict"], string> = {
  failed: "el envío falló",
  no_trace: "no salió: no hay ningún rastro de envío",
};

export function UnnotifiedPanel({ rows, instanceLabel }: {
  rows: UnnotifiedRow[];
  /** "la convocatoria" / "la segunda instancia": el aviso del que se habla. */
  instanceLabel: string;
}) {
  return (
    <Section
      id="sin-aviso"
      title="Convocados sin aviso por correo"
      hint={
        <>
          Hoy tienen casilla cargada y no hay constancia de que les haya llegado el aviso. Los que
          ya la tenían al convocar NO entran en el cartel de la sede —el cartel se armó con los que
          no tenían—, así que si nadie los atiende se quedan sin enterarse con el plazo corriendo.
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          size="list"
          description={`Todos los convocados con casilla recibieron el aviso de ${instanceLabel}.`}
        />
      ) : (
        // Los nombres con enlace a la ficha y el motivo al lado, no un contador:
        // decirle al operador "quedaron 12 sin aviso" sin decirle CUÁLES es
        // ordenarle una tarea sin darle los medios (mismo criterio que la
        // bandeja de altas con los fallos parciales de un lote).
        // `role="none"` como el veredicto de arriba: esta lista es el ESTADO de
        // la pantalla al abrirla, no la respuesta a una acción, y un `alert`
        // interrumpiría al lector de pantalla en cada recarga.
        <FormMessage kind="warning" box as="div" role="none">
          <p className="font-medium">
            <span className={NUM}>{rows.length}</span>{" "}
            {rows.length === 1 ? "convocado quedó" : "convocados quedaron"} sin el aviso de {instanceLabel}:
          </p>
          <ul className="mt-2 space-y-1">
            {rows.map((r) => (
              <li key={r.memberId}>
                <Link className={cn(INLINE_LINK, "font-medium")} href={`/admin/socios/${r.memberId}`}>
                  <span className={NUM}>N° {r.memberNumber ?? "—"}</span> {r.fullName}
                </Link>
                {` — ${VERDICT_TEXT[r.verdict]}`}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cartelera
// ─────────────────────────────────────────────────────────────────────────────

export type BoardNoticeRow = {
  id: number;
  kind: BoardNoticeKind;
  postedAt: Date | null;
  dueAt: Date | null;
};

/** A cuánta gente alcanza el cartel de la sede, y DE DÓNDE sale ese número.
 *
 *  El lote de cartelera se arma UNA sola vez —al convocar y al abrir la 2ª
 *  instancia—, con los que en ESE momento no tenían casilla utilizable, y se
 *  imprime y se fija en la pared. Contarlo en vivo sobre el padrón da un número
 *  que BAJA solo: el objetivo del módulo es que los socios carguen su correo, y
 *  a cada uno al que se lo cargan durante el plazo desaparece de la cuenta
 *  aunque su nombre esté en la nómina fijada en la sede. Hoy 100 de 124 no
 *  tienen casilla, así que la deriva no es teórica.
 *
 *  El único registro durable del lote que existe hoy es el asiento de auditoría
 *  de la convocatoria / de la apertura (`detail.boardCount`, escrito con el
 *  conteo que devolvió el servicio). Si no está —`audit()` es best-effort— se
 *  cae al conteo en vivo, pero entonces la pantalla DICE que es el de hoy en
 *  vez de hacerlo pasar por el lote.
 *
 *  Pura y exportada: el asiento llega como `Json` de Prisma, que puede ser
 *  cualquier cosa, y de leerlo mal sale un número inventado en pantalla. */
export type BoardAudience = { count: number; fromBatch: boolean };

export function boardAudience(input: { auditDetail: unknown; liveCount: number }): BoardAudience {
  const detail = input.auditDetail;
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail)) {
    const value = (detail as Record<string, unknown>).boardCount;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      return { count: value, fromBatch: true };
    }
  }
  return { count: input.liveCount, fromBatch: false };
}

export function BoardNoticesPanel({ notices, audience }: {
  notices: BoardNoticeRow[];
  /** Los destinatarios del cartel: el lote que se generó si quedó asentado, o
   *  el conteo en vivo si no. Ver `boardAudience`. */
  audience: BoardAudience;
}) {
  const { count, fromBatch } = audience;
  return (
    <Section
      id="cartelera"
      title="Cartelera"
      hint={
        fromBatch ? (
          <>
            El cartel se generó para <span className={NUM}>{count}</span>{" "}
            {count === 1 ? "convocado sin casilla" : "convocados sin casilla"} utilizable: se los
            notifica por el cartel de la sede (20 días hábiles, REG-10). Es el tamaño del lote que
            se imprimió, y no baja si después se les carga el correo.
          </>
        ) : (
          <>
            A hoy, <span className={NUM}>{count}</span>{" "}
            {count === 1 ? "convocado no tiene" : "convocados no tienen"} casilla utilizable: se los
            notifica por el cartel de la sede (20 días hábiles, REG-10). El asiento del lote no
            está, así que este número es el del padrón de hoy y puede ser menor que la nómina que se
            fijó en la sede.
          </>
        )
      }
    >
      {/* TODO (M6 Task 13): el circuito completo —PDF imprimible, asiento de la
          fecha de fijación por lote y el pase a fehaciente al cumplirse los 20
          días hábiles— llega con la Task 13. Acá el aviso sólo se LISTA: sin esa
          pantalla no hay forma de fijarlo, y ofrecer un botón que no hace nada
          sería peor que no ofrecer ninguno. */}
      {notices.length === 0 ? (
        <EmptyState size="list" description="No hay ningún aviso de cartelera en este proceso." />
      ) : (
        <ul className="list-none space-y-2 p-0">
          {notices.map((n) => (
            <li key={n.id} className="rounded-md border p-3 text-sm">
              <span className="font-medium">{BOARD_NOTICE_KIND_LABELS[n.kind]}</span>
              {" — "}
              {n.postedAt === null ? (
                <span className="text-warning">sin fijar</span>
              ) : (
                <>
                  fijado el <span className={NUM}>{formatDateAR(n.postedAt)}</span>
                  {n.dueAt && <> · fehaciente el <span className={NUM}>{formatDateAR(n.dueAt)}</span></>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export { Section };
