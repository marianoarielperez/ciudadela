---
title: Instalación, despliegue y operación
subtitle: Entorno local, producción, crons, backups y diagnóstico
series: Serie técnica — Documento 3 de 7
docx: SIGeV-T3-Instalacion-despliegue-operacion
version: 1.0
date: 11/09/2026
---

# Para quién es y qué da por sabido

Este documento es el manual de operaciones de SIGeV. Está escrito para quien tenga que
levantar el proyecto en una máquina nueva, desplegarlo en el servidor, entender qué corre
solo todas las noches y diagnosticar un problema sin ayuda del equipo que lo construyó.

Da por sabido: línea de comandos POSIX, Git, Docker, Node.js y npm, nociones de MariaDB y
de SQL de lectura, y qué es un proxy inverso. No da por sabido nada del proyecto: los
nombres propios del script de despliegue, de la tabla de corridas y de la pantalla de salud
se explican al aparecer. La arquitectura del código —cómo está organizado el árbol de
fuentes, qué capa hace qué— es el documento T2 de esta serie; acá sólo se opera.

## Cómo leer este documento

Los capítulos 1 a 3 son la instalación local y la configuración: se leen una vez, de
corrido, el primer día. Los capítulos 4 y 5 son producción y despliegue: se leen antes del
primer deploy y después se consultan. Los capítulos 6 a 9 —crons, backups, la pantalla de
salud, el diagnóstico— están pensados para abrirse ante un síntoma concreto. El capítulo 10
son runbooks: recetas cortas para las tareas que se piden de vez en cuando.

Dos advertencias que valen para todo el documento:

- **Hay un solo entorno desplegado**, `vecinalciudadela.ar`. El staging
  `sigev.redaccion.ar` se dio de baja el 20/08/2026. Lo que digan `docs/03`, `docs/09` y
  `docs/10` sobre dos entornos es historia.
- **Los comandos de servidor no se improvisan.** Los que están acá se copiaron de
  `docs/10`, de `docs/11` o de los scripts del repositorio. Un comando inventado contra una
  base con 278 socios reales es un incidente.

---

# 1. Entorno local

## 1.1 Requisitos

Medidos en la máquina de desarrollo: Node.js v24.14.1 y npm 11.11.0; el servidor corre
Node v22.22.0 según `docs/09` (17/08/2026). Docker Desktop sólo para la base de datos, y
Git. No hay `engines` en `package.json` ni `.nvmrc`: esas versiones son las efectivamente
usadas, no un mínimo declarado.

## 1.2 Clonar y configurar

```bash
git clone <url-del-repo> ciudadela
cd ciudadela
cp .env.example .env
```

`.env.example` está comentado variable por variable y es la referencia canónica; el
capítulo 2 la resume. Para desarrollo alcanza con:

```bash
DATABASE_URL="mysql://sigev:sigev_dev@localhost:3306/sigev"
SHADOW_DATABASE_URL="mysql://root:devroot@localhost:3306/sigev_shadow"
AUTH_SECRET=<cadena larga>
AUTH_URL=http://localhost:3000
ALLOW_LOCALHOST_BASE_URL=1
SEED_SUPERADMIN_PASSWORD=<a elección>
SEED_ALLOW_TEST_USERS="true"
SEED_TEST_PASSWORD=<a elección>
EMAIL_ALLOWLIST=<la casilla propia>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
CRON_SECRET=<cadena larga>
```

Tres detalles que cuestan tiempo si se pasan por alto. Las dos claves de captcha de arriba
son las **claves dummy de Cloudflare** que siempre aprueban: sin claves el widget no monta
y no se entra al panel ni se completa el alta. `ALLOW_LOCALHOST_BASE_URL` habilita un build
con la base en localhost y **en el servidor no puede existir**. Y definir
`EMAIL_ALLOWLIST` con la casilla propia es lo que evita que una prueba mande correo a un
vecino real.

Sin credenciales de Brevo el sistema no envía: cae al transporte de consola, que en
desarrollo es lo deseable. Sin `MP_ACCESS_TOKEN` no se puede ejercitar el circuito de
Mercado Pago, que se prueba con una cuenta de prueba propia (`docs/11` Parte J).

## 1.3 Base de datos

```bash
docker compose up -d
```

Levanta MariaDB 10.11 —la misma versión mayor que el servidor— en el contenedor `sigev-db`,
con el puerto publicado **sólo en loopback** (`127.0.0.1:3306:3306`): sin ese prefijo Docker
lo expone a toda la red local. `docker/mariadb-init/01-shadow-db.sql` se monta como script
de inicialización y crea la base sombra con el mismo juego de caracteres que la real; si
difiere, las migraciones se validan contra algo que no se parece a producción. Credenciales
de desarrollo: root `devroot`, usuario `sigev` con contraseña `sigev_dev`, base `sigev`.

## 1.4 Dependencias, esquema y semilla

```bash
npm ci
npx prisma migrate dev
npx prisma generate
npx prisma db seed
```

`npm ci` dispara `postinstall`, que genera el cliente. La llamada explícita de la tercera
línea no siempre sobra: medido el 10/09/2026 en este repositorio, `npx prisma migrate dev`
**no regeneró el cliente**, y sin regenerar, TypeScript falla por un campo que ya está en
la base (`docs/10` §4.10). La semilla la resuelve `prisma.config.ts` — Prisma 7 ignora la
entrada `prisma.seed` de `package.json` cuando ese archivo existe.

Qué crea la semilla: los roles, la cuenta de superadmin, los borradores de los textos
legales y las claves de configuración que estrena cada módulo. Es idempotente —todos sus
`upsert` llevan una actualización vacía— y por eso nunca pisa lo editado desde el panel.
Dos invariantes que conviene conocer antes de confiar en ella: **nunca pisa la contraseña
de un usuario existente** y **no vuelve a otorgar roles** (corre en cada despliegue, y
re-otorgarlos haría que una revocación deliberada volviera sola; si no queda ningún
superadmin lo avisa en el log y no lo arregla).

Las **cuentas de prueba** son un opt-in explícito: sin `SEED_ALLOW_TEST_USERS` en verdadero
no se crean, pase lo que pase con el entorno; con el opt-in puesto, `SEED_TEST_USERS` en
falso gana; y con el opt-in más el entorno de producción la semilla **lanza y rompe el
despliegue**. La guarda vive en `prisma/seed-guard.ts`, aparte del archivo de semilla,
porque éste ejecuta su función principal al importarse. El diseño es deliberado:
`admin.prueba@sigev.local` es una cuenta con rol de administrador y contraseña conocida, y
sembrarla sobre el padrón real sería una puerta trasera.

