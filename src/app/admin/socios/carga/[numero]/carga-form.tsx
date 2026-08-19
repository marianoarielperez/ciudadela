"use client";
// Modo carga. La Comisión tiene que pasar 160 fichas de papel a la base, y el
// criterio de aceptación es menos de 2 minutos por ficha, así que todo acá está
// puesto para no perder segundos ni datos:
//
//   - Un solo estado controlado para todos los campos (useSyncedForm), que
//     además deja resueltos los <select> frente al reset de React 19: un error
//     de validación no puede borrar lo copiado del papel.
//   - Ctrl+S guarda sin sacar las manos del teclado.
//   - El foco arranca en el primer campo vacío: en el padrón importado casi
//     siempre es el DNI o el domicilio, no el nombre.
//   - Ir al socio anterior/siguiente con cambios sin guardar pide confirmación.
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendVerificationAction, updateMemberAction, type SaveState, type SendState } from "./actions";
import { StreetAutocomplete, type StreetOption } from "@/components/admin/street-autocomplete";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { EMAIL_STATUS_LABELS } from "@/lib/members/labels";
import type { EmailStatus } from "@/generated/prisma/client";

export type MemberData = {
  id: number; fullName: string; dni: string | null; birthDate: string | null;
  civilStatus: string | null; nationality: string | null; occupation: string | null;
  phone: string | null; streetId: number | null; streetText: string | null;
  streetNumber: string | null; neighborhood: string | null; email: string | null;
  emailStatus: EmailStatus;
};

const CIVIL_STATUS = ["Soltero/a", "Casado/a", "Divorciado/a", "Viudo/a", "Separado/a", "Unión convivencial"];
const NATIONALITIES = ["Argentina", "Boliviana", "Chilena", "Paraguaya", "Peruana", "Uruguaya", "Brasileña", "Venezolana"];
const NEIGHBOURHOODS = ["Ciudadela", "Pueyrredón", "Standard", "Roca", "General Mosconi", "Laprida"];

// El orden de tabulación es el orden del DOM, y el orden del DOM es el de la
// ficha de papel: quien carga lee de arriba a abajo y no debería tener que
// buscar el próximo campo con el mouse.
const FIELD_ORDER = [
  "dni", "birthDate", "civilStatus", "nationality", "occupation",
  "phone", "street", "streetNumber", "neighborhood", "email",
] as const;

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

// Un valor viejo que no está en la lista (el padrón trae "Soltero" sin barra)
// tiene que seguir siendo una opción: si no, el select mostraría vacío y al
// guardar borraría un dato que nadie pidió borrar.
function civilStatusOptions(current: string | null): Array<[string, string]> {
  const values = [...CIVIL_STATUS];
  if (current && !values.includes(current)) values.unshift(current);
  return [["", "—"], ...values.map((v) => [v, v] as [string, string])];
}

