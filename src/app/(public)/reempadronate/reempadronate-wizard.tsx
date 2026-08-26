"use client";
// Wizard público REEMPADRONATE (Art. 9° bis; diseño M6 §5). Cuatro pasos:
// identificación, datos, documentación y declaración jurada.
//
// ESTA TASK IMPLEMENTA EL PASO 1. Los pasos 2 a 4 los llena la Task 11 y por
// ahora muestran un cartel de "en construcción"; el avance ya está cableado
// para que encastren sin tocar el marco. La fase se mergea entera, así que ese
// cartel no llega a producción.
//
// Es el mismo marco que ASOCIATE —stepper, foco al encabezado al cambiar de
// paso, pantalla que REEMPLAZA al wizard cuando el trámite no puede seguir— y
// reusa sus primitivas visuales (`wizard-ui`) y sus clases de control en vez de
// copiarlas. Dos diferencias que sí son de fondo:
//
//   1. NO HAY NINGÚN PASO DE PAGO (decisión del operador, 25/08/2026). El
//      re-empadronamiento no ofrece pagar, ni adherir débito, ni cambiar
//      montos: el adherente sólo ratifica su condición de socio.
//   2. El paso 1 no crea nada. Busca una ficha que YA existe y, antes de dejar
//      entrar, pide confirmar un nombre ENMASCARADO. El DNI no es una
//      contraseña: cualquiera puede tipear el de otro, así que la pantalla no
//      puede mostrar ni precargar datos de un tercero. Lo único que sale del
//      padrón acá es "M****** P.", que alcanza para que el propio vecino se
//      reconozca y no le dice nada a un desconocido.
//
// Y por el mismo motivo hay UNA sola pantalla negativa: el DNI que no existe,
// el que no es adherente, el que no fue convocado, el dado de baja y el
// rechazado ven exactamente el mismo cartel. Quien lo garantiza es
// `lookupVerdict` en el server; acá lo que importa es no agregarle matices.
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { Field, NavButtons } from "../asociate/wizard-ui";
import { lookupAction } from "./actions";
import {
  CONTROL_HEIGHT,
  FOCUS_RING,
  LINK_TARGET,
  STEP_TITLES,
  TOTAL_STEPS,
  type ContactInfo,
  type LookupState,
} from "./wizard-shared";

const IDLE: LookupState = { kind: "idle" };

