// El detalle de UNA presentación: lo que el vecino declaró, lo que la ficha
// dice hoy, sus documentos y la decisión.
//
// La pantalla está armada alrededor de una sola pregunta —"¿esto que declaró es
// él, y está bien?"— y por eso las dos columnas van lado a lado: DECLARADO a la
// izquierda, FICHA ACTUAL a la derecha, con lo que difiere resaltado. El
// operador tiene que poder ver de un vistazo qué cambia si valida, sin abrir
// otra pestaña con la ficha.
//
// Lo que difiere se marca con `font-semibold` Y con una palabra ("cambia") en
// un `sr-only`: el color y el peso no llegan a un lector de pantalla, y la
// diferencia es justamente la información de esta pantalla.
//
// `requireAdmin()` propio y no heredado del layout: acá se muestran nombre,
// fecha de nacimiento, domicilio, teléfono y email de un socio, más las fotos
// de su DNI (Ley 25.326, docs/08). El layout mira el token; `requireAdmin`
// resuelve contra la fila viva de `User`.
import { notFound } from "next/navigation";

import { streetLabel } from "@/app/(public)/asociate/wizard-shared";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PresentationChannelIcon } from "@/components/admin/presentation-channel-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRESENTATIONS_BASE } from "@/lib/admin/presentation-queue";
import { presentationStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateAR, formatDateTimeAR } from "@/lib/format";
import {
  CATEGORY_LABELS, PRESENTATION_STATUS_LABELS, STATUS_LABELS,
} from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { ObserveForm, RejectForm, UnrejectForm, ValidateForm } from "./decision-forms";
import { PresentationDocumentViewer } from "./document-viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Presentación — SIGeV" };

const NUM = "font-mono tabular-nums";
const EMPTY = "—";

