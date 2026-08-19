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

function auditData(entry: AuditEntry) {
  return {
    userId: entry.userId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId === undefined ? undefined : String(entry.entityId),
    // Prisma rechaza un null pelado en columnas Json?: hay que omitirlo.
    detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    ip: entry.ip ?? undefined,
  }
}

export function makeAudit(db: Db) {
  return async function audit(entry: AuditEntry): Promise<void> {
    try {
      await db.auditLog.create({ data: auditData(entry) })
    } catch (err) {
      // La auditoría nunca rompe el flujo principal
      console.error("[audit] failed to persist entry", entry.action, err)
    }
  }
}

// A diferencia de `audit()`, ESTA propaga el error en vez de tragarlo. Es para
// el único llamador que necesita distinguir "se escribió" de "no se escribió":
// `auditAfterCommit` en `carga/[numero]/actions.ts`, que degrada a un aviso
// explícito para el operador cuando el asiento no se pudo persistir. El resto
// del proyecto sigue usando `audit()` a propósito — son ~15 sitios que corren
// asientos sueltos sin envolverlos en su propio try/catch, y hoy dependen de
// que un hipo de la base nunca les rompa el flujo principal.
export function makeAuditStrict(db: Db) {
  return async function auditStrict(entry: AuditEntry): Promise<void> {
    await db.auditLog.create({ data: auditData(entry) })
  }
}

export const audit = makeAudit(prisma)
export const auditStrict = makeAuditStrict(prisma)
