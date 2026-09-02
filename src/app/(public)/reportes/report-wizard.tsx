"use client";
// El marco del wizard de Reportes (spec §5.1-§5.2). Acá vive SÓLO el stepper,
// el borrador del navegador, el foco y el descarte de respuestas: cada paso
// está en su archivo.
//
// Copia la frontera de estado de ASOCIATE: el paso 1 CREA el borrador en la
// base y estampa la llave en la URL con `history.replaceState`; desde ahí todo
// se opera con la llave y NINGUNA action revalida. Esa invariante no es
// decorativa: si alguna action de este wizard llamara `revalidatePath`, Next
// adjuntaría payload de flight a la respuesta y el árbol de router del cliente
// —que sigue siendo el de `/reportes/nuevo`— podría remontar el wizard vivo en
// medio del trámite. Ver el comentario largo de `asociate-wizard.tsx`.
//
// `mode="member"`: sin Turnstile, sin paso 2 (la identidad vino de la ficha) y
// la URL de retome es la de /mi. `startAction` la inyecta la página: la pública
// exige captcha, la del socio exige sesión.
import { FileText, Landmark, MapPinned, Send, UserRound, type LucideIcon } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ReportKindSlug } from "@/lib/reports/catalog";
import { ProcessRail, type ProcessPhase } from "../asociate/process-rail";
import { saveReporterAction, submitReportAction } from "./actions";
import { ReportDone } from "./report-done";
import { StepIdentity } from "./step-identity";
import { StepReport } from "./step-report";
import { StepStart } from "./step-start";
import {
  EMPTY_REPORT_DRAFT,
  type ReportDraft,
  type ReportMode,
  type ReporterState,
  type ReportSnapshot,
  type StartState,
  type StreetOption,
  type SubmitState,
  type UploadedFile,
} from "./wizard-shared";

// Las dos etapas que siguen al formulario, siempre a la vista: el vecino tiene
// que ver que enviar NO es que ya esté resuelto (mismo criterio que ASOCIATE).
// Se leen distinto según el tipo, como en `ReportDone` (spec §2, `filedVerb`).
const PHASES: Record<ReportKindSlug, ProcessPhase[]> = {
  claim: [
    {
      icon: Landmark,
      label: (
        <>
          La Comisión
          <br />
          lo canaliza
        </>
      ),
      srText: "lo revisa la Comisión Directiva",
    },
    {
      icon: Send,
      label: (
        <>
          Presentado
          <br />
          al organismo
        </>
      ),
      srText: "y lo presenta ante el organismo",
    },
  ],
  initiative: [
    {
      icon: Landmark,
      label: (
        <>
          La Comisión
          <br />
          lo evalúa
        </>
      ),
      srText: "lo evalúa la Comisión Directiva",
    },
    {
      icon: Send,
      label: (
        <>
          Tratado por
          <br />
          la Comisión
        </>
      ),
      srText: "y lo trata en su reunión",
    },
  ],
};

// Decorativos: el título es el dato (el gesto size-9 bg-primary/10 del panel).
const ICONS: Record<"start" | "identity" | "report", LucideIcon> = {
  start: FileText,
  identity: UserRound,
  report: MapPinned,
};
const TITLES = { start: "Empezar", identity: "Tus datos", report: "Tu reporte" } as const;
type StepKey = keyof typeof TITLES;

