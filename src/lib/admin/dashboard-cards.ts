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

// "Salón Histórico, Salón Vidriado, Cocina y Aulas". Sin Intl.ListFormat, por el
// mismo motivo que la página pública de actividades: no depender de qué ICU trae
// el runtime del VPS.
const ROOM_NAMES = Object.values(SITE.rooms);
const ROOM_LIST = `${ROOM_NAMES.slice(0, -1).join(", ")} y ${ROOM_NAMES.at(-1)}`;

// Mismo orden de grupos que la lateral (src/lib/admin/nav.ts).
export const DASHBOARD_GROUPS: DashboardGroup[] = [
  {
    label: "Gestión",
    cards: [
      {
        title: "Solicitudes",
        description: "Altas de socios pendientes de revisión y aprobación.",
        href: "/admin/solicitudes",
        cta: "Ver la bandeja",
      },
      { title: "Socios", description: "Padrón, fichas y estado de cada socio.", href: "/admin/socios", cta: "Ver el padrón" },
      {
        title: "Tesorería",
        description: "Cuotas, deudores, efectivo y recibos.",
        href: "/admin/tesoreria",
        cta: "Abrir tesorería",
      },
      {
        title: "Actas",
        description: "Actas de Comisión Directiva y Asamblea donde se asientan los movimientos.",
        href: "/admin/actas",
        cta: "Ver las actas",
      },
    ],
  },
  {
    label: "Contenido",
    cards: [
      { title: "Noticias", description: "Novedades y comunicados del sitio público.", href: "/admin/noticias", cta: "Gestionar noticias" },
      {
        title: "Actividades",
        // Los nombres salen de SITE.rooms, que es de donde también sale el selector
        // del formulario y la grilla pública: si alguna vez se renombra o se suma un
        // espacio, se hace en un solo lugar y esta tarjeta no queda mintiendo. Por eso
        // la lista se DERIVA y no se escribe: antes nombraba a los dos salones y quedó
        // desactualizada el día que aparecieron la cocina y las aulas.
        description: `Calendario semanal de la sede: ${ROOM_LIST}.`,
        href: "/admin/actividades",
        cta: "Ver el calendario",
      },
    ],
  },
  {
    label: "Sistema",
    cards: [
      {
        // `title` idéntico al `label` de la nav: lo verifica dashboard-cards.test.ts.
        title: "Salud",
        description: "Tareas automáticas, backup, Mercado Pago y avisos que no salieron.",
        href: "/admin/salud",
        cta: "Ver el estado",
        superadminOnly: true,
      },
      {
        title: "Padrón electoral",
        description: "Padrón para la Junta Electoral a una fecha dada, con los morosos que pueden purgar su deuda.",
        href: "/admin/padron-electoral",
        cta: "Generar",
        superadminOnly: true,
      },
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
