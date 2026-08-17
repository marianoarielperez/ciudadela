import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // El VPS corre en UTC: fijamos TZ=UTC para que los tests de formato de
    // fecha ejerciten de verdad la conversión UTC -> America/Argentina.
    env: { TZ: "UTC" },
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
})