export default async function PresentacionPage(props: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Presentación" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const { id } = await props.params;
  const presentationId = Number(id);
  if (!Number.isInteger(presentationId) || presentationId <= 0) notFound();

  const presentation = await prisma.presentation.findUnique({
    where: { id: presentationId },
    select: {
      id: true, status: true, channel: true, submittedAt: true, observation: true,
      validatedAt: true, createdAt: true,
      birthDate: true, civilStatus: true, nationality: true, occupation: true,
      streetNumber: true, neighborhood: true, phone: true, email: true, streetText: true,
      street: { select: { name: true } },
      validatedBy: { select: { name: true } },
      process: {
        select: {
          id: true, status: true, bookId: true, firstEndsAt: true, secondEndsAt: true,
          book: { select: { number: true } },
        },
      },
      member: {
        select: {
          id: true, fullName: true, dni: true, category: true, status: true,
          birthDate: true, civilStatus: true, nationality: true, occupation: true,
          streetNumber: true, neighborhood: true, phone: true, email: true, streetText: true,
          street: { select: { name: true } },
        },
      },
    },
  });
  if (!presentation) notFound();

  const documents = await prisma.document.findMany({
    where: { ownerType: "presentation", ownerId: presentation.id },
    select: { id: true, type: true, mime: true, size: true },
    orderBy: { id: "asc" },
  });

  const membership = await prisma.membership.findFirst({
    where: { memberId: presentation.member.id, bookId: presentation.process.bookId },
    select: { memberNumber: true },
  });

  const rows = compareRows(presentation, presentation.member);
  const decidable = presentation.status === "submitted" || presentation.status === "observed";
  const processClosed = presentation.process.status === "closed";

  return (
    <div className="space-y-6">
      <PageHeader
        // La ENTIDAD va en el <h1> (convención del panel: el nombre del socio,
        // no el nombre de la pantalla) y la miga lleva el sustantivo corto.
        title={presentation.member.fullName}
        breadcrumb={[
          { label: "Reempadronamiento", href: "/admin/reempadronamiento" },
          { label: "Presentaciones", href: PRESENTATIONS_BASE },
          { label: "Presentación" },
        ]}
        actions={
          <Badge variant={presentationStatusBadgeVariant(presentation.status)}>
            {PRESENTATION_STATUS_LABELS[presentation.status]}
          </Badge>
        }
      >
        <p className="text-sm text-muted-foreground">
          Socio N° <span className={NUM}>{membership?.memberNumber ?? EMPTY}</span> del Libro N°{" "}
          <span className={NUM}>{presentation.process.book.number}</span> ·{" "}
          {CATEGORY_LABELS[presentation.member.category]} ·{" "}
          {STATUS_LABELS[presentation.member.status]} · DNI{" "}
          <span className={NUM}>{presentation.member.dni ?? EMPTY}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {presentation.channel && (
            <span className="mr-1 inline-flex items-center align-text-bottom">
              <PresentationChannelIcon channel={presentation.channel} className="size-4" />
            </span>
          )}
          {presentation.submittedAt ? (
            <>Presentada el <span className={NUM}>{formatDateTimeAR(presentation.submittedAt)}</span></>
          ) : (
            "Todavía sin presentar"
          )}
          {presentation.validatedAt && (
            <>
              {" · resuelta el "}
              <span className={NUM}>{formatDateTimeAR(presentation.validatedAt)}</span>
              {presentation.validatedBy?.name ? ` por ${presentation.validatedBy.name}` : ""}
            </>
          )}
        </p>
      </PageHeader>

      {presentation.observation && (
        <FormMessage kind="neutral" box role="none" className="whitespace-pre-line">
          <span className="font-semibold">Nota de la Comisión: </span>
          {presentation.observation}
        </FormMessage>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Datos declarados</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldList rows={rows} side="declared" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Ficha actual</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldList rows={rows} side="current" />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle as="h2">Documentos</CardTitle>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <EmptyState
                size="card"
                description="Esta presentación todavía no tiene documentos cargados."
              />
            ) : (
              <PresentationDocumentViewer presentationId={presentation.id} documents={documents} />
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle as="h2">Decisión</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {processClosed ? (
              <FormMessage kind="neutral" box role="none">
                El proceso de re-empadronamiento está cerrado: sus presentaciones ya no se
                modifican.
              </FormMessage>
            ) : decidable ? (
              <>
                <FormMessage kind="neutral" role="none">
                  Validar copia a la ficha del socio los datos declarados —todos menos el nombre y
                  el DNI, que no se editan desde acá— y, si la dirección de correo cambió, le manda
                  la verificación de la casilla.
                </FormMessage>
                <ValidateForm
                  presentationId={presentation.id}
                  memberName={presentation.member.fullName}
                />
                <ObserveForm
                  presentationId={presentation.id}
                  defaultNote={presentation.observation ?? ""}
                />
                <RejectForm
                  presentationId={presentation.id}
                  memberName={presentation.member.fullName}
                />
              </>
            ) : presentation.status === "rejected" ? (
              <UnrejectForm presentationId={presentation.id} />
            ) : (
              <FormMessage kind="neutral" box role="none">
                Esta presentación no está esperando una decisión: quedó{" "}
                {PRESENTATION_STATUS_LABELS[presentation.status].toLocaleLowerCase("es-AR")}.
              </FormMessage>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// La comparación
// ─────────────────────────────────────────────────────────────────────────────

type Sided = {
  birthDate: Date | null;
  civilStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  street: { name: string } | null;
  streetText: string | null;
  streetNumber: string | null;
  neighborhood: string | null;
  phone: string | null;
  email: string | null;
};

type Row = { label: string; declared: string; current: string; differs: boolean };

/** El domicilio se muestra en UNA línea porque así se lee y así se corrige: la
 *  calle del catálogo (o el texto libre que quedó de la carga desde papel) más
 *  la altura. Partido en dos filas, una calle igual con la altura cambiada se
 *  ve como "todo igual salvo un número suelto". */
function address(x: Sided): string {
  // `streetLabel` normaliza el formato del catálogo catastral, que viene con el
  // espacio antes de la coma ("Pizarro , Francisco"). Es la misma función que
  // usan el wizard y `/mi/datos`: sin ella, el mismo domicilio se lee distinto
  // en dos pantallas y la comparación de esta parece una diferencia.
  const street = x.street ? streetLabel(x.street.name) : x.streetText ?? "";
  const parts = [street.trim(), (x.streetNumber ?? "").trim()].filter(Boolean);
  return parts.join(" ");
}

/** ¿Los dos lados dicen lo mismo?
 *
 *  Se compara NORMALIZADO —sin distinguir mayúsculas ni espacios al borde—
 *  porque el padrón importado trae emails en mayúsculas y ocupaciones con
 *  espacios pegados del copiar y pegar: marcarlos como diferencia mandaría al
 *  operador a mirar veinte campos "cambiados" que son el mismo dato. Es el
 *  mismo criterio con el que `sameAddress` decide si una dirección cambió, y el
 *  mismo con el que la validación arma el patch: lo que esta pantalla resalta
 *  es lo que la validación efectivamente va a escribir. */
function same(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("es-AR") === b.trim().toLocaleLowerCase("es-AR");
}

function compareRows(declared: Sided, current: Sided): Row[] {
  const pairs: Array<[string, string, string]> = [
    [
      "Fecha de nacimiento",
      declared.birthDate ? formatDateAR(declared.birthDate) : "",
      current.birthDate ? formatDateAR(current.birthDate) : "",
    ],
    ["Estado civil", declared.civilStatus ?? "", current.civilStatus ?? ""],
    ["Nacionalidad", declared.nationality ?? "", current.nationality ?? ""],
    ["Ocupación", declared.occupation ?? "", current.occupation ?? ""],
    ["Domicilio", address(declared), address(current)],
    ["Barrio", declared.neighborhood ?? "", current.neighborhood ?? ""],
    ["Teléfono", declared.phone ?? "", current.phone ?? ""],
    ["Email", declared.email ?? "", current.email ?? ""],
  ];
  return pairs.map(([label, d, c]) => ({
    label,
    declared: d === "" ? EMPTY : d,
    current: c === "" ? EMPTY : c,
    differs: !same(d, c),
  }));
}

function FieldList({ rows, side }: { rows: Row[]; side: "declared" | "current" }) {
  return (
    <dl className="space-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="w-40 shrink-0 text-muted-foreground">{row.label}</dt>
          {/* `break-words` y no un ancho fijo: un email largo en 375px tiene que
              cortar, no desbordar la tarjeta. */}
          <dd className={cn("min-w-0 break-words", row.differs && "font-semibold")}>
            {row[side]}
            {row.differs && <span className="sr-only"> (cambia)</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
