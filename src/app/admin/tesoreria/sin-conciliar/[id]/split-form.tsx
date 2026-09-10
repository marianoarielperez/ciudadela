"use client";
// El reparto de un cobro de Mercado Pago entre socios (spec 2026-09-10 §8.1).
//
// Una boleta: una parte por socio elegido (los socios viajan en la URL, así que
// agregar y quitar es navegar), con concepto, cuotas e importe; el pie suma lo
// asignado y dice cuánto falta; y el envío es en DOS pasos —el primero devuelve
// la confirmación resuelta en el servidor (qué cuotas se imputan a cada uno),
// el segundo emite— con el mismo mecanismo que el lote de cesantía: token de
// lo confirmado, foco en el panel, Enter bloqueado mientras está visible.
//
// `useSyncedForm`: React 19 resetea el <form action> cuando la action termina
// y, con varios <select> controlados, cada rechazo devolvería todos los
// conceptos al primero mientras el operador lee por qué se rechazó.
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Receipt, X } from "lucide-react";
import { FormMessage } from "@/components/admin/form-message";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MemberStatus } from "@/generated/prisma/client";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { formatARS } from "@/lib/format";
import { arsInputClean, formatArsInput, parseArsInput } from "@/lib/treasury/ars-input";
import { CASH_CONCEPT_LABELS } from "@/lib/treasury/labels";
import type { CashConcept } from "@/lib/treasury/rules";
import { cents } from "@/lib/treasury/split-group";
import { digitsOnly } from "../../efectivo/digits";
import { resolveUnmatchedAction } from "./actions";

/** Lo que la pantalla resolvió en el servidor sobre cada socio elegido. */
export type SplitPartMember = {
  memberId: number;
  name: string;
  memberNumber: number | null;
  categoryLabel: string;
  status: MemberStatus;
  statusLabel: string;
  /** Conceptos que se le pueden asignar (categoría, cesante y exención ya
   *  aplicados en el servidor). Vacío = no hay nada que asignarle. */
  concepts: CashConcept[];
  /** Valor vigente de la cuota de su categoría, o null si no paga cuota. */
  feeAmount: number | null;
  pendingCount: number;
  /** "julio 2026", o null si está al día. */
  oldestPendingLabel: string | null;
  withdrawn: boolean;
  /** El aviso del acta si está eximido, ya redactado. */
  exemptionNotice: string | null;
  /** La URL de la pantalla sin este socio. */
  removeHref: string;
};

type SplitState = Awaited<ReturnType<typeof resolveUnmatchedAction>>;
type Confirmation = NonNullable<SplitState["confirm"]>;

const MAX_COUNT = 60;

