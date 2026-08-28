// Pestañas de /admin/salud y el mapeo alerta→pestaña. Client-side (`?tab=`,
// mismo criterio que config-tabs.ts): una sola URL = una sola guarda de
// superadmin y los dos revalidatePath de las actions de reenvío intactos.
// El mapa ícono→componente vive en el componente cliente (salud-tabs.tsx);
// lib/ es puro y testeable en node sin arrastrar lucide.
//
// health-alerts.ts NO se toca: sigue emitiendo `#ancla` y rutas absolutas.
// La traducción a `?tab=X#ancla` es de PRESENTACIÓN y vive acá, en un solo
// lugar, para que el veredicto, el badge de solapa y el test de anclas no
// puedan divergir (la lección de coverageFloor).
export type SaludTabId = "tareas" | "infraestructura" | "dinero" | "correo";

export type SaludTab = {
  value: SaludTabId;
  label: string;
  icon: "clock" | "server" | "banknote" | "mail";
};

export const SALUD_TABS: SaludTab[] = [
  { value: "tareas", label: "Tareas", icon: "clock" },
  { value: "infraestructura", label: "Infraestructura", icon: "server" },
  { value: "dinero", label: "Dinero", icon: "banknote" },
  { value: "correo", label: "Correo", icon: "mail" },
];

// Las seis anclas que los paneles publican como `id`. `#dinero` existe aunque
// hoy ninguna alerta lo emita (las de dinero van directo a Tesorería).
const ANCHOR_TAB: Record<string, SaludTabId | undefined> = {
  tareas: "tareas",
  backup: "infraestructura",
  "mercado-pago": "infraestructura",
  dinero: "dinero",
  avisos: "correo",
  recibos: "correo",
};

/** A qué pestaña pertenece el destino de una alerta. Las rutas de Tesorería
 *  son asuntos de plata: cuentan para Dinero aunque naveguen a otra pantalla.
 *  `null` = destino ajeno a la pantalla, se deja tal cual. */
export function tabForAlertHref(href: string): SaludTabId | null {
  if (href.startsWith("#")) return ANCHOR_TAB[href.slice(1)] ?? null;
  if (href.startsWith("/admin/tesoreria")) return "dinero";
  return null;
}

/** El href que renderiza el veredicto: un ancla se traduce a `?tab=X#ancla`
 *  (activa la pestaña y scrollea al panel); todo lo demás queda como vino. */
export function alertHrefFor(href: string): string {
  if (!href.startsWith("#")) return href;
  const tab = tabForAlertHref(href);
  return tab ? `?tab=${tab}${href}` : href;
}

/** Cuántas condiciones ACT caen en cada pestaña. Es la ÚNICA fuente del punto
 *  rojo de solapa: review e historia no cuentan jamás (la lección de las 51
 *  firmas: un numerito que suma lo que no requiere acción enseña a ignorar el
 *  tablero). */
export function actCountByTab(
  act: ReadonlyArray<{ href: string }>,
): Partial<Record<SaludTabId, number>> {
  const counts: Partial<Record<SaludTabId, number>> = {};
  for (const alert of act) {
    const tab = tabForAlertHref(alert.href);
    if (tab) counts[tab] = (counts[tab] ?? 0) + 1;
  }
  return counts;
}
