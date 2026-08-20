// Tarjetas del tablero de /admin. Viven al lado de `nav.ts` y no dentro de la
// página porque el tablero y la lateral tienen que decir lo mismo: hasta ahora
// eran dos arrays paralelos sincronizados a mano y M3-M6 iban a olvidarse de
// uno. `tests/dashboard-cards.test.ts` verifica la correspondencia.
//
// Diferencia deliberada con `ADMIN_NAV`: acá SÍ aparecen las secciones futuras
// (las que no tienen `href` se muestran como "Próximamente"). Este es el lugar
// del roadmap; la lateral solo lista lo que funciona.
import { SITE } from "@/lib/site";

export type DashboardCard = {
  title: string;
  description: string;
  href?: string;
  cta?: string;
  superadminOnly?: boolean;
};

export type DashboardGroup = { label: string; cards: DashboardCard[] };

// Mismo orden de grupos que la lateral (src/lib/admin/nav.ts).
export const DASHBOARD_GROUPS: DashboardGroup[] = [
  {
    label: "Gestión",
    cards: [
      { title: "Solicitudes", description: "Altas de socios pendientes de revisión y aprobación." },
      { title: "Socios", description: "Padrón, fichas y estado de cada socio.", href: "/admin/socios", cta: "Ver el padrón" },
      {
        title: "Actas",
        description: "Actas de Comisión Directiva y Asamblea donde se asientan los movimientos.",
        href: "/admin/actas",
        cta: "Ver las actas",
      },
      { title: "Tesorería", description: "Cuotas, pagos y conciliación con Mercado Pago." },
    ],
  },
  {
    label: "Contenido",
    cards: [
      { title: "Noticias", description: "Novedades y comunicados del sitio público.", href: "/admin/noticias", cta: "Gestionar noticias" },
      {
        title: "Actividades",
        // Los nombres salen de SITE.rooms, que es de donde también sale el selector
        // del formulario y la grilla pública: si alguna vez se renombra un salón, se
        // renombra en un solo lugar y esta tarjeta no queda mintiendo.
        description: `Calendario del ${SITE.rooms.historic} y el ${SITE.rooms.glass}.`,
        href: "/admin/actividades",
        cta: "Ver el calendario",
      },
    ],
  },
  {
    label: "Sistema",
    cards: [
      {
        title: "Configuración",
        description: "Parámetros del sistema.",
        href: "/admin/configuracion",
        cta: "Abrir",
        superadminOnly: true,
      },
    ],
  },
];
