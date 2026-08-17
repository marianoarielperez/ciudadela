import { PrismaMariaDb } from "@prisma/adapter-mariadb"

import { PrismaClient } from "@/generated/prisma/client"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createPrismaClient() {
  // Sin esta guarda el adapter recibe undefined y falla recién en la primera
  // consulta, con un error que no dice que falta la variable de entorno.
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está definida (revisá .env)")
  }
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL)
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
