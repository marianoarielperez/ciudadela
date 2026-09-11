# Pagos ajenos en la conciliación diaria (el cron no distingue plata que sale): diseño aprobado

**Fecha:** 11/09/2026 · **Estado:** aprobado por el operador (cuatro decisiones + cinco secciones)

El 11/09/2026 a las 03:17 la conciliación diaria mandó a la bandeja Sin
conciliar, con motivo "Sin referencia", un pago de Mercado Pago de $ 94,88
(id 178354740076, referencia externa `[5117560041]`) que **no era un cobro**:
era la factura mensual de Mercado Pago por cargos de operar ("Facturas con
cargos por operar", percepción de IVA), que el operador pagó el 10/09 desde la
cuenta de la vecinal. Plata que **salió** de la cuenta, mostrada como plata que
entró. Medido contra la API real con el token productivo: `GET
/v1/payments/search` devuelve, para el token del vendedor, **también los pagos
que la cuenta hizo como pagadora**, y en ésos la clave `collector_id` viene
**ausente**. Nuestro gateway no leía ese campo, el sistema no conocía su propio
id de cuenta, y el resolutor sólo mira id, preapproval y referencia: no había
ninguna pregunta sobre la dirección del dinero en todo el camino. Mercado Pago
factura esos cargos **todos los meses** (cierre el 7, cobro alrededor del 10),
así que sin arreglo esto se repite en cada corrida de octubre en adelante.

De paso, la misma investigación encontró por qué la corrida contó dos pagos a
bandeja con una sola fila visible: el paso 1 del cron le pasa al procesador un
preapproval **nulo** aunque el pago traiga su id de suscripción, así que un
débito cuyo webhook no llegó hace escala en la bandeja y recién el paso 2 lo
levanta. El webhook ya pasa ese id desde la T14; el cron quedó atrás.

---

## 1. Alcance

1. **Guarda de pago ajeno en el paso 1 del reconcile.** Antes de la búsqueda, el
   cron resuelve el id de la cuenta propia (`GET /users/me`, cacheado). Cada fila
   de `payments/search` pasa por un predicado puro `isOwnCollection`: sólo se
   procesa lo que tiene `collector_id` presente **e igual** al propio. Lo demás se
   saltea, se cuenta en un contador nuevo del resumen (`paymentsForeign`) y deja
   **un** asiento de auditoría por pago.
2. **El paso 1 pasa `p.subscriptionId` al procesador**, como el webhook. Un
   débito sin webhook resuelve por suscripción en el paso 1 en vez de hacer
   escala en la bandeja.
3. **El gateway aprende dos cosas**: mapea `collector_id` a `collectorId` en
   `MpPaymentDetails` y expone `ownAccountId()`.

**Lo que NO cambia:** los parámetros de `searchPayments`; `applyPayment`,
`resolve.ts`, `unmatched.ts`, `link-subscription.ts` y la ruta del webhook; los
pasos 2 a 5 del reconcile; `src/lib/treasury/*`; `prisma/*`; `.env.example`. Sin
migración ni variable de entorno nueva. **Fuera de alcance:** §9.

---

## 2. Decisiones del operador (11/09/2026)

| # | Decisión | Elección |
|---|---|---|
| 1 | De dónde sale el id propio de la cuenta de MP | **`GET /users/me` desde el gateway, cacheado en memoria.** El token define la identidad: no se puede configurar mal. Descartadas: variable `MP_COLLECTOR_ID` (paso manual por entorno, deriva si se rota el token) y fila en `Configuration` (editable a mano, sin forma de validarla sin llamar a `/users/me` igual) |
| 2 | Qué hace el cron con un pago ajeno | **Saltearlo, contarlo y auditarlo.** No va a la bandeja: la bandeja es plata que entró (docs/04) y esto es plata que salió; no hay ninguna decisión que tomar. Descartada: fila con motivo propio (trabajo sin decisión, y el titular "$ X cobrados" lo sumaría) |
| 3 | La escala del débito por bandeja | **Se arregla en la misma rama, con commit y test aparte.** Dos causas distintas en el mismo archivo; un solo deploy cierra las dos |
| 4 | Dónde vive la guarda | **En el paso 1 del reconcile, con el predicado puro.** La señal de "ajeno" es la **ausencia** del campo, así que la guarda falla cerrada ante cualquier cambio de payload: en el cron, lo único que se apaga es la red y `/admin/salud` lo muestra; en `applyPayment` (núcleo compartido) apagaría el asiento de cobros reales por webhook sin alerta roja. Descartada también la guarda dentro de `searchPayments`: el gateway no puede contar ni auditar |

---

## 3. Lo medido contra la API real (11/09/2026, token productivo)

Base del diseño. Va también a `docs/11` Parte J.

| Hecho | Medición |
|---|---|
| Id de la cuenta de la vecinal | `GET /users/me` → `id: 1978062823` (entero), `nickname: VECINALCIUDADELA`, `site_id: MLA` |
| La búsqueda devuelve pagos del lado pagador | `payments/search` desde el 01/07: **13 filas**. 10 cobros reales, todos con `collector_id: 1978062823` (entero, clave presente): 3 `recurring_payment`, 4 `regular_payment` (links `pago:`, ingreso `solicitud:`, adhesión `socio:`), 3 `money_transfer`. **3 pagos ajenos**, los tres con la clave `collector_id` **ausente** y `payer` ausente, `operation_type: regular_payment`, `payment_type_id: account_money`: 27,11 el 14/07 (ref `MELIPAYMENTS-COLLECTIONATTEMPT-1978062823-…`), 27,11 el 13/08 y 94,88 el 10/09 ("Facturas con cargos por operar", ref `[5007340143]` y `[5117560041]`) |
| Un pago ajeno se puede pedir por id | `GET /v1/payments/178354740076` → 200, `status: approved`, `collector_id` ausente, `payer` ausente, `point_of_interaction.type: CHECKOUT`, `metadata: {}` |
| `[5117560041]` no es un id de pago | `GET /v1/payments/5117560041` → 404 `Payment not found`. Es el número de la factura de MP, que viaja como `external_reference` |
| La búsqueda trae el id de suscripción | Las filas de los débitos traen `point_of_interaction.transaction_data.subscription_id` y coincide con la fila local (`4b3e9b33…`, `a69d4b7c…`). El tipo del SDK para el resultado de búsqueda lo omite; el JSON real lo trae |
| Filtro de servidor por cobrador | `payments/search?…&collector.id=1978062823` → total 4 → 3. **Existe y funciona, pero no se usa**: no está documentado en el SDK y un filtro que MP pueda ignorar o rechazar en silencio es la trampa de la 4B. Queda anotado como dato |
| El JSDoc del SDK es falso | `payment/search/index.d.ts`: "payments belonging to the authenticated collector". No |
| Duración de la corrida | 8 s la del 11/09 con 3 suscripciones. Una llamada más a `/users/me` no la compromete |

---

## 4. Diseño por componente

### 4.1 Gateway (`src/lib/mp/gateway.ts`)

- `RawPayment` suma `collector_id?: number | string | null`.
- `MpPaymentDetails` suma `collectorId: string | null`, con el comentario de lo
  medido: entero en los cobros propios, clave ausente en los pagos que la cuenta
  hizo como pagadora. `mapPayment` normaliza a texto; ausente, nulo o vacío →
  `null`. Se mapea en los dos caminos (`searchPayments` y `getPayment`) porque
  comparten `mapPayment`; nadie más lo consume hoy.
- Método nuevo en `MpGateway`: `ownAccountId(): Promise<string>`. `GET
  https://api.mercadopago.com/users/me` por `fetch` autenticado (como
  `searchAll`), sin SDK. No-2xx → `httpFailure("users/me", res)` (el `status`
  colgado es lo que hace reconocible un 429 para el reintento). Sin `id` en la
  respuesta → `Error("MP no devolvió el id de la cuenta.")`. Devuelve
  `String(id)`. **Cache en el closure** de `makeMpGateway` (`let ownId: string |
  null`): sólo se guarda un éxito; el proceso de PM2 lo pregunta una vez y listo.
  Va envuelto en `retrying` como el resto de las lecturas.
- `searchPayments` no cambia ni un parámetro.

### 4.2 Predicado puro (`src/lib/mp/own-collection.ts`, nuevo)

```ts
export const FOREIGN_PAYMENT_ACTION = "payment_foreign";
export function isOwnCollection(p: { collectorId: string | null }, ownId: string): boolean {
  return p.collectorId !== null && p.collectorId === ownId;
}
```

Sin Prisma, sin gateway, sin `Date`. Falla cerrada: `null` nunca es propio.

### 4.3 Reconcile, paso 1 (`src/lib/mp/reconcile.ts`)

`Deps` suma `gateway.ownAccountId`, `db.auditLog` (lectura) y `audit` (el
`audit()` best-effort de `@/lib/audit`, inyectado como en el procesador).
`ReconcileSummary` suma `paymentsForeign: number` después de `paymentsSkipped`,
con doc: *"Filas de `payments/search` que no son cobros de la cuenta (la cuenta
fue la pagadora: la factura mensual de MP). Se cuentan POR CORRIDA —una misma
factura puede contarse en hasta tres corridas de la ventana de 72 h—; el asiento
es lo que se escribe una sola vez."*

