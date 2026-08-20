// Los valores por defecto son el control de seguridad de docs/08: viven como
// constantes exportadas para que un test los fije y un typo no los afloje.
export const DEFAULT_LIMIT = 5
export const DEFAULT_WINDOW_MS = 15 * 60_000
/** Cantidad de claves a partir de la cual se dispara la poda. No es un tope
 *  duro: el barrido solo borra claves vencidas, así que si hay más de estas
 *  vivas dentro de la ventana, el Map las conserva. */
export const DEFAULT_MAX_KEYS = 10_000

type Options = {
  limit?: number
  windowMs?: number
  maxKeys?: number
  now?: () => number
}

export function createRateLimiter({
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  maxKeys = DEFAULT_MAX_KEYS,
  now = Date.now,
}: Options = {}) {
  const hits = new Map<string, number[]>()

  // Sin poda, quien rota claves (emails inventados) hace crecer el Map sin techo.
  // Barremos solo al pasar maxKeys: es O(n) y ocurre muy de vez en cuando.
  // Se borran únicamente las claves vencidas; las que siguen dentro de la
  // ventana se conservan, aunque queden por encima de maxKeys.
  function sweep(t: number) {
    for (const [key, stamps] of hits) {
      const newest = stamps[stamps.length - 1]
      if (newest === undefined || t - newest >= windowMs) hits.delete(key)
    }
  }

  // Deja en el Map sólo los intentos que siguen dentro de la ventana.
  function recentOf(key: string, t: number): number[] {
    const stamps = hits.get(key)
    if (stamps === undefined) return []
    const recent = stamps.filter((ts) => t - ts < windowMs)
    if (recent.length === 0) hits.delete(key)
    else hits.set(key, recent)
    return recent
  }

  /** ¿Queda cupo? NO registra el intento. Existe para consultar varios
   *  limitadores y recién registrar cuando TODOS dieron cupo: con `check` a
   *  secas, el primero en evaluarse le cobra el intento a su clave aunque el
   *  segundo termine rechazando, y el operador se queda sin cupo por envíos que
   *  nunca salieron. */
  function allows(key: string): boolean {
    return recentOf(key, now()).length < limit
  }

  /** Registra un intento. Se llama con el cupo ya verificado con `allows`. */
  function record(key: string) {
    const t = now()
    if (hits.size > maxKeys) sweep(t)
    const recent = recentOf(key, t)
    recent.push(t)
    hits.set(key, recent)
  }

  /** Devuelve el último intento registrado de la clave. Para el caso en que se
   *  reservó cupo y la operación no llegó a ocurrir (el SMTP falló): no se
   *  acreditó ninguna Notification ni quedó ningún enlace vivo, así que no hay
   *  nada que racionar y tres errores de configuración no pueden dejar al socio
   *  sin reintentos por una hora. */
  function refund(key: string) {
    const stamps = hits.get(key)
    if (stamps === undefined || stamps.length === 0) return
    stamps.pop()
    if (stamps.length === 0) hits.delete(key)
  }

  return {
    /** El presupuesto configurado. Introspección para tests y diagnóstico: deja
     *  que un test pinee la configuración del singleton, no sólo la constante. */
    limit,
    windowMs,
    /** true = intento permitido (y registrado); false = bloqueado */
    check(key: string): boolean {
      if (!allows(key)) return false
      record(key)
      return true
    },
    allows,
    record,
    refund,
    reset(key: string) {
      hits.delete(key)
    },
    /** Introspección para tests y diagnóstico operativo; no es parte del control. */
    size(): number {
      return hits.size
    },
  }
}

// In-memory alcanza: PM2 corre un único proceso (escala ~300 socios).
// Si se clusteriza, migrar a almacenamiento compartido.

/** Por par email|ip: frena la fuerza bruta contra una cuenta concreta. */
export const loginLimiter = createRateLimiter()

/** Por IP sola: frena el barrido de muchas cuentas desde un mismo origen,
 *  que nunca llegaría a 5 intentos en ningún par email|ip. */
