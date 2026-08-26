// Identidad visual de cada espacio en el sitio público: ícono + acento.
// El Salón Vidriado lleva el celeste institucional (token --primary en claro,
// sky-400 en oscuro); los demás usan paleta explícita de Tailwind con su
// variante dark. Contraste MEDIDO en el navegador sobre el fondo REAL de la
// tarjeta —`bg-muted/40` compuesto sobre `--background`, que da #FBFBFB en
// claro y #151515 en oscuro, no el fondo pelado— con el texto de 12px de
// `ActivityCard`, que pide 4.5:1:
//
//   espacio           claro              oscuro
//   Salón Histórico   #973C00  6.85:1    #FFD230  12.62:1
//   Salón Vidriado    #0079BC  4.55:1    #00BCFF   8.38:1
//   Cocina            #A50036  7.65:1    #FFA1AD   9.52:1
//   Aulas             #006045  7.36:1    #5EE9B5  12.00:1
//
// --primary NO alcanza en oscuro: es el mismo #0079BC en :root y en .dark, y
// contra #151515 computa 3.87:1. Por eso el Salón Vidriado necesita su `dark:`
// explícito como los otros tres.
// Es decoración de tarjetas, no mensajes de estado: los tokens
// --success/--warning quedan para FormMessage.
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
    // sky-400 y no sky-300: de la escala de Tailwind es el que queda más cerca
    // del celeste de marca #2E9BDF, y sobre la tarjeta en oscuro sobra para AA.
    // Ojo si se busca el hex: en Tailwind v4 la paleta es oklch, así que
    // `sky-400` NO es el #38BDF8 de la v3 — el navegador lo resuelve a #00BCFF,
    // que es el valor con el que están medidos los 8.38:1 de arriba.
    // El borde acompaña al texto: si sólo cambiara el texto, la misma tarjeta
    // tendría el acento en dos celestes distintos.
    accentBorder: "border-primary dark:border-sky-400",
    accentText: "text-primary dark:text-sky-400",
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