export function SplitForm({ rowId, sociosParam, parts, unassigned, paidAt }: {
  rowId: number;
  sociosParam: string;
  parts: SplitPartMember[];
  /** Lo que queda por asignar de la fila (todo, o el resto de una parcial). */
  unassigned: number;
  /** Ya formateada en es-AR: la fecha del recibo es la del cobro. */
  paidAt: string;
}) {
  const [state, formAction, pending] = useActionState(resolveUnmatchedAction, {});
  const [dismissed, setDismissed] = useState<Confirmation | undefined>(undefined);
  const confirmRef = useRef<HTMLDivElement>(null);
  const single = parts.length === 1;

  const { values, setValue, formRef, field } = useSyncedForm<Record<string, string>>(() => {
    const v: Record<string, string> = { note: "" };
    for (const p of parts) {
      const concept = p.concepts[0] ?? "";
      // Con un solo socio, lo que el importe sugiere (cuántas cuotas entran);
      // con varios, una cuota cada uno y que el operador lo ajuste.
      const suggested = p.feeAmount ? Math.max(1, Math.min(MAX_COUNT, Math.floor(unassigned / p.feeAmount))) : 1;
      const count = concept === "fees"
        ? (single ? (p.withdrawn ? Math.max(1, Math.min(suggested, p.pendingCount)) : suggested) : 1)
        : 1;
      v[`part_${p.memberId}_concept`] = concept;
      v[`part_${p.memberId}_count`] = String(count);
      v[`part_${p.memberId}_amount`] = concept === "fees" && p.feeAmount
        ? formatArsInput(p.feeAmount * count)
        : single ? formatArsInput(unassigned) : "";
    }
    return v;
  });

  const amountCents = (p: SplitPartMember) => {
    const n = parseArsInput(values[`part_${p.memberId}_amount`] ?? "");
    return n === null ? 0 : cents(n);
  };
  const assigned = parts.reduce((s, p) => s + amountCents(p), 0);
  const remaining = cents(unassigned) - assigned;
  const blocked = parts.some((p) => p.concepts.length === 0);
  const confirm = state.confirm && state.confirm !== dismissed ? state.confirm : null;

  // Cambiar cuotas o concepto recalcula el importe (n × valor vigente); el
  // operador puede corregirlo después. Y cualquier cambio invalida lo que
  // acaba de leer en la confirmación.
  const onCountChange = (p: SplitPartMember, raw: string) => {
    const c = digitsOnly(raw).slice(0, 2);
    setValue(`part_${p.memberId}_count`, c);
    if (p.feeAmount && values[`part_${p.memberId}_concept`] === "fees" && c !== "") {
      setValue(`part_${p.memberId}_amount`, formatArsInput(p.feeAmount * Number(c)));
    }
  };
  const onConceptChange = (p: SplitPartMember, concept: string) => {
    setValue(`part_${p.memberId}_concept`, concept);
    if (concept === "fees" && p.feeAmount) {
      const c = Number(values[`part_${p.memberId}_count`] || "1");
      setValue(`part_${p.memberId}_amount`, formatArsInput(p.feeAmount * Math.max(1, c)));
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (confirm && e.key === "Enter" && (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
    }
  };
  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={() => setDismissed(state.confirm)}
      onKeyDown={onKeyDown}
      className="space-y-4"
    >
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="socios" value={sociosParam} />

      <ul className="divide-y rounded-xl border">
        {parts.map((p) => {
          const concept = values[`part_${p.memberId}_concept`] ?? "";
          const conceptField = field(`part_${p.memberId}_concept`);
          const countField = field(`part_${p.memberId}_count`);
          const amountField = field(`part_${p.memberId}_amount`, arsInputClean);
          return (
            <li key={p.memberId} className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-mono tabular-nums text-muted-foreground">
                  {p.memberNumber !== null ? `N° ${p.memberNumber}` : "Sin número"}
                </span>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">· {p.categoryLabel}</span>
                <Badge variant={memberStatusBadgeVariant(p.status)}>{p.statusLabel}</Badge>
                <Link
                  href={p.removeHref}
                  className="ml-auto inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden="true" />
                  Quitar
                  <span className="sr-only"> a {p.name} del reparto</span>
                </Link>
              </div>
              {p.concepts.length === 0 ? (
                <FormMessage kind="warning" role="none">
                  Está dado de baja y no le quedan cuotas pendientes: no hay a qué imputarle una parte. Quitalo del reparto.
                </FormMessage>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SelectField
                      label="Concepto"
                      field={{ ...conceptField, onChange: (e) => onConceptChange(p, e.target.value) }}
                      options={p.concepts.map((c): [string, string] => [c, p.withdrawn && c === "fees" ? "Cuotas sociales (deuda congelada)" : CASH_CONCEPT_LABELS[c]])}
                    />
                    {concept === "fees" ? (
                      <TextField
                        label="Cuotas"
                        field={{ ...countField, onChange: (e) => onCountChange(p, e.target.value) }}
                        inputMode="numeric"
                        maxLength={2}
                        hint={
                          p.withdrawn
                            ? `Dado de baja: como máximo ${p.pendingCount}.`
                            : p.pendingCount > 0
                              ? `Debe ${p.pendingCount}${p.oldestPendingLabel ? ` desde ${p.oldestPendingLabel}` : ""}. Se imputan a las más antiguas primero.`
                              : "Está al día: se imputa a la primera cuota no cubierta."
                        }
                      />
                    ) : (
                      <div aria-hidden="true" />
                    )}
                    <TextField
                      label="Importe ($)"
                      field={amountField}
                      inputMode="text"
                      maxLength={11}
                      placeholder="6000"
                      hint="Centavos con coma: 6000,50."
                    />
                  </div>
                  {p.exemptionNotice && (
                    <FormMessage kind="warning" role="none">{p.exemptionNotice} Sólo se le puede registrar un aporte.</FormMessage>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {/* La boleta: qué se le asigna a cada uno y cuánto falta. Verde en cero,
          ámbar mientras falte o sobre: se lee antes que el número. */}
      <div className="overflow-hidden rounded-xl border-2 border-border">
        <ul className="divide-y divide-border text-sm">
          {parts.map((p) => (
            <li key={p.memberId} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <span className="min-w-0 truncate">{p.name}</span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{formatARS(amountCents(p) / 100)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-4 bg-muted/40 px-4 py-3">
            <span className="font-medium">Total asignado</span>
            <span className="shrink-0 font-mono text-lg font-semibold tabular-nums">{formatARS(assigned / 100)}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-4 py-3">
            <span className="font-medium">Sin asignar</span>
            <span
              className={`shrink-0 font-mono text-lg font-semibold tabular-nums ${remaining === 0 ? "text-success" : "text-warning"}`}
              role="status"
            >
              {formatARS(remaining / 100)}
            </span>
          </li>
        </ul>
      </div>
      {remaining !== 0 && (
        <FormMessage kind="warning" role="none">
          {remaining > 0
            ? `Faltan asignar ${formatARS(remaining / 100)} de los ${formatARS(unassigned)} cobrados.`
            : `Las partes suman ${formatARS(-remaining / 100)} más que lo cobrado.`}
        </FormMessage>
      )}

      <TextField label="Nota (opcional)" field={field("note")} maxLength={200} hint="Va en los pagos de todas las partes, no en los recibos." />

      <p className="text-sm text-muted-foreground">
        Los recibos se fechan el {paidAt}, que es el día en que Mercado Pago lo cobró.
      </p>

      {state.error && (
        <FormMessage kind={state.kind ?? "error"} box>
          {state.error}
          {state.receipt && (
            <>
              {" "}
              <Link
                className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                href={`/admin/tesoreria/recibos/${state.receipt.id}`}
              >
                Ver el recibo N° {state.receipt.number}
              </Link>
            </>
          )}
        </FormMessage>
      )}

      {confirm && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="split-confirm-title"
          className="space-y-3 rounded-md border border-primary bg-primary/5 p-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p id="split-confirm-title" className="font-medium">
            {`Vas a emitir ${confirm.parts.length} ${confirm.parts.length === 1 ? "recibo" : "recibos"} por ${formatARS(confirm.total)}.`}
          </p>
          <ul className="space-y-1 text-sm">
            {confirm.parts.map((c) => (
              <li key={c.memberId} className="flex flex-wrap items-baseline gap-x-2">
                <Receipt className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
                <span className="font-mono tabular-nums text-muted-foreground">
                  {c.memberNumber !== null ? `N° ${c.memberNumber}` : "Sin número"}
                </span>
                <span className="font-medium">{c.name}</span>
                <span>· {c.concept} ·</span>
                <span className="font-mono tabular-nums">{formatARS(c.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Cada socio recibe su recibo por email si tiene casilla. Los números se asignan al confirmar y no se reutilizan.
          </p>
          <input type="hidden" name="confirmToken" value={confirm.token} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="confirmar" value="1" className="min-h-11 px-4" disabled={pending}>
              {pending ? "Emitiendo…" : `Confirmar y emitir ${confirm.parts.length} ${confirm.parts.length === 1 ? "recibo" : "recibos"}`}
            </Button>
            <Button type="button" variant="outline" className="min-h-11 px-4" disabled={pending} onClick={() => setDismissed(confirm)}>
              Volver
            </Button>
          </div>
        </div>
      )}

      {!confirm && (
        <Button type="submit" className="min-h-11 px-4" disabled={pending || blocked || parts.length === 0 || remaining !== 0}>
          {pending ? "Revisando…" : "Revisar el reparto"}
        </Button>
      )}
    </form>
  );
}
