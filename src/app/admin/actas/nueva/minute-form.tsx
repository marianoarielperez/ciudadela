"use client";
import { useActionState, useState } from "react";
import { createMinuteAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MinuteForm() {
  const [state, formAction, pending] = useActionState(createMinuteAction, {});
  // Campos controlados a propósito: React 19 resetea el formulario cuando la
  // action termina, y con inputs no controlados un error ("Ya existe el acta…")
  // dejaba la pantalla en blanco y había que tipear todo de nuevo.
  const [values, setValues] = useState({ type: "board", number: "", date: "", description: "" });
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <div className="space-y-1">
        <Label htmlFor="type">Tipo</Label>
        <select
          id="type" name="type" className="h-9 w-full rounded-md border px-2 text-sm"
          value={values.type} onChange={set("type")}
        >
          <option value="board">Comisión Directiva</option>
          <option value="assembly">Asamblea</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="number">Número</Label>
        <Input id="number" name="number" type="number" min={1} required value={values.number} onChange={set("number")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="date">Fecha</Label>
        <Input id="date" name="date" type="date" required value={values.date} onChange={set("date")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="description">Descripción</Label>
        <Input id="description" name="description" maxLength={500} value={values.description} onChange={set("description")} />
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Crear acta"}</Button>
    </form>
  );
}
