"use client";
import { useActionState, useRef, useState } from "react";
import { admitAction } from "./actions";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORY_LABELS } from "@/lib/members/labels";

const CATEGORIES = Object.entries(CATEGORY_LABELS);

export function AdmitForm({ minutes }: { minutes: MinuteOption[] }) {
  const [state, formAction, pending] = useActionState(admitAction, {});
  // Campos controlados a propósito: React 19 resetea el formulario al terminar
  // la action y un rechazo ("Ya existe un socio con ese DNI", "Ya existe el acta
  // N° 47") dejaría al admin tipeando de nuevo un alta que copió de una ficha
  // en papel.
  const [values, setValues] = useState({ fullName: "", category: "active", dni: "", email: "" });
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const formRef = useRef<HTMLFormElement>(null);
  // El <select> de categoría no vuelve solo al valor del estado tras el reset
  // de React 19: sin esto un DNI repetido lo dejaría en "Activo" en silencio.
  useFormResetSync(formRef, values);

  return (
    <form ref={formRef} action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-1">
        <Label htmlFor="fullName">Apellido y nombre</Label>
        <Input id="fullName" name="fullName" required value={values.fullName} onChange={set("fullName")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="category">Categoría</Label>
        <select
          id="category" name="category" required
          className="h-9 w-full rounded-md border px-2 text-sm"
          value={values.category} onChange={set("category")}
        >
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="dni">DNI (opcional)</Label>
        <Input id="dni" name="dni" inputMode="numeric" value={values.dni} onChange={set("dni")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email (opcional)</Label>
        <Input id="email" name="email" type="email" value={values.email} onChange={set("email")} />
      </div>
      <MinutePicker minutes={minutes} />
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Dar de alta"}</Button>
    </form>
  );
}