export const ipLimiter = createRateLimiter({ limit: 20 })

export const VERIFICATION_WINDOW_MS = 60 * 60_000
export const VERIFICATION_MEMBER_LIMIT = 3
export const VERIFICATION_ACTOR_LIMIT = 20

/** Envío de verificación + invitación de acceso desde el panel, por socio.
 *  Cada envío acredita una notificación fehaciente (Art. 5° quater) y deja un
 *  enlace vivo: apretar 20 veces "no me llegó" no puede escribir 20 asientos del
 *  mismo hecho. La ventana es larga a propósito; el reintento legítimo es raro. */
export const verificationMemberLimiter = createRateLimiter({
  limit: VERIFICATION_MEMBER_LIMIT,
  windowMs: VERIFICATION_WINDOW_MS,
})

/** Y por admin: frena el barrido de muchos socios desde una misma sesión, que
 *  nunca llegaría a 3 en ningún socio concreto. */
export const verificationActorLimiter = createRateLimiter({
  limit: VERIFICATION_ACTOR_LIMIT,
  windowMs: VERIFICATION_WINDOW_MS,
})

export const PUBLIC_TOKEN_LIMIT = 30
export const PUBLIC_TOKEN_WINDOW_MS = 60 * 60_000

/** Canje de enlaces en /verificar, /acceso y /ingresar/restablecer, por IP. Son
 *  rutas públicas y anónimas: no hay sesión que racionar, así que la única
 *  clave posible es el origen.
 *
 *  El presupuesto es holgado a propósito y no pretende frenar la adivinación de
 *  tokens —son 256 bits de `randomBytes`, no se enumeran—: lo que raciona es el
 *  martilleo del alta y del restablecimiento de contraseña, que cuestan un
 *  bcrypt de costo 12 (~300 ms de CPU) por intento. Un socio legítimo hace uno
 *  o dos POST en todo el circuito, y
 *  el techo tiene que dejar pasar a varios vecinos detrás del mismo CGNAT de una
 *  operadora móvil, que es el caso común en Comodoro. Sólo lo consultan los POST:
 *  el GET de las páginas sólo hace `peek` (una lectura por índice) y limitarlo
 *  castigaría al que refresca. */
export const publicTokenLimiter = createRateLimiter({
  limit: PUBLIC_TOKEN_LIMIT,
  windowMs: PUBLIC_TOKEN_WINDOW_MS,
})

export const APPLICATION_STATUS_LIMIT = 240

/** Sondeo del estado de la solicitud ("estamos confirmando tu pago…"), por IP.
 *
 *  Limitador propio y NO `publicTokenLimiter` por el criterio que ese mismo
 *  limitador documenta: raciona los POST, y deja fuera las lecturas por índice
 *  porque "limitarlo castigaría al que refresca". Esto es exactamente eso —un
 *  SELECT por `resume_token_hash`, sin escritura y sin bcrypt—, pero se hace 24
 *  veces por espera: con el presupuesto de los POST, volver del checkout de MP
 *  le comía al vecino los intentos que necesita para subir un documento o
 *  reenviar la solicitud. Doscientos cuarenta por hora son diez esperas
 *  completas por origen; sigue habiendo techo para el que automatice el sondeo,
 *  y alcanza para varios vecinos detrás del mismo CGNAT. */
export const applicationStatusLimiter = createRateLimiter({
  limit: APPLICATION_STATUS_LIMIT,
  windowMs: 60 * 60_000,
})

export const PASSWORD_RESET_WINDOW_MS = 60 * 60_000
export const PASSWORD_RESET_IP_LIMIT = 10
export const PASSWORD_RESET_EMAIL_LIMIT = 5

