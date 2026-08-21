// Serializa secciones críticas por clave DENTRO del proceso.
//
// Misma premisa que los limitadores de `auth/rate-limiter.ts`: PM2 corre un
// único proceso a esta escala (~300 socios), así que una cola en memoria
// alcanza para que dos pedidos concurrentes con la misma clave no se pisen.
// Si algún día se clusteriza, esto hay que moverlo a la base —columna única
// mantenida por la app, o lock distribuido—: dos procesos tienen dos Maps y
// esta garantía desaparece sin ruido. Está anotado allá y acá.
//
// No es un lock de la base: no protege contra escrituras hechas por fuera de
// este proceso (consola de MySQL, scripts de mantenimiento).

export function createKeyedMutex() {
  // Por clave, la promesa de la ÚLTIMA sección crítica encolada. Encadenar
  // sobre ella es lo que serializa; la entrada se borra cuando esa última
  // termina, así el Map no crece con las claves ya drenadas.
  const chains = new Map<string, Promise<unknown>>();

  return {
    /** Corre `fn` cuando no quede nada pendiente para `key`. Claves distintas
     *  no se esperan entre sí. Un rechazo de `fn` se propaga al caller pero NO
     *  rompe la cadena: el siguiente en la cola corre igual. */
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const previous = chains.get(key);
      // `catch` vacío: la cadena espera a que el anterior TERMINE, sin importar
      // cómo. Sin esto, un rechazo dejaría a todos los siguientes rechazados.
      const result = (previous === undefined ? Promise.resolve() : previous.catch(() => {}))
        .then(fn);
      // La cadena guarda la versión "amansada": si nadie la maneja —porque el
      // caller ya recibió el rechazo por `result`— igual no dispara un
      // unhandledRejection.
      const settled = result.catch(() => {});
      chains.set(key, settled);
      void settled.then(() => {
        // Sólo el último de la fila limpia: si mientras tanto se encoló otro,
        // `chains` ya apunta a esa promesa nueva y no hay que tocarla.
        if (chains.get(key) === settled) chains.delete(key);
      });
      return result;
    },

    /** Introspección para tests y diagnóstico; no es parte de la garantía. */
    size(): number {
      return chains.size;
    },
  };
}
