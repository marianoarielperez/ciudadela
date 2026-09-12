# La IPN vieja de Mercado Pago llega con cuerpo JSON y recibe 400: diseño aprobado

**Fecha:** 12/09/2026 · **Estado:** aprobado por el operador (un cambio, dos supuestos)

**Lo medido (nginx del VPS, 11/09/2026).** Mercado Pago sigue mandando a
`/api/webhooks/mp` la IPN vieja —`User-Agent: MercadoPago Feed v2.0`, query
`?id=…&topic=payment` o `?id=…&topic=merchant_order`, sin `data.id=`— para pagos
de **agosto** (`174386387557`, `175328938010`) y sus órdenes, **varias veces por
día** (03:25, 04:21, 04:22, 04:40, 05:15, 11:21…), y la ruta responde **400 con 23
bytes** = `{"error":"bad_data_id"}`. La 4B (`49d06e1`) había decidido que la IPN
vieja responde 200 —"recibido, no procesado"— porque un 4xx sostenido es algo que
MP puede terminar deshabilitando, y ahí se perdería también la notificación
moderna. Pero ese arreglo supuso que la IPN vieja llega **con el cuerpo vacío** y
por eso puso el 200 sólo en la rama `bad_json`. En producción la IPN vieja llega
**con un cuerpo JSON** (`req.json()` no falla), así que cae en la rama siguiente,
la del `data.id` malformado, que ya la reconoce como `legacyIpn` y la audita, pero
devuelve 400 igual. El test existente ("un IPN legacy que llega con cabeceras de
firma también asienta webhook_legacy_ipn") fija ese 400: fijaba el defecto.

## 1. Cambio

En `src/app/api/webhooks/mp/route.ts`, rama `!SAFE_DATA_ID.test(dataId)`: si
`legacyIpn`, auditar `webhook_legacy_ipn` (`reason: "legacy_ipn_shape"`, `topic`
recortado a 32) **sin condicionar a `claimsSignature`** —mismo criterio que la
rama `bad_json`: `?topic=` sin `data.id=` no es ruido de escáner— y responder
**200 `{ ignored: "legacy_ipn" }`**. El resto de la rama (data.id malformado que NO
es IPN vieja) queda igual: audita `webhook_rejected_signature` sólo con cabeceras
y responde 400. Para no duplicar el asiento y sus comentarios, las dos ramas
comparten un helper local `ignoreLegacyIpn()` que audita y devuelve la respuesta.

**Lo que NO cambia:** un POST sin `topic=` sigue dando 400 (`bad_json` o
`bad_data_id`) y sin auditar; la firma, la idempotencia por `WebhookEvent` y el
procesador no se tocan; ningún archivo de `src/lib/mp/*`, `src/lib/treasury/*`
ni `prisma/*`.

## 2. Supuestos (el operador puede objetar)

1. La IPN vieja se audita **en cada llegada**, traiga o no cabeceras. Hoy MP la
   reintenta ~6 veces por día por 400; con el 200 deja de reintentar, así que el
   volumen de asientos baja, no sube.
2. El test que hoy exige 400 para una IPN vieja con cuerpo pasa a exigir 200 y
   `{ ignored: "legacy_ipn" }`.

## 3. Tests (en rojo primero)

`tests/mp-webhook-route.test.ts`:
- Nuevo: IPN vieja **real** —`?id=175328938010&topic=payment`, sin cabeceras,
  cuerpo `{"resource":"/v1/payments/175328938010","topic":"payment"}`— → 200,
  `{ ignored: "legacy_ipn" }`, asiento `webhook_legacy_ipn` con `topic: "payment"`.
  RED hoy: 400 `bad_data_id`.
- Nuevo: lo mismo con `topic=merchant_order` y cuerpo `{"resource":"…","topic":
  "merchant_order"}` → 200 y `topic: "merchant_order"`.
- Modificado: el de "con cabeceras de firma" pasa de 400 a 200 + `ignored`.
- Sin cambio y en verde: "POST basura sin topic → 400 bad_json sin auditar" y
  "data.id malformado que NO es IPN legacy → 400 + malformed_data_id".
- Mutación: volver la rama a 400 → los dos nuevos y el modificado en rojo.

## 4. Docs

- `docs/06` §4: la IPN vieja llega **con cuerpo JSON**; las dos ramas responden 200.
- `docs/11` Parte J, J.8: lo medido (las líneas de nginx, el 23 = `bad_data_id`,
  los reintentos de agosto).
- `docs/07`: entrada fechada 12/09 con el commit.
- `CLAUDE.md`, bullet "Las notificaciones que no atendemos responden 200" de la
  4B: agregar que la IPN vieja trae cuerpo JSON y que el 200 vive en las dos ramas.

## 5. Verificación y despliegue

Suite de base en `main` (`4372ff2`, 12/09): 293 archivos / 4169 tests → esperado
**4171**. `tsc`, lint, build. `git diff --stat` sólo: la ruta, su test, docs/06,
docs/07, docs/11, CLAUDE.md, esta spec. Deploy sin migración (docs/10 §4.1).
Post-deploy: `grep -h "Feed v2.0" /var/log/nginx/access.log | tail -5` muestra
**200** en los POST de la IPN vieja, y a los días MP deja de reintentar los de
agosto.