## 1.5 Cargas fundacionales

Cinco scripts llenan la base con datos reales del barrio, más uno que sólo genera
imágenes. Los cinco que tocan la base empiezan importando la configuración de entorno como
primer import, porque `tsx` no carga el archivo por su cuenta.

```bash
npx tsx scripts/import-calles.ts
npx tsx scripts/import-padron.ts
npx tsx scripts/import-deuda.ts
npx tsx scripts/seed-holidays.ts
npx tsx scripts/import-estatuto.ts
npx tsx scripts/generate-assets.ts
```

| Script | Qué hace | Cuidados |
|---|---|---|
| `import-calles.ts` | Las 40 calles catastrales, para el autocompletado de domicilios | Idempotente; valida el encabezado exacto del archivo |
| `import-padron.ts` | El Libro N° 1: 278 fichas | Por defecto **sólo crea lo que falta**. Con `--update-existing` pisa las fichas con el Excel y borra documento, domicilio, correo, teléfono y nacimiento cargados a mano; con `--prune --yes` borra fichas que salieron del Excel, sólo si no tienen nada colgando y si los totales de control dan. Ante cualquier ambigüedad aborta |
| `import-deuda.ts` | 3076 cuotas impagas | Ancladas a `DEBT_SNAPSHOT_DATE`, la fecha de la foto (21/08/2026), y **no** al reloj de la corrida. Idempotente por socio; aborta si una fila no coincide por número **y** por documento |
| `seed-holidays.ts` | Feriados nacionales de la Ley 27.399 | No carga los días no laborables turísticos ni el Jueves Santo: alargarían plazos sin fundamento legal |
| `import-estatuto.ts` | Copia el estatuto a la carpeta de subidas y crea la norma destacada | Idempotente. En producción **no es opcional** y va en la misma sesión del despliegue |
| `generate-assets.ts` | Ícono, logo del encabezado e imagen de Open Graph | Los resultados **se commitean**: no es parte del build |

Para ver la bandeja de cobros sin conciliar con una fila de ejemplo hay además
`scripts/dev/seed-unmatched.ts`, que es **sólo local**.

## 1.6 Levantar y probar

```bash
npm run dev                 # http://localhost:3000
npm test                    # suite unitaria
npm run test:integration    # necesita MariaDB real
```

La suite unitaria son 293 archivos que corren y unos 4169 casos, y **no requiere un archivo de
entorno**: el patrón dominante es mockear el cliente de base de datos. Esa garantía la
sostienen dos tests de pureza, y un módulo nuevo que importe el cliente desde una cadena
que algún test toca rompe la suite entera en una máquina sin configurar, con un síntoma que
no apunta al culpable.

La suite de integración son 4 archivos y 14 casos que hablan con MariaDB de verdad. Exige
`DATABASE_URL_TEST` apuntando a una base real y migrada —la de Docker sirve—; sin esa
variable los cuatro se saltean enteros. Cada archivo usa un año propio (1997 o 1999) para
no pisarse, y la configuración desactiva el paralelismo entre archivos: dos que toquen la
serie de recibos del mismo año producen un hueco en la numeración sin que haya ningún bug.

**No hay integración continua.** No existe ningún pipeline en el repositorio: los tests y
el linter se corren a mano, y nada impide desplegar con la suite en rojo, porque
`deploy.sh` no los ejecuta.

## 1.7 Volver la base a una línea de base conocida

Es el procedimiento que se usó al terminar el simulacro del Módulo 6, y el que conviene
usar antes y después de cualquier prueba destructiva en local. Saltear el primer paso o el
último es lo que convierte una restauración en un incidente.

```bash
# 1. Dump del estado actual, por si hay que volver.
docker exec sigev-db mysqldump -usigev -p'<clave>' \
  --single-transaction --routines --triggers --events --hex-blob \
  sigev > sigev-actual.sql
tail -2 sigev-actual.sql        # tiene que cerrar con "Dump completed on …"

# 2. Restaurar. El dump trae DROP TABLE IF EXISTS por tabla.
docker exec -i sigev-db mysql -usigev -p'<clave>' sigev < <dump-elegido>.sql
echo "exit=$?"                  # tiene que ser 0

# 3. El cliente sigue con el pool viejo: forzar la recarga del servidor de desarrollo.
touch next.config.ts
```

Que el cliente de MySQL salga con código 0 no prueba que la restauración sea correcta. Lo
que da certeza es comparar contenidos: cargar el dump en una base auxiliar del mismo
contenedor y cotejar tabla contra tabla con `CHECKSUM TABLE … EXTENDED`. El bloque completo
está en `.superpowers/sdd/simulacro/etapas-5-6.md` §16, que es donde se midió que las 33
tablas quedaban idénticas.

## Dónde está en el código

`docker-compose.yml`, `docker/mariadb-init/01-shadow-db.sql`, `.env.example`,
`package.json`, `prisma/seed.ts`, `prisma/seed-guard.ts`, `prisma.config.ts`,
`scripts/*.ts`, `vitest.config.mts`, `vitest.integration.config.mts`.

---

# 2. Variables de entorno

Referencia completa y comentada: `.env.example`. Esta tabla la resume y agrega qué pasa si
falta.

