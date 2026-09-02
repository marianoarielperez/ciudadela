// El pin de marca de los mapas: gota --primary (#0079BC) con halo blanco. Un
// divIcon SVG evita los PNG del default de Leaflet, que llegan con rutas rotas
// por el bundler. Lo comparten /ubicacion, el picker del wizard de Reportes y
// el mapa del admin (que lo tiñe por estado con `pinSvg`). Módulo PURO: no
// importa Leaflet, así que lo puede leer un test en node.
export function pinSvg(fill: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48" aria-hidden="true">' +
    `<path d="M20 2C11.2 2 4 9.2 4 18c0 11.5 13.3 25.6 14.9 27.2a1.6 1.6 0 0 0 2.2 0C22.7 43.6 36 29.5 36 18 36 9.2 28.8 2 20 2Z" fill="${fill}" stroke="#FFFFFF" stroke-width="3"/>` +
    '<circle cx="20" cy="18" r="6" fill="#FFFFFF"/>' +
    "</svg>"
  );
}

export const PIN_SVG = pinSvg("#0079BC");
export const PIN_SIZE: [number, number] = [40, 48];
export const PIN_ANCHOR: [number, number] = [20, 46];
