// La convocatoria del proceso: el acto que le abre a cada adherente vigente un
// plazo de treinta días del que cuelga su condición de socio.
//
// `requireSuperadmin` en la RUTA y otra vez en la action. Acá no alcanza con
// esconder el link del tablero: una server action se despacha por el id del
// encabezado `Next-Action`, así que el POST no pasa por esta página.
//
// La pantalla avisa DOS cosas antes de dejar convocar, y las dos cambian lo que
// el operador tiene que hacer después:
//   1. a cuánta gente alcanza (la cohorte real, contada en vivo);
//   2. cuántas solicitudes de alta quedan en trámite — ASOCIATE se suspende al
//      convocar, y esas solicitudes no se rechazan solas (docs/05 §2).
import Link from "next/link";

import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { LIVE_APPLICATION_STATUSES } from "@/lib/applications/service";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import {
  COHORT_CATEGORY, COHORT_STATUSES, FIRST_INSTANCE_DAYS, firstEndsAt,
} from "@/lib/reregistration/rules";
import { LIVE_PROCESS_STATUSES } from "@/lib/reregistration/service";
import { civilDayOf } from "@/lib/treasury/periods";
import { CallForm } from "./call-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Convocar el reempadronamiento — SIGeV" };

const NUM = "font-mono tabular-nums";

/** Hoy según el calendario ARGENTINO, no el reloj UTC del server: a las 21:00 de
 *  acá `new Date().toISOString()` ya está en el día siguiente y el formulario
 *  abriría con la fecha de mañana. Mismo helper que /admin/padron-electoral. */
function isoToday(): string {
  return civilDayOf().toISOString().slice(0, 10);
}

export default async function ConvocarPage() {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    return (
      <div className="max-w-2xl space-y-4">
        <PageHeader
          title="Convocar el proceso"
          breadcrumb={[{ label: "Reempadronamiento", href: "/admin/reempadronamiento" }, { label: "Convocatoria" }]}
        />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const [live, book, cohortSize, openApplications, minuteRows] = await Promise.all([
    prisma.reregistrationProcess.findFirst({
      where: { status: { in: [...LIVE_PROCESS_STATUSES] } },
      select: { id: true },
    }),
    prisma.book.findFirst({ where: { status: "open" }, select: { number: true } }),
    // La cohorte se cuenta con LAS MISMAS constantes con las que `activate` la
    // congela: si esta pantalla dijera "124" y la convocatoria alcanzara a otros,
    // el número que el superadmin leyó antes de apretar sería mentira.
    prisma.member.count({
      where: { category: COHORT_CATEGORY, status: { in: [...COHORT_STATUSES] } },
    }),
    prisma.application.count({ where: { status: { in: LIVE_APPLICATION_STATUSES } } }),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
  ]);

  const minutes = minuteRows.map((m) => ({
    id: m.id,
    label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  const today = isoToday();

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="Convocar el proceso"
        breadcrumb={[{ label: "Reempadronamiento", href: "/admin/reempadronamiento" }, { label: "Convocatoria" }]}
      />

      {live ? (
        <>
          <FormMessage kind="error" box>
            Ya hay un proceso de re-empadronamiento en curso. Hay uno solo por vez.
          </FormMessage>
          <Button asChild variant="outline">
            <Link href="/admin/reempadronamiento">Ver el proceso en curso</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Convoca a los <span className={NUM}>{cohortSize}</span> socios adherentes vigentes del
            Libro N° <span className={NUM}>{book?.number ?? "—"}</span> a ratificar su condición.
            Se les abre un plazo de <span className={NUM}>{FIRST_INSTANCE_DAYS}</span> días corridos
            —hasta el <span className={NUM}>{formatDateAR(firstEndsAt(civilDayOf()))}</span> si se
            convoca hoy— y se les avisa por correo; los que no tienen casilla van al cartel de la sede.
          </p>

          {openApplications > 0 && (
            <FormMessage kind="warning" box>
              Hay <span className={NUM}>{openApplications}</span>{" "}
              {openApplications === 1 ? "solicitud de alta en curso" : "solicitudes de alta en curso"}.
              ASOCIATE queda suspendido al convocar; {openApplications === 1 ? "rechazala" : "rechazalas"}{" "}
              a mano desde{" "}
              <Link className="underline" href="/admin/solicitudes">Solicitudes</Link>.
            </FormMessage>
          )}

          <CallForm minutes={minutes} today={today} />
        </>
      )}
    </div>
  );
}
