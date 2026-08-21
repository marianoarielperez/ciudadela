# SIGeV — Sistema Integral de Gestión Vecinal

Sistema web para la **Asociación Vecinal del Barrio Ciudadela** (Comodoro Rivadavia, Chubut).
Sitio público + gestión de socios + pagos (Mercado Pago) + re-empadronamiento estatutario.

## Antes de programar

Leé los documentos de `docs/` en orden. Son la especificación acordada con el cliente
y **tienen prioridad sobre cualquier decisión de diseño propia**:

1. `docs/01-vision-y-alcance.md` — qué es SIGeV y qué NO es
2. `docs/02-marco-estatutario.md` — reglas de negocio derivadas del estatuto (crítico)
3. `docs/03-arquitectura-e-infraestructura.md` — stack, VPS, despliegue
4. `docs/04-modelo-de-datos.md` — entidades y relaciones
5. `docs/05-flujos-funcionales.md` — flujos pantalla por pantalla
6. `docs/06-integracion-mercadopago.md` — planes, suscripciones, webhooks, conciliación
7. `docs/07-plan-de-etapas.md` — módulos 0 a 6 con criterios de aceptación
8. `docs/08-seguridad-y-privacidad.md` — Ley 25.326, DNIs, backups

Operativos (no son spec, son cómo se opera): `docs/09` relevamiento del VPS,
`docs/10` runbook del dominio productivo, `docs/11` preparación de MP sandbox y
Turnstile (de dónde salen las credenciales y el crontab).

## Stack (no negociable)

- **Next.js 16+** (App Router, TypeScript; `proxy.ts` en lugar de middleware,
  `params`/`searchParams` como Promise) — un solo proyecto: sitio público + panel + API
- **MariaDB** (localhost:3306, ya corre en el VPS) vía **Prisma** (provider `mysql`)
- **Auth.js v5** con provider Credentials (bcrypt). Roles: `superadmin`, `admin`, `socio` (acumulables)
- **Nodemailer + Brevo SMTP** para emails transaccionales
- **PM2** en producción, puerto **3006**, detrás de Nginx + Cloudflare
- PDFs de recibos: `pdf-lib` o `pdfkit` en API route del servidor
- Captcha: **Cloudflare Turnstile** en todos los formularios públicos ANÓNIMOS —
  ASOCIATE (alta y reenvío del enlace de retome), `/ingresar` y
  `/ingresar/recuperar`—. Los que se abren con un token de un solo uso
  (`/acceso/[token]`, `/ingresar/restablecer/[token]`, `/verificar/[token]`) no
  lo llevan: el token ya es la barrera, y no hay nada que enumerar sin él

## Convenciones

- **UI en español** (es-AR: "vos", fechas DD/MM/AAAA, moneda ARS `$ 1.234,56`).
  Código, nombres de variables, tablas y commits en **inglés**.
- Zona horaria: `America/Argentina/Buenos_Aires` (UTC-3, sin DST). Guardar UTC en DB.
- Color primario de marca: celeste `#2E9BDF` (derivado de `assets/logo.png`).
  Ojo accesibilidad: `#2E9BDF` solo llega a 3.06:1 sobre blanco — para botones/links
  se usa el token `--primary` `#0079BC` (4.71:1). Ver `src/app/globals.css`.
- Los archivos subidos (DNIs, facturas) van a `UPLOADS_DIR` (en prod `/var/sigev/uploads`),
  **NUNCA** dentro de `public/` ni del repo. Se sirven solo por API route autenticada.
  Excepción: las imágenes de portada de noticias viven en `UPLOADS_DIR/news/` pero se
  sirven por route handler público SIN autenticación (`/api/imagenes/noticias/[name]`)
  con caché inmutable — son contenido público. La regla de API autenticada aplica a
  documentos personales (DNIs, facturas).
- Toda acción sensible de admin (aprobar alta, declarar baja, registrar pago, ver documento)
  se registra en la tabla de auditoría.
- Migraciones siempre con `prisma migrate` — nunca `db push` en producción.

## Panel de administración: shell y patrones

El panel tiene un marco compartido. **Una pantalla nueva no escribe su propio encabezado,
sus propios mensajes ni su propio estado vacío**: usa estos componentes.

