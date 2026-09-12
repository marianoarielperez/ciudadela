---
title: Arquitectura y código
subtitle: Stack, capas, patrones y componentes compartidos
series: Serie técnica — Documento 2 de 7
docx: SIGeV-T2-Arquitectura-y-codigo
version: 1.0
date: 11/09/2026
---

# Para quién es y qué da por sabido

Este documento es para la persona que hereda el código de SIGeV y tiene que agregarle una
pantalla, arreglar un error o entender por qué una pieza está donde está. No es un tutorial
de Next.js ni de Prisma: da por sabido TypeScript, React con componentes de servidor, SQL
relacional básico y el uso de un ORM.

Lo que sí explica es lo que no se deduce leyendo un archivo suelto: cómo está repartido el
proyecto, qué capa puede hacer qué, y cuáles son los patrones que el proyecto repite a
propósito y que romperlos cuesta caro. Varios de esos patrones no son preferencias de estilo:
nacieron de un error medido en producción o en una sesión de pruebas contra un servicio
externo, y el archivo que los implementa suele abrir con un comentario que cuenta cuál fue.

La verdad de este documento es el código en la rama `main` al 11/09/2026. Donde la
documentación previa del repositorio dice otra cosa, manda el código.

# Cómo leer este documento

Los capítulos 1 a 4 son el mapa: stack, zonas, carpetas y capas. Leídos en orden alcanzan
para ubicarse y para no romper nada grave el primer día.

Los capítulos 5 a 8 son el catálogo de lo reutilizable: los patrones transversales, el marco
del panel, el patrón de formularios y el sistema de color. Se leen salteados, cuando hace
falta.

El capítulo 9 es una lista de pasos para arrancar. Cada capítulo cierra con "Dónde está en el
código", que nombra los archivos donde vive lo que se acaba de explicar: el detalle fino está
ahí, no acá.

---

# 1. El stack

SIGeV es un monolito de Next.js con App Router. Un solo proyecto, un solo proceso y un solo
puerto sirven cuatro cosas: el sitio público, el panel de administración, el panel de socio y
la API (webhooks, tareas programadas y descargas autenticadas). No hay backend separado, no
hay microservicios y no hay cola de mensajes.

## 1.1 Dependencias de runtime

Las versiones son las declaradas en `package.json`. Las dos primeras filas están fijadas sin
rango porque un salto de versión menor del framework rompe el build de producción sin aviso.

| Paquete | Versión | Para qué |
|---|---|---|
| `next` | 16.3.1 (fija) | Framework: App Router, Server Actions, proxy |
| `react` / `react-dom` | 19.2.8 (fijas) | Runtime de interfaz |
| `@prisma/client` | ^7.9.1 | ORM; el cliente se genera a `src/generated/prisma` |
| `@prisma/adapter-mariadb` | ^7.9.1 | Adaptador de driver, en lugar del motor binario |
| `mariadb` | ^3.5.3 | Driver nativo que usa el adaptador |
| `next-auth` | 5.0.0-beta.32 | Auth.js v5, proveedor de credenciales |
| `bcryptjs` | ^3.0.3 | Hash de contraseñas |
| `zod` | ^4.4.3 | Validación de todo formulario y de todo payload |
| `nodemailer` | ^8.0.11 | Envío por SMTP contra Brevo |
| `mercadopago` | ^2.13.0 | SDK oficial de pagos, encapsulado (ver capítulo 5) |
| `sharp` | ^0.35.3 | Recodificación de imágenes y generación de assets |
| `pdf-lib` | ^1.17.1 | Recibos, avisos de cartelera y PDF de reportes |
| `docx` | ^9.7.1 | Exportación de actas a Word |
| `exceljs` | ^4.4.0 | Importación del padrón y exportación del padrón electoral |
| `leaflet` | ^1.9.4 | Mapas de la sede y de los reportes |
| `sanitize-html` | ^2.17.7 | Única defensa contra XSS almacenado en el cuerpo de noticias |
| `radix-ui` | ^1.6.7 | Primitivas sobre las que se arman los componentes |
| `shadcn` | ^4.18.0 | Registro y CLI de componentes |
| `lucide-react` | ^1.31.0 | Iconografía |
| `next-themes` | ^0.4.6 | Modo claro y oscuro |
| `sonner` | ^2.0.8 | Avisos flotantes |
| `@tiptap/react` y complementos | ^3.30.2 | Editor de texto enriquecido de noticias |

A eso se suman tres utilidades de clases y las animaciones de Tailwind: `clsx` para
componerlas condicionalmente, `tailwind-merge` para que la última gane sobre la anterior, y
`class-variance-authority` para declarar variantes de componente.

## 1.2 Dependencias de desarrollo que el servidor necesita

En desarrollo están Tailwind 4, ESLint 9, TypeScript 5, Vitest 4 y `tsx`. Dos de ellas no son
opcionales en el servidor: el paso de post-instalación genera el cliente del ORM y necesita
su CLI, y la siembra de datos corre con `tsx`. El script de despliegue instala con `npm ci` a
secas, sin podar las dependencias de desarrollo, justamente por eso. Podarlas rompe el
despliegue.

La serie de manuales agregó dos más, que sólo usa el generador de documentos: `marked` para
leer el Markdown y `playwright-core` para las capturas.

## 1.3 Tres particularidades de Next 16

**El middleware se llama `proxy.ts`.** Next 16 renombró el archivo. El del proyecto tiene
cuatro líneas: exporta el manejador de Auth.js y un `matcher` que cubre el panel de
administración y el de socio. Todo lo demás pasa sin tocar.

**Los parámetros de ruta son promesas.** Tanto `params` como los parámetros de consulta
llegan envueltos y hay que esperarlos antes de leerlos. Es un cambio mecánico pero afecta a
toda página con segmento dinámico.

**El caché público se invalida por etiquetas.** Las consultas del sitio público que se
repiten (noticias, actividades, configuración) van envueltas en `unstable_cache` con una
etiqueta, y las acciones del panel la invalidan al guardar. Las tres etiquetas vivas están en
un módulo propio y no cuelgan de ninguno de los tres dominios que las usan. Un detalle de la
versión: en 16.3.1 la función clásica de revalidación pide un segundo argumento de perfil y
no se la puede llamar desde una acción de servidor, así que el proyecto usa `updateTag`.

## 1.4 Prisma 7 con adaptador, sin motor binario

El cliente se construye con el adaptador de MariaDB en lugar del motor binario clásico. La
configuración vive en `prisma.config.ts` (Prisma 7 ignora la sección equivalente de
`package.json` cuando este archivo existe) y apunta el esquema, las migraciones y la siembra.

