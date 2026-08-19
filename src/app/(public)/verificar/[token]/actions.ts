"use server";
// Canje del enlace de verificación. Es una ruta PÚBLICA y ANÓNIMA: no hay
// `requireAdmin` ni sesión que mirar, la única credencial es el token del correo.
//
// Todo lo que decide vive en `@/lib/members/access` (una transacción con el
// consume, la revalidación del estado del socio y la escritura adentro). Acá
// queda lo que sólo la action puede hacer: leer la IP para el limitador y para
// la auditoría, y redirigir.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { publicTokenLimiter } from "@/lib/auth/rate-limiter";
import { memberAccess } from "@/lib/members/access";

export type VerifyState = { error?: string };

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint), y una constante rompe el build.
const TOO_MANY = "Demasiados intentos desde tu conexión. Probá de nuevo en un rato.";

async function clientIp(): Promise<string> {
  // Sólo X-Real-IP, como el login y el modo carga: el resto de las cabeceras de
  // IP las puede fijar el cliente si le pega directo al origen, y rotándolas se
  // regalaría un presupuesto nuevo del limitador en cada intento.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

export async function confirmEmailAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const raw = String(formData.get("token") ?? "");
  const ip = await clientIp();
  if (!publicTokenLimiter.check(ip)) return { error: TOO_MANY };

  // El `consume` ocurre acá adentro y NUNCA en el GET de la página: los
  // escáneres de enlaces de los clientes de correo abren la URL, y con una
  // página que consumiera, el token moriría antes de que la persona haga clic.
  const res = await memberAccess.verifyEmail(raw);
  if (!res.ok) return { error: res.error };

  // Sin `userId`: la persona todavía no tiene sesión. El asiento identifica al
  // socio por `entityId`; no van ni el email ni el token al log (Ley 25.326).
  await audit({ action: "member_email_verified", entity: "member", entityId: res.memberId, ip });

  // Fuera de cualquier try: `redirect` señaliza con una excepción.
  redirect(res.invite ? `/acceso/${res.invite}` : "/ingresar");
}
