"use client";
// Wizard público ASOCIATE (docs/05 §2). Cinco pasos. Acá vive SÓLO el marco —
// el stepper, el borrador, el foco y el descarte de las respuestas del server—;
// cada paso está en su propio archivo (`step-residence`, `step-category`,
// `step-personal`, `step-documents`, `step-payment`), las primitivas visuales en
// `wizard-ui`, el rechazo por elegibilidad en `blocked-panel` y las pantallas de
// una solicitud ya enviada en `application-status`.
//
// De los pasos 1-3 a los 4-5 cambia de qué se habla: antes de crear la solicitud
// todo vive en el borrador del navegador, y después TODO está en la base y se
// opera con el token de retome. Por eso a partir del paso 4 no se vuelve atrás:
// reenviar el paso 3 crearía un duplicado (que el server rechaza igual).
//
// Regla del estado de las actions: el de las que CAMBIAN la pantalla del wizard
// —la subida (habilita "Continuar") y el envío sin débito (lleva a la pantalla
// de recibida)— vive acá, como ya vivía el del paso 3, y se deriva en el render
// sin efectos. El de `startPaymentAction`, que se va del sitio, vive en el paso.
//
// Criterios de diseño de esta pantalla:
//
//   - Mobile-first de verdad: el vecino entra desde el celular, muchas veces es
//     su primer contacto con la asociación y puede tener 70 años. Una columna,
//     controles de 48 px, tipografía de 16 px (abajo de eso iOS hace zoom al
//     enfocar un input), y los selectores nativos del sistema operativo antes
//     que un combo propio cuando el nativo alcanza.
//   - Nada de colores nuevos: los tokens del M2. El celeste interactivo es
//     `--primary` (#0079BC, 4.71:1); el celeste de marca #2E9BDF no aparece acá
//     porque todo lo celeste de esta pantalla es accionable.
//   - El resumen de los pasos ya contestados (`AnsweredTrail`) es la pieza
//     distintiva: en un trámite, lo que más tranquiliza es ver qué se está por
//     registrar sobre uno. Es además el único camino de vuelta, así que no hay
//     "Volver" duplicado.
//
// El estado de los pasos 1-2 NO viaja como campos del formulario del paso 3
// hasta el submit: se guarda en `draft` y se emite como `<input type="hidden">`
// dentro del form, con los nombres EXACTOS del schema de `createApplicationAction`.
import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import type { ApplicationStatus, DocumentType, MemberCategory } from "@/generated/prisma/client";
import { requiredDocsComplete } from "@/lib/applications/documents-rules";
import { cn } from "@/lib/utils";
import { createApplicationAction, submitNoDebitAction, uploadDocumentAction } from "./actions";
import { ApplicationStatusScreen } from "./application-status";
import { BlockedPanel } from "./blocked-panel";
import { StepCategory } from "./step-category";
import { StepDocuments } from "./step-documents";
import { StepPayment } from "./step-payment";
import { StepPersonal } from "./step-personal";
import { StepResidence } from "./step-residence";
import {
  FOCUS_RING,
  type ApplicationSnapshot,
  type AsociateDraft,
  type CreateState,
  type FeeAmounts,
  type LegalTexts,
  type StreetOption,
  type SubmitState,
  type UploadState,
} from "./wizard-shared";

// La página de retome importa estos tipos desde acá: se re-exportan para no
// obligar a nadie a saber que viven en `wizard-shared`.
export type { ApplicationSnapshot, AsociateDraft, FeeAmounts, LegalTexts, StreetOption };

const TOTAL_STEPS = 5;
const STEP_TITLES: Record<number, string> = {
  1: "¿Dónde vivís?",
  2: "Elegí tu categoría",
  3: "Tus datos",
  4: "Documentación",
  5: "Pago y envío",
};

const CATEGORY_LABELS: Record<string, string> = {
  active: "Socio activo",
  adherent: "Socio adherente",
  collaborator: "Socio colaborador",
};

const EMPTY_DRAFT: AsociateDraft = {
  livesInBarrio: "",
  streetId: null,
  streetName: "",
  streetText: "",
  neighborhood: "",
  streetNumber: "",
  requestedCategory: "",
  wantsDebit: "",
  fullName: "",
  dni: "",
  birthDate: "",
  civilStatus: "",
  // La nacionalidad de casi todo el padrón es la misma y el campo es
  // obligatorio: se propone y se puede cambiar, no se asume en silencio.
  nationality: "Argentina",
  occupation: "",
  phone: "",
  email: "",
  emailConfirm: "",
  acceptTerms: false,
};

