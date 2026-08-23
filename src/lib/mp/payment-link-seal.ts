// Sello que ata el link de pago al socio para el que se generó.
//
// EL PORQUÉ: `emailPaymentLinkAction` recibe la URL del checkout en un `hidden`
// —vuelve del navegador, es entrada hostil— y valida que sea de Mercado Pago,
// pero no que sea DE ESE SOCIO. Sin esto, un POST armado a mano le manda al
// socio A un enlace cuya referencia acredita al socio B: el vecino paga y la
// cuota se le imputa a otro. Es inalcanzable desde la pantalla y sólo lo puede
// intentar un admin, pero cerrarlo cuesta cuatro líneas.
//
// La preferencia NO se persiste (spec 4B §12), así que no hay fila contra la
// cual comparar: en su lugar el servidor firma la tupla que acaba de crear y
// verifica esa firma al reenviarla. La URL no aporta el `memberId` por sí sola
// —es `.../redirect?pref_id=...`—, así que la pertenencia tiene que viajar
// firmada o no viaja.
import { createHmac, timingSafeEqual } from "node:crypto";

export type SealedLink = { memberId: number; n: number; amount: number; url: string };

/** `AUTH_SECRET` ya es el secreto del proceso (Auth.js lo exige) y no sale de
 *  acá: el sello es un hex de 64 caracteres. Si falta, se tira — un sello
 *  calculado con una clave vacía sería un sello que cualquiera puede fabricar. */
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET no está configurado.");
  return s;
}

/** El separador es un ESPACIO, que no puede aparecer en una URL válida (iría
 *  como %20) ni dentro de un número: dos tuplas distintas no pueden producir el
 *  mismo manifiesto. */
export function sealPaymentLink(v: SealedLink): string {
  const manifest = [v.memberId, v.n, v.amount, v.url].join(" ");
  return createHmac("sha256", secret()).update(manifest).digest("hex");
}

export function isPaymentLinkSealValid(v: SealedLink, seal: string): boolean {
  const a = Buffer.from(sealPaymentLink(v), "utf8");
  const b = Buffer.from(seal, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
