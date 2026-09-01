"use client";
// Pantallas de estado de una solicitud ya enviada. Reemplazan la pantalla entera
// —stepper incluido, mismo criterio que `BlockedPanel`—: cuando ya no hay nada
// que completar, dejar la barra de progreso a la vista sugiere lo contrario.
//
// Las usan las dos puntas del circuito: el wizard apenas la rama sin débito
// contesta, y `/asociate/retomar/[token]` cada vez que el vecino vuelve —desde
// el email, desde el recordatorio del cron, o de vuelta del checkout de MP—.
//
// `pending_payment` es la única con vida propia: la autorización del débito la
// confirma un webhook de MP, así que la pantalla sondea el estado en vez de
// pedirle al vecino que recargue. El sondeo tiene techo (dos minutos) y después
// ofrece el botón, porque una rueda girando para siempre es peor que decir "esto
// puede tardar".
import Link from "next/link";
import { CreditCard, Landmark, Stamp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ApplicationStatus } from "@/generated/prisma/client";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { checkoutUrlFor } from "@/lib/mp/checkout";
import { cn } from "@/lib/utils";
import { applicationStatusAction } from "./actions";
import { TramiteTimeline } from "./tramite-timeline";
import { CONTROL_HEIGHT, LINK_TARGET } from "./wizard-shared";

const POLL_MS = 5_000;
const MAX_POLLS = 24; // dos minutos