| Variable | Requerida | Producción | Si falta |
|---|---|---|---|
| `DATABASE_URL` | sí | MariaDB local del servidor | El cliente de Prisma **lanza al evaluarse**, con mensaje explícito |
| `SHADOW_DATABASE_URL` | sólo dev | no existe | La migración de desarrollo no puede validar |
| `DATABASE_URL_TEST` | sólo tests | no | Los 4 archivos de integración se saltean enteros |
| `AUTH_SECRET` | sí | cadena larga | No se firma la sesión |
| `AUTH_URL` | sí | la dirección del sitio con esquema | **Se hornea en el build**: de ahí salen las URLs canónicas, el archivo de robots y el sitemap |
| `ALLOW_LOCALHOST_BASE_URL` | no | **prohibida** | Escotilla que desactiva la guarda anterior |
| `SEED_SUPERADMIN_PASSWORD` | al crear | sí | Sólo se usa para crear la cuenta; si ya existe, ni se mira |
| `SEED_ALLOW_TEST_USERS` | no | **prohibida** | Ausente, las cuentas de prueba no se crean (falla cerrado) |
| `SEED_TEST_USERS` | no | `"false"` o ausente | En falso **gana** sobre el opt-in anterior. La contraseña de esas cuentas va en `SEED_TEST_PASSWORD`, que es sólo de desarrollo |
| `MP_ACCESS_TOKEN` | sí | **productivo desde el 22/08/2026** | Sin él no hay cobros ni conciliación |
| `MP_WEBHOOK_SECRET` | sí | del panel productivo | Si no coincide con el panel de Mercado Pago, la ruta responde 401 sin persistir el aviso; la única señal es el contador de firmas rechazadas de la pantalla de salud, con ventana de 24 h |
| `BREVO_SMTP_HOST` · `_PORT` · `_USER` · `_KEY` y `MAIL_FROM` | para enviar | sí | Sin las cuatro de Brevo más el remitente, cae al transporte de consola. La dirección remitente tiene que estar verificada en Brevo |
| `EMAIL_ALLOWLIST` | no | **se borra al lanzar** | Definida, ningún correo sale fuera de la lista |
| `MAIL_BATCH_CAP` | no | `50` | Tope de **correos** por corrida. Vacío, cero o basura caen a 50 |
| `UPLOADS_DIR` | sí en producción | `/var/sigev/uploads` | Cae **en silencio** dentro del árbol del repositorio, y ahí queda fuera del backup |
| `RECEIPTS_DIR` | sí en producción | `/var/sigev/recibos` | Misma falla silenciosa, y con la misma consecuencia sobre el backup |
| `BACKUP_DIR` | recomendada | `/var/sigev/backups` | La pantalla de salud dice "sin configurar" |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` | sí | reales | La pública **se hornea en el bundle del cliente** y sin ella no entra nadie al panel ni se asocia; la secreta se lee en tiempo de ejecución |
| `CRON_SECRET` | sí | fuerte | Los cinco endpoints de tareas programadas responden **503** |
| `APP_DIR` | opcional | por defecto `/root/dev/ciudadela` | La usa el script de despliegue |

Cinco se hornean en el build o fallan en silencio y llevan su propio paso de verificación:
la dirección pública del sitio y su escotilla de localhost, las dos carpetas de archivos y
la clave pública del captcha. Y dos cosas **no** son variables de entorno, porque cambiarlas
no puede exigir un despliegue: el puerto de producción, que vive en el script de arranque de
`package.json`, y las claves de configuración del capítulo siguiente.

## Dónde está en el código

`.env.example`, `src/lib/prisma.ts`, `src/lib/auth/`, `src/lib/email/`,
`src/lib/cron/auth.ts`, `next.config.ts`.

---

# 3. La tabla `Configuration`

Es un almacén de clave y valor JSON: guarda lo que el superadmin tiene que poder cambiar
sin tocar el servidor. Las claves las crea la semilla en cada despliegue; los valores se
editan desde **Configuración** (`/admin/configuracion`) salvo donde se indique.

| Clave | Quién la edita | Efecto | Si falta |
|---|---|---|---|
| `asociate_activo` | Configuración → Sitio público | Abre o cierra el alta pública | Cuenta como apagada |
| `colaborador_habilitado` | Configuración → Sitio público | Ofrece la categoría de socio colaborador en el alta y en las solicitudes del socio | **Ausente cuenta como apagada** |
| `contact_phone` · `contact_email` | Configuración → Sitio público | Datos de contacto del sitio | No se muestran |
| `terms_text` · `privacy_consent_text` | Configuración → ASOCIATE | Textos legales del alta, en texto plano | El formulario queda vacío |
| `mp_plan_active_id` · `mp_plan_shared_id` | Configuración → ASOCIATE | Los dos planes de Mercado Pago. **Opcionales**: su único uso vivo es el aviso de divergencia entre plan y valor | Ese aviso no corre |
| `digest_recipients` | Configuración → Avisos | Quién recibe el resumen diario | Vacío significa "nadie": el resumen no sale y la corrida igual cierra bien |
| `elecciones_en_curso` | Padrón electoral | Bloquea cambios de categoría durante el acto eleccionario | Cuenta como apagada |
| `reempadronamiento_proceso_id` | El propio proceso, al convocarse | Cuál es el proceso de re-empadronamiento vivo | El alta pública no queda suspendida y el botón del re-empadronamiento no aparece; el tablero lo denuncia en rojo |

El lector de configuración compara de forma **estricta** contra el valor booleano
verdadero: la cadena `"true"`, el número `1` y el valor nulo cuentan como apagado.

La división que atraviesa el archivo: las páginas públicas leen con caché —etiqueta
`config`, invalidada por las acciones que escriben— y **toda guarda lee directo, sin
caché**, porque un valor verdadero viejo dejaría crear solicitudes después de apagar la
llave.

Hay una cuarta forma de configuración que no vive acá: el **valor de la cuota**. Desde el
Módulo 4 la tabla `fee_values` es la única fuente de montos y los planes de Mercado Pago
son referencia. Un valor nuevo se registra desde Configuración → Tesorería y **nunca se
edita**: se asienta otro encima, como un acta (runbook 10.1).

## Dónde está en el código

`src/lib/config-keys.ts` (módulo puro, sin un solo import), `src/lib/config.ts`,
`src/lib/cache-tags.ts`, `src/app/admin/configuracion/actions.ts`.

---

# 4. Producción

## 4.1 El servidor

Aplicación en `/root/dev/ciudadela`; acceso por SSH al puerto 2222 como root; MariaDB en el
host, no en contenedor; proceso `sigev` bajo PM2 en el puerto **3006**; dominio
`vecinalciudadela.ar`. El puerto **vive en `package.json`**
(`"start": "next start -p 3006"`), no en el archivo de entorno: ninguna variable lo
gobierna, y si alguien cambia ese script, Nginx pasa a proxear hacia un puerto muerto.

**PM2 corre una sola instancia, y no se toca.** El proyecto asume un único proceso: los
candados por documento y los limitadores de frecuencia viven en memoria. Subir `instances`
los multiplicaría y cada réplica tendría su propio conteo. El arranque de PM2 está
habilitado en systemd, así que las aplicaciones levantan solas tras un reinicio; después de
agregar un proceso hay que guardar la lista.

## 4.2 Nginx

Nginx 1.18.0 —no soporta la directiva `http2 on;`, hay que usar la forma vieja en la línea
de escucha—. Tres bloques de servidor: el puerto 80 redirige a HTTPS, el subdominio `www`
redirige a la raíz, y el real proxea a `http://127.0.0.1:3006`. Cuatro piezas que no son
opcionales:

- Un cuerpo máximo de 15 MB, por las portadas, los documentos y los anexos.
- La cabecera `X-Forwarded-Proto` en `https`: sin ella Auth.js cree que la petición es HTTP
  y rompe las cookies de sesión.
