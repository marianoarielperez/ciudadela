"use client";
// Pantallas de resultado del paso 1 "Tu DNI" (spec 2026-08-27 §3.2). Como el
// BlockedPanel: el veredicto REEMPLAZA la pantalla entera, stepper incluido —
// un bloqueo no es un paso—, y nunca es un callejón sin salida: siempre hay
// "Probar con otro documento" y "Volver al inicio".
//
// Qué revela y qué no (decisiones del operador, 27/08/2026): el nombre viaja
// ENMASCARADO; la deuda dice la CANTIDAD de cuotas (sin pesos); expulsión,
// fallecimiento y anulación comparten un único literal de sede, indistinguibles.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { formatDateAR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ResendResumeForm } from "./resend-resume-form";
import { CONTROL_HEIGHT, LINK_TARGET, type DniCheckState } from "./wizard-shared";

type BlockedVerdict = Extract<DniCheckState, { kind: "blocked" }>;

const HEADINGS: Record<BlockedVerdict["code"], string> = {
  already_member: "Ya estás asociado/a",
  in_progress: "Ya tenés una solicitud en trámite",
  visit_office: "No pudimos seguir",
  debt: "No pudimos seguir",
  rejected_wait: "No pudimos seguir",
};

export function DniResultPanel({
  blocked,
  dni,
  siteKey,
  onRetry,
}: {
  blocked: BlockedVerdict;
  /** El DNI tal como se tipeó: precarga el reenvío del enlace (in_progress). */
  dni: string;
  siteKey: string;
  /** Vuelve al paso 1 con el campo limpio, descartando el veredicto. */
  onRetry: () => void;
}) {
  // El encabezado del wizard se saltea al reemplazarse la pantalla: sin esto el
  // foco cae al <body> y quien navega con teclado no se entera del veredicto.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const masked = blocked.maskedName;

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold tracking-tight outline-hidden sm:text-3xl"
      >
        {HEADINGS[blocked.code]}
      </h1>

      <FormMessage kind={blocked.code === "already_member" ? "neutral" : "warning"} box className="mt-5">
        {blocked.code === "already_member" && (
          <>
            <span className="block">
              {masked ? (
                <>
                  Encontramos una ficha a nombre de <strong>{masked}</strong>, que ya está asociada
                  a la vecinal.
                </>
              ) : (
                <>Ya estás asociado/a a la vecinal.</>
              )}
            </span>
            <span className="mt-2 block">
              Si sos vos, no hace falta que te asocies de nuevo: podés ver tu cuenta, tus pagos y
              tus datos desde el panel de socio.
            </span>
          </>
        )}
        {blocked.code === "in_progress" && (
          <span className="block">
            Ya hay una solicitud de asociación en trámite con ese DNI. Te podemos reenviar por
            email el enlace para retomarla.
          </span>
        )}
        {blocked.code === "debt" && (
          <>
            <span className="block">
              La ficha a nombre de <strong>{masked}</strong> registra{" "}
              <strong>
                {blocked.pendingCount === 1
                  ? "1 cuota pendiente"
                  : `${blocked.pendingCount} cuotas pendientes`}
              </strong>{" "}
              con tesorería.
            </span>
            <span className="mt-2 block">
              Para reingresar como socio/a, acercate a la sede vecinal a regularizarla. Después vas
              a poder completar tu solicitud.
            </span>
          </>
        )}
        {blocked.code === "visit_office" && (
          <>
            {masked && (
              <span className="block">
                Encontramos una ficha a nombre de <strong>{masked}</strong>.
              </span>
            )}
            <span className={masked ? "mt-2 block" : "block"}>
              No podemos procesar tu solicitud por este medio. Acercate a la sede vecinal.
            </span>
          </>
        )}
        {blocked.code === "rejected_wait" && (
          <>
            {masked && (
              <span className="block">
                Encontramos una ficha a nombre de <strong>{masked}</strong>.
              </span>
            )}
            <span className={masked ? "mt-2 block" : "block"}>
              No podés presentar una nueva solicitud por el momento.
            </span>
            {blocked.retryAtIso && (
              <span className="mt-2 block">
                Vas a poder volver a solicitarlo a partir del{" "}
                <strong>{formatDateAR(new Date(blocked.retryAtIso))}</strong>.
              </span>
            )}
          </>
        )}
      </FormMessage>

      {blocked.code === "already_member" && (
        <div className="mt-6">
          <Button asChild className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-8")}>
            <Link href="/ingresar">Ingresar al panel de socio</Link>
          </Button>
        </div>
      )}

      {blocked.code === "in_progress" && <ResendResumeForm dni={dni} siteKey={siteKey} />}

      <div className="mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-6")}
        >
          Probar con otro documento
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Si te equivocaste al escribir el DNI, corregilo y probá de nuevo.
        </p>
      </div>

      {(blocked.code === "debt" || blocked.code === "visit_office" || blocked.code === "rejected_wait") && (
        <p className="mt-8 text-sm text-muted-foreground">
          Si creés que hay un error, acercate a la sede vecinal o escribinos desde la{" "}
          <Link href="/ubicacion" className={LINK_TARGET}>
            página de contacto
          </Link>
          .
        </p>
      )}
      <p className="mt-2">
        <Link href="/" className={LINK_TARGET}>
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}