export function ApplicationStatusScreen({
  status: initialStatus,
  resumeToken,
  preapprovalId,
  fullName,
}: {
  status: ApplicationStatus;
  resumeToken: string;
  preapprovalId: string | null;
  fullName: string;
}) {
  const [status, setStatus] = useState<ApplicationStatus>(initialStatus);

  // Mismo agujero que arregla `BlockedPanel`: al reemplazarse la pantalla, el
  // foco se queda en un botón que ya no existe y cae al `<body>`. Quien navega
  // con teclado o lector de pantalla no se entera de que hubo una respuesta.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const view = VIEWS[status] ?? VIEWS.rejected;

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold tracking-tight outline-hidden sm:text-3xl"
      >
        {typeof view.title === "function" ? view.title(fullName) : view.title}
      </h1>

      <div className="mt-5 space-y-4">
        {status === "pending_payment" ? (
          <PendingPayment
            resumeToken={resumeToken}
            preapprovalId={preapprovalId}
            onStatus={setStatus}
          />
        ) : typeof view.body === "function" ? (
          view.body(fullName)
        ) : (
          view.body
        )}
      </div>

      <p className="mt-8">
        <Link href="/" className={LINK_TARGET}>
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Textos por estado                                                   */
/* ------------------------------------------------------------------ */

const VIEWS: Record<
  string,
  {
    title: string | ((name: string) => string);
    body?: React.ReactNode | ((name: string) => React.ReactNode);
  }
> = {
  pending_payment: { title: "Estamos confirmando tu pago" },

  approved_pending_minute: {
    title: "Tu solicitud quedó completa",
    body: (name: string) => (
      <>
        {/* Anuncia: la pantalla de espera del pago cambia a esta vista en el lugar (onStatus) y no se mueve el foco. */}
        <FormMessage kind="info" box role="status">
          Recibimos tu pago{firstName(name) ? `, ${firstName(name)}` : ""}.{" "}
          <strong>Ya cumpliste todos los requisitos del estatuto</strong> para pedir el ingreso a
          la vecinal.
        </FormMessage>
        <TramiteTimeline
          items={[
            {
              state: "done",
              title: "Solicitud completa y pago acreditado",
              children: "Te enviamos por correo el recibo de la cuota de ingreso.",
            },
            {
              state: "now",
              icon: Landmark,
              title: "La Comisión Directiva resuelve",
              children: (
                <>
                  <strong className="text-foreground">Todavía no sos socio/a.</strong> La admisión
                  se resuelve en la próxima reunión (Art. 5 del estatuto) y te avisamos el
                  resultado por correo.
                </>
              ),
            },
            {
              state: "next",
              icon: Stamp,
              title: "Alta en acta",
              children:
                "Si te admiten, la fecha del acta es tu fecha de ingreso — y desde ahí corren los 90 días para votar en asambleas y elecciones.",
            },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Te mandamos un correo aparte para verificar tu dirección: confirmala así podés recibir el
          acceso al portal de socios si tu alta se asienta.
        </p>
      </>
    ),
  },

  pending_board: {
    title: "Recibimos tu solicitud",
    body: (
      <>
        <FormMessage kind="info" box>
          Tu solicitud quedó <strong>presentada</strong>.
        </FormMessage>
        <TramiteTimeline
          items={[
            { state: "done", title: "Solicitud presentada" },
            {
              state: "now",
              icon: Landmark,
              title: "La Comisión Directiva resuelve",
              children:
                "Todavía no sos socio/a: la va a resolver en su próxima reunión y te avisamos el resultado por email.",
            },
            {
              state: "next",
              icon: Stamp,
              title: "Alta en acta",
              children: "Si te admiten, la fecha del acta es tu fecha de ingreso.",
            },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Te mandamos aparte un correo para verificar tu dirección. Revisá también la carpeta de
          correo no deseado.
        </p>
      </>
    ),
  },

  expired: {
    title: "Tu solicitud venció",
    body: (
      <>
        <FormMessage kind="warning" box>
          Las solicitudes que quedan sin completar vencen a los 7 días de iniciadas.
        </FormMessage>
        <p className="text-sm text-muted-foreground">
          No perdiste nada: podés empezar una nueva cuando quieras y volver a cargar tus datos.
        </p>
        <p>
          <Link href="/asociate" className={LINK_TARGET}>
            Empezar una solicitud nueva
          </Link>
        </p>
      </>
    ),
  },

  // `rejected` y `completed` comparten pantalla y es también la de reserva para
  // cualquier estado que no reconozcamos: el resultado se comunica por email
  // (sin expresión de causa, Art. 5 inc. 7), no por esta página.
  rejected: {
    title: "Tu solicitud ya fue resuelta",
    body: (
      <>
        <p className="text-sm text-muted-foreground">
          Revisá tu email: ahí te contamos cómo siguió el trámite.
        </p>
        <p className="text-sm text-muted-foreground">
          Ante cualquier consulta, acercate a la sede vecinal.
        </p>
      </>
    ),
  },
};
VIEWS.completed = VIEWS.rejected;

/** Sólo el primer nombre para el acuse: "Recibimos tu pago, María Fernanda
 *  Gómez" suena a formulario, no a alguien hablándole al vecino. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/* ------------------------------------------------------------------ */
/* pending_payment: sondeo del webhook                                 */
/* ------------------------------------------------------------------ */

type Stall = "timeout" | "rate_limited" | "not_found";

function PendingPayment({
  resumeToken,
  preapprovalId,
  onStatus,
}: {
  resumeToken: string;
  preapprovalId: string | null;
  onStatus: (status: ApplicationStatus) => void;
}) {
  const [stalled, setStalled] = useState<Stall | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (stalled) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      if (cancelled) return;
      // La pestaña en segundo plano no gasta intentos: mientras el vecino está
      // en el checkout de MP, sondear es tirar el presupuesto por IP.
      if (document.visibilityState === "hidden") {
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      attempts += 1;
      const res = await applicationStatusAction(resumeToken);
      if (cancelled) return;
      if ("error" in res) {
        setStalled(res.error === "rate_limited" ? "rate_limited" : "not_found");
        return;
      }
      if (res.status !== "pending_payment") {
        onStatus(res.status as ApplicationStatus);
        return;
      }
      if (attempts >= MAX_POLLS) {
        setStalled("timeout");
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    }

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resumeToken, stalled, onStatus]);

  async function checkNow() {
    setChecking(true);
    const res = await applicationStatusAction(resumeToken);
    setChecking(false);
    if ("error" in res) {
      setStalled(res.error === "rate_limited" ? "rate_limited" : "not_found");
      return;
    }
    if (res.status !== "pending_payment") return onStatus(res.status as ApplicationStatus);
    setStalled("timeout");
  }

  return (
    <>
      {/* `status` y no `alert`: el resultado llega solo y no hay nada que
          interrumpir. El texto cambia cuando el sondeo se rinde, y el lector de
          pantalla se entera sin que nadie toque nada. */}
      <FormMessage kind="neutral" box role="status">
        {stalled === null ? (
          <span className="flex items-center gap-3">
            <span
              aria-hidden
              className="size-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary motion-reduce:animate-none"
            />
            Mercado Pago nos tiene que confirmar la autorización del débito. Suele tardar menos de
            un minuto.
          </span>
        ) : stalled === "rate_limited" ? (
          "Consultamos demasiadas veces desde esta conexión. Esperá un rato y volvé a abrir el enlace de tu email."
        ) : stalled === "not_found" ? (
          "Este enlace dejó de ser válido: si pediste que te lo reenviáramos, usá el del último correo."
        ) : (
          "Todavía no nos llegó la confirmación. A veces tarda más; también te vamos a avisar por email cuando entre."
        )}
      </FormMessage>

      <TramiteTimeline
        items={[
          { state: "now", icon: CreditCard, title: "Estamos confirmando tu pago" },
          { state: "next", icon: Landmark, title: "La Comisión Directiva resuelve" },
          { state: "next", icon: Stamp, title: "Alta en acta" },
        ]}
      />

      {stalled === "timeout" && (
        <Button
          type="button"
          onClick={checkNow}
          disabled={checking}
          className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-6")}
        >
          {checking ? "Consultando…" : "Volver a consultar"}
        </Button>
      )}

      <p className="text-sm text-muted-foreground">
        Podés cerrar esta página: la solicitud queda guardada y te escribimos cuando el pago se
        confirme.
      </p>

      {preapprovalId && (
        // Camino del que abandonó el checkout (o lo cerró sin querer). No es un
        // pago nuevo: es la MISMA suscripción, la que ya está creada en MP.
        <p>
          <a
            href={checkoutUrlFor(preapprovalId)}
            rel="noopener"
            className={LINK_TARGET}
          >
            Volver al pago en Mercado Pago
          </a>
        </p>
      )}
    </>
  );
}
