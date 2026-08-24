// La credencial de socio: la pieza firma del panel (spec M5 §3.3). Franja de la
// foto aérea del barrio con overlay al estilo del hero público, y encima los
// datos que el socio no veía en ningún lado: su número del libro abierto, su
// categoría, su antigüedad y si está habilitado para votar (REG-31).
import Image from "next/image";
import { Vote } from "lucide-react";

import heroImg from "../../../assets/hero.jpg";
import { Badge } from "@/components/ui/badge";
import type { MemberCategory } from "@/generated/prisma/client";
import { formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { electoralSentence, type ElectoralStatus } from "@/lib/mi/identity";
import { cn } from "@/lib/utils";

export function MemberCard(props: {
  fullName: string;
  memberNumber: number | null;
  category: MemberCategory;
  joinedAt: Date;
  electoral: ElectoralStatus;
}) {
  return (
    <section
      aria-label="Credencial de socio"
      className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10"
    >
      <div className="relative h-24">
        <Image
          src={heroImg}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="672px"
          className="object-cover"
        />
        {/* Overlay negro como el hero público (contraste calibrado allá): el
            eyebrow blanco apoya sobre la parte más oscura. */}
        <div className="absolute inset-0 flex items-end bg-[linear-gradient(to_top,rgb(0_0_0/0.72)_0%,rgb(0_0_0/0.35)_55%,rgb(0_0_0/0.05)_100%)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white">
            Vecinal Ciudadela · Credencial de socio
          </p>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-3xl font-bold tabular-nums text-primary">
            {props.memberNumber !== null ? `N° ${props.memberNumber}` : "N° —"}
          </p>
          <Badge variant="secondary">{CATEGORY_LABELS[props.category]}</Badge>
        </div>
        <div>
          <p className="text-lg font-semibold leading-tight">{props.fullName}</p>
          <p className="text-sm text-muted-foreground">
            {/* REG-29: la antigüedad nunca se reinicia — joinedAt es el original. */}
            Socio desde el {formatDateAR(props.joinedAt)}
          </p>
        </div>
        <p className="flex items-start gap-2 text-sm">
          <Vote
            aria-hidden
            className={cn(
              "mt-0.5 size-4 shrink-0",
              props.electoral.eligible ? "text-success" : "text-muted-foreground",
            )}
          />
          <span>{electoralSentence(props.electoral)}</span>
        </p>
      </div>
    </section>
  );
}