export function AsociateWizard(props: {
  streets: StreetOption[];
  legal: LegalTexts;
  fees: FeeAmounts | null;
  siteKey: string;
  /** Rehidratación desde /asociate/retomar/[token]: la solicitud ya existe y lo
   *  que decide la pantalla es su ESTADO, no el borrador. */
  initial?: {
    draft?: Partial<AsociateDraft>;
    resumeToken?: string;
    application?: ApplicationSnapshot;
  };
}) {
  const { streets, legal, fees, siteKey, initial } = props;

  // El retome cae directo en el paso que corresponde: con la documentación ya
  // completa, en el 5. La regla es la MISMA función pura que usa el server para
  // aceptar el envío, así que las dos puntas no se pueden desincronizar.
  const [navStep, setStep] = useState(() => {
    const app = initial?.application;
    if (app?.status !== "started") return 1;
    return requiredDocsComplete(
      app.uploadedTypes.map((type) => ({ type })),
      app.requestedCategory,
    ).ok
      ? 5
      : 4;
  });
  const [draft, setDraft] = useState<AsociateDraft>({ ...EMPTY_DRAFT, ...initial?.draft });
  const [localError, setLocalError] = useState<string | null>(null);

  const [createState, createAction, creating] = useActionState<CreateState, FormData>(
    createApplicationAction,
    {},
  );
  const [uploadState, uploadAction, uploading] = useActionState<UploadState, FormData>(
    uploadDocumentAction,
    {},
  );
  const [submitState, submitAction, submitting] = useActionState<SubmitState, FormData>(
    submitNoDebitAction,
    {},
  );

  // `useActionState` no se puede limpiar: su valor vive hasta la próxima
  // respuesta del server. Sin esto el rechazo era permanente en las dos puntas
  // —el `blocked` reemplazaba la pantalla para siempre, y el `error` seguía
  // pintado al volver al paso 2 y avanzar, describiendo algo que ya no pasa—.
  //
  // Se guarda la RESPUESTA descartada, no un booleano: cada respuesta de
  // `useActionState` es un objeto nuevo, así que la comparación por identidad
  // vuelve a mostrar el mensaje solo cuando el server contesta de nuevo, sin
  // ningún efecto que resetee la bandera.
  const [dismissed, setDismissed] = useState<CreateState | null>(null);
  const live = createState === dismissed ? null : createState;

  // Todo lo que depende de la respuesta de la action se DERIVA en el render, sin
  // efectos que llamen a setState (la regla del compilador de React lo prohíbe,
  // y con razón: eran dos renders en cascada por respuesta).
  //
  // `created` se lee del estado crudo y no de `live`: el descarte es para los
  // rechazos, y una solicitud creada no se descarta.
  const resumeToken = createState.created?.resumeToken ?? initial?.resumeToken ?? "";
  // Con la solicitud ya creada no se vuelve a los pasos 1-3: los datos están en
  // la base y reenviar el paso 3 crearía un duplicado (que el server rechaza).
  const step = resumeToken && navStep < 4 ? 4 : navStep;

  // La solicitud llega de uno de dos lados: la trajo el retome desde la base, o
  // la acaba de crear el paso 3 y entonces todo lo que sabemos de ella está en
  // el borrador que la creó.
  const application: ApplicationSnapshot | null =
    initial?.application ??
    (createState.created
      ? {
          status: "started",
          // No puede estar vacía acá: la creación validó ESTE borrador con zod.
          // El default existe sólo para que el tipo cierre.
          requestedCategory: (draft.requestedCategory || "adherent") as MemberCategory,
          // Sólo el adherente elige; activo y colaborador van siempre con débito
          // (misma regla que aplica `createApplicationAction`).
          wantsDebit: draft.requestedCategory === "adherent" ? draft.wantsDebit === "si" : true,
          preapprovalId: null,
          uploadedTypes: [],
          fullName: draft.fullName,
        }
      : null);

  // Documentos ya subidos. Se arranca de lo que trajo el retome y se le suma lo
  // que va aceptando el server, derivándolo en el render por identidad de la
  // respuesta (mismo idioma que `dismissed`, sin efectos): `useActionState`
  // devuelve un objeto nuevo por respuesta, así que un re-render cualquiera no
  // vuelve a contar el mismo archivo.
  const [uploaded, setUploaded] = useState<DocumentType[]>(
    initial?.application?.uploadedTypes ?? [],
  );
  const [appliedUpload, setAppliedUpload] = useState<UploadState | null>(null);
  if (uploadState !== appliedUpload && uploadState.uploaded) {
    setAppliedUpload(uploadState);
    const type = uploadState.uploaded.type as DocumentType;
    // El frente y el dorso se REEMPLAZAN (el store borra el anterior); los
    // anexos se acumulan hasta MAX_ANNEXES.
    setUploaded((prev) => (type !== "annex" && prev.includes(type) ? prev : [...prev, type]));
  }

  // La rama sin débito no cambia de página: cuando la action contesta, la
  // solicitud ya pasó a `pending_board` y la pantalla de estado toma el control.
  const status: ApplicationStatus | null = application
    ? submitState.done
      ? "pending_board"
      : application.status
    : null;

  function patch(values: Partial<AsociateDraft>) {
    setDraft((d) => ({ ...d, ...values }));
    setLocalError(null);
  }

  function goTo(next: number) {
    setLocalError(null);
    setDismissed(createState);
    setStep(next);
  }

  // Al cambiar de paso, React reusa el nodo del botón "Continuar": el foco se
  // queda ahí, o sea AL FINAL del paso nuevo, y quien navega con teclado sale
  // del formulario sin haber pasado por un solo campo. Se lleva al encabezado,
  // que además es lo que el lector de pantalla lee al recibirlo.
  //
  // El guardia compara contra el paso anterior y no contra un "es el primer
  // render": con StrictMode los efectos corren dos veces sobre la misma
  // instancia, así que la bandera quedaba consumida en la primera pasada y la
  // segunda le robaba el foco al vecino apenas cargaba la página.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedStep = useRef(step);
  useEffect(() => {
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  // Salir del bloqueo también mueve el foco, y necesita su propio disparo: el
  // panel lo tenía puesto en SU encabezado, que al descartar se desmonta, y
  // como el paso nunca cambió (siempre fue 3) el efecto de arriba corta en el
  // guardia y el foco se cae al body. Es el mismo agujero que arregla el
  // efecto de navegación, en el camino de vuelta.
  function dismissBlocked() {
    goTo(3);
    // Tras el re-render que desmonta el panel: el encabezado del paso 3 ya existe.
    queueMicrotask(() => headingRef.current?.focus());
  }

  // El bloqueo no es un paso del wizard: reemplaza la pantalla entera, stepper
  // incluido. Dejar la barra en 60 % sugeriría que hay algo que completar.
  if (live?.blocked) {
    return (
      <BlockedPanel
        blocked={live.blocked}
        dni={draft.dni}
        siteKey={siteKey}
        onDismiss={dismissBlocked}
      />
    );
  }

  // Solicitud ya enviada: no hay nada que completar, así que la pantalla de
  // estado reemplaza al wizard entero (stepper incluido, como el bloqueo).
  if (application && status && status !== "started") {
    return (
      <ApplicationStatusScreen
        status={status}
        resumeToken={resumeToken}
        preapprovalId={application.preapprovalId}
        fullName={application.fullName}
      />
    );
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

      {(step === 2 || step === 3) && <AnsweredTrail draft={draft} step={step} onEdit={goTo} />}

      <div className="mt-6">
        {step === 1 && (
          <StepResidence
            streets={streets}
            draft={draft}
            patch={patch}
            error={localError}
            onError={setLocalError}
            onNext={() => goTo(2)}
          />
        )}
        {step === 2 && (
          <StepCategory
            draft={draft}
            fees={fees}
            patch={patch}
            error={localError}
            onError={setLocalError}
            onBack={() => goTo(1)}
            onNext={() => goTo(3)}
          />
        )}
        {step === 3 && (
          <StepPersonal
            draft={draft}
            patch={patch}
            legal={legal}
            siteKey={siteKey}
            actionState={createState}
            formAction={createAction}
            pending={creating}
            error={live?.error}
            onBack={() => goTo(2)}
          />
        )}
        {step === 4 && application && (
          <StepDocuments
            resumeToken={resumeToken}
            category={application.requestedCategory}
            uploaded={uploaded}
            state={uploadState}
            formAction={uploadAction}
            pending={uploading}
            onNext={() => goTo(5)}
          />
        )}
        {step === 5 && application && (
          <StepPayment
            resumeToken={resumeToken}
            category={application.requestedCategory}
            wantsDebit={application.wantsDebit}
            fees={fees}
            submitState={submitState}
            submitAction={submitAction}
            submitting={submitting}
            onBack={() => goTo(4)}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Resumen de lo ya contestado                                         */
/* ------------------------------------------------------------------ */

function AnsweredTrail({
  draft,
  step,
  onEdit,
}: {
  draft: AsociateDraft;
  step: number;
  onEdit: (step: number) => void;
}) {
  const rows: Array<{ step: number; label: string; value: string }> = [];

  const address =
    draft.livesInBarrio === "si"
      ? `${draft.streetName} ${draft.streetNumber}, Barrio Ciudadela`
      : `${draft.streetText} ${draft.streetNumber}, ${draft.neighborhood}`;
  rows.push({ step: 1, label: "Vivís en", value: address });

  if (step > 2 && draft.requestedCategory) {
    const debit =
      draft.requestedCategory === "adherent"
        ? draft.wantsDebit === "si"
          ? " · con débito automático"
          : " · sin débito automático"
        : "";
    rows.push({
      step: 2,
      label: "Categoría",
      value: `${CATEGORY_LABELS[draft.requestedCategory]}${debit}`,
    });
  }

  return (
    <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
      {rows.map((row) => (
        <li key={row.step}>
          <button
            type="button"
            onClick={() => onEdit(row.step)}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted",
              FOCUS_RING,
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-xs tracking-[0.08em] text-muted-foreground uppercase">
                {row.label}
              </span>
              <span className="mt-0.5 block truncate text-sm font-medium">{row.value}</span>
            </span>
            <span className="shrink-0 text-sm font-semibold text-primary underline underline-offset-2">
              Cambiar
              <span className="sr-only"> {row.label.toLowerCase()}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