La consecuencia práctica más cara del adaptador es que **el error de violación de unicidad no
trae `meta.target`**: el nombre del índice viaja anidado dentro del error del adaptador. Una
guarda escrita contra la forma que documenta Prisma pasa todos los tests y nunca coincide en
producción, porque el doble de los tests es el que miente. El proyecto la aisló en un módulo
que soporta las dos formas y falla cerrada.

El cliente también tiene una guarda explícita: sin la variable de conexión definida, el módulo
tira al evaluarse. Eso tiene un corolario de diseño que aparece en el capítulo 5.

## Dónde está en el código

- `package.json` — dependencias y scripts (`dev`, `build`, `start` en el puerto 3006).
- `src/proxy.ts` y `src/auth.config.ts` — el proxy y el callback que decide.
- `src/lib/prisma.ts` y `prisma.config.ts` — cliente y configuración del ORM.
- `src/lib/cache-tags.ts` — las tres etiquetas de caché.
- `src/lib/treasury/unique-violation.ts` — la lectura de la violación de unicidad.

---

# 2. Un solo proyecto, tres zonas y la API

## 2.1 Las zonas

Todo cuelga de `src/app`. Cuatro ramas importan.

| Rama | Qué sirve | Quién entra |
|---|---|---|
| `(public)` | Sitio público y los tres trámites anónimos | Cualquiera |
| `admin` | Panel de administración | Rol de administración |
| `mi` | Panel de socio | Rol de socio |
| `api` | Webhooks, tareas programadas y descargas | Según la ruta |

El grupo público contiene la portada, noticias, actividades, ubicación, los wizards de
asociarse, de re-empadronarse y de reportes, el ingreso con su recuperación de contraseña, y
las tres pantallas que se abren con un token de un solo uso (acceso, verificación y
restablecimiento), más los dos retomes de wizard, que también llegan por token.

El panel de administración tiene una carpeta por sección: actas, actividades, configuración,
documentos, noticias, padrón electoral, re-empadronamiento, salud, socios, solicitudes,
tesorería y usuarios. Tres de ellas (socios, solicitudes y tesorería) tienen layout propio
porque llevan su barra de pestañas de sección.

El panel de socio tiene seis: inicio, cuenta, datos, débito, documentos y solicitudes, más el
estatuto.

Fuera de las cuatro ramas quedan tres piezas sueltas: la ruta de redirección posterior al
login, que manda al panel que corresponde según el rol del token; el archivo de exclusión de
robots, que cierra las tres zonas privadas y los seis prefijos cuyo secreto es la propia URL
(verificación, acceso, ingreso con su restablecimiento, los dos retomes de wizard y el
reporte nuevo con llave); y el mapa del sitio, declarado dinámico para que el build no lo
congele.

Al 12/09/2026 hay 86 archivos de página, 8 layouts y 23 manejadores de ruta, sobre 556
archivos TypeScript bajo `src` sin contar el cliente generado.

## 2.2 La API

| Rama | Qué expone |
|---|---|
| `api/admin` | Descargas autenticadas y exportaciones del panel |
| `api/mi` | Documentos, recibos y archivos de reportes del propio socio |
| `api/auth` | Auth.js |
| `api/cron` | Cinco tareas programadas: devengo, solicitudes, resumen, conciliación, recordatorio |
| `api/imagenes` | Portadas de noticias: público, sin autenticación, con caché inmutable |
| `api/webhooks` | El aviso de Mercado Pago |

La regla del proyecto para archivos: nada de lo que sube un vecino vive dentro de `public` ni
del repositorio. Los documentos personales se sirven sólo por ruta autenticada y con asiento
de auditoría por cada visualización. La única excepción deliberada son las portadas de
noticias, que son contenido público.

## 2.3 Las tres capas de autorización

| Capa | Qué mira | Para qué sirve |
|---|---|---|
| Proxy | Los roles del token | Filtro barato; redirige al login |
| Layout | La fila viva del usuario | Pinta la pantalla de bloqueo con el motivo |
| Cada acción y cada ruta | La fila viva del usuario | La autorización real |

**Por qué no alcanza con el proxy.** Una acción de servidor no se invoca por su URL: Next la
despacha por el identificador que viaja en un encabezado propio, contra un manifiesto global
del build. Un POST a la portada ejecuta igual una acción declarada bajo el panel, sin pasar
nunca por la rama del panel en el callback del proxy. Por eso **cada acción se autoriza a sí
misma en su primera línea**, sin excepción.

**Por qué la navegación es sólo display.** Las guardas de rol comparten una fábrica y corren
seis verificaciones en orden: hay sesión; el token trae el rol (filtro barato, sin tocar la
base — el token puede quitar un permiso, nunca darlo); el identificador es un entero positivo;
la fila viva del usuario existe, está activa y conserva el rol; la sesión no es anterior al
último cambio de contraseña; y la sesión no superó el techo absoluto de vida. Sólo el paso
dos mira el token. Como el token dura ocho horas, una degradación de rol puede tardar ese
tiempo en reflejarse en la barra lateral, pero no en lo que el servidor deja hacer.

Hay tres guardas de administración, con mensajes distintos: la general del panel, la de
superadministrador y la específica de la sección de usuarios. Para el panel de socio hay una
cuarta, que resuelve contra la ficha del padrón además de contra la cuenta: el dado de baja
queda afuera siempre, y el suspendido queda afuera salvo que la pantalla pida explícitamente
el modo lectura. Ese modo lectura es lo que deja al suspendido consultar su cuenta, descargar
recibos y pagar; las acciones que mutan usan la guarda pelada.

## Dónde está en el código

- `src/app/admin/layout.tsx` y `src/app/mi/layout.tsx` — la capa del layout.
- `src/lib/auth/require-admin.ts` — las tres guardas de administración y sus mensajes.
- `src/lib/auth/require-member.ts` — la guarda del socio y su modo lectura.
- `src/lib/auth/session-freshness.ts` — sesión rancia y techo de vida.
- `src/app/robots.ts` y `src/app/sitemap.ts` — qué se indexa y qué no.

---

# 3. Estructura de carpetas

El árbol siguiente llega a tres niveles y comenta una línea por carpeta. Es el mapa que
conviene tener abierto los primeros días.