- Las **22 líneas de rangos de Cloudflare** con la cabecera de IP real, **dentro del bloque
  de servidor**, no globales. Sin eso la dirección remota es el borde de Cloudflare, todos
  los visitantes comparten una IP y cinco intentos fallidos de cualquiera dejan afuera al
  barrio entero. Es además la única fuente de dirección IP del proyecto: los asientos de
  auditoría la leen de `X-Real-IP`, que Nginx sobrescribe.
- Vaciar la cabecera de IP que manda el cliente antes de proxear, para que sólo valga la que
  resolvió el módulo de IP real.

Activación: enlace simbólico, `nginx -t` y **recarga, nunca reinicio** — hay otras cuatro
aplicaciones en producción en el mismo servidor.

## 4.3 Cloudflare

Plan gratuito, con proxy activo. Ahí viven el DNS, el certificado de origen propio del
dominio y el encabezado de transporte estricto, que se prende en SSL/TLS → Edge
Certificates. Tres consecuencias operativas:

1. **Corta la conexión al origen a los ~100 segundos y devuelve 524.** Un 524 en el log de
   una tarea programada **no** significa que la corrida no haya pasado: la verdad está en la
   tabla de corridas.
2. **El firewall de aplicación puede bloquear una subida sin dejar rastro en el servidor.**
   Es el capítulo 9.3.
3. Las portadas de noticias se sirven por una ruta pública con caché inmutable, así que el
   borde las cachea; es contenido público y así está previsto.

## 4.4 Servicios externos

**Brevo** entrega el correo transaccional por SMTP. El dominio autenticado es el mismo del
sitio, y la dirección remitente tiene que estar verificada en Brevo o el envío se rechaza.

**Turnstile** protege los formularios públicos anónimos: el alta y el reenvío de su enlace
de retome, el ingreso, la recuperación de contraseña, el primer paso del re-empadronamiento
y el primer paso de los reportes. Los formularios que se abren con un token de un solo uso
no lo llevan: el token ya es la barrera.

**Mercado Pago** corre con credenciales **productivas desde el 22/08/2026**. Dos cosas que
cuesta caro no saber: el panel de webhooks tiene **dos solapas**, prueba y producción, y un
token de aplicación de una cuenta de prueba dispara por la productiva, así que con una sola
configurada el silencio es total y nada se encola; y **nunca se prueban cobros en
producción**, porque ahí la plata es de un vecino. El circuito se ejercita en local con
cuenta de prueba y túnel (`docs/11` Parte J).

## 4.5 Lo que se hornea en el build

El build fija en el artefacto dos variables: la dirección pública del sitio (`AUTH_URL`) y
la clave pública del captcha. Cambiar cualquiera de las dos exige **volver a construir**: un
reinicio de PM2 no alcanza.
Si el build sale con el dominio equivocado, el sitio publica sus URLs canónicas hacia otra
dirección y se desindexa solo.

## Dónde está en el código

`package.json` (script `start`), `deploy.sh`, `next.config.ts`, `src/lib/turnstile.ts`,
`src/lib/mp/gateway.ts`, `src/lib/email/transport.ts`. Nginx y Cloudflare no viven en el
repositorio: están en `docs/10` §1 y §2.

---

# 5. Desplegar

## 5.1 El script

El despliegue es basado en Git: se empuja a GitHub, se trae en el servidor, se construye y
se reinicia el proceso.

```bash
bash /root/dev/ciudadela/deploy.sh
```

| Paso | Por qué |
|---|---|
| `git pull --ff-only` | Nunca un merge en el servidor |
| `npm ci` | **A secas**, sin podar las dependencias de desarrollo: el `postinstall` genera el cliente con el CLI de Prisma y la semilla corre con `tsx`. Las dos son dependencias de desarrollo, y podarlas rompe el despliegue |
| `npx prisma migrate deploy` | Aplica lo que falte. **Nunca `db push`** |
| `NODE_ENV=production npx prisma db seed` | Crea las claves de configuración que estrena cada módulo. Va **antes** del build porque el alta pública se prerenderiza leyendo los textos legales |
| `npm run build` | Acá se hornean las dos variables del capítulo 4.5 |
| `pm2 restart sigev --update-env` | Sin actualizar el entorno no toma los cambios del archivo |
| `pm2 save` | Deja el proceso registrado para el próximo reinicio del servidor |

La variable de entorno de producción se pone **sólo en la línea de la semilla**, sin
exportar: exportarla haría que el `npm ci` de arriba dejara de instalar las dependencias de
desarrollo. Es cinturón y tirantes sobre la guarda real, que es el opt-in explícito de las
cuentas de prueba.

`docs/10` §4.1 agrega al final un paso que el script no incluye y conviene correr siempre:
`pm2 logs sigev --lines 20 --nostream`.

## 5.2 Con migración

**Backup primero, siempre, aunque la migración parezca inofensiva** (`docs/10` §4.1):

```bash
mysqldump --single-transaction --routines sigev \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file /root/.sigev_backup_pass \
        -o /root/backup-pre-deploy-$(date +%F).sql.gz.gpg

gpg --batch --quiet --decrypt --passphrase-file /root/.sigev_backup_pass \
    /root/backup-pre-deploy-$(date +%F).sql.gz.gpg | gunzip | tail -1
```

La última línea tiene que decir `-- Dump completed on …`. **Si no, no se sigue.** Después,
el despliegue normal: `migrate deploy` aplica las migraciones que falten, en orden, en el
mismo comando de siempre.

## 5.3 Verificación post-despliegue

Vale para cualquier despliegue (`docs/10` §4.6):

```bash
curl -sI https://vecinalciudadela.ar | grep -i 'content-security-policy'
curl -sI https://vecinalciudadela.ar | grep -i 'strict-transport-security'
curl -s  https://vecinalciudadela.ar/robots.txt | tail -2
```

La política de seguridad de contenido tiene que llegar **entera**: la emite Next y tiene que
sobrevivir a Nginx y a Cloudflare. Si el encabezado de transporte estricto vuelve vacío,
falta prenderlo en Cloudflare. Y la última línea del archivo de robots apunta al sitemap:
**si dice otro dominio, el build se hizo con la base equivocada** y hay que rehacerlo. El
cuarto paso no es un comando: entrar a `/ingresar` desde el navegador, porque las dos claves
del captcha cierran el panel entero y la pública se hornea en el build.

Cada fase tuvo además su verificación propia, y sirven de modelo. El **Módulo 7** (§4.9)
trajo tres migraciones, la última con un relleno que **renumera** lo ya enviado, y cierra
con una consulta que comprueba que ningún reporte enviado quedó sin número. La **fase 4D**
(§4.10) trajo una migración aditiva y una verificación **por pantalla**. El arreglo de
**pagos ajenos** (§4.11) no trajo migración y se verifica con una corrida manual de la
conciliación. El patrón es siempre el mismo: qué migra, qué se mira en la base, qué se mira
en una pantalla.