- **Navegación**: `src/lib/admin/nav.ts` es la ÚNICA fuente de las secciones (grupos
  Gestión / Contenido / Sistema). Agregar una sección = agregar un ítem ahí; la lateral,
  el cajón móvil y el marcado de sección activa salen solos. Las tarjetas de `/admin` viven
  en `src/lib/admin/dashboard-cards.ts` y un test verifica que no se desincronicen.
  La lateral lista solo secciones que funcionan; el roadmap ("Próximamente") vive en las
  tarjetas de Inicio.
- **Encabezado**: `PageHeader` (`title`, `breadcrumb`, `actions`, `children`). Convenciones
  acordadas: la **entidad va en el `<h1>`** (el nombre del socio, el título de la noticia) y
  la miga lleva la referencia corta; la **última miga es un sustantivo corto** ("Baja",
  "Editar", "Nueva"), nunca una repetición del título.
- **Mensajes**: `FormMessage` (`kind`: `error | success | warning | neutral`, `box`, `as`).
  Deriva el `role` del `kind`; la prop `role` solo se usa para casos justificados
  (`"none"` para texto estático, `"status"` para el guardado del modo carga).
  **No usar verde/ámbar crudo de Tailwind**: están los tokens `--success` y `--warning`.
- **Estado vacío**: `EmptyState` (`size="list"` reemplaza la tabla entera y ofrece la acción
  que lo resuelve; `size="card"` es una línea). **Nunca renderizar un `thead` sin filas.**
- **Badges de estado**: `src/lib/admin/status-badges.ts`, no ternarios por pantalla.
- **Roles**: la nav y las tarjetas filtran por los roles del TOKEN — es display, y puede
  quedar hasta 8 h desactualizado tras una degradación. **La autorización real va siempre
  en la ruta y en cada server action** (`requireAdmin` / `requireSuperadmin`, que resuelven
  contra la fila viva de `User`).
- Accesibilidad del shell (verificada, no romper): targets ≥44px, `aria-current="page"` en la
  sección activa, `outline-hidden` + `focus-visible:ring-sidebar-ring` en TODO control de la
  lateral (`outline-none` deja el foco invisible en modo alto contraste), skip link al
  `<main id="contenido">`.
- Deuda anotada: 4 formularios y 9 `<select>` crudos siguen sin migrar a `synced-fields`
  (se ven planos en modo oscuro); `AdminActor` no devuelve los roles vivos, así que el layout
  llama a `auth()` una segunda vez.

## Patrones que estrenó el Módulo 3 (reutilizables)

- **Servicios externos detrás de una factory propia.** `makeMpGateway()`
  (`src/lib/mp/gateway.ts`, sin argumentos: lee `MP_ACCESS_TOKEN` del entorno)
  expone siete métodos: `getPlan`, `createPreapproval`, `cancelPreapproval`,
  `updatePreapprovalAmount`, `getPreapproval`, `getPayment` y
  `getAuthorizedPayment`. El dominio **nunca** ve el SDK de Mercado Pago, y los
  tests mockean esa interfaz: ni SDK ni red.
  Mismo criterio para cualquier proveedor que venga después.
- **Las guardas globales van en el transporte, no en los llamadores.**
  `EMAIL_ALLOWLIST` envuelve el transporte de Nodemailer, así que cubre wizard,
  panel y cron por igual y una pantalla nueva no puede olvidarse de aplicarla. El
  log del bloqueo dice el motivo, **nunca la dirección completa** (Ley 25.326).
- **Reglas de negocio como funciones puras, testeadas aparte.**
  `src/lib/applications/eligibility.ts` decide los bloqueos por DNI sin tocar la
  base: la tabla entera de casos se prueba sin fixtures ni Prisma.
- **En módulos puros, el cliente de Prisma se INYECTA, no se importa.**
  `@/lib/prisma` tira al evaluarse si falta `DATABASE_URL`; un test puro que
  importe el módulo se cae sin `.env`. Ver `applications/query.ts` y
  `applications/summary.ts`.
- **Documentos personales: ruta autenticada + auditoría por visualización.**
  `GET /api/admin/solicitudes/[id]/documentos/[docId]` con `requireAdmin`,
  `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff` y un
  asiento por cada vista. La validación por magic bytes dice qué **es** el
  archivo, no qué se puede hacer con él: el `nosniff` no es opcional.