```text
src/
├── auth.ts                 servidor de Auth.js: proveedores y eventos
├── auth.config.ts          config compartida con el proxy: sesión de 8 h
├── proxy.ts                ex-middleware: matcher del panel y de /mi
├── app/
│   ├── (public)/           sitio público y los tres wizards anónimos
│   ├── admin/              panel: 12 secciones, 3 con layout propio
│   ├── mi/                 panel de socio: 6 secciones
│   ├── api/                admin, auth, cron (5), imagenes, mi, webhooks
│   ├── redirigir/          post-login: al panel que corresponde según el rol
│   ├── robots.ts           exclusiones de indexado
│   ├── sitemap.ts          mapa del sitio, dinámico
│   ├── globals.css         tokens de color, tema y estilos base
│   └── layout.tsx          root layout: fuentes propias, metadatos, idioma
├── components/
│   ├── ui/                 12 primitivas de shadcn
│   ├── admin/              29 componentes del marco del panel
│   ├── mi/                 marco y navegación del panel de socio
│   ├── public/             encabezado, pie, hero y tarjetas del sitio público
│   └── map/                el pin de marca: módulo puro que no importa Leaflet
├── generated/prisma/       cliente generado del ORM (no versionado)
├── lib/
│   ├── activities/         reglas y consultas del calendario
│   ├── admin/              navegación, tarjetas, pastillas de estado, catálogos
│   ├── applications/       altas web: elegibilidad, wizard, servicio, cron, acta
│   ├── auth/               guardas de rol, limitadores, frescura, contraseñas
│   ├── board/              cartelera: días hábiles, aviso, PDF
│   ├── cron/               guarda compartida de las tareas programadas
│   ├── documents/          almacenamiento de documentos personales
│   ├── email/              transporte, plantillas, presupuesto de envíos
│   ├── institutional-documents/  estatuto, memorias y balances
│   ├── members/            padrón, altas y bajas, débito, solicitudes, electoral
│   ├── mi/                 navegación y ayudantes del panel de socio
│   ├── minutes/            actas
│   ├── mp/                 Mercado Pago: gateway, firma, webhook, conciliación
│   ├── news/               noticias: ABM, saneado, portadas
│   ├── padron/             mapeo y poda de la importación del padrón
│   ├── reports/            reportes: servicio, reglas, almacenamiento, PDF, mapa
│   ├── reregistration/     re-empadronamiento: reglas, proceso vigente, migración
│   ├── streets/            catálogo de calles y normalización
│   ├── treasury/           tesorería: cuotas, pagos, recibos, exenciones, reparto
│   ├── ui/                 clases compartidas de las pestañas de sección
│   ├── users/              cuentas y roles
│   ├── audit.ts            asiento de auditoría, en dos variantes
│   ├── cache-tags.ts       las tres etiquetas de caché público
│   ├── config.ts           lector tipado de la tabla de configuración
│   ├── config-keys.ts      las claves de configuración; módulo puro, sin imports
│   ├── dates.ts            fecha civil al mediodía UTC; año y día argentinos
│   ├── format.ts           fechas, bytes y moneda con zona horaria fija
│   ├── forms.ts            puente de datos de formulario hacia el validador
│   ├── keyed-mutex.ts      serialización por clave dentro del proceso
│   ├── log-safe.ts         enmascarado para registros (Ley 25.326)
│   ├── prisma.ts           cliente con adaptador de MariaDB
│   ├── public-nav.ts       navegación del sitio público, sin JSX
│   ├── site.ts             datos institucionales fijos y guarda de la URL base
│   ├── tokens.ts           tokens de un solo uso, con vencimiento por propósito
│   ├── turnstile.ts        verificación del captcha; falla cerrado
│   └── utils.ts            combinador de clases
└── types/                  ampliaciones de tipos de terceros
```

Fuera de `src` están el esquema y las 24 migraciones, los scripts de importación y respaldo,
los 293 archivos de test más los cuatro de integración, la documentación previa, los datos
fuente, los assets, la definición del contenedor de base local y el script de despliegue.

## 3.1 La convención estructural número uno

`src/lib` son módulos **puros**: sin JSX, sin React, sin iconos y, cuando se puede, sin
cliente del ORM. Se testean en Node sin DOM. `src/components` es lo que renderiza. Cuando un
catálogo necesita un ícono, el mapa de nombre a componente vive en el componente cliente, no
en el módulo.

Un ejemplo vivo de la regla es la carpeta de mapas: contiene un único módulo puro con el pin
de marca, que no importa Leaflet y por eso lo puede leer un test en Node. Los cuatro
componentes que sí importan la librería viven en `src/app`, pegados a la pantalla que los
monta.

La regla está escrita textualmente en al menos siete archivos del repositorio. La otra constante de
estilo: **cada archivo abre con un comentario que explica por qué existe y qué error concreto
previene**. No son comentarios decorativos; casi todos documentan algo medido en un navegador
o contra un servicio real, y son la mejor fuente para entender una decisión rara.

## Dónde está en el código

- `src/lib/admin/nav.ts` — el ejemplo canónico de módulo puro con su comentario de por qué.
- `src/components/admin/nav-icons.ts` — el mapa de íconos que vive del lado del componente.

---

# 4. Las capas y sus responsabilidades

El camino de una operación es siempre el mismo:

1. **Pantalla.** Un componente de servidor lee lo que necesita y renderiza. Sin estado de
   cliente salvo que haya interacción real.
2. **Acción de servidor.** Recibe los datos del formulario, se autoriza, valida y delega.
3. **Módulo de dominio.** La regla de negocio y la escritura. Vive en `src/lib`.
4. **ORM.** La consulta y la transacción.

## 4.1 Qué va en cada capa

**La pantalla** no decide nada de negocio. Si tiene que mostrar un botón deshabilitado porque
una regla lo impide, pide el veredicto a la misma función que después va a usar la acción
para rechazar. Esa simetría es deliberada y aparece en varios módulos: lo que la pantalla
muestra deshabilitado es exactamente lo que la acción rechaza.

**La acción** hace cuatro cosas y en este orden: se autoriza, convierte los datos del
formulario con el validador, pre-valida lo barato y frecuente, y llama al dominio. También es
la única capa que ve las cabeceras HTTP, así que **la dirección IP del asiento de auditoría la
escribe la acción, nunca el servicio**.

**El dominio** revalida todo lo que la acción pre-validó. No es redundancia: la acción
pre-valida para dar un mensaje temprano y barato, y el dominio revalida adentro de la
transacción porque entre una cosa y la otra el mundo puede cambiar. El cierre del libro de
socios y el otorgamiento de una exención son los dos ejemplos explícitos.