Secuencia nueva del paso 1:

1. `ownId = await gateway.ownAccountId()`. Si lanza → `fail("payments.owner",
   {}, e)` y **el paso 1 no corre**: ni búsqueda ni procesador. La corrida sigue
   con los pasos 2 a 5.
2. `searchPayments({ since })` como hoy.
3. Por cada fila, **primero** la guarda: si `!isOwnCollection(p, ownId)` →
   `s.paymentsForeign++`, `noteForeign(p)`, `continue`. Después, como hoy,
   `hasLocal` / `inInbox` → `continue`.
4. `count(await processor.applyPayment(p, p.subscriptionId, { mailBudget }),
   "payments")`. Antes iba `null`. El comentario que lo justificaba (`reconcile.ts`
   183-187, "el cron no sabe nada que el webhook no supiera") pasa a ser cierto
   literalmente y se reescribe en ese sentido.

`noteForeign(p)`: `db.auditLog.findFirst({ where: { action:
FOREIGN_PAYMENT_ACTION, entity: "mp_payment", entityId: p.id }, select: { id:
true } })` (usa el índice `[entity, entityId]`); si no existe, `audit({ action:
FOREIGN_PAYMENT_ACTION, entity: "mp_payment", entityId: p.id, detail: {
mpPaymentId, amount, description, externalReference } })`. Sin email ni datos
personales: un pago ajeno no trae pagador, y `description` y
`externalReference` son texto de MP (la factura). Si la lectura del asiento
lanza, se registra `fail("payments.foreign", …)` —rótulo propio, porque acá nunca
se aplicó nada— y el bucle sigue con la fila siguiente; el pago ajeno se contó
igual y no se aplicó, que es lo que importa.

