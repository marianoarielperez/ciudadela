# Siembra de la base local para las capturas de los manuales

Base LOCAL (Docker `sigev-db`, `sigev` en `localhost:3306`). **Producción no se tocó.**
Fecha del sistema durante la siembra: **12/09/2026**. Todo lo de acá abajo queda en la base
(decisión del operador). Ver también `task-2-report.md`.

---

## 1. Fichas ficticias creadas

Todas por **Alta manual** (`/admin/socios/nuevo`) como `admin.prueba`, con acta existente
**Comisión Directiva N° 124 (id 20, 12/09/2026)**, salvo la 678, que ya venía de la Tarea 1.

| id | N° libro 1 | Nombre | DNI | Categoría | Para qué |
|---|---|---|---|---|---|
| 678 | 308 | Prueba Manuales, Socia | 99000001 | activo | socio de `/mi` (M2) y de las capturas de Tesorería |
| 679 | 309 | Prueba Adherente, Vecino | 99000003 | adherente | cohorte del re-empadronamiento + solicitudes de socio |
| 680 | 310 | Prueba Exenta, Vecina | 99000002 | activo | exención de cuota vigente |
| 681 | 311 | Prueba Debito, Vecino | 99000004 | activo | suscripciones de Mercado Pago |

El **679 se creó ANTES de convocar** el re-empadronamiento: la cohorte se congela al convocar.

## 2. Arreglos sobre la ficha 678 (watch items de la revisión de la Tarea 1)

1. **`emailStatus` `declared` → `verified`** (+ `emailVerifiedAt`), por SQL. Sin eso,
   `/mi/datos` (m2/05) y la ficha del admin (m1/13) mostraban "Sin verificar" para una
   casilla que en el manual se usa como ejemplo de casilla válida.
2. **Deuda**: el devengo con la escotilla **NO sirve hoy**. Medido leyendo
   `src/app/api/cron/accrual/route.ts` + `rules.ts`: `IMPORT_COVERAGE_FLOOR` es
   **2026-09** (la foto de deuda cubre hasta agosto) y el techo de `?upTo=` es el mes
   **vencido**, o sea **2026-08**; el piso queda por encima del techo, así que la ventana
   está vacía y `periodsToAccrue` devuelve `[]` para todos. La primera corrida que crea
   filas es la del 01/10/2026. Se sembraron entonces **3 cuotas `pending` con
   `origin='import'`** (2026-06, 2026-07, 2026-08; ids 3603-3605), que es exactamente lo
   que hace `scripts/import-deuda.ts` con el resto del padrón.
3. **Pago en efectivo** desde Tesorería → Efectivo: 1 cuota, $ 6.100,00 →
   **recibo 2026-00011** (payment id 322, receipt id 282), concepto "Cuota social · junio
   2026". Quedan **2 cuotas pendientes** ($ 12.200,00). Sin débito vigente.
   - **El pago se BACKDATEÓ a 25/08/2026** (payment.paid_at y receipt.issued_at) después de
     ver la captura: con el pago en el mes corriente, `/mi/debito` (m2/04) mostraba
     "Ya abonaste una cuota este mes. Podés adherirte desde el 01/10/2026" (la regla
     anti-duplicación mensual) y el manual del socio se quedaba sin la pantalla de
     adhesión, que es la que el capítulo explica.

## 3. Contenido

- **Acta**: Comisión Directiva **N° 124**, id **20**, 12/09/2026, "Acta de prueba para los
  manuales…". Se usa en el alta manual, en la exención y en la convocatoria.
- **Noticia en borrador**: id **63**, "Reunion informativa sobre el re-empadronamiento"
  (sin portada). La publicada con portada es la que ya existía: id 60, "Asamblea General
  Ordinaria 2026".
- **Actividades**: no se sembró nada — ya había 11 (10 de 2026 y 1 de 2025).
- **Documentos institucionales**: no se sembró nada — está el Estatuto social (id 19).

## 4. Tesorería

- **Exención de cuota** (superadmin): socio **680**, 12 meses, **septiembre 2026 a agosto
  2027**, acta N° 124, nota "Contribucion en especie: pintura de la sede (caso de prueba
  para los manuales)". Fila `fee_exemptions` id **4**.
- **Bandeja Sin conciliar**: `npx tsx scripts/dev/seed-unmatched.ts 18000
  vecino.prueba@example.com` → fila **62**, $ 18.000,00, `dev-1789224842469`, motivo
  "sin referencia".