## 4.2 Qué NO va adentro de una transacción

Esta es la regla que el proyecto aprendió tres veces, y las tres costaron caro.

**Ninguna llamada de red.** El tiempo de espera de transacción del ORM es de cinco segundos, y
una llamada a un servicio externo lo consume sosteniendo el lock. La cancelación del débito
automático al dar de baja a un socio vive en un módulo de dominio que corre **después** del
commit, y lo comparten la baja individual y la baja en lote.

**Ninguna escritura de PDF.** El número de recibo se pide tarde y adentro de la transacción
para que no queden huecos en la serie; escribir el archivo ahí adentro sostendría el lock del
año hasta el commit. El PDF se escribe después, es best-effort y es regenerable: si falla, el
cobro ya quedó asentado y hay una acción que lo rehace.

**Nada fila por fila cuando son muchas.** El cierre del libro daba por sentado que unos
cientos de actualizaciones entraban holgadas en los cinco segundos; medido contra la base
real, los viajes de ida y vuelta solos se comían el presupuesto y todo cierre abortaba. Pasó
a escribirse por conjuntos, una actualización masiva por combinación de estado y categoría,
más un conteo de completitud que falla cerrado.

## 4.3 Lo que pasa después del commit

Tres cosas viven ahí: la cancelación del débito, la escritura del PDF del recibo y los
correos. Las tres comparten la misma propiedad: si fallan, el hecho ya quedó asentado y el
sistema tiene cómo enterarse o cómo rehacerlas.

## 4.4 Concurrencia: la premisa de un solo proceso

El proyecto corre con **una sola instancia** del gestor de procesos, y de ahí depende una
garantía: los mutex por clave y los limitadores de tasa viven en memoria. Un mutex por
clave encadena promesas en un mapa, y la entrada se borra cuando la última promesa de esa
clave termina, así que el mapa no crece.

Hoy lo instancian siete módulos de dominio: las altas web (por documento), las solicitudes
del socio (por socio), el procesador del aviso de pagos, el cierre del libro, el núcleo de
tesorería, las cuentas de gestión y el aviso de cartelera.

Si algún día se clusteriza, esa garantía desaparece **sin ruido**: dos procesos tienen dos
mapas. Está anotado en el propio archivo y en la documentación de infraestructura. Antes de
tocar el número de instancias hay que leer las dos advertencias.

Donde la invariante la puede sostener la base, el proyecto prefiere la base. Las transiciones
de estado de los reportes son actualizaciones condicionales que llevan el estado de origen en
el filtro: dos administradores que aprietan a la vez no producen dos asientos, porque el
segundo cuenta cero filas afectadas. Un mutex ahí habría sido una cerradura de proceso para
algo que la base ya garantiza.

## Dónde está en el código

- `src/lib/forms.ts` — el puente de datos de formulario hacia el validador.
- `src/lib/keyed-mutex.ts` — el mutex por clave, con su advertencia de clusterización.
- `src/lib/treasury/receipt-number.ts` — el número que se pide tarde y adentro.
- `src/lib/members/withdraw-with-debits.ts` — la llamada de red que espera al commit.

---

# 5. Patrones transversales

Once patrones que el proyecto repite. Cada uno con qué problema resuelve, dónde está y cómo
se reconoce.

## 5.1 Servicios externos detrás de una fábrica propia

**Problema.** Un SDK de terceros repartido por el dominio hace que los tests necesiten red y
que un cambio de proveedor toque cincuenta archivos.

**Dónde.** La fábrica `makeMpGateway()` se llama sin argumentos y lee el token del entorno.
Vive en `src/lib/mp/gateway.ts`. El dominio nunca ve el SDK de pagos, y los tests simulan la
interfaz, no la red.

**Cómo se reconoce.** Si un módulo de dominio importa un paquete de un proveedor externo,
está mal. El mismo criterio vale para cualquier proveedor que venga después.

## 5.2 Reglas de negocio como funciones puras, testeadas aparte

**Problema.** Una regla mezclada con consultas necesita fixtures y base para probar un caso
de borde, y termina sin probarse.

**Dónde.** La elegibilidad por DNI para el alta web decide los bloqueos sin tocar la base: la
tabla entera de casos se prueba sin fixtures. La imputación de cuotas, el resolutor de pagos
entrantes y las dos aritméticas de plazos del re-empadronamiento siguen el mismo molde.

**Cómo se reconoce.** Firma de entrada y salida, sin `async` y sin consultas. Quien carga los
datos es otra función.

## 5.3 En módulos puros el ORM se inyecta, no se importa

**Problema.** El cliente del ORM tira al evaluarse si falta la variable de conexión. Un test
puro que importe un módulo que a su vez lo importe se cae sin archivo de entorno.

**Dónde.** Varios módulos de consulta y de resumen reciben el cliente por parámetro.

**Cómo se reconoce.** El primer parámetro de la función es la base. Si un módulo de `src/lib`
importa el cliente arriba de todo y además se quiere testear puro, hay que partirlo.

## 5.4 Una función compartida en lugar de copias

Es la lección más repetida del proyecto y la que más veces se corrigió tarde.

**Problema.** La misma regla escrita en la pantalla y en la acción diverge en silencio: alguien
toca una copia y la otra sigue igual.

**Dónde.** Hay al menos cinco casos vivos:

| Función | Qué comparte | Qué pasaba antes |
|---|---|---|
| `coverageFloor` | Devengo, recordatorio e imputación | El recordatorio reclamaba el mes de ingreso |
| `activeExemption` | Las cinco guardas de cobro y las tres pantallas | Un camino sin el filtro de anulación |
| `validateSubmission` | El wizard de reportes y el servicio | Lo deshabilitado y lo rechazado podían diferir |
| `loadEligibilityInputs` | El chequeo temprano y la guarda del envío | Dos lecturas de los mismos insumos |
| `groupTotals` | La pantalla del reparto y la lista | Dos aritméticas del mismo total |

**Cómo se reconoce.** Si al escribir una pantalla hace falta "la misma condición que la
acción", no se copia: se extrae. El caso de la exención es el más didáctico — con un filtro
por camino, alcanza con que uno olvide excluir las anuladas para que a un vecino se le siga
bloqueando el pago después de que la Comisión le anuló la exención.

## 5.5 Las guardas globales van en el transporte

**Problema.** Una guarda aplicada por el llamador se olvida en la pantalla número doce.

**Dónde.** La lista blanca de correo envuelve el transporte de Nodemailer, así que cubre por
igual al wizard, al panel y a las tareas programadas, y una pantalla nueva no puede
olvidarse de aplicarla. El registro del bloqueo dice el motivo y **nunca la dirección
completa**.