Orden de la guarda **antes** de `hasLocal`/`inInbox`, a propósito: la pregunta
"¿es nuestro?" va antes que "¿ya lo conocemos?", y un pago ajeno no puede tener
`Payment` local. La fila de $ 94,88 que hoy está en la bandeja (descartada, §8)
queda fuera de la ventana de 72 h para cuando esto se despliegue; si no, se
contaría como ajena una vez y su asiento se escribiría una vez, sin tocar la
fila.

Cableado por defecto: `db: prisma` (que ya tiene `auditLog`), `gateway:
mpGateway`, `audit` de `@/lib/audit`.

### 4.4 Qué ve el operador

- `/admin/salud` → Tareas → Conciliación imprime las claves crudas del resumen,
  así que `paymentsForeign` aparece solo, al lado de `paymentsSkipped`. Sin
  cambio de pantalla.
- Un pago ajeno **no** cambia el veredicto de salud ni pinta rojo: es un evento
  mensual normal. Lo que sí pinta rojo es un `payments.owner` en `errors[]`
  (cron con errores → *act*), y eso es correcto: la red no corrió.
- `audit_log` guarda `payment_foreign` con id, monto, descripción y referencia
  externa (el número de factura de MP). No tiene pantalla; es rastro.

---

## 5. Manejo de errores y casos borde

| Caso | Comportamiento |
|---|---|
| `/users/me` responde 429 | `retrying` lo reintenta como a cualquier lectura (`retry.ts`) |
| `/users/me` falla después de los reintentos, o no trae `id` | Paso 1 no corre; `errors[]` lleva `payments.owner: …`; HTTP 207; pasos 2-5 corren igual. Al día siguiente vuelve a intentar (el cache sólo guarda éxitos) |
| `collector_id` viene como texto en vez de entero | Se normaliza a texto en los dos lados: `String(collector_id)` contra `String(me.id)` |
| `collector_id` presente pero distinto del propio | Ajeno. No hay caso medido, pero la regla es "propio o nada" |
| MP dejara de mandar `collector_id` en los cobros reales | **Todo el paso 1 contaría ajeno** (`paymentsForeign` = filas, `paymentsRecovered` 0, un asiento por pago). Fail-closed acotado a la red del cron; el webhook, que es el camino primario, sigue asentando. Riesgo aceptado y documentado en docs/06 §6 |
| Un pago ajeno que ya está en la bandeja (la fila de hoy) | La guarda lo cuenta y audita una vez; no toca la fila. `inInbox` nunca llega a preguntarse |
| Débito en el paso 1 con suscripción local vinculada | Regla 3 del resolutor → `debit_applied` → `paymentsRecovered++`. Antes: bandeja + paso 2 |
| Débito en el paso 1 cuya suscripción no existe localmente | Regla 8 → bandeja con motivo `no_subscription` (antes `no_reference`, menos preciso). El paso 4 crea la suscripción huérfana; la corrida siguiente lo resuelve por el paso 2 |
| Débito en el paso 1 con suscripción local sin socio | Regla 4, idéntica al webhook: `entry` si hay solicitud, si no `duplicate_entry` a la bandeja |
| Fila de búsqueda sin `point_of_interaction` | `subscriptionId: null` → comportamiento de hoy, sin regresión |

