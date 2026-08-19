"use client";

import { useActionState, useState } from "react";

import { resetPasswordAction, type ResetState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ResetState, FormData>(resetPasswordAction, {});
  // React 19 resetea el <form action> cuando la server action termina: con
  // inputs NO controlados, equivocarse al repetir la contraseña borraría las dos
  // que la persona acaba de tipear. Controlados, el valor lo pone el estado y
  // sobrevive al reset (mismo criterio que /acceso/[token]/password-form.tsx).
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      {/* El token viaja en un hidden y no se lee de la URL en el cliente: la
          action es un endpoint y tiene que recibir todo lo que necesita. */}
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña nueva</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Mínimo {MIN_PASSWORD_LENGTH} caracteres. No uses la misma que en otros sitios.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Repetí la contraseña</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Guardando…" : "Guardar contraseña"}
      </Button>
    </form>
  );
}
