// Ciclo de vida de la Solicitud de alta web. Mismo patrón que members/service:
// factory con un Prisma "pick", transacciones con callback, singleton al final.
import { randomBytes } from "node:crypto";
import type { Application, ApplicationStatus, MemberCategory, PrismaClient } from "@/generated/prisma/client";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

// Estados en los que la solicitud "existe" para el vecino y para la unicidad
// por DNI. rejected/expired/completed no bloquean una solicitud nueva
// (completed no llega a molestar: ahí el DNI ya es socio vigente y lo frena
// la elegibilidad).
export const LIVE_APPLICATION_STATUSES: ApplicationStatus[] = [
  "started", "pending_payment", "approved_pending_minute", "pending_board",
];

export class DuplicateLiveApplicationError extends Error {
  constructor() {
    super("Ya tenés una solicitud en trámite.");
    this.name = "DuplicateLiveApplicationError";
  }
}

export type CreateApplicationInput = {
  fullName: string; dni: string; birthDate: Date; civilStatus: string; nationality: string;
  occupation: string; phone: string; email: string;
  streetId: number | null; streetText: string | null; streetNumber: string | null;
  neighborhood: string | null;
  requestedCategory: MemberCategory; wantsDebit: boolean;
  memberId: number | null; acceptedTermsAt: Date; ip: string; userAgent: string;
};

type Db = Pick<PrismaClient, "application" | "$transaction">;

// Serializa los `create` que comparten DNI. Es el mutex —no la transacción— lo
// que hace atómico el "chequear y crear": en InnoDB con REPEATABLE READ el
// `findFirst` es una lectura consistente SIN locks, así que dos transacciones
// simultáneas del mismo DNI ven las dos `null` y las dos insertan; y
// `Application.dni` no es unique a propósito (el mismo vecino puede tener una
// rechazada vieja y una viva), así que la base tampoco las atrapa. La
// transacción sigue estando por lo suyo: que el chequeo y el INSERT vean la
// misma foto y que un fallo no deje media escritura.
//
// Premisa: PM2 corre un único proceso (misma que documenta
// `auth/rate-limiter.ts`). Si se clusteriza, este mutex deja de garantizar
// nada y hay que mover la exclusión a la base — índice único parcial mantenido
// por la app sobre (dni, estado vivo), o lock distribuido.
// Anclado a `globalThis` con el mismo criterio que el cliente de Prisma
// (`src/lib/prisma.ts`): si el módulo se re-evalúa dentro del MISMO proceso
// —el HMR de `next dev` lo hace en cada guardado— dos instancias serían dos
// colas distintas y la exclusión se perdería sin ruido. En los limitadores eso
// sólo afloja una cuota; acá reabre la carrera que este mutex existe para
// cerrar, así que la instancia tiene que ser una sola por proceso.
const globalForMutex = globalThis as unknown as { applicationMutex?: ReturnType<typeof createKeyedMutex> };
const applicationMutex = globalForMutex.applicationMutex ?? createKeyedMutex();
globalForMutex.applicationMutex = applicationMutex;

export function makeApplicationService(db: Db) {
  return {
    // La unicidad "una sola viva por DNI" se revalida acá adentro: la
    // elegibilidad de la action corre antes y sin exclusión, dos POST
    // simultáneos del mismo DNI pasan los dos el chequeo externo (patrón
    // requireOpenBook).
    async create(input: CreateApplicationInput): Promise<{ id: number; resumeToken: string }> {
      return applicationMutex.run(input.dni, async () => {
        const raw = randomBytes(32).toString("base64url");
        const created = await db.$transaction(async (tx) => {
          const live = await tx.application.findFirst({
            where: { dni: input.dni, status: { in: LIVE_APPLICATION_STATUSES } },
            select: { id: true },
          });
          if (live) throw new DuplicateLiveApplicationError();
          // Sólo el sha256 se persiste: el crudo vuelve al caller (enlace de
          // retome) y no queda en la base ni en los logs de Prisma.
          return tx.application.create({
            data: { ...input, resumeTokenHash: hashToken(raw) },
          });
        });
        return { id: created.id, resumeToken: raw };
      });
    },

    async findLiveByDni(dni: string): Promise<{ id: number; email: string } | null> {
      const app = await db.application.findFirst({
        where: { dni, status: { in: LIVE_APPLICATION_STATUSES } },
        select: { id: true, email: true },
      });
      return app;
    },

    // Para el bloqueo REG-05 de no-socios: fecha de la última rechazada.
    async lastRejectionAt(dni: string): Promise<Date | null> {
      const app = await db.application.findFirst({
        where: { dni, status: "rejected", decidedAt: { not: null } },
        orderBy: { decidedAt: "desc" },
        select: { decidedAt: true },
      });
      return app?.decidedAt ?? null;
    },

    async findByResumeToken(raw: string): Promise<Application | null> {
      return db.application.findUnique({ where: { resumeTokenHash: hashToken(raw) } });
    },

    // UPDATE condicional (patrón tokens.consume): dos clics en el enlace de
    // verificación no escriben dos veces.
    async verifyEmail(applicationId: number, now: Date = new Date()): Promise<void> {
      await db.application.updateMany({
        where: { id: applicationId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
    },
  };
}

export const applicationService = makeApplicationService(prisma);
