// Identidad visual de cada espacio en el sitio público: ícono + acento.
// El Salón Vidriado lleva el celeste institucional (tokens --primary); los
// demás usan paleta explícita de Tailwind con su variante dark. Contraste
// verificado: los *-800 sobre blanco y los *-300 sobre fondo oscuro dan AA
// para texto chico. Es decoración de tarjetas, no mensajes de estado: los
// tokens --success/--warning quedan para FormMessage.
import { Building2, GraduationCap, Landmark, Utensils, type LucideIcon } from "lucide-react";
import type { RoomKey } from "@/lib/activities/rules";

export const ROOM_META: Record<
  RoomKey,
  { icon: LucideIcon; accentBorder: string; accentText: string }
> = {
  historic: {
    icon: Landmark,
    accentBorder: "border-amber-600 dark:border-amber-400",
    accentText: "text-amber-800 dark:text-amber-300",
  },
  glass: {
    icon: Building2,
    accentBorder: "border-primary",
    accentText: "text-primary",
  },
  kitchen: {
    icon: Utensils,
    accentBorder: "border-rose-600 dark:border-rose-400",
    accentText: "text-rose-800 dark:text-rose-300",
  },
  classroom: {
    icon: GraduationCap,
    accentBorder: "border-emerald-600 dark:border-emerald-400",
    accentText: "text-emerald-800 dark:text-emerald-300",
  },
};
