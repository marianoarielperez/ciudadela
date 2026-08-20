"use client";
// Widget de Cloudflare Turnstile para los formularios públicos.
//
// Modo IMPLÍCITO: el script de Cloudflare busca todo `.cf-turnstile` de la
// página, lo renderiza e inyecta un `<input type="hidden"
// name="cf-turnstile-response">` DENTRO del form que lo contiene. Por eso el
// componente va adentro del `<form>` y no al lado: la server action lee
// exactamente ese nombre (`verifyTurnstile` en createApplicationAction /
// resendResumeLinkAction).
//
// El token es de UN SOLO USO y dura ~5 minutos. Si la action rechaza el envío
// (error de validación, DNI bloqueado, cupo agotado), el token ya se gastó y el
// siguiente intento fallaría con "No pudimos verificar que sos una persona"
// aunque el vecino no haya hecho nada mal. Para eso está `resetKey`: cada vez
// que cambia (por identidad, como cualquier dependencia de efecto) se pide un
// token nuevo. Lo natural es pasarle el estado de la action: `useActionState`
// devuelve un objeto nuevo por cada respuesta del server.
//
// OJO CSP (next.config.ts): `https://challenges.cloudflare.com` tiene que estar
// en `script-src` y en `frame-src`. Se habilita en la Task 21 del módulo; hasta
// entonces el widget queda en blanco y la consola muestra el bloqueo.
import Script from "next/script";
import { useEffect, useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";

declare global {
  interface Window {
    turnstile?: { reset: (widget?: HTMLElement | string) => void };
  }
}

export function TurnstileWidget({ siteKey, resetKey }: { siteKey: string; resetKey?: unknown }) {
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    // El primer render ya trae un token fresco: sólo reseteamos cuando el
    // formulario avisa que gastó el anterior. `reset` con el elemento (y no sin
    // argumentos) porque la pantalla de bloqueo puede tener dos widgets vivos.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (container.current) window.turnstile?.reset(container.current);
  }, [resetKey]);

  // Sin site key el widget no rinde nada y el envío falla SIEMPRE con el mensaje
  // genérico del captcha, que manda al vecino a recargar una página que no se
  // va a arreglar. Es un error de configuración y se nombra como tal.
  if (!siteKey) {
    return (
      <FormMessage kind="error" box>
        El formulario no está disponible por un problema de configuración del sitio.
        Escribinos o acercate a la sede para asociarte.
      </FormMessage>
    );
  }

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div
        ref={container}
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-theme="auto"
        data-language="es"
      />
    </>
  );
}
