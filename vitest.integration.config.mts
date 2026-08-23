import { defineConfig } from "vitest/config"
import path from "node:path"

// Los tests de `tests/integration` hablan con UNA MariaDB compartida, así que no
// pueden correr en paralelo ENTRE ARCHIVOS: dos archivos que tocan la misma fila
// —la serie de recibos de un año, por ejemplo— se pisan los `beforeEach` y
// producen justo el síntoma que REG-33 prohíbe, un hueco en la numeración, sin
// que haya ningún bug. Pasó de verdad al escribir el test de concurrencia de la
// T14: `receipt-sequence.test.ts` y `mp-apply-concurrency.test.ts` compartían el
// año 1999 y el primero falló.
//
// Se resuelve acá y no con la convención "un año por archivo" porque la
// convención se rompe sola: el que escriba el tercer archivo de integración no
// tiene forma de saber que existe.
//
// Dentro de un archivo el paralelismo sigue intacto: `Promise.all` con 20
// llamadas concurrentes es exactamente lo que estos tests vienen a ejercer.
//
// No se hereda de `vitest.config.mts` con `mergeConfig` porque los arrays se
// CONCATENAN: `include` terminaba siendo el glob de integración más el de toda
// la suite, y `npm run test:integration` corría los 132 archivos en serie.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    env: { TZ: "UTC" },
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
})
