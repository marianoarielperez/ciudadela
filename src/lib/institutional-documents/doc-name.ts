// Validación del nombre de archivo de un documento institucional. Separado del
// storage (que importa node:fs) para poder importarse desde client components y
// tests puros — mismo criterio que @/lib/news/image-url.
//
// Es la ÚNICA defensa contra path traversal antes de concatenar el nombre a una
// ruta del filesystem. Sin flag `m`: `^`/`$` anclan a los extremos reales del
// string. No aflojar.
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

export function isValidInstitutionalDocFileName(name: string): boolean {
  return NAME_RE.test(name);
}
