// Pestañas de /admin/configuracion. Client-side (`?tab=`, calco de MemberTabs)
// y NO subrutas: los cuatro redirects de actions.ts apuntan a la raíz y tres
// tests los asertan textualmente — una sola URL conserva actions, tests y la
// guarda de superadmin en un solo lugar. El mapa ícono→componente vive en el
// componente cliente (config-tabs.tsx), como socios-tabs: lib/ es puro y
// testeable en node sin arrastrar lucide.
export type ConfigTabId = "sitio" | "asociate" | "avisos" | "tesoreria" | "feriados";

export type ConfigTab = {
  value: ConfigTabId;
  label: string;
  icon: "globe" | "user-plus" | "mail" | "wallet" | "calendar-off";
};

// "Tesorería" no es negociable: NO_FEE_VALUE_MESSAGE ("registralo en
// Configuración → Tesorería") vive en src/lib/treasury y no se toca.
export const CONFIG_TABS: ConfigTab[] = [
  { value: "sitio", label: "Sitio público", icon: "globe" },
  { value: "asociate", label: "ASOCIATE", icon: "user-plus" },
  { value: "avisos", label: "Avisos", icon: "mail" },
  { value: "tesoreria", label: "Tesorería", icon: "wallet" },
  { value: "feriados", label: "Feriados", icon: "calendar-off" },
];

// En qué pestaña ATERRIZA cada redirect de las actions. `?cuota=1` es el éxito
// del valor de cuota y `?feriado=1|2` los del ABM de feriados; `?guardado=1`
// es del form de 8 claves, cuyo mensaje es global, así que abre en la primera.
// Acepta el union crudo de searchParams (string | string[] | undefined): un
// param repetido no matchea "1" y cae en la inicial, que es lo inofensivo.
export function initialConfigTab(sp: {
  cuota?: string | string[];
  feriado?: string | string[];
}): ConfigTabId {
  if (sp.cuota === "1") return "tesoreria";
  if (sp.feriado === "1" || sp.feriado === "2") return "feriados";
  return "sitio";
}
