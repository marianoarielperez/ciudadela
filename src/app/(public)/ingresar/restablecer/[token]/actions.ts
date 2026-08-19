"use server";
// Canje del enlace de recupero. Ruta PÚBLICA y ANÓNIMA, igual que /acceso: la
// única credencial es el token del correo.
//
// Todo lo que decide vive en `@/lib/auth/password-reset` (una transacción con el
// `consume`, la revalidación de la cuenta y la escritura adentro). Acá queda lo
// que sólo la action puede hacer: leer la IP para el limitador y la auditoría,
// calcular el bcrypt fuera de la transacción y redirigir.
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { BCRYPT_COST, validatePassword } from "@/lib/auth/password";
import { RESET_ERRORS, passwordReset } from "@/lib/auth/password-reset";
import { publicTokenLimiter } from "@/lib/auth/rate-limiter";
import { tokens } from "@/lib/tokens";

export type ResetState = { error?: string };

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint), y una constante rompe el build.
const TOO_MANY = "Demasiados intentos desde tu conexión. Probá de nuevo en un rato.";
const MISMATCH = "Las contraseñas no coinciden.";

export async function resetPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const raw = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Las validaciones locales van primero y NO gastan cupo: equivocarse al
  // repetir la contraseña no puede dejar a nadie afuera ni quemarle el enlace.
  // (Y el formulario conserva lo tipeado: los campos son controlados.)
  const check = validatePassword(password);
  if (!check.ok) return { error: check.error };
  if (password !== confirm) return { error: MISMATCH };

  // Sólo X-Real-IP, como el login y el resto del circuito público.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  if (!publicTokenLimiter.check(ip)) return { error: TOO_MANY };

  // `peek` barato ANTES del bcrypt: el hash de costo 12 son ~300 ms de CPU y
  // sería el recurso a agotar martillando esta ruta con tokens inventados. No
  // reemplaza al `consume` —eso lo hace `passwordReset.reset` adentro de la
  // transacción, que es lo que decide quién gana entre dos POST simultáneos—.
  if (!(await tokens.peek(raw, "password_reset"))) return { error: RESET_ERRORS.dead };

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const res = await passwordReset.reset(raw, passwordHash);
  if (!res.ok) {
    // Sin `userId`: en el caso normal (enlace muerto) no sabemos de quién era.
    // Va sólo el motivo, que es lo que distingue el enlace vencido de la cuenta
    // deshabilitada cuando haya que reconstruir un reclamo.
    await audit({ action: "password_reset_failed", detail: { reason: res.reason }, ip });
    return { error: res.error };
  }

  await audit({
    userId: res.userId, action: "password_reset_completed", entity: "user", entityId: res.userId, ip,
  });

  // Fuera de cualquier try: `redirect` señaliza con una excepción.
  redirect("/ingresar?cuenta=restablecida");
}