## 5.4 Volver atrás

El riesgo real **no** es tipear mal el nombre del backup —un archivo inexistente falla
cerrado— sino **elegir el backup equivocado**: uno viejo que sí existe se restaura sin
chistar y se lleva puesto todo lo posterior. Por eso el procedimiento de `docs/10` §4.1 son
cuatro pasos y no uno: (1) **listar** los candidatos con su fecha y elegir mirando;
(2) fijar el elegido en su propia variable; (3) **verificar** que descifra y qué fecha
tiene; (4) recién ahí restaurarlo sobre la base viva y reiniciar el proceso.

```bash
# 1 y 2. Listar y fijar. El caso normal es el de hoy: el deploy salió mal recién.
ls -lh --time-style=long-iso /root/backup-pre-deploy-*.sql.gz.gpg
export RESTORE_FILE=/root/backup-pre-deploy-$(date +%F).sql.gz.gpg
```

La salida del paso 3 tiene que traer la fecha y la hora del backup que se quiere restaurar.
Si no descifra, si no dice eso, o si la fecha no es la esperada, se frena ahí: todavía no se
tocó nada. Los pasos 3 y 4 del original llevan adelante una condición de existencia sobre
esa variable, y es deliberada: pegado el bloque en una terminal nueva, donde el paso 2 no
corrió, **no se ejecuta nada**. Los dos comandos completos se copian de `docs/10` §4.1; no
se tipean de memoria.

Y el código también vuelve atrás, al commit anterior. Hay una trampa anotada: volver a un
commit previo a los cuatro espacios de actividades sólo es seguro mientras no exista
ninguna actividad en los dos espacios nuevos; con filas así en la base, el código viejo
devuelve 500 en la página pública de actividades.

## 5.5 Cinco reglas que no se rompen

De `docs/10` §4.3: nunca un borrado o una actualización con un marcador de posición dentro
de un bloque copiable; nunca `prisma db push`; nunca un backup sin verificar; no tocar
`instances` de PM2; no se prueban cobros en producción.

> Corolario operativo, medido: tras un cambio de `next.config.ts` hay que **reiniciar el
> servidor de desarrollo antes de medir cabeceras**. Una configuración vieja en el proceso
> mostró la política global en una ruta que tiene la suya y pareció un error de código que
> no existía.

## Dónde está en el código

`deploy.sh`, `prisma/migrations/`, `next.config.ts`. El procedimiento completo, con el
diario de cada fase, está en `docs/10` §4.

---

# 6. Tareas programadas

## 6.1 Las seis líneas del crontab

Cinco endpoints de la aplicación más el backup. Es el estado completo del crontab de root
(`docs/11` Parte H).

| Hora AR | Ruta | Qué hace | Cuándo saltea |
|---|---|---|---|
| 00:30 | `/api/cron/accrual` | Devenga las cuotas del mes vencido | Todos los días salvo el 1° |
| 03:17 | `/api/cron/reconcile` | Conciliación de cinco pasos con Mercado Pago | Nunca |
| 04:00 | `scripts/backup.sh` | Backup (no es un endpoint) | Nunca |
| 07:30 | `/api/cron/digest` | Purga de retención de reportes y resumen diario a la Comisión | Sin novedades |
| 08:05 | `/api/cron/applications` | Recordatorio de pago a los 3 días y expiración a los 7 de una solicitud de alta | Nunca |
| 10:00 | `/api/cron/reminder` | Recordatorio de vencimiento de la cuota del mes | Todos los días salvo el último del mes |

Las expresiones horarias, en el mismo orden: `30 0 * * *`, `17 3 * * *`, `0 4 * * *`,
`30 7 * * *`, `5 8 * * *` y `0 10 * * *`.

Cada corrida efectiva escribe una fila en `cron_runs` con su resumen y deja un asiento de
auditoría. El devengo y el recordatorio llevan siempre el campo de forzado en el resumen,
también en falso: si sólo apareciera al forzar, la pantalla no podría separar una corrida
automática de una fila vieja sin el campo.

Forma de cada línea, con el secreto en un archivo aparte de permisos restringidos:

```bash
17 3 * * * curl -sS --max-time 900 -X POST \
  -H "Authorization: Bearer $(cat /root/.sigev-cron-secret)" \
  https://vecinalciudadela.ar/api/cron/reconcile >> /var/log/sigev-cron.log 2>&1
```

El minuto 17 y no en punto es deliberado: el rechazo por frecuencia de Mercado Pago es
cuota compartida entre clientes y a las horas redondas se amontonan las tareas de todo el
mundo. El tiempo máximo generoso también: la primera corrida de mantenimiento arrastra el
atraso y cada expiración con suscripción cancela en serie contra la API. **Un timeout no es
un fallo**: la corrida siguiente termina lo que quedó, y no hay que relanzar en bucle. El
bloque de instalación de `docs/11` Parte H es **idempotente por existencia, no por
contenido**: si ya hay una línea de conciliación con el horario viejo, no la corrige.

## 6.2 Cómo se leen las respuestas

Los cuatro códigos significan lo mismo en los cinco endpoints: **200** es corrida sin
errores; **207** es que corrió entera pero algún paso falló, y es la **única señal** de que
la red de seguridad se rompió (no es "casi 200"); **401** es que el secreto del crontab no
coincide con el del archivo de entorno; **503** es que `CRON_SECRET` no está definida.

Dos reglas de lectura del log:

- **Un salteo es una corrida sana.** Las tres respuestas de salteo —no es día 1, no es el
  último día del mes, no hay novedades— **no escriben fila**, a propósito: la pantalla de
  salud muestra la última corrida **efectiva**, y 29 filas vacías por mes taparían la única
  que importa.
- **Un 524 no significa que no haya corrido.** Cloudflare corta a los ~100 segundos.

Todas las tareas abren su fila **antes** de trabajar: si el proceso muere, queda sin fecha
de fin y la pantalla la muestra como "Quedó colgada", que es distinto de haber corrido mal.
Los asientos de auditoría van **sin datos personales**.

## 6.3 Las dos escotillas

El devengo y el recordatorio actúan un solo día del mes. Si esa corrida se pierde, sin
escotilla el devengo recién se recuperaba al mes siguiente y el aviso de ese mes no salía
nunca. Las dos viajan detrás del **mismo secreto**: no hay barrera nueva (`docs/11` Parte
H).

