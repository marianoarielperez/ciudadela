// La URL del checkout de una suscripción de Mercado Pago es determinística
// sobre el `preapproval_id`, así que NO persistimos el `init_point` que devuelve
// la API: se reconstruye desde el único dato que sí guardamos
// (`Application.preapprovalId`).
//
// Vive en su propio módulo —y no dentro de `actions.ts`— porque lo necesitan las
// dos puntas: la action que arranca el pago (server) y la pantalla "estamos
// confirmando tu pago", que ofrece "volver al pago" (cliente). Es un string puro,
// sin SDK ni credenciales, así que entra al bundle del navegador sin arrastrar
// nada de MP.
export function checkoutUrlFor(preapprovalId: string): string {
  return `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=${encodeURIComponent(preapprovalId)}`;
}
