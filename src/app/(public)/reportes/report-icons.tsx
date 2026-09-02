"use client";
// Mapa nombre → componente lucide (regla del repo: el string viaja por `lib/`,
// el componente vive en el cliente).
import {
  BusFront,
  Droplets,
  HardHat,
  Lightbulb,
  MessageSquareWarning,
  Palette,
  Shield,
  TrafficCone,
  Trash2,
  TreeDeciduous,
  Trophy,
  Users,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReportIconName } from "@/lib/reports/catalog";

// Tipado como `Record<ReportIconName, …>`: si el catálogo suma un ícono y acá
// no se agrega, el build falla en vez de renderizar `undefined`.
// OJO: `REPORT_ICONS` es una referencia de CLIENTE (este módulo es "use client").
// Un Server Component renderiza `<ReportIcon>`, no lee el mapa.
export const REPORT_ICONS: Record<ReportIconName, LucideIcon> = {
  droplets: Droplets,
  waves: Waves,
  zap: Zap,
  "trash-2": Trash2,
  "traffic-cone": TrafficCone,
  "tree-deciduous": TreeDeciduous,
  "bus-front": BusFront,
  "message-square-warning": MessageSquareWarning,
  users: Users,
  palette: Palette,
  trophy: Trophy,
  "hard-hat": HardHat,
  shield: Shield,
  lightbulb: Lightbulb,
};

export function ReportIcon({ name, className }: { name: ReportIconName; className?: string }) {
  const Icon = REPORT_ICONS[name];
  return <Icon aria-hidden className={className} />;
}
