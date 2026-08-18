import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7 ignora `package.json#prisma.seed` cuando existe este archivo.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
    // Solo dev: `migrate dev` necesita la shadow DB; en el VPS no existe la
    // variable y `migrate deploy`/`generate` no la usan. `env()` de Prisma
    // lanza si falta, por eso se lee condicional desde process.env.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