```bash
export S=$(cat /root/.sigev-cron-secret)
export URL=https://vecinalciudadela.ar/api/cron
curl -sS -X POST -H "Authorization: Bearer $S" "$URL/accrual?force=1" -w '\nHTTP %{http_code}\n'
curl -sS -X POST -H "Authorization: Bearer $S" "$URL/accrual?force=1&upTo=2026-09" -w '\nHTTP %{http_code}\n'
curl -sS -X POST -H "Authorization: Bearer $S" "$URL/reminder?force=1" -w '\nHTTP %{http_code}\n'
```

Qué esperar y qué cuidar:

- **Una corrida forzada sí es una corrida**: deja fila y se ve en la pantalla de salud, y
  volver a correr el devengo no duplica nada (la segunda vez crea cero cuotas).
- El tope de mes tiene rango derivado —piso en el primer mes que la foto de deuda no cubre,
  techo en el mes vencido— y fuera de rango es un **400 con el rango en el cuerpo**, no un
  silencio ni un 500. Los parámetros se validan antes de mirar el calendario.
- Sólo se aceptan los valores `1` y `true`; cualquier otro es 400, y un parámetro mal
  escrito se ignora en silencio. La lista blanca es deliberada: leer un cero como "forzar"
  sería lo contrario de lo que escribió el operador.
- El recordatorio **adapta el texto por calendario, no por el parámetro**, y avisa por el
  período que corresponde al día en que se lo corre: perdido el aviso de septiembre y
  forzado en octubre, avisa octubre.

El resumen diario **no tiene escotilla**: corre todos los días y su ventana es el día
anterior, así que forzarlo sería remandar lo mismo.

## Dónde está en el código

`src/app/api/cron/*/route.ts`, `src/lib/cron/auth.ts` (la guarda común, con comparación de
tiempo constante), `src/lib/treasury/accrual.ts`, `src/lib/treasury/reminder.ts`,
`src/lib/mp/reconcile.ts`, `src/lib/reports/retention.ts`. El crontab está en `docs/11`
Parte H.

---

# 7. Backups

## 7.1 Qué hace el script

`scripts/backup.sh` corre a las 04:00 como root. Instala una trampa de error que dice **en
qué línea** se cortó —sin ella un fallo a mitad de camino sale mudo salvo por el código de
salida—; crea las tres carpetas si no existen; vuelca **tres bases** (la del sistema y otras
dos aplicaciones del mismo servidor, que no tenían ningún otro backup); empaqueta las
subidas y los recibos; cifra los cuatro archivos con GPG simétrico AES256 y borra los
claros; los sube a Google Drive filtrando por el sello del día; poda local y remota a **30
días**, la remota **acotada a los archivos cifrados**, porque sin ese filtro barrería
cualquier archivo del destino; y escribe el sello `LAST_OK` con la fecha y hora UTC.

Ese sello es lo que lee la pantalla de salud, y por eso `BACKUP_DIR` tiene que apuntar
exactamente a la carpeta que el script escribe. Si no está, el panel dice "sin configurar";
si apunta a otra carpeta, dice "sin rastro", que es peor porque parece un backup roto.

## 7.2 Restaurar

Para volver atrás un despliegue, el procedimiento de cuatro pasos del capítulo 5.4.

Para una restauración completa hay un antecedente con una lección cara: el rearmado de la
base del 22/08/2026 **perdió las actividades cargadas a mano**. De todas las tablas, sólo
seis sobreviven a un rearmado desde los archivos de datos: configuración, usuarios, roles,
asignación de roles, actividades y noticias. Las dos últimas son contenido cargado desde el
panel y **no hay ningún archivo que las reponga**. El procedimiento está en `docs/10` §4.2
y arranca por apagar el alta pública y no usar el panel hasta terminar.

Con datos reales cargados —278 socios, 3076 cuotas, recibos emitidos— el rearmado **no se
vuelve a correr nunca**: no hay forma de des-importar.

## Dónde está en el código

`scripts/backup.sh`, `src/lib/admin/health-backup.ts` (el lector del sello).

---

# 8. La pantalla de salud

`/admin/salud` es de **superadmin**; un administrador común ni siquiera tiene la sección en
la barra lateral. Tiene un banner de veredicto arriba y cuatro pestañas: **Tareas** (las
cinco tareas programadas), **Infraestructura** (el backup y el estado de Mercado Pago),
**Dinero** (la bandeja de cobros sin conciliar, divergencias de monto y débitos vivos de
socios dados de baja) y **Correo** (avisos fallidos, recibos pendientes de envío y accesos
trabados).

## 8.1 Tres niveles, no dos

Es la decisión de diseño que hace que la pantalla sirva. **Actuar** es algo roto **con una
salida concreta que lo apaga**: es el único rojo, y lo único que cuenta para el punto rojo
de cada pestaña. **Revisar** son ausencias, colas normales y cruces sanos. **Historia** son
los contadores acumulativos —total histórico de la bandeja, de divergencias, de fallidos—,
redactados como contexto y **nunca como trabajo pendiente**: un contador sin ventana ni
acción que lo baje enseña a ignorar el tablero, y el proyecto ya lo corrigió tres veces.

## 8.2 Las varas de cada tarea

El período esperado **no es el intervalo del crontab**, porque tres de las cinco tareas
corren todos los días y actúan uno solo: 24 horas para la conciliación y el mantenimiento
de solicitudes, **24 × 31 horas** para el devengo y el recordatorio, y 24 × 7 para el
resumen diario. Una tarea se marca "Hace mucho que no corre" recién al **doble** de su
período. Medir a
las cinco con la misma vara pintaría de rojo tres tareas sanas 29 días de cada 30.

Los cinco estados, con el texto que muestra la pantalla: **Al día**, **Terminó con
errores**, **Hace mucho que no corre**, **Quedó colgada** (empezó y no terminó, a partir de
las dos horas abierta) y **Nunca corrió**.

## 8.3 Si se ve X, hacer Y

| Lo que dice la pantalla | Qué significa | Qué hacer |
|---|---|---|
| Devengo en "Nunca corrió" y ya pasó un día 1 | La línea del crontab falta o falló | Verificar el crontab; correr la escotilla (runbook 10.2) |
| Una tarea en "Terminó con errores" | Cerró en 207 | Abrir el resumen de la corrida, que dice qué ítem falló |
| Una tarea en "Quedó colgada" | Empezó y el proceso murió | Revisar el log de PM2 de esa hora; volver a correrla si tiene escotilla |
| Backup "sin configurar" | Falta `BACKUP_DIR` | Agregarla y reiniciar el proceso actualizando el entorno |
| Backup "sin rastro" | La variable apunta a otra carpeta, o el script instalado es anterior al sello | Comprobar a mano que el archivo de sello exista antes de sacar conclusiones |
| Backup "no se puede leer" | El sello está pero la aplicación no tiene permiso | Lo roto son los permisos de la pantalla, **no** el backup |
| Bandeja con filas pendientes | Cobros que no se pudieron imputar | Resolverlos desde Tesorería → Sin conciliar; es trabajo normal, no una falla |
| Firmas rechazadas en 24 h | El secreto del webhook no coincide con el panel de Mercado Pago | Cotejar las dos solapas del panel contra el archivo de entorno |
| Avisos fallidos o recibos sin enviar | Fallos reales de envío, con su **código**, o envíos diferidos por el tope de correos | Reenviar desde la propia pantalla o desde el recibo (runbook 10.5) |