export function ReempadronateWizard({
  siteKey,
  contact,
}: {
  siteKey: string;
  contact: ContactInfo;
}) {
  const [state, formAction, pending] = useActionState<LookupState, FormData>(lookupAction, IDLE);
  const [dni, setDni] = useState("");
  const [step, setStep] = useState(1);

  // `useActionState` no se puede limpiar: su valor vive hasta la próxima
  // respuesta del server. Sin esto, el cartel de "no figura" sería permanente y
  // el vecino que tipeó mal el DNI no tendría cómo volver a intentar. Se guarda
  // la RESPUESTA descartada y no un booleano: cada respuesta es un objeto
  // nuevo, así que la comparación por identidad vuelve a mostrar la pantalla
  // sólo cuando el server contesta de nuevo, sin ningún efecto que resetee la
  // bandera. (Mismo mecanismo que el `dismissed` de ASOCIATE.)
  const [dismissed, setDismissed] = useState<LookupState | null>(null);
  const live = state === dismissed ? null : state;

  const headingRef = useRef<HTMLHeadingElement>(null);
  // El guardia compara contra el paso anterior y no contra un "es el primer
  // render": con StrictMode los efectos corren dos veces sobre la misma
  // instancia, así que una bandera quedaría consumida en la primera pasada y la
  // segunda le robaría el foco al vecino apenas carga la página.
  const focusedStep = useRef(step);
  useEffect(() => {
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  /** Volver al formulario del DNI descartando lo que contestó el server. */
  function retry() {
    setDismissed(state);
    setStep(1);
    // Tras el re-render que desmonta el panel: el encabezado ya existe otra vez.
    // Sin esto el foco se cae al `<body>` —el botón que se apretó ya no está— y
    // quien navega con teclado o lector de pantalla no se entera de nada.
    queueMicrotask(() => headingRef.current?.focus());
  }

  // Las dos pantallas terminales REEMPLAZAN al wizard, stepper incluido: dejar
  // la barra de progreso a un cuarto sugeriría que hay algo que completar.
  if (live?.kind === "not_found") {
    return <NotFoundPanel contact={contact} onRetry={retry} />;
  }
  if (live?.kind === "already_submitted") {
    return <AlreadySubmittedPanel canResend={live.canResend} onRetry={retry} />;
  }

  return (
    <div>
      <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        Paso {step} de {TOTAL_STEPS}
      </p>
      {/* Decorativo: el mismo dato ya está en el texto de arriba. */}
      <div aria-hidden className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
        />
      </div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-5 text-2xl font-bold tracking-tight outline-hidden sm:text-3xl"
      >
        {STEP_TITLES[step]}
      </h1>
      {/* Sin esto, para un lector de pantalla el avance de paso es un cambio
          silencioso de contenido en la misma URL. */}
      <p role="status" className="sr-only">
        Paso {step} de {TOTAL_STEPS}: {STEP_TITLES[step]}
      </p>

      <div className="mt-6">
        {step === 1 &&
          (live?.kind === "eligible" ? (
            <ConfirmIdentity
              maskedName={live.maskedName}
              onConfirm={() => setStep(2)}
              onReject={retry}
            />
          ) : (
            <DniForm
              dni={dni}
              onDni={setDni}
              siteKey={siteKey}
              actionState={state}
              formAction={formAction}
              pending={pending}
              error={live?.kind === "error" ? live.error : undefined}
            />
          ))}
        {step > 1 && <UnderConstruction onBack={() => setStep(1)} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 1a: el DNI                                                     */
/* ------------------------------------------------------------------ */

function DniForm({
  dni,
  onDni,
  siteKey,
  actionState,
  formAction,
  pending,
  error,
}: {
  dni: string;
  onDni: (value: string) => void;
  siteKey: string;
  /** Se le pasa entero a Turnstile: cada respuesta del server es un objeto
   *  nuevo, y cada respuesta significa que el token anterior ya se gastó. */
  actionState: LookupState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <form action={formAction} className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Escribí tu número de documento para buscar tu ficha en el padrón. Es el primer paso del
        re-empadronamiento que dispuso la Comisión Directiva.
      </p>

      <Field id="dni" label="DNI" hint="Sin puntos ni espacios.">
        <Input
          id="dni"
          name="dni"
          className={CONTROL_HEIGHT}
          inputMode="numeric"
          // Sin autocompletado: es el documento de quien se re-empadrona, no un
          // dato del navegador, y el celular no tiene por qué proponer otro.
          autoComplete="off"
          maxLength={9}
          required
          // Sin `autoFocus`: en el celular abriría el teclado apenas carga la
          // página, tapando el texto que explica de qué se trata, y en el
          // camino de vuelta desde el cartel genérico le robaría el foco al
          // encabezado que `retry()` acaba de enfocar a propósito.
          aria-describedby="dni-hint"
          value={dni}
          onChange={(e) => onDni(e.target.value.replace(/\D/g, ""))}
        />
      </Field>

      <TurnstileWidget
        siteKey={siteKey}
        resetKey={actionState}
        unavailable="El formulario no está disponible por un problema de configuración del sitio. Acercate a la sede vecinal para re-empadronarte."
      />

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}

      <NavButtons submit nextLabel="Buscar mi ficha" pending={pending} pendingLabel="Buscando…" />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 1b: confirmar el nombre enmascarado                            */
/* ------------------------------------------------------------------ */

function ConfirmIdentity({
  maskedName,
  onConfirm,
  onReject,
}: {
  maskedName: string;
  onConfirm: () => void;
  onReject: () => void;
}) {
  // El encabezado del paso no cambia (seguimos en "Identificate"), así que el
  // efecto de foco del wizard no dispara: esta pregunta se lleva el foco por su
  // cuenta. Si no, el foco queda en "Buscar mi ficha", que ya no existe.
  const headingRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="rounded-xl border-2 border-primary bg-primary/5 p-5">
      {/* El nombre viene ENMASCARADO del server: la pantalla nunca ve el
          completo. Alcanza para que el vecino se reconozca; a quien tipeó un
          DNI ajeno no le dice quién es. */}
      <p
        ref={headingRef}
        tabIndex={-1}
        className={cn("text-xl font-bold tracking-tight outline-hidden", FOCUS_RING)}
      >
        ¿Sos <span className="text-primary">{maskedName}</span>?
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Mostramos el nombre incompleto a propósito, para no publicar los datos de otra persona. Si
        sos vos, seguí; si no, probá con otro documento.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:justify-end">
        <Button
          type="button"
          onClick={onConfirm}
          className={cn(CONTROL_HEIGHT, "font-semibold sm:px-8")}
        >
          Sí, soy yo
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onReject}
          className={cn(CONTROL_HEIGHT, "font-semibold sm:px-6")}
        >
          No, no soy yo
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pantallas terminales                                                */
/* ------------------------------------------------------------------ */

/** El cartel genérico. Es EL MISMO para todos los caminos negativos: no dice
 *  cuál fue el motivo porque decirlo convertiría la pantalla en un oráculo para
 *  averiguar quién es socio de la vecinal, quién dejó de serlo y quién quedó
 *  fuera de la convocatoria. */
function NotFoundPanel({ contact, onRetry }: { contact: ContactInfo; onRetry: () => void }) {
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
        <span className="block">Tu DNI no figura en el padrón de este re-empadronamiento.</span>
        <span className="mt-2 block">
          Acercate a la Vecinal con tu documento y lo revisamos con vos.
        </span>
      </FormMessage>

      <div className="mt-6 rounded-xl border border-border p-4">
        <p className="text-sm font-semibold">La sede</p>
        <address className="mt-1 space-y-1 text-sm not-italic">
          <span className="block">{SITE.address}</span>
          <span className="block text-muted-foreground">{SITE.city}</span>
        </address>
        {/* Teléfono y email viven en `configuration` y hoy pueden estar vacíos:
            el bloque explica el hueco en vez de dejarlo, igual que /ubicacion.
            Los horarios de atención NO están en ningún lado del sistema, así
            que no se inventan acá. */}
        {contact.phone || contact.email ? (
          <ul className="mt-3 space-y-1 text-sm">
            {contact.phone && (
              <li>
                Teléfono:{" "}
                <a
                  className="text-primary underline underline-offset-2"
                  href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                >
                  {contact.phone}
                </a>
              </li>
            )}
            {contact.email && (
              <li className="[overflow-wrap:anywhere]">
                Email:{" "}
                <a
                  className="text-primary underline underline-offset-2"
                  href={`mailto:${contact.email}`}
                >
                  {contact.email}
                </a>
              </li>
            )}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Todavía no hay un teléfono ni un email de contacto publicados. Podés acercarte a la
            sede, en la dirección de acá arriba.
          </p>
        )}
        <p className="mt-3 text-sm">
          <Link href="/ubicacion" className="text-primary underline underline-offset-2">
            Cómo llegar
          </Link>
        </p>
      </div>

      <RetryBlock onRetry={onRetry} />
    </div>
  );
}

/** Ya hay una presentación de este proceso para ese DNI. No es un rechazo: no
 *  hay nada que volver a cargar. NO se muestra ningún dato de la presentación
 *  —el DNI no autentica—: para verla o corregirla está el enlace que viajó al
 *  email cuando se recibió. */
function AlreadySubmittedPanel({
  canResend,
  onRetry,
}: {
  canResend: boolean;
  onRetry: () => void;
}) {
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
        Tu presentación ya está
      </h1>
      <FormMessage kind="success" box className="mt-5">
        <span className="block">
          Ya recibimos una presentación de este re-empadronamiento con ese documento. No hace falta
          que la vuelvas a cargar.
        </span>
        <span className="mt-2 block">
          {canResend
            ? "Al recibirla te enviamos por email el enlace para verla. Revisá también la carpeta de correo no deseado."
            : "Si necesitás ver o corregir algo, acercate a la sede vecinal con tu documento."}
        </span>
      </FormMessage>

      <RetryBlock onRetry={onRetry} />
    </div>
  );
}

/** El camino de vuelta que comparten las dos pantallas terminales. Sin él, un
 *  DNI mal tipeado es un callejón sin salida: es la misma lección que dejó el
 *  `BlockedPanel` de ASOCIATE. El cupo se cobra igual en cada intento, así que
 *  ofrecer volver no afloja nada. */
function RetryBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <>
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
          Si te equivocaste al escribir el DNI, corregilo y buscá de nuevo.
        </p>
      </div>
      <p className="mt-8">
        <Link href="/" className={LINK_TARGET}>
          Volver al inicio
        </Link>
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Andamiaje de los pasos 2 a 4 (Task 11)                              */
/* ------------------------------------------------------------------ */

/** Marcador de los pasos que todavía no existen. Está para que el avance del
 *  paso 1 quede cableado contra algo real y la Task 11 sólo tenga que
 *  reemplazar este bloque. La fase se mergea entera: esto no llega a un vecino. */
function UnderConstruction({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <FormMessage kind="neutral" box>
        Esta parte del formulario todavía se está terminando. Volvé en unos días o acercate a la
        sede vecinal.
      </FormMessage>
      <div className="mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-6")}
        >
          Volver
        </Button>
      </div>
    </div>
  );
}
