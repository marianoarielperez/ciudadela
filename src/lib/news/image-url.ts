// URL pública y validación de nombre de las portadas. Separado de images.ts
// (que importa node:fs) para que sea importable desde client components.
//
// Esta validación es la ÚNICA defensa contra path traversal: el route handler
// concatena el nombre a una ruta del filesystem, así que todo lo que no sea
// exactamente `uuid.ext` de la allowlist tiene que caer acá. Sin flag `m`,
// `^`/`$` en JS anclan al principio y al final reales del string (no antes de
// un `\n` final, como en Python/PCRE): no hay separador, byte nulo ni salto de
// línea que pueda colarse. No aflojar.
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isValidNewsImageName(name: string): boolean {
  return NAME_RE.test(name);
}

export function newsImageUrl(fileName: string): string {
  return `/api/imagenes/noticias/${fileName}`;
}
