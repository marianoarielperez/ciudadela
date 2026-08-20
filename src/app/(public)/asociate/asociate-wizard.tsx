"use client";
// Wizard público ASOCIATE (docs/05 §2). Cinco pasos; acá viven el marco, los
// pasos 1 a 3 y las pantallas de bloqueo. Los pasos 4 (documentación) y 5 (pago)
// llegan con la Task 13, igual que el retome desde /asociate/retomar/[token].
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
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatARS, formatDateAR } from "@/lib/format";
import { searchStreets } from "@/lib/streets/search";
import { cn } from "@/lib/utils";
import { createApplicationAction, resendResumeLinkAction } from "./actions";

export type StreetOption = { id: number; name: string; loadOrder: number };
export type LegalTexts = { terms: string | null; privacyConsent: string | null };
export type FeeAmounts = { active: number; shared: number };

export type AsociateDraft = {
  livesInBarrio: "" | "si" | "no";
  streetId: number | null;
  /** Sólo para mostrar: al server viaja `streetId`. */
  streetName: string;
  streetText: string;
  neighborhood: string;
  streetNumber: string;
  requestedCategory: "" | "active" | "adherent" | "collaborator";
  wantsDebit: "" | "si" | "no";
  fullName: string;
  dni: string;
  birthDate: string;
  civilStatus: string;
  nationality: string;
  occupation: string;
  phone: string;
  email: string;
  emailConfirm: string;
  acceptTerms: boolean;
};

// El tipo del estado de la action se redeclara acá porque un módulo "use server"
// sólo puede exportar funciones async. Es estructuralmente el mismo `CreateState`
// de ./actions.ts: si allá cambia, esto deja de compilar en el `useActionState`.
type CreateState = {
  error?: string;
  blocked?: {
    code: "in_progress" | "already_member" | "visit_office" | "debt" | "rejected_wait";
    message: string;
    retryAtIso?: string;
  };
  created?: { resumeToken: string };
};
type ResendState = { error?: string; done?: boolean };

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

const CIVIL_STATUSES = [
  "Soltero/a",
  "Casado/a",
  "Divorciado/a",
  "Viudo/a",
  "Unión convivencial",
];

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

/** El catálogo catastral guarda cinco calles como "Hernandez , Jose": el espacio
 *  antes de la coma es del CSV de origen y no se toca en la base (el padrón y el
 *  panel citan ese nombre tal cual). Acá se limpia sólo para mostrar — el orden
 *  apellido/nombre se respeta, que es como la vecinal las nombra. */
function streetLabel(name: string): string {
  return name.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
}

// Clases compartidas. Los controles del wizard son más altos que los del panel
// (48 px contra 32) porque acá se opera con el pulgar, no con el mouse.
const CONTROL_HEIGHT = "h-12 text-base md:text-base";
const FOCUS_RING = "outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50";

