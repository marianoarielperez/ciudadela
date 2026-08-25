// El ícono de cada tipo de solicitud de socio, para las DOS pantallas que las
// listan: la del socio (`/mi/solicitudes`) y la bandeja de la Comisión
// (`/admin/solicitudes/socios`). Vive acá y no en `@/lib/members/labels` por el
// mismo motivo que el mapa de la navegación del panel vive en
// `admin-nav-list.tsx` y no en `@/lib/admin/nav`: los módulos de `lib` son
// puros y testeables en node, y `labels.ts` en particular lo importan piezas de
// dominio declaradas puras (`applications/summary.ts`, `members/export.ts`,
// `members/minute-form.ts`). Meter ahí un `import` de lucide les arrastra el
// bundle del cliente sin que ninguna lo necesite.
//
// Las ETIQUETAS y la variante del badge sí siguen en `labels.ts`: son strings.
import { ArrowLeftRight, UserMinus } from "lucide-react";

import type { MemberRequestType } from "@/generated/prisma/client";

const ICONS: Record<MemberRequestType, React.ComponentType<{ className?: string }>> = {
  withdrawal: UserMinus,
  category_change: ArrowLeftRight,
};

export function RequestTypeIcon({
  type,
  className,
}: {
  type: MemberRequestType;
  className?: string;
}) {
  const Icon = ICONS[type];
  return <Icon className={className} aria-hidden />;
}
