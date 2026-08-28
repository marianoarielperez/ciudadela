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
// compuesto (tinte al 60% sobre --card / --background). La tabla de valores
// MEDIDOS en el navegador se asienta acá en la verificación visual de esta
// misma rama (plan 2026-08-28-actividades-visual, Task 5); si algún par no
// llega a 4.5:1, se oscurece el texto (p. ej. text-primary → text-sky-800)
// antes de cerrar.
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
