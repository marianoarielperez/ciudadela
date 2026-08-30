// Mapa nombre→componente de los íconos de navegación del panel. Vive en un
// módulo propio (sin "use client") para que lo compartan la lateral (client)
// y el tablero de /admin (server component); `nav.ts` sigue serializable y
// testeable en node sin arrastrar lucide.
import {
  Activity,
  CalendarDays,
  ClipboardCheck,
  Home,
  Inbox,
  Library,
  Newspaper,
  ScrollText,
  Settings,
  UserCog,
  Users,
  Vote,
  Wallet,
} from "lucide-react";

import type { AdminNavIcon } from "@/lib/admin/nav";

export const NAV_ICONS: Record<AdminNavIcon, typeof Home> = {
  home: Home,
  inbox: Inbox,
  "clipboard-check": ClipboardCheck,
  users: Users,
  wallet: Wallet,
  "scroll-text": ScrollText,
  newspaper: Newspaper,
  "calendar-days": CalendarDays,
  library: Library,
  activity: Activity,
  vote: Vote,
  "user-cog": UserCog,
  settings: Settings,
};