export function CargaForm(props: {
  member: MemberData;
  streets: StreetOption[];
  prevNumber: number | null;
  nextNumber: number | null;
}) {
  const { member, streets } = props;
  const router = useRouter();
  const [saveState, saveAction, saving] = useActionState<SaveState, FormData>(updateMemberAction, {});
  const [sendState, sendAction, sending] = useActionState<SendState, FormData>(sendVerificationAction, {});
  // "Editado desde el último envío". Se apaga en el submit y no en un efecto:
  // apagarlo cuando vuelve la action haría un render en cascada y, peor, dejaría
  // el aviso "Guardado ✓" un instante al lado de un campo ya modificado.
  const [edited, setEdited] = useState(false);
  // Un guardado que falló deja los datos igual de perdidos que no haber
  // guardado nunca: para avisar antes de salir cuenta como pendiente.
  const unsaved = edited || Boolean(saveState.error);

  const { field, formRef } = useSyncedForm({
    fullName: member.fullName ?? "",
    dni: member.dni ?? "",
    birthDate: member.birthDate ?? "",
    civilStatus: member.civilStatus ?? "",
    nationality: member.nationality ?? "",
    occupation: member.occupation ?? "",
    phone: member.phone ?? "",
    streetNumber: member.streetNumber ?? "",
    neighborhood: member.neighborhood ?? "",
    email: member.email ?? "",
  });

  const filled: Record<(typeof FIELD_ORDER)[number], boolean> = {
    dni: !!member.dni, birthDate: !!member.birthDate, civilStatus: !!member.civilStatus,
    nationality: !!member.nationality, occupation: !!member.occupation, phone: !!member.phone,
    street: !!(member.streetId || member.streetText), streetNumber: !!member.streetNumber,
    neighborhood: !!member.neighborhood, email: !!member.email,
  };
  const focusOn: string = FIELD_ORDER.find((name) => !filled[name]) ?? "fullName";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formRef]);

  useEffect(() => {
    if (!saveState.saved) return;
    // El encabezado y el botón de verificación se arman con lo que hay en la
    // base: sin refrescar, después de cargar un email el botón seguiría
    // deshabilitado y la pantalla estaría mintiendo sobre el estado del socio.
    router.refresh();
  }, [saveState, router]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // El aviso del navegador no corre en la navegación cliente de Next, y
  // anterior/siguiente es justamente por donde se sale de esta pantalla.
  function confirmLeave(e: React.MouseEvent) {
    if (unsaved && !window.confirm("Hay cambios sin guardar en esta ficha. ¿Salir igual?")) {
      e.preventDefault();
    }
  }

  const emailStatusLabel = EMAIL_STATUS_LABELS[member.emailStatus];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {props.prevNumber !== null ? (
          <Button asChild variant="outline">
            <Link href={`/admin/socios/carga/${props.prevNumber}`} onClick={confirmLeave}>← N° {props.prevNumber}</Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>← N° —</Button>
        )}
        {props.nextNumber !== null ? (
          <Button asChild variant="outline">
            <Link href={`/admin/socios/carga/${props.nextNumber}`} onClick={confirmLeave}>N° {props.nextNumber} →</Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>N° — →</Button>
        )}
      </div>

      <form
        ref={formRef} action={saveAction} className="max-w-3xl space-y-4"
        onInput={() => setEdited(true)} onSubmit={() => setEdited(false)}
      >
        <input type="hidden" name="memberId" value={member.id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField label="Apellido y nombre" field={field("fullName")} maxLength={160} autoFocus={focusOn === "fullName"} />
          </div>
          <TextField
            label="DNI" field={field("dni", digitsOnly)} inputMode="numeric" maxLength={9}
            placeholder="Sólo números" autoFocus={focusOn === "dni"}
          />
          {/* Sin el ícono del calendario: en Chrome es una parada de tabulación
              extra dentro del campo, y quien tabula rápido termina tipeando la
              nacionalidad ahí y perdiéndola. Para copiar una fecha de una ficha
              de papel el almanaque no sirve —nadie navega hasta 1962 a mano— así
              que se tipea y listo. */}
          <TextField
            label="Fecha de nacimiento" field={field("birthDate")} type="date"
            autoFocus={focusOn === "birthDate"}
            className="[&::-webkit-calendar-picker-indicator]:hidden"
          />
          <SelectField
            label="Estado civil" field={field("civilStatus")}
            options={civilStatusOptions(member.civilStatus)} autoFocus={focusOn === "civilStatus"}
          />
          <TextField
            label="Nacionalidad" field={field("nationality")} maxLength={60}
            options={NATIONALITIES} autoFocus={focusOn === "nationality"}
          />
          <TextField label="Ocupación" field={field("occupation")} maxLength={80} autoFocus={focusOn === "occupation"} />
          <TextField
            label="Teléfono" field={field("phone")} type="tel" inputMode="tel" maxLength={40}
            autoFocus={focusOn === "phone"}
          />
          <StreetAutocomplete
            streets={streets} defaultStreetId={member.streetId} defaultStreetText={member.streetText}
            autoFocus={focusOn === "street"}
          />
          <TextField label="Altura" field={field("streetNumber")} inputMode="numeric" maxLength={10} autoFocus={focusOn === "streetNumber"} />
          <TextField
            label="Barrio" field={field("neighborhood")} maxLength={60}
            options={NEIGHBOURHOODS} autoFocus={focusOn === "neighborhood"}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Email" field={field("email")} type="email" maxLength={191}
              autoFocus={focusOn === "email"}
              hint={member.email ? `Guardado: ${emailStatusLabel}` : undefined}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar (Ctrl+S)"}</Button>
          {/* El aviso desaparece en cuanto se vuelve a tipear: un "Guardado ✓"
              al lado de un campo ya modificado es una mentira. */}
          {saveState.saved && !edited && !saveState.unchanged && (
            <span role="status" className="text-sm font-medium text-green-700 dark:text-green-500">Guardado ✓</span>
          )}
          {saveState.saved && !edited && saveState.unchanged && (
            <span role="status" className="text-sm text-muted-foreground">Sin cambios que guardar</span>
          )}
          {saveState.error && <span role="alert" className="text-sm text-destructive">{saveState.error}</span>}
          {edited && !saving && <span className="text-sm text-muted-foreground">Cambios sin guardar</span>}
        </div>
      </form>

      <form action={sendAction} className="flex max-w-3xl flex-wrap items-center gap-3 border-t pt-4">
        <input type="hidden" name="memberId" value={member.id} />
        <Button
          type="submit" variant="outline"
          disabled={sending || !member.email || member.emailStatus === "verified"}
        >
          {sending ? "Enviando…" : "Enviar verificación + invitación de acceso"}
        </Button>
        {member.emailStatus === "verified" && (
          <span className="text-sm text-green-700 dark:text-green-500">Email verificado ✓</span>
        )}
        {!member.email && (
          <span className="text-sm text-muted-foreground">Cargá el email y guardá la ficha para poder enviarlo.</span>
        )}
        {member.email && edited && (
          <span className="text-sm text-muted-foreground">Se envía al email guardado ({member.email}).</span>
        )}
        {sendState.sent && <span role="status" className="text-sm text-green-700 dark:text-green-500">Enviado ✓</span>}
        {sendState.error && <span role="alert" className="text-sm text-destructive">{sendState.error}</span>}
      </form>
    </div>
  );
}
