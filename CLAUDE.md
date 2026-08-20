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

## Stack (no negociable)

- **Next.js 16+** (App Router, TypeScript; `proxy.ts` en lugar de middleware,
  `params`/`searchParams` como Promise) — un solo proyecto: sitio público + panel + API
- **MariaDB** (localhost:3306, ya corre en el VPS) vía **Prisma** (provider `mysql`)
- **Auth.js v5** con provider Credentials (bcrypt). Roles: `superadmin`, `admin`, `socio` (acumulables)
- **Nodemailer + Brevo SMTP** para emails transaccionales
- **PM2** en producción, puerto **3006**, detrás de Nginx + Cloudflare
- PDFs de recibos: `pdf-lib` o `pdfkit` en API route del servidor
- Captcha: **Cloudflare Turnstile** en todos los formularios públicos

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

## Flujo de trabajo con el operador (Mariano)

- Claude Code trabaja **localmente en Windows**: escribe código, corre dev server, commitea.
- **Claude Code NO se conecta por SSH al VPS.** Los comandos de servidor se preparan
  en bloques copiables y Mariano los ejecuta a mano (SSH puerto 2222, root).
- El despliegue es git-based: push a GitHub (repo privado) → pull en el VPS → build → PM2 restart.
- Staging: `sigev.redaccion.ar` con credenciales **de prueba** de MP.
  Producción: `vecinalciudadela.com.ar` con credenciales productivas.

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

```
DATABASE_URL="mysql://sigev:***@localhost:3306/sigev"
AUTH_SECRET=***
AUTH_URL=https://sigev.redaccion.ar        # prod: https://vecinalciudadela.com.ar
MP_ACCESS_TOKEN=***                        # staging: credenciales TEST
MP_WEBHOOK_SECRET=***                      # para validar x-Signature
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=***
BREVO_SMTP_KEY=***
MAIL_FROM="Vecinal Ciudadela <notificaciones@vecinalciudadela.com.ar>"
UPLOADS_DIR=/var/sigev/uploads             # dev: ./uploads (gitignored)
TURNSTILE_SITE_KEY=***
TURNSTILE_SECRET_KEY=***
CRON_SECRET=***                            # protege endpoints internos de cron
```

## Prioridad actual

Empezar por el **Módulo 0** de `docs/07-plan-de-etapas.md` y avanzar en orden.
No arrancar un módulo sin cerrar los criterios de aceptación del anterior.
