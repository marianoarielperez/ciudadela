export const BCRYPT_COST = 12
export const MIN_PASSWORD_LENGTH = 8

export function validatePassword(pw: string): { ok: true } | { ok: false; error: string } {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }
  }
  return { ok: true }
}