**Cómo se reconoce.** La guarda está en la capa más baja posible, no en cada consumidor.

## 5.6 Auditoría best-effort contra auditoría estricta

El asiento normal traga errores: sirve para el noventa y nueve por ciento de los casos, donde
perder un asiento es molesto pero no rompe nada. La variante estricta propaga, y es para los
casos en que **el asiento es la señal**: si no se escribe, el operador no se entera por
ninguna pantalla.

Hoy tiene tres llamadores, y conviene mirar qué hace cada uno con el error que recibe:

| Dónde | Qué asienta | Qué pasa si falla |
|---|---|---|
| Confirmación del cierre del libro | El acto irreversible y su acta | El resumen se lo dice al operador con todas las letras |
| Modo carga de socios | El alta cargada por el operador | Degrada a un aviso explícito en pantalla |
| Procesador del aviso de pagos | Una solicitud revivida por un pago tardío | Queda un registro crítico con el identificador |

Los tres capturan el error y ninguno propaga: los tres corren **después** del commit, y
convertir en error una transacción ya confirmada sería peor que perder el asiento. Lo que
cambia respecto del asiento normal es que el fallo se ve: la variante estricta es lo que
permite enterarse. En el tercer caso la razón es concreta — al vencer, la tarea programada
mandó a cancelar el débito y el alta puede haber quedado sin él, y el estado final en
pantalla es idéntico al de una aceptación normal.

En el contenido del asiento van identificadores, códigos, conteos y montos. Nunca nombres,
documentos, correos, domicilios ni texto libre del operador.

## 5.7 Transiciones de estado como actualizaciones condicionales

Ya apareció en el capítulo 4. El detalle que vale repetir es el del mensaje: cuando la
actualización afecta cero filas, se responde **el mismo texto** para "ya está resuelto" y para
"no existe". Distinguirlos le diría a un tercero si el registro existe.

## 5.8 Numeración sin huecos

**Problema.** Una serie numerada que se pide temprano deja huecos cuando la transacción se
revierte, y una serie de recibos con huecos es un problema contable.

**Dónde.** El siguiente número se pide **tarde y adentro** de la transacción, con una
inserción que incrementa en caso de duplicado. El lock de la fila del año serializa, y una
reversión no consume número. Está verificado con veinte recibos concurrentes contra la base
real. Los reportes reusaron el mismo patrón para su número público.

**Cómo se reconoce.** El número se pide después de todas las validaciones y antes del commit,
nunca al abrir el formulario.

## 5.9 La lectura de la violación de unicidad

Ya se explicó en el capítulo 1. Se menciona acá porque es el ejemplo canónico de la regla
general: **medir antes de suponer**, también contra el driver de la base y no sólo contra un
servicio externo. Un doble de test que reproduce la forma documentada en lugar de la forma
real deja la guarda verde y rota.

## 5.10 El doble de base tiene que honrar el filtro que recibe

**Problema.** Un doble que reimplementa el filtro en lugar de aplicarlo deja cláusulas del
filtro real sin ejercitar, y el test pasa igual. El caso concreto fue un identificador de
proceso que el doble sintetizaba como constante, así que esa parte nunca se probó.

**Cómo se reconoce.** La única prueba de que una guarda se está probando es **borrarla y ver
el test en rojo**; después se restaura.

## 5.11 Un tope de lote tiene que contar lo que cuesta

**Problema.** Un límite copiado sin copiar su aritmética se convierte en una traba de
trabajo. El lote de bajas del re-empadronamiento heredó un tope de veinticinco socios que en
realidad era el presupuesto de llamadas de red de otro proceso; los convocados no podían
tener débito, así que el tope trababa noventa bajas con cero llamadas.

**Cómo se reconoce.** El nombre de la constante dice qué cuenta, y la aritmética está escrita
al lado.

## Dónde está en el código

- `src/lib/mp/gateway.ts` — la fábrica del proveedor de pagos.
- `src/lib/applications/eligibility.ts` — la regla pura con su tabla de casos.
- `src/lib/treasury/rules.ts` — el piso de cobertura y la imputación.
- `src/lib/treasury/exemptions.ts` — la fuente única de las guardas de exención.
- `src/lib/email/transport.ts` — la lista blanca en el transporte.
- `src/lib/audit.ts` — las dos variantes de asiento.

---

# 6. El marco del panel

Una pantalla nueva del panel **no escribe su propio encabezado, ni sus propios mensajes, ni su
propio estado vacío**. Todo eso ya existe y está verificado en accesibilidad.

## 6.1 Los componentes compartidos

| Componente | Cuándo se usa | Convención que impone |
|---|---|---|
| `PageHeader` | Toda pantalla | La entidad va en el título; la última miga es un sustantivo corto |
| `FormMessage` | Todo mensaje de resultado | El rol accesible se deriva del tipo de mensaje |
| `EmptyState` | Toda lista que puede estar vacía | En tamaño lista reemplaza la tabla entera y ofrece la acción |
| `FilterChips` | Filtros de vista | Son enlaces, no botones con estado |
| `PanelHeader` | Encabezado de panel interno | Sin marca de cliente, para que lo usen los dos lados |
| `PaginationNav` | Listas largas | Con una sola página no renderiza nada |
| `MinutePicker` | Toda acción que se asienta en acta | Ver la advertencia de más abajo |
| `PeriodStrip` | Grilla de cuotas de la ficha | Tabla semántica, con glifo visible además del color |
| `StreetAutocomplete` | Domicilios | Emite calle del catálogo o texto libre, nunca los dos |

`FormMessage` es el componente más reutilizado del proyecto, con más de cien usos. Su
propiedad más importante es que el rol accesible **se deriva** del tipo: error y advertencia se
anuncian como alerta, éxito como estado, y los neutros no se anuncian. Pasar el rol a mano es
la salida de emergencia y tiene dos casos justificados documentados.

El selector de acta merece una advertencia propia, con su historia. **Sin configurar, abre
preseleccionado en "acta existente" con la primera de la lista, que viene ordenada de la más
reciente a la más vieja.** En el simulacro del cierre del libro eso dejó el acto asentado bajo
el acta de las bajas de minutos antes, que es justamente el documento que la asociación
presenta ante la IGJ. Era la tercera vez que el selector sorprendía encadenado; las dos
anteriores habían sido cosméticas.

