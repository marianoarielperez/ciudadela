// La carga PRESENCIAL: buscar al cohortado que se acercó a la sede y cargarle
// la presentación.
//
// Una sola pantalla con dos momentos, gobernados por la URL: sin `?socio=` es
// el buscador, con `?socio=` es el formulario. Van juntos —y no en dos rutas—
// porque son un solo acto de mostrador con la persona esperando, y el
// resultado de la búsqueda tiene que poder verse mientras se decide.
//
// El buscador NO es `searchMembers` de tesorería (que no se toca): busca sólo
// dentro de la COHORTE de este proceso. Ofrecerle al operador cargarle una
// presentación a alguien que nadie convocó sería fabricar una fila que después
// no tiene dónde ir.
//
// `requireAdmin()` propio y no heredado del layout: acá se listan nombres y
// DNIs de socios (Ley 25.326, docs/08).
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PRESENTATIONS_BASE } from "@/lib/admin/presentation-queue";
import { presentationStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { PRESENTATION_STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { EDITABLE_STATUSES, presentations } from "@/lib/reregistration/presentation";
import { REREGISTRATION_NEIGHBOURHOOD } from "@/lib/reregistration/presentation-rules";
import { wizardOpen } from "@/lib/reregistration/rules";
import { LIVE_PROCESS_STATUSES } from "@/lib/reregistration/service";
import { cn } from "@/lib/utils";
import { InPersonForm, type InPersonDraft } from "./in-person-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Carga presencial — SIGeV" };

const BASE = "/admin/reempadronamiento/presencial";
const NUM = "font-mono tabular-nums";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** El `<input type="date">` quiere `AAAA-MM-DD` y las fechas civiles se guardan
 *  al mediodía UTC, así que las partes UTC son las del día civil argentino: a
 *  las 12:00 UTC no hay cruce de día posible en UTC-3. Usar `toISOString` sobre
 *  una fecha guardada de otra forma sí lo tendría, pero todas las fechas
 *  civiles del proyecto entran por `civilDateUtc`. */
function dateInputValue(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export default async function PresencialPage(props: { searchParams: Promise<SearchParams> }) {
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Carga presencial" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const process = await prisma.reregistrationProcess.findFirst({
    where: { status: { in: [...LIVE_PROCESS_STATUSES] } },
    orderBy: { id: "desc" },
    select: { id: true, bookId: true, status: true, book: { select: { number: true } } },
  });

  const header = (
    <PageHeader
      title="Carga presencial"
      breadcrumb={[
        { label: "Reempadronamiento", href: "/admin/reempadronamiento" },
        { label: "Presencial" },
      ]}
    >
      <p className="text-sm text-muted-foreground">
        Para el vecino que se acerca a la sede (Art. 9° bis a: &laquo;en forma presencial o
        electrónica&raquo;). La presentación queda en la{" "}
        <Link className={INLINE_LINK} href={PRESENTATIONS_BASE}>misma cola</Link> y la valida otra
        persona.
      </p>
    </PageHeader>
  );

  if (!process) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          size="list"
          description="No hay ningún proceso de re-empadronamiento en curso, así que no hay presentaciones que cargar."
          action={
            <Button asChild className="min-h-11 px-4">
              <Link href="/admin/reempadronamiento">Ir a Reempadronamiento</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // El plazo lo decide `wizardOpen`, la MISMA función que abre y cierra el
  // wizard público: el mostrador no puede recibir una presentación un día
  // después de que la web dejó de recibirlas — el plazo del Art. 9° bis es uno
  // solo y no depende del canal.
  if (!wizardOpen(process)) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          size="list"
          description="El proceso ya no está en ninguna de sus dos instancias, así que no se pueden recibir presentaciones nuevas — ni por la web ni por el mostrador."
          action={
            <Button asChild variant="outline" className="min-h-11 px-4">
              <Link href={PRESENTATIONS_BASE}>Ver la cola</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const sp = await props.searchParams;
  const memberId = Number(one(sp.socio));
  if (Number.isInteger(memberId) && memberId > 0) {
    return (
      <div className="space-y-6">
        {header}
        <MemberForm process={process} memberId={memberId} />
      </div>
    );
  }

  // El resultado del último registro, que vuelve por la URL: la action redirige
  // acá en vez de contestarle al formulario, porque el formulario ya no existe
  // cuando la presentación pasa a `submitted` (ver el comentario largo al final
  // de `registerInPersonAction`).
  const registered = Number(one(sp.registrada));
  const mailFailed = one(sp.correo) === "falla";

  const q = (one(sp.q) ?? "").trim();
  const hits = q === "" ? [] : await presentations.searchCohort({ processId: process.id, bookId: process.bookId, q });

  return (
    <div className="space-y-6">
      {header}
      {Number.isInteger(registered) && registered > 0 && (
        <>
          <FormMessage kind="success" box role="status">
            Se registró la presentación. Queda en la cola para que otra persona la valide:{" "}
            <Link className={INLINE_LINK} href={`${PRESENTATIONS_BASE}/${registered}`}>
              verla en la cola
            </Link>
            . Podés seguir con el próximo vecino.
          </FormMessage>
          {mailFailed && (
            <FormMessage kind="warning" box role="status">
              No salió el correo de constancia. Revisá que la dirección esté bien escrita: es el
              domicilio electrónico por el que se le va a notificar cualquier observación.
            </FormMessage>
          )}
        </>
      )}
      {/* GET y no una server action: la búsqueda es una lectura, y con la
          consulta en la URL el operador puede volver atrás desde el formulario
          sin retipearla. */}
      <form method="get" action={BASE} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="q">Buscar al socio convocado</Label>
          <Input
            id="q"
            name="q"
            defaultValue={q}
            autoFocus
            autoComplete="off"
            placeholder="Apellido, DNI o número de socio"
            className="min-h-11"
          />
        </div>
        <Button type="submit" size="lg" className="min-h-11 px-4">Buscar</Button>
      </form>

      {q === "" ? (
        <EmptyState
          size="list"
          description={`Buscá por apellido, DNI o número de socio dentro de los convocados del Libro N° ${process.book.number}. Sólo aparecen los que fueron convocados a este proceso.`}
        />
      ) : hits.length === 0 ? (
        <EmptyState
          size="list"
          description="Ningún convocado de este proceso coincide con esa búsqueda. Si el vecino no está en la lista, no fue convocado: revisá su ficha antes de mandarlo de vuelta."
        />
      ) : (
        <ul className="list-none space-y-2 p-0">
          {hits.map((hit) => {
            const loadable = (EDITABLE_STATUSES as readonly string[]).includes(hit.status);
            return (
              <li key={hit.presentationId}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-4 text-sm">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-muted-foreground">
                        N° <span className={NUM}>{hit.memberNumber ?? "—"}</span>
                      </span>
                      <span className="font-medium">{hit.fullName}</span>
                      <span className={cn(NUM, "text-muted-foreground")}>DNI {hit.dni ?? "—"}</span>
                      <Badge variant={presentationStatusBadgeVariant(hit.status)}>
                        {PRESENTATION_STATUS_LABELS[hit.status]}
                      </Badge>
                    </span>
                    {/* Lo que ya está en la cola NO se vuelve a cargar desde el
                        mostrador: se lo manda al detalle, que es donde se
                        resuelve. Decirlo acá le ahorra al operador tipear media
                        ficha para que el registro la rechace. */}
                    {loadable ? (
                      <Button asChild className="min-h-11 px-4">
                        <Link href={`${BASE}?socio=${hit.memberId}`}>Cargar presentación</Link>
                      </Button>
                    ) : (
                      <Button asChild variant="outline" className="min-h-11 px-4">
                        <Link href={`${PRESENTATIONS_BASE}/${hit.presentationId}`}>Ver presentación</Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

async function MemberForm({ process, memberId }: {
  process: { id: number; bookId: number };
  memberId: number;
}) {
  const presentation = await prisma.presentation.findUnique({
    where: { processId_memberId: { processId: process.id, memberId } },
    select: {
      id: true, status: true,
      birthDate: true, civilStatus: true, nationality: true, occupation: true,
      streetId: true, streetText: true, streetNumber: true, neighborhood: true,
      phone: true, email: true,
      member: {
        select: {
          id: true, fullName: true, dni: true,
          birthDate: true, civilStatus: true, nationality: true, occupation: true,
          streetId: true, streetText: true, streetNumber: true, neighborhood: true,
          phone: true, email: true,
          memberships: { where: { bookId: process.bookId }, select: { memberNumber: true } },
        },
      },
    },
  });

  if (!presentation) {
    return (
      <EmptyState
        size="list"
        description="Ese socio no fue convocado a este proceso, así que no tiene presentación que cargar."
        action={
          <Button asChild variant="outline" className="min-h-11 px-4">
            <Link href={BASE}>Volver al buscador</Link>
          </Button>
        }
      />
    );
  }

  if (!(EDITABLE_STATUSES as readonly string[]).includes(presentation.status)) {
    return (
      <EmptyState
        size="list"
        description={`La presentación de ${presentation.member.fullName} ya está ${PRESENTATION_STATUS_LABELS[presentation.status].toLocaleLowerCase("es-AR")}: no se vuelve a cargar desde el mostrador.`}
        action={
          <Button asChild className="min-h-11 px-4">
            <Link href={`${PRESENTATIONS_BASE}/${presentation.id}`}>Ver la presentación</Link>
          </Button>
        }
      />
    );
  }

  const [streets, documents] = await Promise.all([
    prisma.street.findMany({ orderBy: { loadOrder: "asc" }, select: { id: true, name: true, loadOrder: true } }),
    prisma.document.findMany({
      where: { ownerType: "presentation", ownerId: presentation.id },
      select: { type: true },
    }),
  ]);

  // Lo ya cargado en la presentación manda sobre la ficha: si el vecino vuelve
  // porque la Comisión le observó algo, lo que hay que ver en pantalla es lo
  // que él declaró, no lo que la ficha decía antes.
  const m = presentation.member;
  const pick = <T,>(declared: T | null, card: T | null): T | null => declared ?? card;
  const draft: InPersonDraft = {
    birthDate: dateInputValue(pick(presentation.birthDate, m.birthDate)),
    civilStatus: pick(presentation.civilStatus, m.civilStatus) ?? "",
    nationality: pick(presentation.nationality, m.nationality) ?? "",
    occupation: pick(presentation.occupation, m.occupation) ?? "",
    streetNumber: pick(presentation.streetNumber, m.streetNumber) ?? "",
    // El único campo con valor propuesto: la cohorte es toda adherente y vive
    // en el barrio (Art. 5 inc. 3), así que en el mostrador el operador no
    // debería tener que tipear "Ciudadela" 160 veces. Sigue EDITABLE, a
    // diferencia del wizard público: acá está la persona enfrente y una
    // excepción que la Comisión decida aceptar tiene que poder cargarse.
    neighborhood: pick(presentation.neighborhood, m.neighborhood) ?? REREGISTRATION_NEIGHBOURHOOD,
    phone: pick(presentation.phone, m.phone) ?? "",
    email: pick(presentation.email, m.email) ?? "",
  };
  const streetId = pick(presentation.streetId, m.streetId);
  const streetText = presentation.streetId ? null : pick(presentation.streetText, m.streetText);

  const uploaded = {
    dni_front: documents.filter((d) => d.type === "dni_front").length,
    dni_back: documents.filter((d) => d.type === "dni_back").length,
    annex: documents.filter((d) => d.type === "annex").length,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-4 text-sm">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">
              N° <span className={NUM}>{m.memberships[0]?.memberNumber ?? "—"}</span>
            </span>
            <span className="font-medium">{m.fullName}</span>
            <span className={cn(NUM, "text-muted-foreground")}>DNI {m.dni ?? "—"}</span>
            <Badge variant={presentationStatusBadgeVariant(presentation.status)}>
              {PRESENTATION_STATUS_LABELS[presentation.status]}
            </Badge>
          </span>
          <Button asChild variant="outline" className="min-h-11 px-4">
            <Link href={BASE}>Buscar otro</Link>
          </Button>
        </CardContent>
      </Card>

      <InPersonForm
        processId={process.id}
        memberId={m.id}
        presentationId={presentation.id}
        memberName={m.fullName}
        draft={draft}
        streets={streets}
        defaultStreetId={streetId}
        defaultStreetText={streetText}
        uploaded={uploaded}
      />
    </div>
  );
}