export function ReportWizard({
  mode,
  streets,
  consentText,
  siteKey,
  initialKind,
  initial,
  startAction,
}: {
  mode: ReportMode;
  streets: StreetOption[];
  consentText: string | null;
  siteKey: string;
  /** Con qué tipo llega desde la landing (`?tipo=`). Sólo propone: el paso 1
   *  sigue siendo una elección. */
  initialKind?: ReportKindSlug;
  /** Rehidratación desde `/reportes/nuevo/[claim]`: el borrador ya existe. */
  initial?: { claim: string; snapshot: ReportSnapshot };
  /** El paso 1 del vecino (`startReportAction`) o el del socio
   *  (`startMemberReportAction`): el marco es el mismo. */
  startAction: (prev: StartState, formData: FormData) => Promise<StartState>;
}) {
  const steps: StepKey[] = mode === "public" ? ["start", "identity", "report"] : ["start", "report"];
  const retomePath = mode === "public" ? "/reportes/nuevo" : "/mi/solicitudes/reportes/nuevo";

  // Todo lo que el retome sabe se siembra ACÁ, en el inicializador: el picker
  // de ubicación sólo honra su `value` al montar, así que un efecto posterior
  // llegaría tarde (ver `location-picker.tsx`).
  const [draft, setDraft] = useState<ReportDraft>(() => ({
    ...EMPTY_REPORT_DRAFT,
    kind: initial?.snapshot.kind ?? initialKind ?? "",
    anonymous: initial ? (initial.snapshot.anonymous ? "si" : "no") : "",
    name: initial?.snapshot.reporter?.name ?? "",
    dni: initial?.snapshot.reporter?.dni ?? "",
    phone: initial?.snapshot.reporter?.phone ?? "",
    email: initial?.snapshot.reporter?.email ?? "",
  }));
  // La lista de archivos vive acá y no en los pasos: el paso 2 se desmonta al
  // avanzar, y guardarla adentro haría que volver mostrara "Falta" sobre un DNI
  // que en la base ya está.
  const [files, setFiles] = useState<UploadedFile[]>(initial?.snapshot.files ?? []);
  const [reporterSaved, setReporterSaved] = useState(initial?.snapshot.reporterComplete ?? false);

  const [startState, startFormAction, starting] = useActionState<StartState, FormData>(startAction, {});
  const [reporterState, reporterAction, savingReporter] = useActionState<ReporterState, FormData>(
    saveReporterAction,
    {},
  );
  const [submitState, submitAction, submitting] = useActionState<SubmitState, FormData>(
    submitReportAction,
    {},
  );

  const claim = startState.started?.claim ?? initial?.claim ?? "";

  // El paso se DERIVA, sin efectos: sin llave, paso 1; con llave y (vecino sin
  // datos guardados), paso 2; si no, paso 3. La respuesta nueva del server se
  // reconoce por IDENTIDAD en el render (el patrón de ASOCIATE y REEMPADRONATE).
  const [seenReporter, setSeenReporter] = useState(reporterState);
  const [backTo, setBackTo] = useState<StepKey | null>(null);
  if (reporterState !== seenReporter) {
    setSeenReporter(reporterState);
    if (reporterState.saved) {
      setReporterSaved(true);
      // Guardar de nuevo desde el "Volver" del paso 3 devuelve al paso 3: sin
      // esto, `backTo` dejaría al vecino clavado en sus datos.
      setBackTo(null);
    }
  }
  const step: StepKey =
    claim === ""
      ? "start"
      : mode === "public" && (!reporterSaved || backTo === "identity")
        ? "identity"
        : "report";
  const stepIndex = steps.indexOf(step) + 1;

  // La llave a la URL apenas existe: sin esto, una recarga —F5, o en iOS
  // simplemente cambiar de app y volver— dejaría el borrador huérfano en la
  // base y al vecino sin cómo retomarlo. Ver el comentario largo de
  // `asociate-wizard.tsx`: `replaceState` nativo, no `router.replace`, para no
  // desmontar el wizard vivo ni perder el foco.
  const createdClaim = startState.started?.claim;
  useEffect(() => {
    if (!createdClaim) return;
    window.history.replaceState(null, "", `${retomePath}/${encodeURIComponent(createdClaim)}`);
  }, [createdClaim, retomePath]);

  // Al cambiar de paso React reusa el nodo del botón: el foco se queda al FINAL
  // del paso nuevo. Se lleva al encabezado, que además es lo que el lector de
  // pantalla lee al recibirlo. El guardia compara pasos (y no "primer render")
  // porque con StrictMode los efectos corren dos veces.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedStep = useRef(step);
  useEffect(() => {
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  function patch(values: Partial<ReportDraft>) {
    setDraft((d) => ({ ...d, ...values }));
  }
  // El frente y el dorso se REEMPLAZAN (el store borra el anterior, así que no
  // puede haber dos); las fotos se ACUMULAN hasta el tope, que cuenta el server.
  function addFile(file: UploadedFile) {
    setFiles((prev) =>
      file.kind === "photo" ? [...prev, file] : [...prev.filter((p) => p.kind !== file.kind), file],
    );
  }
  function removeFile(id: number) {
    setFiles((prev) => prev.filter((p) => p.id !== id));
  }

  const kind: ReportKindSlug = draft.kind === "" ? "claim" : draft.kind;

  // Enviado: no hay nada que completar, así que la pantalla terminal reemplaza
  // al wizard entero, stepper incluido (como el bloqueo de ASOCIATE).
  const doneNumber =
    submitState.done?.number ?? (initial && initial.snapshot.status !== "draft" ? initial.snapshot.number : null);
  if (doneNumber !== null) {
    return (
      <ReportDone
        number={doneNumber}
        kind={kind}
        mode={mode}
        filed={initial?.snapshot.status === "filed"}
      />
    );
  }

  const StepIcon = ICONS[step];
  return (
    <div>
      <ProcessRail step={stepIndex} total={steps.length} subject="Tu reporte" phases={PHASES[kind]} />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-5 flex items-center gap-2.5 text-2xl font-bold tracking-tight outline-hidden sm:text-3xl"
      >
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          <StepIcon className="size-5" />
        </span>
        {TITLES[step]}
      </h1>
      {/* Sin esto, para un lector de pantalla el avance de paso es un cambio
          silencioso de contenido en la misma URL. */}
      <p role="status" className="sr-only">
        Paso {stepIndex} de {steps.length}: {TITLES[step]}
      </p>

      <div className="mt-6">
        {step === "start" && (
          <StepStart
            mode={mode}
            draft={draft}
            patch={patch}
            siteKey={siteKey}
            actionState={startState}
            formAction={startFormAction}
            pending={starting}
            error={startState.error}
          />
        )}
        {step === "identity" && (
          <StepIdentity
            claim={claim}
            draft={draft}
            patch={patch}
            files={files}
            onUploaded={addFile}
            onRemoved={removeFile}
            formAction={reporterAction}
            pending={savingReporter}
            error={reporterState.error}
          />
        )}
        {step === "report" && (
          <StepReport
            claim={claim}
            kind={kind}
            draft={draft}
            patch={patch}
            streets={streets}
            consentText={consentText}
            files={files}
            onUploaded={addFile}
            onRemoved={removeFile}
            formAction={submitAction}
            pending={submitting}
            error={submitState.error}
            onBack={mode === "public" ? () => setBackTo("identity") : undefined}
          />
        )}
      </div>
    </div>
  );
}
