"use client";
// Paso 2 (sólo vecinos): datos de identidad + las dos caras del DNI. El
// formulario de datos y las dos ranuras son TRES forms distintos, cada uno con
// su action: mezclarlos es el bug de las 11/12 subidas (ver la cabecera de
// `file-slot.tsx`).
import Link from "next/link";
import { useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REPORT_MESSAGES } from "@/lib/reports/rules";
import { cn } from "@/lib/utils";
import { Field } from "../asociate/wizard-ui";
import { FileSlot } from "./file-slot";
import { CONTROL_HEIGHT, LINK_TARGET, type ReportDraft, type UploadedFile } from "./wizard-shared";

export function StepIdentity({
  claim,
  draft,
  patch,
  files,
  onUploaded,
  onRemoved,
  formAction,
  pending,
  error,
}: {
  claim: string;
  draft: ReportDraft;
  patch: (values: Partial<ReportDraft>) => void;
  files: UploadedFile[];
  onUploaded: (file: UploadedFile) => void;
  onRemoved: (fileId: number) => void;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  // Cuántas subidas hay en vuelo: mientras haya una, "Guardar y continuar"
  // queda apagado (si no, se envía el paso con un DNI a medio subir).
  const [inFlight, setInFlight] = useState(0);
  const front = files.find((f) => f.kind === "dni_front") ?? null;
  const back = files.find((f) => f.kind === "dni_back") ?? null;
  const dniReady = front !== null && back !== null;

  return (
    <div className="space-y-6">
      <form id="reporter-form" action={formAction} className="space-y-5">
        <input type="hidden" name="claim" value={claim} />
        <Field id="name" label="Nombre y apellido">
          <Input
            id="name"
            name="name"
            className={CONTROL_HEIGHT}
            autoComplete="name"
            maxLength={160}
            required
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field id="dni" label="DNI" hint="Solo números, sin puntos.">
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
        <Field id="email" label="Email" hint="Acá te mandamos el acuse y el aviso cuando lo presentemos.">
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
      </form>

      <div>
        <p className="text-sm font-medium">Tu DNI</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Las dos caras, con el documento apoyado y bien iluminado. Es para que el reporte sea de una
          persona real del barrio; no viaja al organismo.
        </p>
        <ul className="mt-3 space-y-3">
          <FileSlot
            claim={claim}
            kind="dni_front"
            title="Frente del DNI"
            hint="La cara con tu foto y tu número."
            existing={front}
            onUploaded={onUploaded}
            onRemoved={onRemoved}
            onBusy={(d) => setInFlight((n) => n + d)}
          />
          <FileSlot
            claim={claim}
            kind="dni_back"
            title="Dorso del DNI"
            hint="La cara de atrás, con el domicilio."
            existing={back}
            onUploaded={onUploaded}
            onRemoved={onRemoved}
            onBusy={(d) => setInFlight((n) => n + d)}
          />
        </ul>
      </div>

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}
      {/* El MISMO texto con el que el server rechaza el paso (`saveReporter`):
          la pantalla y el rechazo no pueden decir cosas distintas del mismo
          requisito (patrón `GRANT_GUARD_MESSAGES`). */}
      {!dniReady && <FormMessage kind="neutral">{REPORT_MESSAGES.dni}</FormMessage>}

      {/* La botonera se arma acá y no con `NavButtons` por dos motivos: el
          avance envía el form de DATOS por `form=` (no el que lo envuelve, que
          es ninguno), y la vuelta no es un paso sino una salida — el paso 1 ya
          creó el borrador en la base, así que no hay a dónde volver dentro del
          wizard. La llave ya está en la URL: quien salga y vuelva con el
          "atrás" del navegador retoma donde estaba. */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/reportes" className={cn(LINK_TARGET, "order-last justify-center sm:order-first")}>
          Volver a Reportes
        </Link>
        <Button
          type="submit"
          form="reporter-form"
          disabled={!dniReady || inFlight > 0 || pending}
          className={cn(CONTROL_HEIGHT, "font-semibold sm:w-auto sm:px-8")}
        >
          {pending ? "Guardando…" : "Guardar y continuar"}
        </Button>
      </div>
    </div>
  );
}
