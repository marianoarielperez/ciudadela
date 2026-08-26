// La URL de retorno de una presentación de re-empadronamiento.
//
// En UNA sola función porque la arman cuatro correos que salen de dos archivos
// distintos: la constancia y el reenvío del enlace (wizard público) y la
// observación (panel de la Comisión). Mandar el token a una ruta equivocada le
// deja al vecino un enlace muerto justo cuando le corre el plazo del Art. 9°
// bis, y ese error no lo cazaría ningún test que no compare las cuatro.
//
// No puede vivir dentro de `reempadronate/actions.ts`: en un módulo "use
// server" todo lo exportado tiene que ser una función async (lo exportado es un
// endpoint), y una URL no es un endpoint.
//
// `AUTH_URL` se hornea en el build; el fallback a localhost es el mismo que usa
// el resto del proyecto para el dev server.
export function reregistrationBaseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

export function presentationResumeUrl(raw: string): string {
  return `${reregistrationBaseUrl()}/reempadronate/retomar/${raw}`;
}