export function AsociateWizard(props: {
  streets: StreetOption[];
  legal: LegalTexts;
  fees: FeeAmounts | null;
  siteKey: string;
  /** La Task 13 rehidrata desde /asociate/retomar/[token]. */
  initial?: { draft?: Partial<AsociateDraft>; resumeToken?: string; step?: number };
}) {
  const { streets, legal, fees, siteKey, initial } = props;

  const [navStep, setStep] = useState(initial?.step ?? 1);
  const [draft, setDraft] = useState<AsociateDraft>({ ...EMPTY_DRAFT, ...initial?.draft });
  const [localError, setLocalError] = useState<string | null>(null);

  const [createState, createAction, creating] = useActionState<CreateState, FormData>(
    createApplicationAction,
    {},
  );

  // Todo lo que depende de la respuesta de la action se DERIVA en el render, sin
  // efectos que llamen a setState (la regla del compilador de React lo prohíbe,
  // y con razón: eran dos renders en cascada por respuesta).
  const resumeToken = createState.created?.resumeToken ?? initial?.resumeToken ?? "";
  // Con la solicitud ya creada no se vuelve a los pasos 1-3: los datos están en
  // la base y reenviar el paso 3 crearía un duplicado (que el server rechaza).
  const step = resumeToken && navStep < 4 ? 4 : navStep;

  function patch(values: Partial<AsociateDraft>) {
    setDraft((d) => ({ ...d, ...values }));
    setLocalError(null);
  }

  function goTo(next: number) {
    setLocalError(null);
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

  // El bloqueo no es un paso del wizard: reemplaza la pantalla entera, stepper
  // incluido. Dejar la barra en 60 % sugeriría que hay algo que completar.
  if (createState.blocked) {
    return <BlockedPanel blocked={createState.blocked} dni={draft.dni} siteKey={siteKey} />;
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
            error={createState.error}
            onBack={() => goTo(2)}
          />
        )}
        {step === 4 && (
          /* Provisorio: la Task 13 reemplaza este bloque por el paso 4
             (documentación) y el 5 (pago), que usan `resumeToken` para
             enganchar los archivos y la suscripción a la solicitud creada. */
          <section className="rounded-xl border border-border bg-muted/40 p-5">
            <p className="font-medium">Registramos tu solicitud.</p>
            {resumeToken && (
              <p className="mt-2 text-sm text-muted-foreground">
                Te mandamos un email a <strong className="font-medium">{draft.email}</strong> con
                el enlace para retomarla cuando quieras.
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Los pasos de documentación y pago se habilitan en los próximos días.
            </p>
          </section>
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

/* ------------------------------------------------------------------ */
/* Primitivas                                                          */
/* ------------------------------------------------------------------ */

function ChoiceCard({
  name,
  value,
  checked,
  onSelect,
  title,
  aside,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors",
        // El foco vive en el radio nativo, que está adentro: sin `has-` el
        // recorrido con Tab no marcaría la tarjeta, que es lo que se ve.
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-base font-semibold">{title}</span>
          {aside}
        </span>
        {children && <span className="mt-1.5 block text-sm text-muted-foreground">{children}</span>}
      </span>
    </label>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function NavButtons({
  onBack,
  backLabel = "Volver",
  nextLabel = "Continuar",
  onNext,
  nextDisabled,
  submit,
  pending,
}: {
  onBack?: () => void;
  backLabel?: string;
  nextLabel?: string;
  onNext?: () => void;
  nextDisabled?: boolean;
  submit?: boolean;
  pending?: boolean;
}) {
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className={cn(CONTROL_HEIGHT, "sm:w-auto sm:px-6")}
        >
          {backLabel}
        </Button>
      ) : (
        <Link
          href="/"
          className="order-last text-center text-sm text-primary underline underline-offset-2 sm:order-first"
        >
          Volver al inicio
        </Link>
      )}
      <Button
        type={submit ? "submit" : "button"}
        onClick={onNext}
        disabled={nextDisabled || pending}
        className={cn(CONTROL_HEIGHT, "font-semibold sm:w-auto sm:px-8")}
      >
        {pending ? "Enviando…" : nextLabel}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 1 — ¿Dónde vivís?                                              */
/* ------------------------------------------------------------------ */

function StepResidence({
  streets,
  draft,
  patch,
  error,
  onError,
  onNext,
}: {
  streets: StreetOption[];
  draft: AsociateDraft;
  patch: (values: Partial<AsociateDraft>) => void;
  error: string | null;
  onError: (message: string) => void;
  onNext: () => void;
}) {
  // Cambiar de rama tiene que limpiar el domicilio Y la categoría: REG-01 ata
  // las categorías al lugar de residencia, y arrastrar un "Socio activo"
  // elegido antes de decir "vivo en otro barrio" sería un dato inválido que el
  // server rechazaría recién en el submit.
  function chooseBranch(value: "si" | "no") {
    if (draft.livesInBarrio === value) return;
    patch({
      livesInBarrio: value,
      streetId: null,
      streetName: "",
      streetText: "",
      neighborhood: "",
      requestedCategory: value === "no" ? "collaborator" : "",
      wantsDebit: "",
    });
  }

  function next() {
    if (!draft.livesInBarrio) return onError("Contanos dónde vivís.");
    if (draft.livesInBarrio === "si" && draft.streetId === null) {
      return onError("Elegí tu calle de la lista del barrio.");
    }
    if (draft.livesInBarrio === "no" && !draft.streetText.trim()) {
      return onError("Ingresá el nombre de tu calle.");
    }
    if (draft.livesInBarrio === "no" && !draft.neighborhood.trim()) {
      return onError("Ingresá el nombre de tu barrio.");
    }
    if (!draft.streetNumber.trim()) return onError("Ingresá la altura de tu domicilio.");
    onNext();
  }

  return (
    <div>
      <fieldset>
        <legend className="sr-only">¿Dónde vivís?</legend>
        <div className="space-y-3">
          <ChoiceCard
            name="residence"
            value="si"
            checked={draft.livesInBarrio === "si"}
            onSelect={() => chooseBranch("si")}
            title="En el Barrio Ciudadela"
          >
            Podés asociarte como socio activo o adherente.
          </ChoiceCard>
          <ChoiceCard
            name="residence"
            value="no"
            checked={draft.livesInBarrio === "no"}
            onSelect={() => chooseBranch("no")}
            title="En otro barrio"
          >
            Podés asociarte como socio colaborador.
          </ChoiceCard>
        </div>
      </fieldset>

      {draft.livesInBarrio === "si" && (
        <div className="mt-6 space-y-4">
          <StreetPicker
            streets={streets}
            streetId={draft.streetId}
            streetName={draft.streetName}
            onPick={(street) =>
              patch({ streetId: street?.id ?? null, streetName: street ? streetLabel(street.name) : "" })
            }
          />
          <StreetNumberField value={draft.streetNumber} onChange={(v) => patch({ streetNumber: v })} />
        </div>
      )}

      {draft.livesInBarrio === "no" && (
        <div className="mt-6 space-y-4">
          <Field id="streetText" label="Calle">
            <Input
              id="streetText"
              className={CONTROL_HEIGHT}
              autoComplete="address-line1"
              maxLength={120}
              value={draft.streetText}
              onChange={(e) => patch({ streetText: e.target.value })}
            />
          </Field>
          <Field id="neighborhood" label="Barrio">
            <Input
              id="neighborhood"
              className={CONTROL_HEIGHT}
              autoComplete="address-level3"
              maxLength={60}
              value={draft.neighborhood}
              onChange={(e) => patch({ neighborhood: e.target.value })}
            />
          </Field>
          <StreetNumberField value={draft.streetNumber} onChange={(v) => patch({ streetNumber: v })} />
        </div>
      )}

      {error && (
        <FormMessage kind="error" box className="mt-6">
          {error}
        </FormMessage>
      )}
      <NavButtons onNext={next} />
    </div>
  );
}

function StreetNumberField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field id="streetNumber" label="Altura" hint="El número de tu casa. Ej.: 1250 o 1250 B.">
      <Input
        id="streetNumber"
        className={cn(CONTROL_HEIGHT, "max-w-40")}
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        aria-describedby="streetNumber-hint"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Combo sobre las 40 calles catastrales del barrio. Reusa `searchStreets`
 *  —la misma búsqueda del modo carga del panel: normaliza tildes, tolera el
 *  ordinal de "1º de mayo", parte "Hernandez , Jose" en tokens y matchea
 *  también el código catastral— en vez de inventar otra normalización.
 *
 *  No reusa `StreetAutocomplete` del panel: aquel emite sus propios hidden
 *  inputs, ofrece una salida a texto libre —que acá es una rama distinta del
 *  wizard, no un campo— y está escrito para un operador que carga cincuenta
 *  fichas con el teclado. */
function StreetPicker({
  streets,
  streetId,
  streetName,
  onPick,
}: {
  streets: StreetOption[];
  streetId: number | null;
  streetName: string;
  onPick: (street: StreetOption | null) => void;
}) {
  const [query, setQuery] = useState(streetName);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => searchStreets(streets, query), [streets, query]);
  const active = open && matches[highlight] ? matches[highlight] : null;

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  function choose(street: StreetOption) {
    onPick(street);
    setQuery(streetLabel(street.name));
    setOpen(false);
    setHighlight(0);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="street-search" className="text-sm">
        Calle
      </Label>
      <div className="relative">
        <Input
          id="street-search"
          className={CONTROL_HEIGHT}
          autoComplete="off"
          placeholder="Escribí las primeras letras"
          role="combobox"
          aria-expanded={open}
          // Sólo mientras la lista existe: apuntar a un id ausente es una
          // referencia rota para el lector de pantalla.
          aria-controls={open && matches.length > 0 ? "street-listbox" : undefined}
          aria-autocomplete="list"
          aria-describedby="street-search-hint"
          aria-activedescendant={active ? `street-option-${active.id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onPick(null);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          // El clic en una opción dispara blur antes que el mousedown en
          // algunos navegadores móviles: el respiro evita que la lista se
          // cierre debajo del dedo.
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) return setOpen(true);
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) =>
                matches.length === 0 ? 0 : (h + delta + matches.length) % matches.length,
              );
              return;
            }
            if (e.key === "Escape") return setOpen(false);
            if (e.key === "Enter" && open && matches[highlight]) {
              e.preventDefault();
              choose(matches[highlight]);
            }
          }}
        />
        {open && matches.length > 0 && (
          <ul
            id="street-listbox"
            role="listbox"
            aria-label="Calles del barrio"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-background shadow-lg"
          >
            {matches.map((street, i) => (
              <li
                key={street.id}
                id={`street-option-${street.id}`}
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center px-4 py-2.5 text-base",
                  i === highlight && "bg-accent",
                )}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(street);
                }}
              >
                {streetLabel(street.name)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Un solo contenedor con el id del `aria-describedby`: las tres
          variantes son el mismo mensaje del campo, y si el id apareciera y
          desapareciera con la rama, la referencia quedaría colgada. */}
      <div id="street-search-hint">
        {streetId !== null ? (
          <FormMessage kind="success" role="none" className="text-xs">
            Calle del barrio: {streetName}
          </FormMessage>
        ) : query.trim() !== "" && matches.length === 0 ? (
          // Ayuda del campo mientras se tipea, no respuesta a una acción: con
          // `role="alert"` el lector de pantalla interrumpiría en cada tecla.
          <FormMessage kind="warning" role="none" className="text-xs">
            Esa calle no está en el barrio. Revisá cómo la escribiste o volvé arriba y elegí
            «En otro barrio».
          </FormMessage>
        ) : (
          <p className="text-xs text-muted-foreground">
            Elegí tu calle de la lista. También podés buscar por el número de catálogo.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 2 — Categoría                                                  */
/* ------------------------------------------------------------------ */

function StepCategory({
  draft,
  fees,
  patch,
  error,
  onError,
  onBack,
  onNext,
}: {
  draft: AsociateDraft;
  fees: FeeAmounts | null;
  patch: (values: Partial<AsociateDraft>) => void;
  error: string | null;
  onError: (message: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const inBarrio = draft.livesInBarrio === "si";

  function next() {
    if (!fees) return onError("Todavía no podemos mostrarte el valor de la cuota.");
    if (!draft.requestedCategory) return onError("Elegí tu categoría para seguir.");
    if (draft.requestedCategory === "adherent" && !draft.wantsDebit) {
      return onError("Indicanos si querés adherir al débito automático.");
    }
    onNext();
  }

  // Sin montos no hay categoría que elegir: inventar uno sería mentirle al
  // vecino sobre a qué se compromete (los montos son la fuente de verdad de los
  // planes de MP, ver src/lib/mp/plans.ts).
  if (!fees) {
    return (
      <div>
        <FormMessage kind="error" box>
          No pudimos obtener el valor de la cuota en este momento. Probá de nuevo más tarde.
        </FormMessage>
        <NavButtons onBack={onBack} onNext={next} nextDisabled />
      </div>
    );
  }

  return (
    <div>
      {inBarrio ? (
        <fieldset>
          <legend className="sr-only">Elegí tu categoría</legend>
          <div className="space-y-3">
            <ChoiceCard
              name="category"
              value="active"
              checked={draft.requestedCategory === "active"}
              onSelect={() => patch({ requestedCategory: "active", wantsDebit: "" })}
              title="Socio activo"
              aside={<Amount amount={fees.active} note="por mes · obligatoria" />}
            >
              Voz y voto en las asambleas. Podés ocupar cargos en la Comisión Directiva.
            </ChoiceCard>
            <ChoiceCard
              name="category"
              value="adherent"
              checked={draft.requestedCategory === "adherent"}
              onSelect={() => patch({ requestedCategory: "adherent" })}
              title="Socio adherente"
              aside={<Amount amount={fees.shared} note="por mes · voluntaria" />}
            >
              Voz sin voto en las asambleas. Votás en las elecciones.
            </ChoiceCard>
          </div>
        </fieldset>
      ) : (
        <>
          {/* Una sola categoría posible (Art. 5 bis): no hay elección que
              ofrecer, así que la tarjeta informa y `requestedCategory` ya quedó
              fijada al elegir "En otro barrio" en el paso 1. */}
          <div className="rounded-xl border-2 border-primary bg-primary/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-base font-semibold">Socio colaborador</p>
              <Amount amount={fees.shared} note="por mes · obligatoria" />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Es la categoría que corresponde a quienes viven fuera del barrio.
            </p>
          </div>
          <FormMessage kind="neutral" box className="mt-4">
            Vas a tener que acreditar tu vinculación con el barrio: un inmueble a tu nombre, un
            familiar que viva acá, o un comercio o actividad en la zona. Te lo pedimos en el paso
            de documentación.
          </FormMessage>
        </>
      )}

      {draft.requestedCategory === "adherent" && (
        <div className="mt-6">
          <fieldset>
            <legend className="text-sm font-medium">
              ¿Querés adherir al débito automático de la cuota voluntaria?
            </legend>
            <div className="mt-3 space-y-3">
              <ChoiceCard
                name="wantsDebit"
                value="si"
                checked={draft.wantsDebit === "si"}
                onSelect={() => patch({ wantsDebit: "si" })}
                title="Sí, quiero adherir"
              >
                Se debita todos los meses. Podés darla de baja cuando quieras.
              </ChoiceCard>
              <ChoiceCard
                name="wantsDebit"
                value="no"
                checked={draft.wantsDebit === "no"}
                onSelect={() => patch({ wantsDebit: "no" })}
                title="No por ahora"
              >
                Tu solicitud pasa igual a la Comisión Directiva.
              </ChoiceCard>
            </div>
          </fieldset>

          {draft.wantsDebit === "si" && (
            // Aviso suave de docs/05 §2: informa, no bloquea. Quien va a pagar
            // todos los meses como adherente puede tener voz Y voto por lo
            // mismo, y nadie se lo dijo nunca.
            <FormMessage kind="neutral" box className="mt-4">
              <span className="block">
                Por {formatARS(fees.active)} al mes podés ser <strong>socio activo</strong>, con
                voz y voto en las asambleas y la posibilidad de ocupar cargos.
              </span>
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-11 w-full sm:w-auto sm:px-5"
                onClick={() => patch({ requestedCategory: "active", wantsDebit: "" })}
              >
                Cambiar a socio activo
              </Button>
            </FormMessage>
          )}
        </div>
      )}

      {error && (
        <FormMessage kind="error" box className="mt-6">
          {error}
        </FormMessage>
      )}
      <NavButtons onBack={onBack} onNext={next} />
    </div>
  );
}

function Amount({ amount, note }: { amount: number; note: string }) {
  return (
    <span className="text-right">
      <span className="block text-lg font-bold text-primary">{formatARS(amount)}</span>
      <span className="block text-xs text-muted-foreground">{note}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Paso 3 — Tus datos                                                  */
/* ------------------------------------------------------------------ */

function StepPersonal({
  draft,
  patch,
  legal,
  siteKey,
  actionState,
  formAction,
  pending,
  error,
  onBack,
}: {
  draft: AsociateDraft;
  patch: (values: Partial<AsociateDraft>) => void;
  legal: LegalTexts;
  siteKey: string;
  /** Se le pasa entero a Turnstile: cada respuesta del server es un objeto
   *  nuevo, y cada respuesta significa que el token anterior ya se gastó. */
  actionState: CreateState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  onBack: () => void;
}) {
  // React 19 hace `form.reset()` al terminar la action. Para los campos de
  // texto no se nota —React mantiene sincronizado el atributo `value`, así que
  // el reset los devuelve a lo tipeado—, pero el atributo `checked` NO lo
  // sincroniza: el checkbox vuelve a destildado y el render controlado no lo
  // corrige, porque para React la prop no cambió. Sin esto, cada envío fallido
  // le borraba la aceptación al vecino y el siguiente intento moría en la
  // validación del navegador.
  const termsRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (termsRef.current) termsRef.current.checked = draft.acceptTerms;
  }, [actionState, draft.acceptTerms]);

  const emailMismatch =
    draft.email.trim() !== "" &&
    draft.emailConfirm.trim() !== "" &&
    draft.email.trim().toLowerCase() !== draft.emailConfirm.trim().toLowerCase();

  return (
    <form action={formAction} className="space-y-5">
      {/* Los pasos 1 y 2 viajan acá. Los nombres son los del schema de
          createApplicationAction; los opcionales se omiten en vez de mandarse
          vacíos, porque `streetId=""` coacciona a 0 y el server lo rechazaría
          con "Elegí tu calle del listado". */}
      <input type="hidden" name="livesInBarrio" value={draft.livesInBarrio} />
      {draft.livesInBarrio === "si" && draft.streetId !== null && (
        <input type="hidden" name="streetId" value={draft.streetId} />
      )}
      {draft.livesInBarrio === "no" && (
        <>
          <input type="hidden" name="streetText" value={draft.streetText} />
          <input type="hidden" name="neighborhood" value={draft.neighborhood} />
        </>
      )}
      <input type="hidden" name="streetNumber" value={draft.streetNumber} />
      <input type="hidden" name="requestedCategory" value={draft.requestedCategory} />
      {draft.requestedCategory === "adherent" && (
        <input type="hidden" name="wantsDebit" value={draft.wantsDebit} />
      )}

      <Field id="fullName" label="Nombre y apellido">
        <Input
          id="fullName"
          name="fullName"
          className={CONTROL_HEIGHT}
          autoComplete="name"
          maxLength={160}
          required
          value={draft.fullName}
          onChange={(e) => patch({ fullName: e.target.value })}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="dni" label="DNI" hint="Sin puntos ni espacios.">
          <Input
            id="dni"
            name="dni"
            className={CONTROL_HEIGHT}
            inputMode="numeric"
            autoComplete="off"
            maxLength={9}
            required
            aria-describedby="dni-hint"
            value={draft.dni}
            onChange={(e) => patch({ dni: e.target.value.replace(/\D/g, "") })}
          />
        </Field>
        <Field id="birthDate" label="Fecha de nacimiento" hint="Tenés que ser mayor de 18 años.">
          <Input
            id="birthDate"
            name="birthDate"
            type="date"
            className={CONTROL_HEIGHT}
            autoComplete="bday"
            required
            aria-describedby="birthDate-hint"
            value={draft.birthDate}
            onChange={(e) => patch({ birthDate: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="civilStatus" label="Estado civil">
          {/* `<select>` nativo y no el de Radix: en el celular abre el selector
              del sistema operativo, que es el control que el vecino ya sabe
              usar (y el que su lector de pantalla ya sabe leer). Los colores y
              la altura van explícitos para que quede igual que los `Input` de
              al lado, que traen los suyos del componente. */}
          <select
            id="civilStatus"
            name="civilStatus"
            required
            value={draft.civilStatus}
            onChange={(e) => patch({ civilStatus: e.target.value })}
            className={cn(
              "w-full rounded-lg border border-input bg-background px-3 text-foreground transition-colors",
              CONTROL_HEIGHT,
              FOCUS_RING,
              "focus-visible:border-ring",
              draft.civilStatus === "" && "text-muted-foreground",
            )}
          >
            <option value="" disabled>
              Elegí una opción
            </option>
            {CIVIL_STATUSES.map((s) => (
              <option key={s} value={s} className="text-foreground">
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field id="nationality" label="Nacionalidad">
          <Input
            id="nationality"
            name="nationality"
            className={CONTROL_HEIGHT}
            autoComplete="country-name"
            maxLength={60}
            required
            value={draft.nationality}
            onChange={(e) => patch({ nationality: e.target.value })}
          />
        </Field>
      </div>

      <Field id="occupation" label="Ocupación">
        <Input
          id="occupation"
          name="occupation"
          className={CONTROL_HEIGHT}
          autoComplete="organization-title"
          maxLength={80}
          required
          value={draft.occupation}
          onChange={(e) => patch({ occupation: e.target.value })}
        />
      </Field>

      <Field id="phone" label="Teléfono">
        <Input
          id="phone"
          name="phone"
          type="tel"
          className={CONTROL_HEIGHT}
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          required
          value={draft.phone}
          onChange={(e) => patch({ phone: e.target.value })}
        />
      </Field>

      <Field id="email" label="Email" hint="Acá te mandamos todo lo de tu solicitud.">
        <Input
          id="email"
          name="email"
          type="email"
          className={CONTROL_HEIGHT}
          inputMode="email"
          autoComplete="email"
          maxLength={191}
          required
          aria-describedby="email-hint"
          value={draft.email}
          onChange={(e) => patch({ email: e.target.value })}
        />
      </Field>

      <Field id="emailConfirm" label="Repetí tu email">
        <Input
          id="emailConfirm"
          name="emailConfirm"
          type="email"
          className={CONTROL_HEIGHT}
          inputMode="email"
          autoComplete="off"
          maxLength={191}
          required
          aria-invalid={emailMismatch || undefined}
          value={draft.emailConfirm}
          onChange={(e) => patch({ emailConfirm: e.target.value })}
        />
        {emailMismatch && (
          <FormMessage kind="warning" role="none" className="text-xs">
            Los dos emails no coinciden: revisá el tipeo.
          </FormMessage>
        )}
      </Field>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <LegalDetails title="Términos y condiciones" text={legal.terms} />
        <LegalDetails title="Consentimiento de datos personales" text={legal.privacyConsent} />
        <label className="flex cursor-pointer items-start gap-3 py-1.5">
          <input
            ref={termsRef}
            type="checkbox"
            name="acceptTerms"
            required
            checked={draft.acceptTerms}
            onChange={(e) => patch({ acceptTerms: e.target.checked })}
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span className="text-sm">
            Leí y acepto los términos y condiciones y el consentimiento de datos personales.
          </span>
        </label>
      </div>

      <TurnstileWidget siteKey={siteKey} resetKey={actionState} />

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}

      <NavButtons
        onBack={onBack}
        submit
        nextLabel="Guardar y continuar"
        pending={pending}
      />
    </form>
  );
}

function LegalDetails({ title, text }: { title: string; text: string | null }) {
  return (
    <details className="rounded-lg border border-border">
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-medium",
          FOCUS_RING,
        )}
      >
        {title}
      </summary>
      {/* Texto PLANO desde `configuration` (ver getLegalTexts): se renderiza con
          whitespace-pre-line, nunca como HTML. */}
      <div className="max-h-64 overflow-y-auto border-t border-border px-3 py-3 text-sm whitespace-pre-line text-muted-foreground">
        {text ?? "El texto todavía no está publicado. Consultalo en la sede vecinal."}
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Pantallas de bloqueo                                                */
/* ------------------------------------------------------------------ */

function BlockedPanel({
  blocked,
  dni,
  siteKey,
}: {
  blocked: NonNullable<CreateState["blocked"]>;
  dni: string;
  siteKey: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">No pudimos seguir</h1>
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

      <p className="mt-8 text-sm text-muted-foreground">
        Si creés que hay un error, acercate a la sede vecinal o escribinos desde la{" "}
        <Link href="/ubicacion" className="text-primary underline underline-offset-2">
          página de contacto
        </Link>
        .
      </p>
      <p className="mt-4">
        <Link href="/" className="text-sm text-primary underline underline-offset-2">
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}

function ResendResumeForm({ dni, siteKey }: { dni: string; siteKey: string }) {
  const [state, action, pending] = useActionState<ResendState, FormData>(
    resendResumeLinkAction,
    {},
  );
  if (state.done) {
    // Respuesta única de la action: no confirma ni desmiente que ese DNI tenga
    // una solicitud en trámite. El texto tiene que decir lo mismo.
    return (
      <FormMessage kind="success" box className="mt-6">
        Si hay una solicitud en trámite con ese DNI, te enviamos el enlace para retomarla al email
        que dejaste. Revisá también la carpeta de correo no deseado.
      </FormMessage>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4 rounded-xl border border-border p-4">
      <p className="text-sm">
        Te reenviamos por email el enlace para retomar la solicitud que ya empezaste.
      </p>
      <input type="hidden" name="dni" value={dni} />
      <TurnstileWidget siteKey={siteKey} resetKey={state} />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending} className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-6")}>
        {pending ? "Enviando…" : "Reenviarme el enlace"}
      </Button>
    </form>
  );
}
