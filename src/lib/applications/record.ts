// El asiento en acta de una solicitud: el momento en que la Solicitud se
// convierte en Socio (alta) o en reingreso sobre la ficha existente (REG-25).
//
// TODO ocurre en UNA transacción por solicitud — no se reusa
// `memberService.admit`/`readmit` porque abren su propia transacción y el
// asiento necesita atomicidad entre el socio, la solicitud y la suscripción de
// MP (Prisma no anida `$transaction`; es el mismo dilema documentado en la
// cabecera de `src/app/admin/socios/[id]/actions.ts`). Las reglas puras SÍ se
// comparten: `canReadmit` y `requireOpenBook` son las mismas que corre el
// servicio, no una copia.
//
// Una solicitud por transacción y no todo el lote en una sola: el asiento es
// masivo y el rechazo de UNA (un expulsado que se anotó, un DNI que ya está en
// el padrón) no puede tirar abajo las otras veinte que la Comisión Directiva
// aprobó en la misma reunión. El resultado es por solicitud y la action arma el
// resumen.
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canReadmit } from "@/lib/members/rules";
import { requireOpenBook } from "@/lib/members/service";

export type RecordResult =
  | { ok: true; applicationId: number; memberId: number; memberNumber: number | null; reentry: boolean }
  | { ok: false; applicationId: number; error: string };

// Los dos estados desde los que una solicitud puede llegar al libro:
// `approved_pending_minute` (pagó y espera acta) y `pending_board` (la mira la
// Comisión Directiva). Se revalida DENTRO de la transacción: la bandeja es una
// pantalla masiva y dos admins pueden estar asentando el mismo lote.
export const RECORDABLE_STATUSES = ["approved_pending_minute", "pending_board"] as const;

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

// Del error de Prisma sólo se usa el código y el target: el objeto trae la
// consulta con los datos del solicitante en claro, y el log de PM2 no está
// cubierto por los cuidados de docs/08 (Ley 25.326).
function uniqueViolationTarget(e: unknown): string | null {
  if (typeof e !== "object" || e === null || !("code" in e) || e.code !== "P2002") return null;
  const meta = (e as { meta?: { target?: unknown } }).meta;
  return JSON.stringify(meta?.target ?? "");
}

