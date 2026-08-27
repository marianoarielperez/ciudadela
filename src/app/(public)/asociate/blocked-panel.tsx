"use client";
// Pantalla de bloqueo del wizard ASOCIATE: `checkEligibility` rechazó el DNI
// (ya es socio, tiene deuda, tiene una solicitud viva, está en el plazo de
// espera tras un rechazo). Reemplaza la pantalla entera, stepper incluido —
// dejar la barra en 60 % sugeriría que hay algo que completar.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { formatDateAR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ResendResumeForm } from "./resend-resume-form";
import { CONTROL_HEIGHT, LINK_TARGET, type CreateState } from "./wizard-shared";

export function BlockedPanel({
  blocked,
  dni,
  siteKey,
  onDismiss,
}: {
  blocked: NonNullable<CreateState["blocked"]>;
  dni: string;
  siteKey: string;
  /** Vuelve al paso 3 con el borrador intacto. Sin esto el bloqueo es un
   *  callejón sin salida: un DNI mal tipeado que caiga sobre una ficha con
   *  deuda manda al vecino a "acercate a la sede" y le pierde los 16 campos. */
  onDismiss: () => void;
}) {
  // El encabezado del wizard se saltea al reemplazarse la pantalla: sin esto el
  // foco se queda en el botón de envío, que ya no existe, y cae al `<body>` —
  // quien navega con teclado o lector de pantalla no se entera de que hubo una
  // respuesta.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold tracking-tight outline-hidden sm:text-3xl"
      >
        No pudimos seguir
      </h1>
      <FormMessage kind="warning" box className="mt-5">
        <span className="block">{blocked.message}</span>
        {blocked.retryAtIso && (
          <span className="mt-2 block">
            Vas a poder volver a solicitarlo a partir del{" "}
            <strong>{formatDateAR(new Date(blocked.retryAtIso))}</strong>.
          </span>
        )}
      </FormMessage>

      {blocked.code === "in_progress" && <ResendResumeForm dni={dni} siteKey={siteKey} />}

      {/* Convive con el formulario de reenvío en vez de reemplazarlo: el vecino
          que SÍ tiene una solicitud en trámite quiere el enlace, y el que llegó
          acá por un DNI mal tipeado quiere volver a corregirlo. */}
      <div className="mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={onDismiss}
          className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-6")}
        >
          Volver al formulario
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Tus datos siguen cargados. Si te equivocaste con el DNI, corregilo y probá de nuevo.
        </p>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Si creés que hay un error, acercate a la sede vecinal o escribinos desde la{" "}
        <Link href="/ubicacion" className={LINK_TARGET}>
          página de contacto
        </Link>
        .
      </p>
      <p className="mt-2">
        <Link href="/" className={LINK_TARGET}>
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}
