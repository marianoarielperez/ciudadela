"use client";
// Campos de formulario controlados con la sincronización post-reset ya puesta.
//
// React 19 resetea el <form action> cuando la server action termina. Con inputs
// de texto controlados no se nota; con <select> y radios sí (ver el comentario
// largo de use-form-reset-sync.ts). Hasta ahora cada pantalla se acordaba de
// llamar al hook por su cuenta, y el modo carga tiene más campos que ninguna:
// olvidarse en uno solo significa que un error de validación le borra al
// operador un dato que copió de una ficha en papel.
//
// `useSyncedForm` centraliza las tres piezas —estado, ref del formulario y
// hook— y `field(name)` devuelve las props que dejan a un input o a un select
// controlado y registrado de una sola vez. Un campo mal cableado deja de ser
// posible por omisión.
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type FieldBinding = {
  id: string;
  name: string;
  value: string;
  // El textarea entra en la misma unión que el input y el select: los tres
  // exponen `value` y es lo único que el handler mira.
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
};

export function useSyncedForm<T extends Record<string, string>>(initial: T | (() => T)) {
  const [values, setValues] = useState<T>(initial);
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, values);

  function setValue(name: keyof T & string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  // `clean` permite normalizar mientras se tipea (por ejemplo, DNI a dígitos
  // pelados) sin que cada pantalla arme su propio onChange.
  function field(name: keyof T & string, clean?: (raw: string) => string): FieldBinding {
    return {
      id: name,
      name,
      value: values[name] ?? "",
      onChange: (e) => setValue(name, clean ? clean(e.target.value) : e.target.value),
    };
  }

  return { values, setValue, setValues, formRef, field };
}

function Wrapper({ htmlFor, label, hint, children }: {
  htmlFor: string; label: string; hint?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextField(props: {
  label: string;
  field: FieldBinding;
  type?: "text" | "date" | "email" | "tel";
  inputMode?: "text" | "numeric" | "tel";
  maxLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
  options?: string[]; // datalist: sugerencias sin cerrar el campo
  hint?: ReactNode;
  className?: string;
}) {
  const listId = props.options ? `${props.field.name}-opciones` : undefined;
  return (
    <Wrapper htmlFor={props.field.name} label={props.label} hint={props.hint}>
      <Input
        {...props.field}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        autoComplete="off"
        list={listId}
        className={props.className}
      />
      {listId && (
        <datalist id={listId}>
          {props.options?.map((o) => <option key={o} value={o} />)}
        </datalist>
      )}
    </Wrapper>
  );
}

// Texto largo (los textos legales del wizard ASOCIATE). Controlado igual que
// `TextField`: el valor vive en `useSyncedForm`, así que el reset de React 19 no
// le borra al superadmin un pliego de veinte mil caracteres cuando la action
// rechaza por otro campo.
export function TextareaField(props: {
  label: string;
  field: FieldBinding;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Wrapper htmlFor={props.field.name} label={props.label} hint={props.hint}>
      <Textarea
        {...props.field}
        rows={props.rows}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        className={props.className}
      />
    </Wrapper>
  );
}

export function SelectField(props: {
  label: string;
  field: FieldBinding;
  options: Array<[string, string]>;
  autoFocus?: boolean;
  hint?: ReactNode;
}) {
  return (
    <Wrapper htmlFor={props.field.name} label={props.label} hint={props.hint}>
      <select
        {...props.field}
        autoFocus={props.autoFocus}
        className="h-9 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs"
      >
        {props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Wrapper>
  );
}