El arreglo es la propiedad `defaultMode`, que fija en cuál de los dos modos abre. Hoy la pasan
en "acta nueva" tres pantallas, y las tres son ceremonias de un solo acto: la confirmación del
cierre del libro, el formulario de presentar un reporte ante un organismo y la anulación de
una exención. **La regla para una pantalla nueva**: si la acción es una ceremonia de un solo
acto, el valor por omisión tiene que ser el acta nueva, y la pantalla de confirmación tiene
que decir con cuál se va a firmar. Si es una acción de rutina que se asienta junto a otras
—aprobar varias altas en la misma reunión—, el acta existente sigue siendo el caso normal.

Para el estado visual de una fila no se escriben ternarios por pantalla: hay dieciocho
funciones de pastillas de estado con una gramática consistente — celeste relleno significa
"acá hay trabajo", verde tenue el desenlace bueno, rojo tenue algo roto o rechazado, gris
relleno algo terminal o una ausencia, y borde fino algo que todavía no ocurrió. Dos corolarios
explícitos: se distingue por peso además de por color, y un estado desconocido de un proveedor
externo va neutro, nunca en verde.

## 6.2 Navegación y tarjetas del tablero

La barra lateral, el cajón móvil y el marcado de sección activa salen de **una sola fuente**.
Agregar una sección al panel es agregar un ítem a ese arreglo; la marca `superadminOnly` es
display, y la autorización real va igual en la ruta y en cada acción.

Las tarjetas del tablero viven en un módulo aparte, y ahí sí aparecen las secciones futuras
como "Próximamente" (hoy ninguna). Un test cruza los dos catálogos: cada sección viva tiene
exactamente una tarjeta, con el mismo título y la misma marca de superadministrador.

## 6.3 Pestañas: tres niveles que no hay que confundir

| Nivel | Qué es | Forma | Dónde vive |
|---|---|---|---|
| 1 | Navegación del panel de socio | Subrayado en pantalla ancha, tira grande en angosta | `mi-tabs.tsx` |
| 2 | Pestañas de sección | Solapa de carpeta | `src/lib/ui/section-tabs.ts` |
| 3 | Filtros de vista | Píldora sobre pista gris | `filter-chips.tsx` |

El nivel 2 tiene ocho barras y **una sola fuente de clases**. Cuatro son por URL (tesorería,
socios, solicitudes del panel y solicitudes del socio) y cuatro son de Radix con parámetro de
consulta (ficha del socio, configuración, salud y documentos).

**La regla de decisión**: si cada pestaña es una ruta propia, van enlaces — el enlace profundo,
el botón atrás y el marcado de página actual salen gratis. Si los paneles ya vinieron en el
HTML y no navegan, va Radix.

**Por qué existe una variante vacía.** El atributo de estado activo de la librería de
componentes está definido con una envoltura de especificidad cero, mientras que las reglas de
la variante subrayada pesan más. Un override por clase sobre la variante subrayada **pierde
siempre**. La variante de sección está vacía a propósito: su único efecto es que ninguna regla
de estado activo de las otras dos variantes se dispare.

El archivo documenta seis trampas más, todas medidas en navegador: el relleno que evita que el
anillo de foco quede recortado por el desplazamiento horizontal; el desplazamiento que va
siempre en el envoltorio y nunca en la lista; la tapa celeste hecha con sombra interior en
lugar de borde, para que activa e inactiva midan lo mismo; y tres de orden de clases.

El nivel 1 es el negativo deliberado: la navegación del panel de socio **no** usa el módulo de
pestañas de sección, y hay un test que lo fija. Migrarla "por prolijidad" volvería a confundir
los dos niveles. Su corte de presentación está en el punto medio de la escala de anchos, no en
el chico: entre los dos anchos la barra de subrayado no entraba y cortaba la última pestaña
sin ninguna señal.

## 6.4 El marco del panel de socio

Seis pestañas, de una sola fuente, con una marca que oculta la de débito a las categorías que
no pagan cuota. Esa marca también es display: quien fuerce la URL se topa con el veredicto de
adhesión.

La deuda conocida del panel de socio: su layout hace una consulta extra por render para
decidir si muestra esa pestaña. La deuda equivalente del panel de administración: el layout
llama al proveedor de sesión una segunda vez para el nombre y el rol mostrado.

## 6.5 Primitivas de los wizards públicos

Las primitivas visuales de los pasos del wizard de asociarse viven en un archivo aparte para
que las hereden los pasos que se agregaron después. Se comparten fuera del wizard, pero **no
con los mismos importadores**: el wizard de re-empadronarse toma el campo y la botonera y no
la tarjeta de opción; la tarjeta de opción la toman los pasos de residencia y categoría del
alta, los dos pasos del wizard de reportes y las solicitudes del socio.

Lo que diverge a propósito desde el 01/09/2026 es el paso a paso visual del encabezado: el
wizard de re-empadronarse conserva el suyo, escrito en su propio archivo.

## 6.6 Accesibilidad verificada

Lo siguiente está medido y no se rompe: objetivos táctiles de al menos 44 píxeles; marcado de
página actual en la sección activa; **contorno oculto y nunca anulado** más anillo de foco
visible en todo control de la barra lateral (anularlo deja el foco invisible en modo de alto
contraste); enlace de salto al contenido principal; el color nunca como único canal; y
navegación oculta en impresión, con glifo visible en lugar de sólo fondo donde la pantalla se
imprime.

## Dónde está en el código

- `src/components/admin/` — los 29 componentes del marco.
- `src/lib/admin/nav.ts` y `src/lib/admin/dashboard-cards.ts` — las dos fuentes cruzadas.
- `src/lib/ui/section-tabs.ts` — las clases de las ocho barras y sus seis trampas.
- `src/lib/mi/nav.ts` y `src/components/mi/mi-tabs.tsx` — el marco del socio.
- `src/app/(public)/asociate/wizard-ui.tsx` — las primitivas compartidas.

---

# 7. Formularios

## 7.1 El patrón central

El molde es siempre el mismo:

1. El formulario declara una acción de servidor y lee su resultado con `useActionState`.
2. La acción se autoriza, convierte los datos con `parseForm` contra un esquema de validación
   y devuelve un resultado con un mensaje o con éxito.
3. La pantalla muestra el resultado con `FormMessage`.

Los mensajes de error salen **del esquema, escritos en castellano**, porque se muestran tal
cual. El puente hacia el validador tiene un detalle que hay que conocer: un campo vacío del
navegador llega como cadena vacía, y el puente la traduce a ausente sólo si el campo es
opcional. Si es requerido la deja tal cual, para que corra la validación de longitud mínima
del esquema y el usuario vea el mensaje en castellano en lugar del genérico en inglés del
validador. El resultado además devuelve **qué campo** falló.

