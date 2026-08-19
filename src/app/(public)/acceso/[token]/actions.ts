"use server";
// Alta de la contraseña del socio. Ruta PÚBLICA y ANÓNIMA, igual que /verificar:
// la única credencial es el token de invitación.
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { BCRYPT_COST, validatePassword } from "@/lib/auth/password";
import { publicTokenLimiter } from "@/lib/auth/rate-limiter";
import { ACCESS_ERRORS, memberAccess } from "@/lib/members/access";
import { tokens } from "@/lib/tokens";

export type AccessState = { error?: string };

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint), y una constante rompe el build.
const TOO_MANY = "Demasiados intentos desde tu conexión. Probá de nuevo en un rato.";
const MISMATCH = "Las contraseñas no coinciden.";

async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

export async function createPasswordAction(_prev: AccessState, formData: FormData): Promise<AccessState> {
  const raw = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Las validaciones locales van primero y NO gastan cupo: equivocarse al
  // repetir la contraseña no puede dejar a nadie afuera. (Y el formulario
  // conserva lo tipeado: los campos son controlados, ver password-form.tsx.)
  const check = validatePassword(password);
  if (!check.ok) return { error: check.error };
  if (password !== confirm) return { error: MISMATCH };

  const ip = await clientIp();
  if (!publicTokenLimiter.check(ip)) return { error: TOO_MANY };

  // `peek` barato ANTES del bcrypt: el hash de costo 12 son ~300 ms de CPU y
  // sería el recurso a agotar martillando esta ruta con tokens inventados. No
  // reemplaza al `consume` —eso lo hace `createPassword` adentro de la
  // transacción, que es lo que decide quién gana entre dos POST simultáneos—.
  if (!(await tokens.peek(raw, "password_invitation"))) return { error: ACCESS_ERRORS.dead };

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const res = await memberAccess.createPassword(raw, passwordHash);
  if (!res.ok) return { error: res.error };

  await audit({
    userId: res.userId,
    action: res.created ? "member_user_created" : "member_password_set",
    entity: "member",
    entityId: res.memberId,
    ip,
  });

  // Fuera de cualquier try: `redirect` señaliza con una excepción.
  redirect("/ingresar?cuenta=lista");
}
