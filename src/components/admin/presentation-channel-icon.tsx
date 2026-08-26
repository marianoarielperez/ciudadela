// Por dónde llegó una presentación de re-empadronamiento: la web o el
// mostrador. Vive acá y no en `@/lib/members/labels` por el mismo motivo que
// `RequestTypeIcon`: los módulos de `lib` son puros y testeables en node, y
// meterles un `import` de lucide les arrastra el bundle del cliente.
//
// El ícono es DECORATIVO (`aria-hidden`) y va siempre acompañado del texto en
// un `sr-only`: un lector de pantalla tiene que poder decir "En el mostrador",
// no "imagen".
import { Building2, Globe } from "lucide-react";

import type { PresentationChannel } from "@/generated/prisma/client";
import { PRESENTATION_CHANNEL_LABELS } from "@/lib/members/labels";

const ICONS: Record<PresentationChannel, React.ComponentType<{ className?: string }>> = {
  web: Globe,
  in_person: Building2,
};

export function PresentationChannelIcon({
  channel,
  className,
}: {
  channel: PresentationChannel;
  className?: string;
}) {
  const Icon = ICONS[channel];
  return (
    <>
      <Icon className={className} aria-hidden />
      <span className="sr-only">{PRESENTATION_CHANNEL_LABELS[channel]}</span>
    </>
  );
}
