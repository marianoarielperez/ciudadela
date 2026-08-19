import { describe, it, expect, vi } from "vitest"

// `src/lib/audit.ts` exporta el singleton `audit = makeAudit(prisma)`, así que
// importarlo construye el PrismaClient real en tiempo de import. Los tests no
// deben depender de DATABASE_URL ni tocar una base viva: stubeamos el módulo.
// El singleton no se ejercita acá; estos tests usan `makeAudit` con un fake.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { makeAudit, makeAuditStrict } from "@/lib/audit"

describe("audit", () => {
  it("persists action with user, entity and stringified entityId", async () => {
    const create = vi.fn(async () => ({}))
    const audit = makeAudit({ auditLog: { create } } as never)
    await audit({ userId: 3, action: "login", entity: "user", entityId: 3, ip: "10.0.0.1" })
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 3,
        action: "login",
        entity: "user",
        entityId: "3",
        detail: undefined,
        ip: "10.0.0.1",
      },
    })
  })
  it("swallows database errors and logs them", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const create = vi.fn(async () => {
      throw new Error("db down")
    })
    const audit = makeAudit({ auditLog: { create } } as never)
    await expect(audit({ action: "login_failed" })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

// `auditStrict` es la variante de `makeAudit` que NO atrapa el error del
// colaborador: la usa `auditAfterCommit` (carga/[numero]/actions.ts) para
// distinguir "el asiento se escribió" de "no se escribió" y recién ahí
// degradar a un aviso explícito para el operador. Sin estos dos tests, un
// `try/catch` agregado adentro de `makeAuditStrict` deja el resto de la
// suite en verde y vuelve a hacer inalcanzable ese aviso — exactamente el
// defecto que esta función vino a arreglar.
describe("auditStrict", () => {
  it("persists the same data shape as audit()", async () => {
    const create = vi.fn(async () => ({}))
    const auditStrict = makeAuditStrict({ auditLog: { create } } as never)
    await auditStrict({ userId: 3, action: "login", entity: "user", entityId: 3, ip: "10.0.0.1" })
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 3,
        action: "login",
        entity: "user",
        entityId: "3",
        detail: undefined,
        ip: "10.0.0.1",
      },
    })
  })

  it("propagates database errors instead of swallowing them", async () => {
    const create = vi.fn(async () => {
      throw new Error("db down")
    })
    const auditStrict = makeAuditStrict({ auditLog: { create } } as never)
    await expect(auditStrict({ action: "x" })).rejects.toThrow("db down")
  })
})
