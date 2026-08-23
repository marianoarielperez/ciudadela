"use server";
// Las tres acciones de Otros ingresos: registrar lo que se cobró en la sede,
// corregir el texto de un registro y anularlo.
//
// La regla vive en `@/lib/treasury/other-income`; acá se valida la forma, se
// traduce el resultado a una frase para el operador y se AUDITA. La auditoría es
// de esta capa a propósito: el módulo no ve los encabezados del request, así que
// no puede asentar la IP.
//
// En el asiento van ids, montos y códigos. NUNCA el concepto ni la nota: son
// texto libre del operador y pueden nombrar a un tercero —el inquilino del
// salón— (Ley 25.326, docs/08). Quedan en el registro, que lo lee sólo el panel.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { parseForm } from "@/lib/forms";
import { otherIncome, OtherIncomeError } from "@/lib/treasury/other-income";
import { civilDayOf } from "@/lib/treasury/periods";

type State = { error?: string };

const BASE = "/admin/tesoreria/otros-ingresos";

async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Del error se loguea SOLO el código o el nombre: el `message` de Prisma vuelca
// los argumentos de la consulta, y ahí va el texto libre del operador.
function errCode(e: unknown): string {
  const o = e as { code?: unknown; name?: unknown } | null;
  if (typeof o?.code === "string") return o.code;
  if (typeof o?.name === "string") return o.name;
  return "unknown";
}

// Todo mensaje va explícito y en castellano, incluida la COERCIÓN: sin mensaje
// propio, un valor que no es número llega a zod como NaN y el operador lee
// "Invalid input: expected number, received NaN" en pantalla.
//
// El monto es en pesos enteros, igual que el de Efectivo y el valor de cuota de
// Configuración: con centavos habría que decidir si la coma es decimal o
// separador de miles, y equivocarse ahí registra de más sin que nadie lo note.
const registerSchema = z.object({
  amount: z.coerce
    .number("Ingresá el monto del ingreso.")
    .int("El monto tiene que ser un número entero de pesos.")
    .positive("Ingresá el monto del ingreso."),
  receivedAt: z
    .string("Ingresá la fecha del ingreso.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá la fecha del ingreso."),
  concept: z
    .string("Ingresá a qué corresponde el ingreso.")
    .min(3, "Ingresá a qué corresponde el ingreso.")
    .max(200, "El concepto no puede superar los 200 caracteres."),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
});

export async function registerOtherIncomeAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(registerSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // El regex del schema es sólo de forma: `parseCivilDate` es el que rechaza el
  // día que no existe y el año mal tipeado, y devuelve el mediodía UTC con el
  // que se guardan todas las fechas civiles del proyecto. El tope es HOY en el
  // calendario argentino: una plata que todavía no entró no se registra.
  const receivedAt = parseCivilDate(parsed.data.receivedAt, {
    minYear: 2015,
    maxDate: civilDayOf(),
    invalidError: "La fecha del ingreso no es válida.",
    rangeError: "La fecha del ingreso tiene que estar entre 2015 y hoy.",
  });
  if (!receivedAt.ok) return { error: receivedAt.error };

  let result;
  try {
    result = await otherIncome.record({
      amount: parsed.data.amount,
      receivedAt: receivedAt.value,
      concept: parsed.data.concept,
      method: "cash",
      note: parsed.data.note ?? null,
      actorId: actor.actorId,
    });
  } catch (e) {
    // Las reglas ya vienen redactadas en es-AR desde el módulo; lo demás es un
    // error nuestro y no se le muestra crudo al operador.
    if (e instanceof OtherIncomeError) return { error: e.message };
    console.error("[other-income] record falló", errCode(e));
    return { error: "No se pudo registrar el ingreso. Reintentá en un momento." };
  }

  await audit({
    userId: actor.actorId,
    action: "other_income_create",
    entity: "other_income",
    entityId: result.id,
    // Sin concepto ni nota. `receivedAt` va como fecha civil, que es lo que el
    // operador cargó.
    detail: { amount: parsed.data.amount, method: "cash", receivedAt: parsed.data.receivedAt },
    ip: await clientIp(),
  });
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`${BASE}?registrado=1`);
}

// Corregir SÓLO el texto: concepto y nota. El monto, la fecha, el medio y el
// `mpPaymentId` no se editan — para cambiar cualquiera de esos el camino sigue
// siendo anular y registrar de nuevo.
const editSchema = z.object({
  incomeId: z.coerce
    .number("No pudimos identificar el ingreso.")
    .int("No pudimos identificar el ingreso.")
    .positive("No pudimos identificar el ingreso."),
  concept: z
    .string("Ingresá a qué corresponde el ingreso.")
    .min(3, "Ingresá a qué corresponde el ingreso.")
    .max(200, "El concepto no puede superar los 200 caracteres."),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
});

export async function editOtherIncomeAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(editSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  let result;
  try {
    result = await otherIncome.edit({
      id: parsed.data.incomeId,
      concept: parsed.data.concept,
      note: parsed.data.note ?? null,
    });
  } catch (e) {
    if (e instanceof OtherIncomeError) return { error: e.message };
    console.error("[other-income] edit falló", errCode(e));
    return { error: "No se pudo guardar la corrección. Reintentá en un momento." };
  }
  if (result.kind === "not_found") return { error: "Ese ingreso ya no existe." };
  if (result.kind === "voided") {
    return { error: "Ese ingreso está anulado: un asiento anulado no se corrige." };
  }

  await audit({
    userId: actor.actorId,
    action: "other_income_edit",
    entity: "other_income",
    entityId: parsed.data.incomeId,
    // Ni el concepto nuevo ni el viejo: son texto libre y pueden nombrar a un
    // tercero. Lo que queda escrito es QUÉ campos pudo tocar esta acción, que es
    // el alcance de la corrección — el monto y la fecha no están en la lista.
    detail: { fields: ["concept", "note"] },
    ip: await clientIp(),
  });
  redirect(`${BASE}?corregido=1`);
}

const voidSchema = z.object({
  incomeId: z.coerce
    .number("No pudimos identificar el ingreso.")
    .int("No pudimos identificar el ingreso.")
    .positive("No pudimos identificar el ingreso."),
  reason: z
    .string("Indicá el motivo de la anulación.")
    .min(3, "Indicá el motivo de la anulación.")
    .max(200, "El motivo no puede superar los 200 caracteres."),
});

export async function voidOtherIncomeAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(voidSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  let result;
  try {
    result = await otherIncome.void({
      id: parsed.data.incomeId,
      actorId: actor.actorId,
      reason: parsed.data.reason,
    });
  } catch (e) {
    if (e instanceof OtherIncomeError) return { error: e.message };
    console.error("[other-income] void falló", errCode(e));
    return { error: "No se pudo anular el ingreso. Reintentá en un momento." };
  }
  if (result.kind === "not_found") return { error: "Ese ingreso ya no existe." };
  if (result.kind === "already_voided") return { error: "Ese ingreso ya está anulado." };

  await audit({
    userId: actor.actorId,
    action: "other_income_void",
    entity: "other_income",
    entityId: parsed.data.incomeId,
    // El motivo NO va: es texto libre. `reopened` sí, porque es la única huella
    // de que una fila de la bandeja volvió a Pendientes por esta anulación.
    detail: { reopened: result.reopened },
    ip: await clientIp(),
  });
  redirect(`${BASE}?anulado=1`);
}
