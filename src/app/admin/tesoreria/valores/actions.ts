"use server";
// Lote REG-34: la ÚNICA escritura del sistema que le cambia a un vecino cuánto
// le van a debitar todos los meses de su tarjeta.
//
// Por eso es superadmin y no admin común, aunque la pantalla de Valores la vea
// el admin: mirar con qué se cobra es consulta; cambiarle el débito a 160
// personas no lo es.
//
// Se invoca desde el cliente con un OBJETO, no con FormData: no hay formulario
// que llenar, hay una cola que vaciar, y el botón de la pantalla reinvoca tanda
// por tanda. Igual es un endpoint público despachado por el id de
// `Next-Action`, así que se autoriza y se valida acá adentro.
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { feeValueBatch } from "@/lib/mp/fee-value-batch";
import { prisma } from "@/lib/prisma";

// Acción de auditoría de la tanda. Hay una por tanda, no una por suscripción:
// lo que se decidió fue "aplicar el valor", y el detalle lleva el desglose.
//
// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (es un endpoint), y una constante exportada rompe el build.
const FEE_VALUE_APPLIED = "fee_value_applied";

// `only` es la lista de suscripciones a mirar, no de montos a cobrar: el monto
// lo recalcula el servidor. El regex es el mismo formato de preapproval que usa
// el resto del módulo — sin él, el texto del cliente llegaría entero a la API
// de Mercado Pago. Mensajes en castellano porque una action es un endpoint
// público y el texto por defecto de zod está en inglés.
const schema = z.object({
  only: z
    .array(
      z
        .string("El pedido no es válido.")
        .regex(/^[a-z0-9-]{1,64}$/, "El pedido no es válido."),
      "El pedido no es válido.",
    )
    .max(200, "El pedido no es válido.")
    .optional(),
});

export type BatchResult =
  | {
      updated: number;
      /** El nombre se muestra en pantalla (que es panel de admin) y NO va al
       *  asiento. Sale de la base, nunca del cliente. */
      failed: Array<{ preapprovalId: string; memberId: number; fullName: string; code: string }>;
      remaining: number;
    }
  | { error: string };

export async function applyFeeValueBatchAction(raw: unknown): Promise<BatchResult> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) return { error: "Pedido inválido." };

  const r = await feeValueBatch.run({ only: parsed.data.only });

  // Los nombres de las que fallaron, para que el operador sepa a QUIÉN
  // reintentarle. Se consultan sólo si hubo fallos.
  const names =
    r.failed.length === 0
      ? new Map<number, string>()
      : new Map(
          (
            await prisma.member.findMany({
              where: { id: { in: r.failed.map((f) => f.memberId) } },
              select: { id: true, fullName: true },
            })
          ).map((m) => [m.id, m.fullName] as const),
        );

  // Sólo X-Real-IP, como en el resto del panel: las demás cabeceras de IP las
  // puede fijar el cliente si le pega directo al origen.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: FEE_VALUE_APPLIED,
    entity: "mp_subscription",
    // Ids, montos y códigos. NUNCA nombres, emails ni el `reason` de la
    // suscripción (docs/08, Ley 25.326): el asiento se exporta y se lee fuera
    // del panel.
    detail: {
      updated: r.updated,
      failed: r.failed.map((f) => ({ preapprovalId: f.preapprovalId, memberId: f.memberId, code: f.code })),
      remaining: r.remaining,
    },
    ip,
  });

  return {
    updated: r.updated,
    remaining: r.remaining,
    failed: r.failed.map((f) => ({ ...f, fullName: names.get(f.memberId) ?? `Socio ${f.memberId}` })),
  };
}