- **Auditoría best-effort vs. estricta.** `audit()` traga errores y sirve para el
  99%; `auditStrict` es para el caso en que el asiento **es** la señal (el aviso
  de solicitud revivida por pago tardío: si no se escribe, el operador no se
  entera por ninguna pantalla) y hay que saber si falló.
- **Premisa de un solo proceso.** Mutex por DNI y rate limiters viven en memoria:
  ver la advertencia de `docs/03` antes de tocar `instances` en PM2.

## Flujo de trabajo con el operador (Mariano)

- Claude Code trabaja **localmente en Windows**: escribe código, corre dev server, commitea.
- **Claude Code NO se conecta por SSH al VPS.** Los comandos de servidor se preparan
  en bloques copiables y Mariano los ejecuta a mano (SSH puerto 2222, root).
- El despliegue es git-based: push a GitHub (repo privado) → pull en el VPS → build → PM2 restart.
- **Un solo entorno desplegado: `vecinalciudadela.ar`** (decisión del 20/08/2026).
  El staging `sigev.redaccion.ar` se dio de baja; lo que dicen `docs/03`, `docs/07`,
  `docs/09` y `docs/10` sobre staging es historia, no el estado actual.
  Hasta el lanzamiento, ese dominio corre con credenciales **de prueba** de MP y con
  `EMAIL_ALLOWLIST` definida (el sitio está publicado pero nadie lo conoce todavía).
  El cambio a credenciales productivas y el borrado de `EMAIL_ALLOWLIST` son dos
  pasos del checklist de lanzamiento de `docs/07`, no algo que ocurra solo.

## Datos incluidos

- `datos/padron_socios.xlsx` — padrón definitivo del Libro N° 1 (283 filas,
  numeración 1-305 con 22 huecos; DNIs completos salvo socios 287/288, ~36 emails
  cargados). Importado por `scripts/import-padron.ts`; el resto de la ficha se
  completa a mano desde el panel. Ver `docs/04-modelo-de-datos.md`.
- `datos/calles_inicial.csv` — 40 calles catastrales del barrio para el autocompletado
  (campos: id_calle, orden_carga, nombre_calle). Ojo: nombres sin tilde y con comas
  tipo "Pizarro , Francisco" → normalizar para búsqueda.
- `assets/logo.png` — logo institucional (monocromo celeste, fondo transparente).
- `assets/hero.jpg` — foto aérea del barrio para el hero (1980×788; generar variantes responsive).

## Variables de entorno (`.env`)

Referencia completa y comentada: `.env.example`.

```
DATABASE_URL="mysql://sigev:***@localhost:3306/sigev"
AUTH_SECRET=***
AUTH_URL=https://vecinalciudadela.ar       # se HORNEA en el build (SEO, canonicals)
MP_ACCESS_TOKEN=***                        # hasta el lanzamiento: credenciales TEST
MP_WEBHOOK_SECRET=***                      # para validar x-Signature
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=***
BREVO_SMTP_KEY=***
MAIL_FROM="Vecinal Ciudadela <notificaciones@vecinalciudadela.ar>"
EMAIL_ALLOWLIST=a@b.com,c@d.com            # si está definida NINGÚN email sale
                                           # fuera de la lista. En producción NO
                                           # se define (se borra al lanzar).
UPLOADS_DIR=/var/sigev/uploads             # dev: ./uploads (gitignored)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=***         # pública: viaja en el HTML
TURNSTILE_SECRET_KEY=***                   # dev: claves dummy de Cloudflare
CRON_SECRET=***                            # protege endpoints internos de cron
```

Los ids de los dos planes de Mercado Pago **no son variables de entorno**: viven
en `Configuration` (`mp_plan_active_id`, `mp_plan_shared_id`) y se cargan desde
`/admin/configuracion`. Ver `docs/06` y el instructivo `docs/11`.

## Prioridad actual

Empezar por el **Módulo 0** de `docs/07-plan-de-etapas.md` y avanzar en orden.
No arrancar un módulo sin cerrar los criterios de aceptación del anterior.
