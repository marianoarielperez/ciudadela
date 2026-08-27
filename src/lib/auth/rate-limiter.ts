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
 *  Cinco por hora y no tres: este techo es lo que le puede gastar los pedidos a
 *  un socio que no pidió nada, así que conviene que sobre. (Cuando se eligió el
 *  número era además lo ÚNICO que protegía la casilla, porque el formulario no
 *  tenía captcha; desde el 21/08/2026 lo tiene, pero Turnstile encarece el
 *  intento automatizado y no raciona al humano persistente, así que el techo se
 *  mantiene tal cual.) Es además el que fija cuántos enlaces de recupero
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
 *  incluido) y frenan el llenado masivo del padrón de solicitudes. Junto con
 *  `asociateDniCheckLimiter` (el cupo del chequeo temprano del paso 1) es una
 *  de las DOS puertas del chequeo de elegibilidad por DNI (anti-enumeración,
 *  spec M3 §4): ésta raciona el del envío del paso de datos. */
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

export const MEMBER_PAY_LIMIT = 5

/** "Pagar ahora" del panel de socio, por memberId: cada clic crea una
 *  preferencia en MP. Cinco por minuto alcanzan para arrepentirse y volver;
 *  más que eso es un script.
 *
 *  Por socio y no por IP: la pantalla es autenticada, así que hay una identidad
 *  mejor que el origen, y dos vecinos detrás del mismo CGNAT no tienen por qué
 *  gastarse el cupo entre ellos. */
export const memberPayLimiter = createRateLimiter({ limit: MEMBER_PAY_LIMIT, windowMs: 60_000 })

export const MEMBER_EDIT_LIMIT = 6

/** Edición de datos propios en /mi/datos, por memberId (mismo criterio que
 *  memberPayLimiter: la pantalla es autenticada, así que hay una identidad
 *  mejor que la IP). El cambio de email además consume los cupos de
 *  verificación existentes (verificationMemberLimiter) al enviar el correo. */
export const memberEditLimiter = createRateLimiter({ limit: MEMBER_EDIT_LIMIT, windowMs: 60_000 })

export const REREGISTRATION_LOOKUP_WINDOW_MS = 15 * 60_000
export const REREGISTRATION_LOOKUP_LIMIT = 5
export const REREGISTRATION_RESEND_WINDOW_MS = 60 * 60_000
export const REREGISTRATION_RESEND_LIMIT = 3

/** Búsqueda por DNI del paso 1 de REEMPADRONATE, por IP.
 *
 *  Es el mismo riesgo que raciona `applicationCreateLimiter` y con una diana
 *  más chica: el formulario contesta "¿Sos M****** P.?" contra un padrón de
 *  ~160 vigentes, así que sin techo sería un barredor de DNIs con confirmación
 *  de nombre parcial. Detrás de Turnstile, pero el captcha encarece el intento
 *  automatizado y no raciona al humano persistente.
 *
 *  Ventana de 15 minutos y no de una hora (el resto de los formularios
 *  públicos usan una): acá el vecino LEGÍTIMO puede necesitar reintentar el
 *  mismo día —tipea mal el DNI, el captcha vence mientras busca el documento,
 *  vuelve a entrar desde el enlace del correo—, y del otro lado del CGNAT de
 *  una operadora móvil de Comodoro puede haber varios vecinos convocados a la
 *  vez. Cinco cada quince minutos deja pasar eso y sigue siendo un techo. */
export const reregistrationLookupLimiter = createRateLimiter({
  limit: REREGISTRATION_LOOKUP_LIMIT,
  windowMs: REREGISTRATION_LOOKUP_WINDOW_MS,
})

/** Reenvío del enlace de una presentación YA enviada, por DNI pedido. Espejo de
 *  `resumeResendTargetLimiter`: dispara un correo hacia afuera desde un
 *  formulario anónimo, y el techo por IP no protege a un socio concreto si
 *  quien molesta rota de origen.
 *
 *  La clave es el DNI y no la IP a propósito: lo que raciona es la inundación
 *  del buzón de un vecino identificable, no el volumen de un origen. Se
 *  consulta y se registra SIEMPRE, exista o no la presentación, para que el
 *  techo mismo no revele si ese DNI ya se presentó.
 *
 *  Lo estrena la Task 11, que es la que suma la action de reenvío; vive acá
 *  desde ahora porque `rate-limiter.ts` define todos los presupuestos juntos y
 *  es donde se comparan entre sí. */
export const reregistrationResendLimiter = createRateLimiter({
  limit: REREGISTRATION_RESEND_LIMIT,
  windowMs: REREGISTRATION_RESEND_WINDOW_MS,
})

export const ASOCIATE_DNI_CHECK_WINDOW_MS = 15 * 60_000
export const ASOCIATE_DNI_CHECK_LIMIT = 5

/** Chequeo temprano por DNI del paso 1 de ASOCIATE, por IP.
 *
 *  Mismo riesgo y mismo presupuesto que `reregistrationLookupLimiter`: un
 *  formulario que contesta contra el padrón con un DNI suelto, sin nada
 *  cargado. Detrás de Turnstile, pero el captcha encarece el intento
 *  automatizado y no raciona al humano persistente. Ventana de 15 minutos por
 *  el mismo motivo que allá: el vecino legítimo reintenta el mismo día (tipeo,
 *  captcha vencido) y detrás del CGNAT móvil puede haber varios a la vez.
 *
 *  Es un presupuesto SEPARADO de `applicationCreateLimiter`: gastar chequeos
 *  del paso 1 no puede dejar sin envío a quien ya llegó al paso de datos, ni
 *  al revés. */
export const asociateDniCheckLimiter = createRateLimiter({
  limit: ASOCIATE_DNI_CHECK_LIMIT,
  windowMs: ASOCIATE_DNI_CHECK_WINDOW_MS,
})