## 7.2 La trampa del reinicio y la API recomendada

React 19 **resetea el formulario cuando la acción de servidor termina**. Con campos de texto
controlados no se nota. Con desplegables, radios y casillas sí: el reinicio los devuelve al
valor por omisión y React no los corrige, porque desde su punto de vista ninguna propiedad
cambió.

El daño real está documentado: el administrador elige una categoría, el estatuto la rechaza,
el formulario vuelve a mostrar la categoría anterior **sin decir nada**, y si reintenta sin
mirar cambia al socio a una categoría que nunca eligió. Un error silencioso con firma del
operador.

La API recomendada resuelve eso y además el cableado: un hook devuelve los valores, el
actualizador, la referencia al formulario y una función que entrega las propiedades de un
campo controlado y registrado de una sola vez. Sobre eso hay tres envoltorios listos para
texto, área de texto y desplegable. Un prefijo de identificadores es obligatorio cuando el
formulario se repite por fila: sin él los identificadores se duplican y hacer clic en la
etiqueta de la fila siete enfoca el campo de la fila uno.

**Regla de oro.** Si un formulario tiene un desplegable, un radio o una casilla y corre una
acción de servidor, se usa la API recomendada. Si no se puede, al menos hay que llamar al hook
de sincronización con la referencia del formulario.

## 7.3 Turnstile: dónde sí y dónde no

El captcha va en **todos los formularios públicos anónimos**. Hoy son ocho pantallas: los dos
primeros pasos del alta web (el documento y los datos personales) y el reenvío de su enlace de
retome; el ingreso y su recuperación de contraseña; el primer paso del wizard de
re-empadronarse y el reenvío de su enlace; y el primer paso del wizard de reportes.

**No va** en las pantallas que se abren con un token de un solo uso — acceso, restablecimiento
y verificación —, ni en los pasos posteriores de un wizard con borrador. El razonamiento es el
mismo en los dos casos: el token ya es la barrera, no hay nada que enumerar sin él, y poner
captcha en cada paso sólo castiga a quien ya la pasó.

El widget va **dentro** del formulario (inyecta su propio campo oculto) y se monta en modo
explícito: el modo implícito escanea una sola vez y el widget queda vacío al remontar. La
verificación del lado del servidor **falla cerrado**.

## 7.4 La deuda anotada

Cuatro formularios y nueve desplegables nativos siguen sin migrar a la API recomendada. Los
cuatro usan el hook de sincronización directo, así que **no tienen el error del reinicio**,
pero sus desplegables no llevan la clase compartida y se ven planos en modo oscuro.

Hay tres deudas más, todas anotadas en comentarios: una pantalla conserva una copia inline de
las clases de los filtros; el envoltorio de desplegable de la API recomendada no usa la clase
compartida y es justo la divergencia que esa clase existe para resolver; y la primitiva de
desplegable de la librería de componentes está sin usar, con cero importadores en todo el
proyecto — o se adopta como el desplegable canónico, o es código muerto.

Y media mejora pendiente: el puente ya propaga qué campo falló, pero llevar el foco a ese
campo y marcarlo como inválido en cada pantalla quedó fuera de alcance.

## Dónde está en el código

- `src/lib/forms.ts` — el puente hacia el validador.
- `src/components/admin/synced-fields.tsx` — la API recomendada.
- `src/components/admin/use-form-reset-sync.ts` — el hook y la explicación del error.
- `src/components/public/turnstile-widget.tsx` y `src/lib/turnstile.ts` — el captcha.

---

# 8. Tema y color

Tailwind 4 con tema en línea: los tokens son variables CSS definidas en la raíz y en la clase
de modo oscuro.

## 8.1 El celeste de marca y el celeste interactivo

Es la sutileza más importante del sistema visual, y se equivoca fácil.

| Token | Valor | Contraste sobre blanco | Uso permitido |
|---|---|---|---|
| Marca (no es token) | `#2E9BDF` | 3,06:1 | Sólo texto grande y superficies decorativas |
| `--primary` | `#0079BC` | 4,71:1 | Botones, enlaces, foco: todo lo interactivo |
| `--sidebar-primary` | `#2E9BDF` | ≥3:1 sobre el fondo oscuro | Indicador de ítem activo en la lateral |

El celeste institucional no llega al mínimo de contraste para texto normal, así que el
proyecto derivó una variante interactiva más oscura. Usar el de marca en un botón es el error
más probable de quien llega nuevo.

Para el feedback hay dos tokens propios, verde y ámbar, con su par para modo oscuro. **Está
prohibido usar verde o ámbar crudos** del framework de clases, y hay un test que lee las
constantes compartidas y falla si aparece cualquier color crudo de la paleta.

## 8.2 El panel es siempre celeste profundo

Los tokens del marco tienen **los mismos valores en modo claro y en modo oscuro**: el panel no
cambia de color con el tema. La trampa documentada es que ya no son sólo del panel — el pie
del sitio público también los consume para vestirse igual que la lateral, así que tocar un
valor repinta las dos cosas y hay que verificar las dos.

## 8.3 La regla de contraste que se mide, no se supone

Un control deshabilitado se atenúa **por su superficie y sus controles decorativos**, nunca
por su texto. El caso que lo fijó: la tarjeta de categoría deshabilitada del alta web. La
línea que explica el motivo es la única información que recibe el vecino sobre por qué no
puede seguir, y atenuar la tarjeta entera la dejó medida en 2,3:1, muy por debajo del mínimo.
Hay un test de fuente que impide que vuelva.

El resto de lo que define el archivo de estilos: la escala de radios derivada de un único
valor base; el alias de fuente de encabezados; los estilos del cuerpo de noticias, compartidos
entre el editor del panel y la página pública, con quiebre de palabra agresivo porque una URL
pegada a mano arrastraba el ancho de toda la página en pantalla angosta; y un ajuste que lleva
los botones de zoom del mapa a 44 píxeles, nombrando la clase del propio botón para no
depender del orden de carga de las hojas.

## 8.4 Los tests que fijan todo esto

Hay trece archivos de test "de fuente": leen el repositorio en lugar de ejecutar código, y
fijan convenciones que ningún test de comportamiento podría ver. Los que tocan este capítulo
y el anterior:

