// Única puerta de escritura de `member_requests` (M5B): crear, retirar,
// aceptar y rechazar. Las guardas de negocio no viven acá — las presta
// `member-requests/rules.ts` — este módulo sólo resuelve datos reales (la
// ficha viva, la deuda, el número del libro abierto) y garantiza la
// invariante "una pendiente por tipo por socio" contra la base.
//
// Mismo patrón de inyección que `mp/link-subscription.ts`: el factory recibe
// `db` para poder testearse con fakes (`@/lib/prisma` tira al importarse sin
// `DATABASE_URL`, así que un test puro no puede importar el cliente real), y
// el singleton del final liga las dependencias reales.
import type { MemberCategory, MemberRequestType, PrismaClient } from "@/generated/prisma/client";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { canCreateRequest, renderWithdrawalText } from "@/lib/members/member-requests/rules";
import {
  collaboratorEnabled as checkCollaboratorEnabled,
  electionsOngoing as checkElectionsOngoing,
} from "@/lib/members/service";
import { prisma } from "@/lib/prisma";

type Deps = {
  db: Pick<PrismaClient, "$transaction" | "memberRequest" | "member" | "fee" | "movement">;
  electionsOngoing: () => Promise<boolean>;
  /** La llave `colaborador_habilitado` (spec 2026-09-02), inyectada como
   *  `electionsOngoing`: bandera global de `Configuration`, no dato del socio. */
  collaboratorEnabled: () => Promise<boolean>;
  now?: () => Date;
};

export type CreateResult = { ok: true; requestId: number } | { ok: false; error: string };
export type CancelResult = { ok: true } | { ok: false; error: string };
export type RejectResult =
  | { ok: true; memberId: number; type: MemberRequestType }
  | { ok: false; error: string };

// Mensaje único para "no hay nada pendiente de este socio con este id que se
// pueda tocar": ni cancel ni reject distinguen "no existe" de "ya se decidió"
// en la respuesta — el socio (o el operador) no gana nada con esa diferencia,
// y no distinguirlos evita enumerar ids de solicitudes ajenas por tanteo.
const NOT_PENDING = "La solicitud ya fue resuelta o no existe.";

// Un débito o un pedido de baja usa el mismo nombre de tipo en `MemberRequestType`
// y en `MovementType` a propósito (ver schema.prisma): la traducción es directa.
function movementTypeFor(type: MemberRequestType): "withdrawal" | "category_change" {
  return type;
}

