"use client";
// Widget de Cloudflare Turnstile para los formularios públicos.
//
// Modo EXPLÍCITO. La primera versión usaba el implícito (el script escanea la
// página buscando `.cf-turnstile` cuando carga) y eso deja agujeros que en esta
// UI son caminos normales, no casos raros:
//
//   - El escaneo automático corre UNA vez, cuando carga `api.js`. `next/script`
//     deduplica por `src`, así que al remontar el componente el script ya está
//     y nadie vuelve a escanear: el `<div>` nuevo queda vacío, sin
//     `cf-turnstile-response`, y el envío falla SIEMPRE con "No pudimos
//     verificar que sos una persona".
//   - En el wizard eso pasaba yendo al paso 3, volviendo al 2 y avanzando otra
//     vez (el form se desmonta y se vuelve a montar), y en la pantalla de
//     bloqueo `in_progress`, donde `StepPersonal` se desmonta y el formulario
//     de reenvío monta un widget nuevo: el reenvío del enlace no funcionaba
//     nunca.
//
// Con render explícito el ciclo de vida del widget es el del componente:
// `render()` al montar, `remove()` al desmontar, `reset()` cuando el formulario
// avisa que gastó el token. El script se carga con `?render=explicit` para que
// no escanee nada por su cuenta.
//
// El widget inyecta un `<input type="hidden" name="cf-turnstile-response">`
// DENTRO del form que lo contiene: por eso el componente va adentro del
// `<form>` y no al lado (la server action lee exactamente ese nombre, ver
// `verifyTurnstile` en createApplicationAction / resendResumeLinkAction, y en
// loginAction / recoverAction).
//
// El token es de UN SOLO USO y dura ~5 minutos. Si la action rechaza el envío
// (error de validación, DNI bloqueado, cupo agotado), el token ya se gastó y el
// siguiente intento fallaría aunque el vecino no haya hecho nada mal. Para eso
// está `resetKey`: cada vez que cambia (por identidad, como cualquier
// dependencia de efecto) se pide un token nuevo. Lo natural es pasarle el
// estado de la action: `useActionState` devuelve un objeto nuevo por respuesta.
//
// CSP (next.config.ts): `https://challenges.cloudflare.com` tiene que estar en
// `script-src` y en `frame-src`. Un iframe bloqueado por CSP no rompe nada
// visible — deja un recuadro vacío en silencio.
import { useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";

type TurnstileRenderOptions = {
  sitekey: string;
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  language?: string;
};

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement | string, options: TurnstileRenderOptions) => string | undefined;
      reset: (widget?: HTMLElement | string) => void;
      remove: (widget: string) => void;
    };
  }
}

const SCRIPT_ID = "cf-turnstile-api";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Carga `api.js` una sola vez por documento y resuelve cuando `window.turnstile`
 *  quedó disponible. Se hace a mano y no con `next/script` porque acá hace falta
 *  SABER cuándo la API está lista en cada montaje: `next/script` deduplica por
 *  `src` y su `onLoad` no vuelve a dispararse en el segundo montaje, que es
 *  justo el caso que este componente tiene que sobrevivir. */
let loader: Promise<void> | null = null;
function loadTurnstileApi(): Promise<void> {
  if (typeof window === "undefined") return new Promise(() => {});
  if (window.turnstile) return Promise.resolve();
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      const script = existing ?? document.createElement("script");
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () => reject(new Error("turnstile api.js")));
      if (!existing) {
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    });
    // Un fallo de red no puede dejar la promesa rechazada cacheada para
    // siempre: el próximo montaje tiene que poder reintentar la carga.
    loader.catch(() => {
      loader = null;
    });
  }
  return loader;
}

/** Texto de la degradación explicable cuando el captcha no puede renderizarse.
 *  Es por formulario porque el remedio es distinto: al que se está asociando se
 *  lo manda a la sede; al socio que ya tiene cuenta, no. */
const DEFAULT_UNAVAILABLE =
  "El formulario no está disponible por un problema de configuración del sitio. " +
  "Escribinos o acercate a la sede para asociarte.";

export function TurnstileWidget({
  siteKey,
  resetKey,
  unavailable = DEFAULT_UNAVAILABLE,
}: {
  siteKey: string;
  resetKey?: unknown;
  /** Qué se le dice al visitante si no hay site key o si `api.js` no carga. */
  unavailable?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // `scriptFailed` es terminal (no hay captcha posible); `notice` es transitorio
  // y NO desmonta el widget: Turnstile reintenta solo, y tirar abajo el
  // formulario por un error de red pasajero sería peor que el error.
  const [scriptFailed, setScriptFailed] = useState(false);
  const [notice, setNotice] = useState<"none" | "error" | "expired">("none");

  // Montaje: renderiza el widget en ESTE contenedor y lo desmonta al salir. El
  // `siteKey` es la única dependencia; `resetKey` se maneja en el efecto de
  // abajo para no destruir y rehacer el widget en cada respuesta del server.
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadTurnstileApi()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current =
          window.turnstile.render(container.current, {
            sitekey: siteKey,
            // El sitio público es light-only (el ThemeProvider vive sólo en el
            // panel): con "auto" el widget seguiría al sistema operativo y
            // quedaría un recuadro oscuro en medio de un formulario claro.
            theme: "light",
            language: "es",
            callback: () => setNotice("none"),
            "error-callback": () => setNotice("error"),
            "expired-callback": () => setNotice("expired"),
          }) ?? null;
      })
      .catch(() => {
        if (!cancelled) setScriptFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  // El primer render ya trae un token fresco: sólo se resetea cuando el
  // formulario avisa que gastó el anterior.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  // Sin site key el widget no rinde nada y el envío falla SIEMPRE con el mensaje
  // genérico del captcha, que manda al vecino a recargar una página que no se
  // va a arreglar. Es un error de configuración y se nombra como tal. Mismo
  // criterio si `api.js` no carga.
  if (!siteKey || scriptFailed) {
    return (
      <FormMessage kind="error" box>
        {unavailable}
      </FormMessage>
    );
  }

  return (
    <div>
      <div ref={container} />
      {notice !== "none" && (
        <FormMessage kind="warning" className="mt-2 text-xs">
          {notice === "expired"
            ? "La verificación venció. Estamos pidiendo una nueva; esperá unos segundos."
            : "No pudimos completar la verificación. Estamos reintentando; si no aparece, recargá la página."}
        </FormMessage>
      )}
    </div>
  );
}