- **Suscripciones de MP**: las 7 filas de `mp_subscriptions` que tenían `member_id`
  apuntaban a socios REALES del padrón (seis fichas reales del padrón, identificadas por id en la base local).
  La pantalla no tiene buscador, así que se **repuntaron por SQL a las fichas ficticias**
  (6, 7, 9 → 681; 10, 12 → 680; 13, 14 → 679). Son suscripciones de sandbox/pruebas de los
  módulos 3-5, no registros de plata de esas personas.

## 5. Solicitudes de alta

Se reusó la cola que ya existía, **saneada** (ver §8). La ficha que ilustra el manual es la
**#32 "Camino Feliz, Vecina"** (DNI inventado 39555777, adherente, `pending_board`).

- Su `email` era el correo personal del operador, lo que además disparaba un
  panel de advertencias que nombraba al socio real N° 14. Se cambió a
  `camino.prueba@example.test` y las advertencias desaparecieron.
- Sus dos documentos de DNI eran archivos de 4096 bytes con cabecera JPEG falsa: el
  navegador no los podía decodificar y la ficha mostraba dos imágenes rotas. Se
  **reemplazaron por dos JPEG reales** generados con `sharp` (una tarjeta gris que dice
  "DNI — frente / dorso · imagen de ejemplo") y se corrigió `documents.size`.

Las capturas del wizard ASOCIATE dejaron **dos solicitudes nuevas en estado `started`**:
**id 37** (DNI 99766147) e **id 38** (DNI 99732766), las dos a nombre de "Vecina de Prueba"
con email `vecina.prueba+<dni>@example.test`. Cada corrida de `m3 --only 09/10` deja una más.

## 6. Reportes

Reporte **id 19, N° público 4**, reclamo `received`, categoría "Electricidad y luminarias /
Falta de alumbrado público / luminaria quemada", con ubicación en el mapa y sin fotos.
Se cargó **desde el panel del socio** (`/mi/solicitudes/reportes/nuevo`) y no desde
`/reportes`: `validateSubmission` exige las **dos caras del DNI** a quien no es socio
(`rules.ts:100`), y el panel del navegador no puede adjuntar archivos. Como socio,
`isMember` es verdadero y esa guarda no corre. Efecto secundario deseado: el reporte
aparece también en m2/07.

Las capturas m3/12 y m3/13 dejan **borradores** (`reports` 20 y 21). Los purga el cron del
resumen diario a las 48 h.

## 7. Re-empadronamiento

**Convocado el 12/09/2026** con el acta N° 124 (proceso id **11**, `first_instance`, 1ª
instancia hasta el **12/10/2026**). Cohorte congelada: **126 adherentes vigentes**.

- **Presentación** del adherente ficticio 679 desde `/reempadronate` (presentación id
  **892**, `submitted` 12/09/2026 12:29). El wizard pide las dos caras del DNI, así que se
  corrió con un script efímero de Playwright (mismo motivo que el reporte).
- **Cartelera**: lote `first_instance` (board_notice id **9**), **101 destinatarios**,
  **fijado el 12/09/2026**, queda fehaciente el **09/10/2026** (20 días hábiles).

⚠️ **Convocar SUSPENDE ASOCIATE.** Desde ese momento `/asociate` responde "Las asociaciones
están suspendidas temporalmente durante el proceso de re-empadronamiento" y la portada
cambia el botón. Por eso **las capturas m3/05 a m3/10 se sacaron ANTES de convocar** y hoy
**no se pueden re-capturar** sin cerrar antes el proceso en la base local.

## 8. Datos reales que hubo que sacar de las pantallas

La restricción era "ninguna captura con DNI, domicilio o nombre de un socio real del padrón".
Lo que se hizo, por pantalla:

