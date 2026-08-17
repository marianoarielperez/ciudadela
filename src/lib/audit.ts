import type { Prisma, PrismaClient } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"

export type AuditEntry = {
  userId?: number | null
  action: string
  entity?: string
  entityId?: string | number
  detail?: unknown
  ip?: string | null
}

type Db = Pick<PrismaClient, "auditLog">

export function makeAudit(db: Db) {
  return async function audit(entry: AuditEntry): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId === undefined ? undefined : String(entry.entityId),
          detail: entry.detail as Prisma.InputJsonValue | undefined,
          ip: entry.ip ?? undefined,
        },
      })
    } catch (err) {
      // La auditoría nunca rompe el flujo principal
      console.error("[audit] failed to persist entry", entry.action, err)
    }
  }
}

export const audit = makeAudit(prisma)