/** Pedidos de recupero de contraseña, por IP.
 *
 *  Este NO es un canje como el de `publicTokenLimiter`: es un formulario
 *  anónimo que dispara un correo hacia afuera, así que lo que raciona es el
 *  mailbombing y el barrido de direcciones, no la CPU. Presupuesto propio y no
 *  el del login (`ipLimiter`): compartirlo significaría que un chaparrón de
 *  pedidos de recupero deja sin INGRESAR a todos los vecinos detrás del mismo
 *  CGNAT de una operadora móvil —el caso común en Comodoro— y al revés. Diez por
 *  hora y por origen: un vecino olvidadizo hace dos o tres, y diez recuperos
 *  distintos en una hora desde una misma IP en una asociación de ~300 socios no
 *  es tráfico legítimo. */
export const passwordResetIpLimiter = createRateLimiter({
  limit: PASSWORD_RESET_IP_LIMIT,
  windowMs: PASSWORD_RESET_WINDOW_MS,
})

/** Y por dirección pedida: el techo por IP no protege a una casilla concreta si
 *  el atacante rota de origen. Lo que raciona es la inundación del buzón de un
 *  socio desde el formulario público.
 *
 *  Cinco por hora y no tres: este techo es lo único que le puede gastar los
 *  pedidos a un socio que no pidió nada (Turnstile sigue diferido al M3), así
 *  que conviene que sobre. Es además el que fija cuántos enlaces de recupero
 *  pueden convivir vivos para una misma cuenta, porque emitir ya no revoca el
 *  anterior (ver `auth/password-reset.ts:request`): con media hora de TTL, como
 *  mucho cinco, todos hacia la misma casilla.
 *
 *  Se consulta y se registra SIEMPRE, exista o no una cuenta con esa dirección:
 *  si sólo contáramos los pedidos que terminan en envío, el intento que se pasa
 *  del techo contestaría distinto según la cuenta exista, que es exactamente lo
 *  que este formulario no puede revelar. La clave es la dirección NORMALIZADA
 *  (minúsculas, sin espacios: la normaliza la action antes de consultar), si no
 *  alternar mayúsculas alcanzaría para saltarse el techo. */
export const passwordResetEmailLimiter = createRateLimiter({
  limit: PASSWORD_RESET_EMAIL_LIMIT,
  windowMs: PASSWORD_RESET_WINDOW_MS,
})

export const APPLICATION_WINDOW_MS = 60 * 60_000
export const APPLICATION_CREATE_LIMIT = 5
export const RESUME_RESEND_LIMIT = 3

/** Creación de solicitudes ASOCIATE, por IP. Detrás de Turnstile, pero el
 *  captcha no raciona el volumen de un humano persistente: cinco solicitudes
 *  por hora desde un mismo origen alcanzan para cualquier hogar (CGNAT
 *  incluido) y frenan el llenado masivo del padrón de solicitudes. Es además
 *  la única puerta del chequeo de elegibilidad por DNI (anti-enumeración,
 *  spec M3 §4). */
export const applicationCreateLimiter = createRateLimiter({
  limit: APPLICATION_CREATE_LIMIT,
  windowMs: APPLICATION_WINDOW_MS,
})

/** Reenvío del link de retome ("ya tenés una solicitud en trámite"), por IP:
 *  dispara un correo hacia afuera desde un formulario anónimo, mismo criterio
 *  que el recupero de contraseña. */
export const resumeResendLimiter = createRateLimiter({
  limit: RESUME_RESEND_LIMIT,
  windowMs: APPLICATION_WINDOW_MS,
})

/** Reenvío del enlace de retome, por DNI pedido. Espejo de
 *  `passwordResetEmailLimiter`: el techo por IP no protege a un solicitante
 *  concreto si el atacante rota de origen, y acá el objetivo es identificable
 *  (el DNI es dato semi-público). El daño que raciona es doble: inundarle el
 *  buzón y, con el Fix del envío-antes-de-persistir, hacerlo pelear contra un
 *  enlace que se le mueve. Se consulta y se registra SIEMPRE, exista o no la
 *  solicitud: contar sólo los pedidos que terminan en envío haría que el
 *  techo mismo revele si ese DNI tiene trámite abierto. */
export const resumeResendTargetLimiter = createRateLimiter({
  limit: RESUME_RESEND_LIMIT,
  windowMs: APPLICATION_WINDOW_MS,
})