---

## 6. Tests (en rojo primero; guardas verificadas por mutación)

Cada guarda se prueba **borrándola** y viendo el test en rojo antes de
restaurarla; el informe de cierre lista cuál mutación puso en rojo a cuál test.

- **`tests/mp-gateway.test.ts`** (fetch mockeado, atraviesa `mapPayment` desde
  JSON crudo): el fixture de `searchPayments` y el de `getPayment` suman
  `collector_id: 1978062823` (entero) → `collectorId: "1978062823"`; fila sin la
  clave → `null`; `collector_id: null` → `null`. `ownAccountId`: `GET /users/me`
  con bearer, devuelve `"1978062823"`; la segunda llamada **no** hace fetch
  (cache); no-2xx lanza con `status`; respuesta sin `id` lanza; un fallo no se
  cachea (la llamada siguiente vuelve a pedir).
- **`tests/mp-own-collection.test.ts`** (nuevo, puro): tabla — igual → propio;
  distinto → ajeno; `null` → ajeno; `"1978062823"` contra `"1978062823"` propio;
  texto con espacios no se normaliza (no es responsabilidad del predicado).
- **`tests/mp-reconcile.test.ts`**: el fixture `pay()` suma `collectorId:
  "1978062823"` y `subscriptionId: null` por defecto, y el doble de gateway suma
  `ownAccountId`. Casos nuevos: (a) un pago ajeno no llama a `applyPayment`, ni
  a `hasLocal`/`inInbox`, suma `paymentsForeign` y escribe el asiento con la
  acción, la entidad y el detalle esperados; (b) si el asiento ya existe
  (`auditLog.findFirst` devuelve fila) no se escribe otro y **sí** se cuenta; (c)
  si `ownAccountId` lanza, no se llama a `searchPayments` ni al procesador,
  `errors[]` lleva `payments.owner` y los pasos 2-5 corren (se ve `getPreapproval`
  llamado); (d) los pagos propios siguen contándose como hoy (los tests
  existentes, sin tocar una aserción); (e) el paso 1 llama `applyPayment(p,
  p.subscriptionId, …)` con `"pre-1"` cuando el pago lo trae, y con `null` cuando
  no; (f) el resumen inicial trae `paymentsForeign: 0`.
- **`tests/mp-reconcile-route.test.ts`** y cualquier otro test con un literal
  tipado `ReconcileSummary`: se completa con `paymentsForeign` para que `tsc`
  pase; sin cambio de aserciones.
- **Cierre**: suite entera con conteo contra `main`, `tsc --noEmit`, lint, `npm
  run build`, `git diff --stat` cotejado contra §10, informe en
  `.superpowers/sdd/`.

---

## 7. Documentación