export function makeApplicationRecorder(db: PrismaClient) {
  return {
    async recordOne(input: {
      applicationId: number; minuteId: number; actorId: number;
    }): Promise<RecordResult> {
      const { applicationId, minuteId, actorId } = input;
      try {
        return await db.$transaction(async (tx) => {
          const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
          if (!(RECORDABLE_STATUSES as readonly string[]).includes(app.status)) {
            throw new Error(`La solicitud #${app.id} ya fue resuelta o no está lista para asentar.`);
          }
          const minute = await tx.minute.findUniqueOrThrow({ where: { id: minuteId } });

          // La dirección de email viaja SIEMPRE a la ficha, verificada o no: es
          // la llave con la que el canje tardío del enlace de verificación
          // (`/verificar`) reconoce que sigue autorizando a esta ficha. El
          // estado, en cambio, cuelga del doble opt-in de la solicitud (REG-08):
          // sin confirmar nace `declared` y no sale ninguna invitación de acceso.
          const contactData = {
            fullName: app.fullName,
            dni: app.dni,
            birthDate: app.birthDate,
            civilStatus: app.civilStatus,
            nationality: app.nationality,
            occupation: app.occupation,
            phone: app.phone,
            email: app.email,
            emailStatus: (app.emailVerifiedAt ? "verified" : "declared") as "verified" | "declared",
            emailVerifiedAt: app.emailVerifiedAt,
            streetId: app.streetId,
            streetText: app.streetText,
            streetNumber: app.streetNumber,
            neighborhood: app.neighborhood,
            autoDebit: app.wantsDebit,
          };

          let memberId: number;
          let memberNumber: number | null = null;
          const reentry = app.memberId !== null;

          if (app.memberId !== null) {
            // ── REINGRESO sobre la ficha existente (REG-25) ──────────────────
            const member = await tx.member.findUniqueOrThrow({ where: { id: app.memberId } });
            const check = canReadmit(member);
            if (!check.ok) throw new Error(check.error);

            // Un ex socio que ya había confirmado ESTA misma dirección no la
            // pierde por no volver a hacer clic: la solicitud no verificada
            // degradaría a `declared` una casilla que la asociación ya tiene
            // acreditada como domicilio electrónico (Art. 5° quater), y lo
            // dejaría sin invitación al portal sin ningún motivo. Si la
            // dirección cambió, manda la de la solicitud y hay que verificarla.
            const keepsVerifiedAddress =
              !app.emailVerifiedAt &&
              member.emailStatus === "verified" &&
              normalizeEmail(member.email) === normalizeEmail(app.email);

            await tx.member.update({
              where: { id: member.id },
              data: {
                ...contactData,
                ...(keepsVerifiedAddress
                  ? { emailStatus: "verified" as const, emailVerifiedAt: member.emailVerifiedAt }
                  : {}),
                status: "active",
                category: app.requestedCategory,
                withdrawalReason: null,
                leftAt: null,
                // joinedAt NO se toca: el reingreso no reinicia la antigüedad
                // (REG-11). debtAtWithdrawal se conserva: el M4 lo usa para
                // calcular la deuda a saldar (REG-16).
              },
            });
            // Contracara del cerrojo de la baja: sin esto el socio readmitido
            // tendría el padrón en orden y el portal cerrado.
            if (member.userId) {
              await tx.user.update({ where: { id: member.userId }, data: { active: true } });
            }
            await tx.movement.create({
              data: {
                memberId: member.id, type: "readmission", date: minute.date, minuteId: minute.id,
                newCategory: app.requestedCategory, createdById: actorId,
                detail: `Reingreso vía solicitud web #${app.id}`,
              },
            });
            memberId = member.id;
          } else {
            // ── ALTA COMÚN: socio nuevo con el número siguiente del libro ────
            const book = await requireOpenBook(tx);
            const max = await tx.membership.aggregate({
              where: { bookId: book.id }, _max: { memberNumber: true },
            });
            const member = await tx.member.create({
              data: {
                ...contactData,
                category: app.requestedCategory,
                status: "active",
                joinedAt: minute.date, // REG-11: fecha de ingreso = fecha del acta
              },
            });
            memberNumber = (max._max.memberNumber ?? 0) + 1;
            await tx.membership.create({
              data: { memberId: member.id, bookId: book.id, memberNumber },
            });
            await tx.movement.create({
              data: {
                memberId: member.id, type: "admission", date: minute.date, minuteId: minute.id,
                newCategory: app.requestedCategory, createdById: actorId,
                detail: `Alta vía solicitud web #${app.id}`,
              },
            });
            memberId = member.id;
          }

          // Las dos escrituras que cierran el circuito, en la MISMA transacción
          // que el socio: `memberId` + `completed` es el contrato del que cuelga
          // la verificación tardía de email (`/verificar` busca por ahí la ficha
          // a la que propagar el canje).
          await tx.application.update({
            where: { id: app.id },
            data: { status: "completed", minuteId: minute.id, decidedAt: new Date(), memberId },
          });
          // La suscripción de MP se firmó cuando todavía no había ficha: ahora
          // pasa a colgar del socio, que es de quien se cobra la cuota.
          await tx.mpSubscription.updateMany({
            where: { applicationId: app.id },
            data: { memberId },
          });

          return { ok: true as const, applicationId, memberId, memberNumber, reentry };
        });
      } catch (e) {
        // Los choques de índice único salen de Prisma en inglés y con la
        // consulta adentro. Acá se traducen a lo único que el operador puede
        // hacer con ellos.
        const target = uniqueViolationTarget(e);
        if (target !== null) {
          if (/dni/i.test(target)) {
            return {
              ok: false, applicationId,
              error: `Ya existe un socio con el DNI de la solicitud #${applicationId}: revisala a mano.`,
            };
          }
          if (/member_number|memberNumber/i.test(target)) {
            return {
              ok: false, applicationId,
              error: `Otro asiento tomó el número de socio mientras se guardaba la solicitud #${applicationId}: reintentá.`,
            };
          }
          return {
            ok: false, applicationId,
            error: `La solicitud #${applicationId} choca con un dato ya registrado: revisala a mano.`,
          };
        }
        return {
          ok: false, applicationId,
          error: e instanceof Error ? e.message : "Error inesperado al asentar la solicitud.",
        };
      }
    },
  };
}

export const applicationRecorder = makeApplicationRecorder(prisma);