export function makeMemberRequests(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  return {
    /** Corre bajo un mutex propio por socio y DENTRO de una transacción:
     *  relee la ficha viva, cuenta lo pendiente y recién ahí decide. El mutex
     *  serializa dos pedidos simultáneos del mismo socio y la cuenta DENTRO de
     *  la transacción es lo que hace que el segundo vea el primero — MariaDB
     *  no tiene índice único parcial para "una pendiente por tipo", así que la
     *  garantía es enteramente de aplicación. */
    async create(input: {
      memberId: number;
      type: MemberRequestType;
      requestedCategory?: MemberCategory | null;
      message?: string | null;
    }): Promise<CreateResult> {
      // No necesitan la foto de la transacción: son banderas globales de
      // `Configuration`, no datos del socio, mismo criterio que
      // `changeCategory` en `members/service.ts` (se leen antes de abrir la
      // transacción, no adentro).
      const [electionsAreOngoing, collaboratorIsEnabled] = await Promise.all([
        deps.electionsOngoing(),
        deps.collaboratorEnabled(),
      ]);
      return requestMutex.run(`request:${input.memberId}`, () =>
        db.$transaction(async (tx) => {
          const member = await tx.member.findUnique({
            where: { id: input.memberId },
            select: {
              fullName: true,
              status: true,
              category: true,
              // El número que va en el escrito de renuncia es el del libro
              // ABIERTO (mismo criterio que `mi/page.tsx` y `treasury/debtors.ts`):
              // un socio migrado de libro puede tener más de una membresía.
              memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
            },
          });
          if (!member) return { ok: false as const, error: "El socio no existe." };

          const [hasPendingOfType, pendingFees] = await Promise.all([
            tx.memberRequest
              .count({ where: { memberId: input.memberId, type: input.type, status: "pending" } })
              .then((n) => n > 0),
            tx.fee.count({ where: { memberId: input.memberId, status: "pending" } }),
          ]);

          const requestedCategory = input.requestedCategory ?? null;
          const check = canCreateRequest({
            type: input.type,
            member: { status: member.status, category: member.category },
            requestedCategory,
            electionsOngoing: electionsAreOngoing,
            pendingFees,
            collaboratorEnabled: collaboratorIsEnabled,
            hasPendingOfType,
          });
          if (!check.ok) return { ok: false as const, error: check.error };

          const text =
            input.type === "withdrawal"
              ? renderWithdrawalText({
                  fullName: member.fullName,
                  memberNumber: member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null,
                  date: now(),
                  message: input.message ?? null,
                })
              : // requestedCategory ya pasó por canCreateRequest: no es null acá.
                `Solicita el cambio de categoría de ${CATEGORY_LABELS[member.category]} a ${CATEGORY_LABELS[requestedCategory as MemberCategory]}.`;

          const created = await tx.memberRequest.create({
            data: {
              memberId: input.memberId,
              type: input.type,
              status: "pending",
              requestedCategory: input.type === "category_change" ? requestedCategory : null,
              message: input.message ?? null,
              text,
            },
          });
          return { ok: true as const, requestId: created.id };
        }),
      );
    },

    /** El `memberId` en el `where` es la guarda de pertenencia: nunca cancela
     *  la solicitud de otro. `count === 0` cubre tanto "no existe" como "ya no
     *  está pendiente" con el mismo mensaje genérico. */
    async cancel(input: { memberId: number; requestId: number }): Promise<CancelResult> {
      const result = await db.memberRequest.updateMany({
        where: { id: input.requestId, memberId: input.memberId, status: "pending" },
        data: { status: "cancelled", cancelledAt: now() },
      });
      if (result.count === 0) return { ok: false, error: NOT_PENDING };
      return { ok: true };
    },

    /** Se llama DESPUÉS de que el servicio estatutario (`memberService.withdraw`
     *  o `.changeCategory`) ya commiteó: el `Movement` que corresponde siempre
     *  existe para cuando esto corre. Se toma el más nuevo del socio con el
     *  `type` correcto — no cualquiera, porque un socio puede tener movimientos
     *  de otro tipo más recientes (una baja después de un cambio de categoría
     *  viejo, por ejemplo). */
    async markAccepted(input: {
      requestId: number;
      memberId: number;
      decidedById: number;
      type: MemberRequestType;
    }): Promise<void> {
      const movement = await db.movement.findFirst({
        where: { memberId: input.memberId, type: movementTypeFor(input.type) },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      // `updateMany` con `memberId` y `status` en el WHERE, no `update` por id:
      // el par requestId/memberId lo arma el llamador (la action del panel), y
      // si alguna vez lo tomara de dos fuentes distintas —el id del formulario y
      // el socio de la ficha— un `update` por id solo le marcaría aceptada la
      // solicitud a OTRO socio y le colgaría un movimiento ajeno. El `status`
      // cierra la otra mitad: una solicitud que el socio ya retiró no puede
      // resucitar como aceptada. Misma guarda por `where` que `cancel`.
      const applied = await db.memberRequest.updateMany({
        where: { id: input.requestId, memberId: input.memberId, status: "pending" },
        data: {
          status: "accepted",
          decidedAt: now(),
          decidedById: input.decidedById,
          // `?? null` es defensivo: si el llamador se equivocó de orden y esto
          // corrió antes de que el movimiento se commiteara, la solicitud
          // igual queda aceptada en vez de reventar — pero sin movimiento no
          // hay forma de que la pantalla explique por acta cuál fue.
          movementId: movement?.id ?? null,
        },
      });
      // Best-effort con fallo VISIBLE en el log (doctrina de CLAUDE.md): acá no
      // hay pantalla que lo cuente —la firma es `void` a propósito, porque el
      // acta ya commiteó y reventar dejaría la aceptación a mitad de camino—,
      // así que el log de PM2 es el único lugar donde un error de orden del
      // llamador se vuelve diagnosticable.
      if (applied.count === 0) {
        console.error("[solicitudes] markAccepted no encontró la solicitud pendiente —", {
          requestId: input.requestId, memberId: input.memberId, type: input.type,
        });
      } else if (!movement) {
        console.error("[solicitudes] aceptada sin movimiento asociado —", {
          requestId: input.requestId, memberId: input.memberId, type: input.type,
        });
      }
    },

    /** Sólo actúa sobre `pending`, con la misma guarda por `where` que `cancel`
     *  (evita la ventana entre leer y escribir). `memberId`/`type` no cambian
     *  después de creada la solicitud, así que leerlos ANTES del update —y no
     *  del resultado del update, que Prisma no devuelve— es seguro. */
    async reject(input: { requestId: number; decidedById: number; note?: string | null }): Promise<RejectResult> {
      const request = await db.memberRequest.findUnique({
        where: { id: input.requestId },
        select: { memberId: true, type: true },
      });
      if (!request) return { ok: false, error: NOT_PENDING };
      const result = await db.memberRequest.updateMany({
        where: { id: input.requestId, status: "pending" },
        data: { status: "rejected", decidedAt: now(), decidedById: input.decidedById, decisionNote: input.note ?? null },
      });
      if (result.count === 0) return { ok: false, error: NOT_PENDING };
      return { ok: true, memberId: request.memberId, type: request.type };
    },
  };
}

// Un solo proceso (premisa de docs/03): el mutex vive en memoria, mismo
// criterio que `memberMutex` de `treasury/service.ts`. Clave propia
// (`request:*` en vez de `member:*`) para no compartir cola con los cobros:
// un socio pagando y pidiendo la baja al mismo tiempo son cosas independientes.
const requestMutex = createKeyedMutex();

export type MemberRequestsService = ReturnType<typeof makeMemberRequests>;

export const memberRequests = makeMemberRequests({
  db: prisma,
  electionsOngoing: () => checkElectionsOngoing(prisma),
  collaboratorEnabled: () => checkCollaboratorEnabled(prisma),
});