| Pantalla | Qué aparecía | Solución |
|---|---|---|
| `/admin/socios` | 164 vigentes reales | `?q=Prueba` (sólo las 4 fichas inventadas) |
| Deudores | 118 deudores reales | `?q=Prueba` |
| Recibos | apellidos reales del padrón en la lista | `?q=Prueba` |
| Usuarios | 4 emails personales reales | `?q=sigev.local` (las 3 cuentas de prueba) |
| Suscripciones | 5 socios reales | repunte de `mp_subscriptions.member_id` (§4) |
| Solicitudes de socios | nombre y número de un socio real, también **dentro del texto** de la carta de renuncia | repunte de `member_requests.member_id` (1, 2 → 679; 5 → 680) **y** `REPLACE()` sobre `member_requests.text` |
| Resumen para acta / cola de altas | dos solicitudes con nombre y DNI de socios reales (ids 293 y 285 en la base local) | `applications` 11 → "Prueba Reingreso, Vecino" DNI 99000311; `applications` 8 → DNI 99000312. Emails reales de las solicitudes 11, 22 y 32 → `@example.test` |
| Padrón electoral | la nómina completa asoma bajo la tira de conteos | `fullPage: false` + `prepare` que pliega `#habilitados`, `#a-purgar`, `#no-habilitados` |
| Tablero de reempadronamiento | "Convocados sin aviso por correo" lista 24 vecinos con nombre y número | `prepare` que pliega `#sin-aviso` (m1/09 y m1/11) |
| Cierre del libro | la nómina de los 125 que se darían de baja (15.852 px de alto) | `fullPage: false` |
| Otros ingresos | la columna "Registró" muestra el nombre de la cuenta de gestión del operador | recapturada a viewport (3499306): la columna queda fuera |

## 9. Comportamientos que sorprendieron (material para M1)

1. **Cobrar en efectivo con `EMAIL_ALLOWLIST` puesta deja un aviso ámbar** que se lee como
   una falla: *"Recibo emitido, pero el email no salió. Podés reenviarlo desde acá."* En el
   entorno local es sólo la allowlist bloqueando. El manual tiene que decir qué significa.
2. **El `MinutePicker` abre siempre en "acta existente" con la MÁS RECIENTE preseleccionada**
   (alta manual, exención, convocatoria, asiento en acta). Es la tercera vez que el proyecto
   lo anota; para el operador es una decisión tomada por defecto que hay que revisar en cada
   pantalla antes de confirmar.
3. **Tesorería → Valores de cuota nombra el acta por su ID**: la tabla dice **"Acta #13"**,
   que es `minutes.id`, y el acta del libro es la **Comisión Directiva N° 123**. Va contra la
   regla propia del proyecto ("un acta se nombra por TIPO y NÚMERO, `minuteName`, nunca por
   su id"). No es una captura mal sacada: es lo que la pantalla imprime hoy. Vale reportarlo
   aparte del manual.
4. **`/admin/reempadronamiento/avisos` no es una ruta**: esa carpeta sólo tiene `actions.ts`
   y `board-notice-card.tsx`. La cartelera es la sección `#cartelera` del tablero. Antes de
   detectarlo, la captura salía "ok" ¡con la página 404 adentro!
5. **Asentar la fijación del cartel pasa por un `window.confirm`**, así que ningún automatismo
   headless puede hacerlo sin manejar el diálogo. Para el operador es lo correcto (es un acto
   que hace correr 20 días hábiles a 101 vecinos); para el manual, conviene decir que ese
   cartel se asienta **una sola vez** y no se puede corregir.
6. **La cola de altas tiene una barra de asiento *sticky***: en una captura de página entera
   queda clavada a media altura tapando una ficha. En pantalla está al pie.
7. **`/reportes` es una landing, no el paso 1**: el wizard vive en `/reportes/nuevo?tipo=…`.
8. **Cupos que frenan una corrida de capturas** (todos en memoria del proceso, se limpian al
   reiniciar el dev server): `asociateDniCheckLimiter` **5 cada 15 min por IP** — una corrida
   completa de m3 gasta exactamente 5— y `asociateEmailLimiter` **por casilla**, que obligó a
   usar un email distinto en cada una de las dos capturas que crean solicitud.

## 10. La casilla de Cloudflare (watch item 4)

`m1/01-ingresar`, `m3/14-ingresar`, `m2/09-recuperar-contrasena`, `m3/05-asociate-paso-1-dni`,
`m3/11-reempadronate-paso-1` y `m3/12-reportes-paso-1` salen con el widget de **Turnstile
oculto** (`hideTurnstile`), porque en local corre con las claves dummy de Cloudflare y pinta
una leyenda ROJA "Solo para pruebas. Si se ve, informe al propietario del sitio" que en un
manual se lee como un error del sitio. **En la captura queda un hueco en blanco donde el
lector va a ver una casilla de verificación de Cloudflare** ("No soy un robot" / la marca
de Cloudflare). Los tres manuales tienen que nombrarla en el texto que acompaña a esas
imágenes: es un control que el vecino y el operador SÍ ven, y si no se explica, el hueco
parece un error de maquetación.