Un punto que ahorra un susto: **un bloqueo por lista blanca de correo no es un fallo**. Se
cuenta aparte y no escribe fila roja. Si contara, en producción —donde la lista sigue
puesta— una sola corrida dejaría unas 160 filas rojas y la pantalla nacería inservible.

## Dónde está en el código

`src/app/admin/salud/`, `src/lib/admin/health.ts`, `src/lib/admin/health-alerts.ts`,
`src/lib/admin/health-backup.ts`, `src/lib/admin/salud-tabs.ts`.

---

# 9. Logs y diagnóstico

## 9.1 Dónde mirar

| Fuente | Comando o pantalla | Qué trae |
|---|---|---|
| Aplicación | `pm2 logs sigev --lines 50 --nostream` | Errores y avisos del servidor |
| Tareas programadas | `/var/log/sigev-cron.log` | La respuesta cruda de cada corrida |
| Corridas | Pantalla de salud, o la tabla `cron_runs` | Cada corrida efectiva con su resumen |
| Webhooks | Tabla `webhook_events` | **Todo** aviso crudo recibido, con asunto, cuerpo, resultado y error |
| Avisos por correo | Tabla `notifications` | Estado de cada correo y el código del fallo |
| Auditoría | Tabla `audit_log` | Acciones sensibles: actor, entidad y detalle |

La rotación de logs de PM2 figuraba como **no instalada** en `docs/09` (17/08/2026), sin
confirmación posterior. Tampoco hay panel de espacio en disco.

## 9.2 Qué no va a aparecer en los logs

Por Ley 25.326 el sistema enmascara antes de escribir. No es una omisión sino una decisión,
y conviene saberlo para no buscar lo que no está:

| Punto | Qué se guarda |
|---|---|
| Log de la aplicación | Mensaje con las direcciones enmascaradas y cortado a 200 caracteres: los errores de Nodemailer traen la dirección en claro dentro del mensaje |
| Fallo de un aviso | **Sólo el código** del fallo, nunca la dirección. Se escribe en un único lugar y cubre los doce puntos de llamada |
| Bloqueo por lista blanca y errores de disco | El motivo o el código del error; nunca la dirección ni la ruta absoluta |
| Auditoría de documentos y resúmenes de tareas | Identificadores, tipo, contadores, períodos y códigos: ni nombres, ni documentos, ni rutas |
| Búsquedas públicas por documento | El nombre enmascarado, del estilo "M****** P." |

Los errores de Mercado Pago pasan además por un formateador propio, porque el SDK **no lanza
objetos de error**.

## 9.3 El 403 que no deja rastro

**Síntoma**: una subida falla con un mensaje genérico de respuesta inesperada y un 403 en la
consola del navegador, y en el servidor **no aparece nada**: el log de PM2 ni registra el
pedido.

**Reconocerlo en diez segundos**: las cabeceras traen el servidor de Cloudflare y su
identificador de traza, y el cuerpo es HTML de unos 3 kB. La clave es que **el código del
proyecto no produce 403 en una acción de servidor**: las acciones devuelven un error con
código 200 y el proxy redirige con 302.

**Caso real, 30/08/2026**: una regla administrada del firewall de aplicación bloqueó una
subida de 1,2 MB al panel de documentos, por un falso positivo. El arreglo en el plan
gratuito es una regla propia que saltea el conjunto administrado para esos envíos, con el
registro de coincidencias encendido. El costo, dicho con todas las letras: en ese plan **no
se puede saltear sólo esa regla**, se apaga el conjunto entero. Es aceptable en una ruta que
exige sesión de administrador; **no automáticamente aceptable en una ruta pública**.

Las cinco rutas que suben archivos son el alta, el re-empadronamiento, documentos, noticias
y la carga presencial de presentaciones. **Las dos primeras son públicas**, y ahí está el
pendiente anotado: revisar en el panel de seguridad de Cloudflare si esa regla bloqueó
alguna vez un envío del alta. Si lo hizo, hay un vecino que quiso asociarse y no pudo, y
**no hay otra forma de enterarse**.

Un síntoma vecino, en el otro extremo: el **rechazo por frecuencia** de Mercado Pago es
cuota compartida entre clientes, no un límite propio, y se dispara en las horas redondas. La
mitad del arreglo fue mover la conciliación al minuto 17; la otra mitad, el reintento
endurecido del módulo de reintentos. Verificado en producción el 30/08/2026.

## 9.4 Consultas de sólo lectura

```sql
SELECT id, topic, received_at, processed_at, result, error
FROM webhook_events ORDER BY id DESC LIMIT 20;
SELECT id, type, status, error, sent_at
FROM notifications WHERE status = 'failed' ORDER BY id DESC LIMIT 20;
SELECT id, created_at, user_id, action, entity, entity_id, detail
FROM audit_log WHERE entity = 'receipt' AND entity_id = 123 ORDER BY id DESC;
```

Responden, en ese orden: si llegó el aviso de Mercado Pago y qué se hizo con él; si salió el
correo y con qué código falló; y quién hizo qué sobre una entidad. En local van prefijadas
por `docker exec -i sigev-db mariadb …`.

## Dónde está en el código

`src/lib/log-safe.ts`, `src/lib/email/index.ts`, `src/lib/mp/retry.ts`, `src/lib/audit.ts`
y `src/lib/members/masked-name.ts`; el bloqueo de Cloudflare, en `docs/10` §4.8.

---

# 10. Runbooks

## 10.1 Registrar un valor de cuota nuevo

1. Entrar como **superadmin** a Configuración (`/admin/configuracion`), pestaña Tesorería.
2. Cargar el importe y la fecha desde la que rige; el acta es opcional. Guardar.
3. **El valor nunca se edita**: si el importe está mal, se registra otro encima, como un
   acta.
4. Verificar en Tesorería → Valores que la fila nueva aparezca con su vigencia.
5. Si hay suscripciones de Mercado Pago con importe divergente, esa misma pantalla ofrece el
   lote de actualización, que es de superadmin y pide confirmación explícita.

