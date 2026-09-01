// La llave del borrador de un reporte (spec §5.1). Mismo criterio que el token
// de retome de ASOCIATE: 256 bits de `randomBytes`, sólo el sha256 en la base,
// el crudo viaja una vez en la URL (`/reportes/nuevo/<claim>`, en `disallow` de
// robots.txt). NO se consume: es la llave mientras el borrador viva.
import { randomBytes } from "node:crypto";
import { hashToken } from "@/lib/tokens";

const CLAIM_RE = /^[A-Za-z0-9_-]{43}$/;

export function mintClaim(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashClaim(raw: string): string {
  return hashToken(raw);
}

/** Forma antes que base: una llave que no tiene la forma no merece una consulta. */
export function isClaimShaped(raw: string): boolean {
  return CLAIM_RE.test(raw);
}