- **`docs/06` §2**: fila nueva en la tabla del gateway (`ownAccountId`, "id de la
  cuenta propia, `GET /users/me`, cacheado; el paso 1 lo usa para descartar lo
  que la cuenta pagó") y el campo `collectorId` en la descripción de
  `MpPaymentDetails`. Pasa a decir **doce** métodos. **§6**: paso 1 con la guarda,
  el contador `paymentsForeign`, el asiento, el fail-closed de `payments.owner`
  y el `subscriptionId`; la lista de contadores del resumen. Todo lugar de `docs/`
  que enumere los contadores se actualiza (`grep paymentsSkipped docs/`).
- **`docs/07`**: bloque nuevo fechado 11/09/2026 después de la 4D: el incidente,
  las dos causas, el commit de cada arreglo, y la nota de que "sí indexa en
  producción" había medido que la búsqueda devuelve algo, no qué universo.
- **`docs/11` Parte J**: subsección nueva con la tabla de §3 tal cual (es lo
  medido), incluido el filtro de servidor que existe y no se usa, y el `curl` de
  `/users/me` + `/v1/payments/search` con el filtro por fecha como procedimiento
  de inspección (hoy no hay ninguno documentado para `payments/{id}`).
- **`docs/10` §4.11**: verificación post-deploy (§8).
- **`CLAUDE.md`**: sección nueva corta "Patrones que estrenó el arreglo de pagos
  ajenos (11/09/2026)": la búsqueda devuelve también lo que la cuenta PAGÓ y la
  señal es la AUSENCIA de `collector_id`; el id propio sale del token
  (`ownAccountId`), no de configuración; la guarda vive en el cron y no en el
  núcleo, y por qué; el paso 1 le pasa al procesador lo mismo que el webhook. Y
  corregir la línea de "Prioridad actual" que da por pendiente el crontab del
  devengo: `/admin/salud` muestra una corrida efectiva del 01/09/2026 con
  `forced no`. Se corrige sólo después de que el operador lo coteje con
  `crontab -l` en el VPS; si la línea no está, se deja como está.

---

## 8. Operativo

1. **Ahora, sin código:** descartar la fila de $ 94,88 en la bandeja con motivo
   "Factura mensual de Mercado Pago por cargos de operar (percepción de IVA); no
   es un cobro". El descarte no crea pago, deja la fila como barrera y pisa la
   descripción de MP, que ya está registrada en §3. El egreso se anota en el
   libro de tesorería: SIGeV no modela egresos (docs/01).
2. **Deploy:** `git pull`, `npm run build`, `pm2 restart` según `docs/10` §4.1.
   Sin migración.
3. **Verificación post-deploy (`docs/10` §4.11):**
   - Corrida manual del reconcile con el `curl` de `docs/11` Parte H → HTTP 200,
     `paymentsForeign` presente en el resumen (0 si la factura del 10/09 ya
     quedó fuera de la ventana de 72 h; 1 si no), `errors` vacío.
   - `/admin/salud` → Tareas: la fila de Conciliación muestra `paymentsForeign`.
   - Si `paymentsForeign` fue 1: un solo asiento `payment_foreign` en
     `audit_log` con `entityId 178354740076`, y ninguna fila nueva en la bandeja.
   - **Primera factura mensual después del deploy** (cobro alrededor del
     10/10): la corrida siguiente muestra `paymentsForeign 1`, `paymentsInbox 0`
     y la bandeja no gana filas. Ésa es la prueba real.
   - **Primer débito de suscripción sin webhook** después del deploy: entra
     como `paymentsRecovered 1` en el paso 1, sin fila en Resueltos con hora
     03:17.

---

## 9. Fuera de alcance (deuda anotada en docs/07)

- **Bruto vs. neto.** El sistema asienta `transaction_amount` (3.000 de Iván
  entraron netos 2.852,91; 18.000 entraron 17.892). Nunca se decidió; hoy queda
  escrito que es bruto por omisión.
- **El webhook que no llegó** para uno de los dos débitos del 10/09 (salud no
  muestra avisos con error: no llegó, no falló). Pendiente identificar cuál en
  Resueltos y mirar la configuración de webhooks del panel de MP (docs/11 J.1).
- **La suscripción duplicada de Iván** (una cancelada el 10/09, otra activa).
- **Etiquetas legibles** para los contadores del reconcile en `/admin/salud`.
- **Filtro `collector.id` del lado del servidor**: existe, no se usa.

---

## 10. Archivos que toca el módulo (para la auditoría del `git diff --stat`)

Código: `src/lib/mp/gateway.ts`, `src/lib/mp/own-collection.ts` (nuevo),
`src/lib/mp/reconcile.ts`.
Tests: `tests/mp-gateway.test.ts`, `tests/mp-reconcile.test.ts`,
`tests/mp-own-collection.test.ts` (nuevo).
Docs: `docs/06-integracion-mercadopago.md`, `docs/07-plan-de-etapas.md`,
`docs/10-runbook-dominio-produccion.md`, `docs/11-preparacion-mp-sandbox-turnstile.md`,
`CLAUDE.md`, y cualquier otro `docs/*.md` que enumere los contadores del
resumen.
**Vacío**, y se verifica: `src/lib/treasury/`, `prisma/`, `src/app/`,
`src/lib/mp/webhook-processor.ts`, `src/lib/mp/resolve.ts`,
`src/lib/mp/unmatched.ts`, `.env.example`.