La vigencia se guarda al mediodía del día civil argentino y la lectura del valor vigente
compara contra el mediodía civil de hoy. Sin eso, un valor no regiría hasta las 09:00 y un
devengo de madrugada abortaría por falta de monto.

## 10.2 Correr un devengo o un recordatorio perdido

```bash
export S=$(cat /root/.sigev-cron-secret)
export URL=https://vecinalciudadela.ar/api/cron
curl -sS -X POST -H "Authorization: Bearer $S" "$URL/accrual?force=1" -w '\nHTTP %{http_code}\n'
```

1. Esperar 200 y un resumen con el forzado en verdadero.
2. Comprobar en la pantalla de salud que el devengo pasó de "nunca corrió" a su última
   corrida.
3. Volver a correrlo no duplica nada: la segunda vez crea cero cuotas.
4. Para el recordatorio, la misma llamada contra `/reminder`. Avisa por el período que
   corresponde **al día en que se lo corre**: un aviso perdido de un mes no se recupera al
   mes siguiente.

## 10.3 Correr la conciliación a mano

```bash
export S=$(cat /root/.sigev-cron-secret)
curl -sS -X POST -H "Authorization: Bearer $S" \
  https://vecinalciudadela.ar/api/cron/reconcile -w '\nHTTP %{http_code}\n'
```

1. **200** con la lista de errores vacía es lo esperado; **207** significa que corrió entera
   pero algo falló.
2. El resumen trae los contadores de cada paso, entre ellos el de pagos ajenos.
3. Un pago recuperado por esta vía queda **idéntico** a uno aplicado por el aviso que se
   perdió: la conciliación reutiliza el mismo procesador.
4. Si aparecen filas nuevas en la bandeja, se resuelven desde Tesorería → Sin conciliar.

## 10.4 Reenviar una invitación y dar de alta un usuario de gestión

1. Entrar como **superadmin** a Usuarios (`/admin/usuarios`). Los estados accionables son
   "invitado" e "invitación vencida"; el reenvío está en la ficha, sección Invitación, y
   deja asiento de auditoría.
2. **Un bloqueo por lista blanca de correo no cuenta como fallo**: si la lista sigue
   definida, el correo no salió aunque la pantalla no muestre un error.
3. Para un alta, Usuarios → Nuevo con nombre y correo. La cuenta nace con una contraseña
   aleatoria que **nadie conoce**: el acceso se obtiene canjeando el enlace de la
   invitación, que es de un solo uso.
4. Los roles se otorgan desde la ficha y son acumulables. Si la cuenta está desactivada al
   momento del canje, el canje se deshace para conservar el enlace.
5. Para quitar un rol hay dos guardas: nadie puede auto-degradarse de superadmin, y no se
   puede dejar al sistema sin ningún superadmin.

## 10.5 Regenerar o reenviar un recibo

1. Abrir el recibo en Tesorería → Recibos y su ficha. El PDF se sirve por una ruta
   autenticada que **audita cada visualización**.
2. El botón de reenvío manda el PDF por correo y deja asiento con el resultado, **salga o
   no**.
3. Si el archivo no está —porque se escribió en la carpeta equivocada, o porque el proceso
   murió después del commit—, el PDF es **regenerable**: el cobro ya quedó asentado en la
   base y el archivo se rehace al pedirlo.
4. Anular un recibo **no borra** el identificador del pago de Mercado Pago: si se borrara,
   un reenvío de la pasarela volvería a cobrar.

## 10.6 Correr el arreglo de motivos de baja

Pendiente operativo anotado del Módulo 6.

1. En el servidor, primero en seco: `npx tsx scripts/fix-withdrawal-reasons.ts`.
2. Leer el informe: toca **dos columnas** y sólo de socios ya dados de baja, no cambia el
   estado societario de nadie —lo reporta como discrepancia— y **nunca apaga** un bloqueo de
   reingreso.
3. Aplicar con `--apply`.
4. Por qué importa: un socio expulsado con motivo "mora" pasaría la puerta del alta pública.

## 10.7 Lanzar al público

**Borrar la lista blanca de correo es un paso manual** y no ocurre solo.

1. **Borrar `EMAIL_ALLOWLIST`** del archivo de entorno del servidor y reiniciar el proceso
   actualizando el entorno. Mientras siga definida, ningún correo sale fuera de la lista, y
   eso incluye recordatorios y el resumen diario.
2. **Cargar `digest_recipients`** en Configuración → Avisos con la dirección de la Comisión.
   Vacío significa que el resumen no se manda a nadie y la corrida igual cierra en verde.
3. **Prender `colaborador_habilitado`** el día que la Inspección General de Justicia
   oficialice el estatuto reformado. Hasta entonces, apagada.
4. Verificar que el archivo de entorno del servidor no pida las cuentas de prueba:
   `grep -n 'SEED_TEST_USERS\|SEED_ALLOW_TEST_USERS' /root/dev/ciudadela/.env` no debe
   devolver el opt-in, y a lo sumo la otra variable en falso (`docs/10` §4.0).
5. Correr la verificación post-despliegue del capítulo 5.3.

## Dónde está en el código

`src/app/admin/configuracion/actions.ts`, `src/app/admin/usuarios/actions.ts`,
`src/app/admin/tesoreria/recibos/[id]/actions.ts`, `src/lib/treasury/fee-values.ts`,
`scripts/fix-withdrawal-reasons.ts`.

---

# Documentos relacionados

**De esta serie:** T1 visión y panorama; T2 arquitectura y código; T4 modelo de datos; T5
tesorería y Mercado Pago; T6 módulos de dominio; T7 seguridad, privacidad y calidad. Y los
manuales de usuario M1 (operador de la Comisión), M2 (socio) y M3 (vecino).

**Documentación de proyecto**, en `docs/`: `docs/03` es el diseño original de
infraestructura, y lo que dice de dos entornos y de la tabla de tareas programadas es
historia; `docs/07` trae los módulos con sus criterios de aceptación y el checklist de
lanzamiento; `docs/09` es el relevamiento del servidor del 17/08/2026, con varios puntos
pendientes sin confirmación posterior.

`docs/10-runbook-dominio-produccion.md` es **la fuente de todos los comandos de servidor de
este documento**: §3 variables, §4.0 la comprobación previa al primer despliegue, §4.1
despliegue y restauración, §4.2 rearmado, §4.3 las cinco reglas, §4.5 a §4.11 las
verificaciones por fase, §4.6 la verificación general y §4.8 el bloqueo de Cloudflare. Y
`docs/11-preparacion-mp-sandbox-turnstile.md`, Parte H el crontab y las dos escotillas,
Parte J el entorno de prueba de Mercado Pago.
