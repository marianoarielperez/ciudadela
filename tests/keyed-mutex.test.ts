import { describe, expect, it } from "vitest";

import { createKeyedMutex } from "@/lib/keyed-mutex";

// Deferreds, no timers: los tests fijan el ORDEN de las secciones críticas, no
// cuánto tardan. Con `setTimeout` un cambio de scheduling los volvería flaky.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deja correr las microtareas pendientes (el `run` encadena varios `.then`). */
const flush = () => new Promise<void>((res) => setImmediate(res));

describe("createKeyedMutex", () => {
  it("con la MISMA clave, el segundo espera a que termine el primero", async () => {
    const mutex = createKeyedMutex();
    const first = deferred();
    const order: string[] = [];

    const a = mutex.run("30111222", async () => {
      order.push("a:in");
      await first.promise;
      order.push("a:out");
    });
    const b = mutex.run("30111222", async () => {
      order.push("b:in");
    });

    await flush();
    expect(order).toEqual(["a:in"]); // b ni siquiera arrancó

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a:in", "a:out", "b:in"]);
  });

  it("con claves DISTINTAS corren en paralelo", async () => {
    const mutex = createKeyedMutex();
    const blocked = deferred();
    const order: string[] = [];

    const a = mutex.run("30111222", async () => {
      order.push("a:in");
      await blocked.promise;
      order.push("a:out");
    });
    const b = mutex.run("27999888", async () => {
      order.push("b:in");
    });

    await b;
    expect(order).toEqual(["a:in", "b:in"]); // b terminó con a todavía adentro

    blocked.resolve();
    await a;
    expect(order).toEqual(["a:in", "b:in", "a:out"]);
  });

  it("un rechazo no rompe la cadena ni deja la clave colgada", async () => {
    const mutex = createKeyedMutex();
    const first = deferred();
    const order: string[] = [];

    const a = mutex.run("30111222", async () => {
      order.push("a:in");
      await first.promise;
      throw new Error("boom");
    });
    const b = mutex.run("30111222", async () => {
      order.push("b:in");
      return "ok";
    });

    first.resolve();
    // El rechazo llega al caller del `run` que falló…
    await expect(a).rejects.toThrow("boom");
    // …y el siguiente de la fila corre igual.
    await expect(b).resolves.toBe("ok");
    expect(order).toEqual(["a:in", "b:in"]);

    await flush();
    expect(mutex.size()).toBe(0);
  });

  it("el Map no crece sin techo: la clave se borra cuando drena la fila", async () => {
    const mutex = createKeyedMutex();
    const blocked = deferred();

    const held = mutex.run("30111222", () => blocked.promise);
    const queued = mutex.run("30111222", async () => {});
    const other = mutex.run("27999888", async () => {});

    expect(mutex.size()).toBe(2); // una entrada por clave, no por llamada

    await other;
    await flush();
    expect(mutex.size()).toBe(1); // la clave drenada se fue

    blocked.resolve();
    await Promise.all([held, queued]);
    await flush();
    expect(mutex.size()).toBe(0);

    // Y sigue usable después de vaciarse.
    await expect(mutex.run("30111222", async () => "de nuevo")).resolves.toBe("de nuevo");
  });
});
