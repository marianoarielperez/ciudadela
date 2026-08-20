// Verificación server-side de Cloudflare Turnstile (docs/08: captcha en todos
// los formularios públicos; diferido del M0 a este módulo). FALLA CERRADO: sin
// secreto, sin token o con la red caída se rechaza — un captcha que aprueba
// cuando no puede verificar no es un captcha. En dev se usan las claves dummy
// de Cloudflare (ver .env.example), que pasan siempre.
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifier = (token: string, ip: string | null) => Promise<boolean>;

export function makeTurnstileVerifier(fetchFn: typeof fetch = fetch): TurnstileVerifier {
  return async (token, ip) => {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret || !token) return false;
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip && ip !== "unknown") body.set("remoteip", ip);
      const res = await fetchFn(SITEVERIFY_URL, { method: "POST", body });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  };
}

export const verifyTurnstile: TurnstileVerifier = makeTurnstileVerifier();