- El de pestañas de sección prohíbe el color crudo sobre la concatenación de las constantes,
  exige que las ocho barras importen del módulo compartido y que ninguna conserve restos del
  subrayado viejo, y fija el negativo de la navegación del panel de socio.
- El de tarjetas del tablero cruza las dos fuentes de navegación sin leer disco.
- El de navegación del panel verifica que cada enlace tenga su archivo de página en disco.
- Los de cabeceras comparan la configuración del framework contra la constante del módulo y
  exigen que las entradas específicas estén declaradas **después** de la global, porque el
  framework las copia con un método que reemplaza en lugar de agregar.

## Dónde está en el código

- `src/app/globals.css` — todos los tokens, con el porqué de cada bloque.
- `src/components/ui/` — las doce primitivas y sus variantes locales.
- `tests/section-tabs.test.ts` y `tests/dashboard-cards.test.ts` — los dos tests de fuente
  más citados en este documento.

---

# 9. Checklist del desarrollador nuevo

## 9.1 Puesta en marcha

1. Clonar el repositorio e instalar Node y Docker. El repositorio **no fija la versión**: no
   hay campo de motores en `package.json` ni archivo de versión para el gestor. El servidor
   corre Node 22 LTS según el relevamiento de infraestructura, y la máquina de desarrollo del
   operador tiene la 24. Ante la duda, la que manda es la del servidor.
2. Copiar `.env.example` a `.env` y completar. Las claves de prueba del captcha son las
   públicas del proveedor; las de pagos van vacías hasta que se necesite el circuito de
   cobro.
3. Levantar la base con `docker compose up -d`. Es MariaDB 10.11, la misma versión mayor que
   el servidor, publicada sólo en la interfaz local, y crea también la base sombra con el
   mismo juego de caracteres.
4. Correr `npx prisma migrate dev`. Nunca `db push`: el proyecto se despliega con migraciones.
5. Correr la siembra. Crea roles, el superadministrador y los borradores de textos legales.
   Nunca pisa la contraseña de un usuario existente y **no re-otorga roles**, porque corre en
   cada despliegue y re-otorgarlos haría que una revocación deliberada volviera sola. Los
   usuarios de prueba sólo se crean con la variable de opt-in correspondiente, y con esa
   variable en producción la siembra **lanza**.
6. Importar los datos fundacionales con los scripts: las 40 calles del barrio, el padrón del
   Libro N° 1 y la foto de deuda. Los tres son idempotentes y abortan ante cualquier
   ambigüedad. Si se va a trabajar sobre plazos del re-empadronamiento, sembrar también los
   feriados.
7. Arrancar con `npm run dev`. Levanta en el puerto 3000; el puerto 3006 es del comando de
   producción y está en el script, no en el entorno.
8. Correr `npm test`. Son 293 archivos de test unitario y no necesitan base.
9. Para la suite de integración hace falta una base real y migrada y la variable de conexión
   de test. Sin esa variable los cuatro archivos se saltean enteros y la suite pasa en verde
   sin haber probado nada: conviene saberlo antes de confiar en el resultado.
10. Entrar al panel con el usuario de prueba de administración. La contraseña sale de la
    variable de siembra del entorno local.

## 9.2 La primera pantalla del panel

11. Encabezado con el componente compartido; mensajes con el de mensajes; lista vacía con el
    de estado vacío, **nunca un encabezado de tabla sin filas**; pastilla de estado del
    catálogo, nunca un ternario local; paginación con los tres ayudantes y su componente;
    enlace de texto con la clase compartida; desplegable nativo con la clase compartida;
    pestañas con el módulo compartido.
12. Sección nueva del panel: agregar el ítem al arreglo de navegación **y** la tarjeta al
    catálogo del tablero. Hay un test que los cruza y falla si se olvida uno.

## 9.3 La primera acción de servidor

13. Primera línea: la guarda de rol que corresponda. No alcanza con que la pantalla esté bajo
    el panel, porque una acción no se despacha por su URL.
14. Convertir los datos con el puente y un esquema de validación cuyos mensajes estén en
    castellano.
15. Si hay red o escritura de archivo, que quede **fuera** de la transacción. Si hay
    concurrencia sobre una fila, preferir una actualización condicional antes que un mutex.
16. Si la acción es sensible (aprobar un alta, declarar una baja, registrar un pago, ver un
    documento), dejar asiento de auditoría con identificadores y montos, nunca con datos
    personales, y escribir la IP desde la acción.

## 9.4 Qué leer antes de tocar tesorería

17. El documento T5 de esta serie, entero. Tesorería es el subsistema con más invariantes y
    con más historia de errores medidos: el número sin huecos, el piso de cobertura
    compartido, la barrera de idempotencia del dinero de pagos, el reparto con portador y
    partes, y las cinco guardas de exención. La regla práctica: antes de agregar una bandera
    al núcleo, preguntarse si la fila que ya existe alcanza — el módulo de exenciones no
    modificó ni un archivo existente de tesorería ni de pagos.

## Dónde está en el código

- `docker-compose.yml` y `docker/mariadb-init/` — la base local y su base sombra.
- `prisma/seed.ts` y `prisma/seed-guard.ts` — la siembra y la guarda de usuarios de prueba.
- `scripts/import-calles.ts`, `scripts/import-padron.ts` y `scripts/import-deuda.ts` — los
  tres importadores fundacionales.
- `deploy.sh` — el despliegue completo, que es el tema del documento T3.

---

# Documentos relacionados

| Documento | Qué cubre |
|---|---|
| T1 — Visión y panorama | Qué es SIGeV, los roles, el mapa del sitio, los módulos y su estado |
| T3 — Instalación, despliegue y operación | Entorno local en detalle, variables, servidor, crons, respaldos |
| T4 — Modelo de datos | El esquema entero, dominio por dominio, enums, uniques y migraciones |
| T5 — Tesorería y Mercado Pago | El ciclo de la cuota, los caminos de cobro, el gateway y los avisos |
| T6 — Módulos de dominio | Altas, socios, re-empadronamiento, reportes, actas, contenido |
| T7 — Seguridad, privacidad y calidad | Sesión, tokens, captcha, límites, cabeceras, auditoría, tests |

De la documentación previa del repositorio, los tres archivos más cercanos a este documento
son `docs/03-arquitectura-e-infraestructura.md` (stack y despliegue),
`docs/04-modelo-de-datos.md` (entidades) y el propio `CLAUDE.md`, que reúne las convenciones y
los bloques de patrones por módulo. Las diferencias encontradas entre esa documentación y el
código están anotadas en `docs/manuales/HALLAZGOS-2026-09-11.md`.
