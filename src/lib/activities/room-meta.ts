// Identidad visual de cada espacio en el sitio público: ícono + juego de
// colores de la tarjeta (reborde completo + fondo tintado + textos).
//
// Los ÍCONOS los comparte /ubicacion (ubicacion/page.tsx importa ROOM_META
// para "La sede por dentro"): cambiarlos impacta ahí. Los COLORES solo los
// consumen ActivityCard y la leyenda de /actividades: son libres.
//
// Light-only: el sitio público solo renderiza en claro (el ThemeProvider vive
// en el panel; decisión escrita en turnstile-widget.tsx), así que estos
// campos no llevan variantes dark:.
//
// El Salón Vidriado lleva el celeste institucional (--primary); los demás,
// paleta explícita de Tailwind v4 (oklch: los hex de v3 no aplican). Es
// decoración de tarjetas, no mensajes de estado: los tokens
// --success/--warning quedan para FormMessage.
//
// Contraste: los textos son de 12px y piden 4.5:1 sobre el fondo REAL
// compuesto (tinte al 60% sobre --card, todo sobre blanco). MEDIDO en el
// navegador el 28/08/2026 pintando los colores computados en un canvas de
// 1px y leyendo el píxel — Chrome computa estos colores como lab()/oklab(),
// así que un parser de "rgb(...)" a mano lee basura sin avisar; ojo si se
// re-mide:
//
//   espacio           timeText  roomText
//   Salón Histórico   8.88:1    6.95:1
//   Salón Vidriado    9.10:1    4.52:1
//   Cocina            9.10:1    7.50:1
//   Aulas             9.35:1    7.39:1
//
// El nombre de la actividad (text-foreground) compone a ~19:1 en las cuatro.
// El 4.52:1 del Vidriado es el celeste institucional --primary sobre el
// tinte sky-50/60: pasa AA con el mismo margen fino que el 4.55 que el
// diseño anterior aceptó documentado. Si el fondo de la tarjeta deja de ser
// blanco puro (o el tinte sube del 60%), re-medir ESTE par primero; el
// fallback pre-acordado es text-sky-800.
import { Building2, GraduationCap, Landmark, Utensils, type LucideIcon } from "lucide-react";
import type { RoomKey } from "@/lib/activities/rules";

export const ROOM_META: Record<
  RoomKey,
  { icon: LucideIcon; cardBorder: string; cardBg: string; timeText: string; roomText: string }
> = {
  historic: {
    icon: Landmark,
    cardBorder: "border-amber-600/40",
    cardBg: "bg-amber-50/60",
    timeText: "text-amber-900",
    roomText: "text-amber-800",
  },
  glass: {
    icon: Building2,
    cardBorder: "border-primary/40",
    cardBg: "bg-sky-50/60",
    timeText: "text-sky-900",
    roomText: "text-primary",
  },
  kitchen: {
    icon: Utensils,
    cardBorder: "border-rose-600/40",
    cardBg: "bg-rose-50/60",
    timeText: "text-rose-900",
    roomText: "text-rose-800",
  },
  classroom: {
    icon: GraduationCap,
    cardBorder: "border-emerald-600/40",
    cardBg: "bg-emerald-50/60",
    timeText: "text-emerald-900",
    roomText: "text-emerald-800",
  },
};
