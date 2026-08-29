// El detalle de un acta, rediseñado (spec 2026-08-29): TODO lo que el acta
// respalda —las nueve clases de FKs entrantes, no sólo movimientos— y los
// botones de descarga de la constancia. Un acta que respalda una exención o un
// valor de cuota ya no se ve "vacía".
//
// Las exenciones no tienen sección propia: conceder y anular escriben también
// un Movement con la misma acta, así que ya aparecen en "Movimientos" (ver el
// comentario de `references.ts`).
import {
  BookMarked, ClipboardCheck, FileDown, FileText, Inbox, Users, Wallet,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { formatARS, formatDateAR } from "@/lib/format";
import { MOVEMENT_LABELS, minuteName } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = { title: "Acta — SIGeV" };

function ReferenceGroup({ icon: Icon, title, count, children }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardTitle as="h3" className="flex items-center gap-2">
          <Icon aria-hidden className="size-4 shrink-0 text-primary" />
          {title}
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-none space-y-1.5 p-0 text-sm">{children}</ul>
      </CardContent>
    </Card>
  );
}

export default async function ActaPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Con un id no numérico Prisma tiraría un error técnico en inglés; acá es un 404.
  const minuteId = Number(id);
  if (!Number.isInteger(minuteId) || minuteId <= 0) notFound();

  const minute = await prisma.minute.findUnique({
    where: { id: minuteId },
    include: {
      // Select explícito: la pantalla muestra nombre y link; el DNI sólo lo
      // carga la ruta del export, que es donde la descarga se audita.
      movements: {
        orderBy: { id: "asc" },
        select: { id: true, type: true, memberId: true, member: { select: { fullName: true } } },
      },
      applications: { select: { id: true, fullName: true, status: true } },
      feeValues: {
        orderBy: { validFrom: "asc" },
        select: { id: true, activeAmount: true, sharedAmount: true, validFrom: true },
      },
      booksOpened: { select: { id: true, number: true } },
      booksClosed: { select: { id: true, number: true } },
      processesCalled: { select: { id: true, book: { select: { number: true } } } },
      processesClosed: { select: { id: true, book: { select: { number: true } } } },
    },
  });
  if (!minute) notFound();

  const bookEntries = [
    ...minute.booksOpened.map((b) => ({ key: `o-${b.id}`, text: `Apertura del Libro de Socios N° ${b.number}`, number: b.number })),
    ...minute.booksClosed.map((b) => ({ key: `c-${b.id}`, text: `Cierre del Libro de Socios N° ${b.number}`, number: b.number })),
  ];
  const processEntries = [
    ...minute.processesCalled.map((p) => ({ key: `call-${p.id}`, text: `Convocatoria al re-empadronamiento del Libro N° ${p.book.number}` })),
    ...minute.processesClosed.map((p) => ({ key: `close-${p.id}`, text: `Cierre del proceso de re-empadronamiento del Libro N° ${p.book.number}` })),
  ];
  const total =
    minute.movements.length + minute.applications.length + minute.feeValues.length +
    bookEntries.length + processEntries.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={minuteName(minute)}
        breadcrumb={[{ label: "Actas", href: "/admin/actas" }, { label: `N° ${minute.number}` }]}
        actions={
          <>
            {/* <a> plano y no <Link>: es una descarga de API, no una navegación
                (mismo patrón que el recibo y el export del libro). */}
            <Button asChild variant="outline" className="min-h-11">
              <a href={`/api/admin/actas/${minute.id}/export?formato=pdf`}>
                <FileDown aria-hidden /> PDF
              </a>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <a href={`/api/admin/actas/${minute.id}/export?formato=docx`}>
                <FileText aria-hidden /> Word
              </a>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`/admin/actas/${minute.id}/editar`}>Editar</Link>
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Asentada con fecha {formatDateAR(minute.date)}. La constancia descargable lista estos
          asientos para incorporarlos al acta del libro.
        </p>
      </PageHeader>

      {minute.description && (
        <div className="max-w-3xl rounded-xl border border-l-4 border-l-primary bg-muted/40 p-4 text-sm">
          {minute.description}
        </div>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Lo que respalda esta acta
      </h2>

      {total === 0 ? (
        <EmptyState size="card" description="Esta acta todavía no respalda ningún asiento del sistema." />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {minute.movements.length > 0 && (
            <ReferenceGroup icon={Users} title="Movimientos de socios" count={minute.movements.length}>
              {minute.movements.map((mv) => (
                <li key={mv.id}>
                  {MOVEMENT_LABELS[mv.type]} —{" "}
                  <Link className={INLINE_LINK} href={`/admin/socios/${mv.memberId}`}>
                    {mv.member.fullName}
                  </Link>
                </li>
              ))}
            </ReferenceGroup>
          )}

          {minute.feeValues.length > 0 && (
            <ReferenceGroup icon={Wallet} title="Valores de cuota" count={minute.feeValues.length}>
              {minute.feeValues.map((v) => (
                <li key={v.id}>
                  <Link className={INLINE_LINK} href="/admin/tesoreria/valores">
                    {formatARS(Number(v.activeAmount))} / {formatARS(Number(v.sharedAmount))}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    — vigente desde el {formatDateAR(v.validFrom)}
                  </span>
                </li>
              ))}
            </ReferenceGroup>
          )}

          {minute.applications.length > 0 && (
            <ReferenceGroup icon={Inbox} title="Solicitudes de asociación" count={minute.applications.length}>
              {minute.applications.map((a) => (
                <li key={a.id}>
                  <Link className={INLINE_LINK} href={`/admin/solicitudes/${a.id}`}>
                    {a.fullName}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    — {a.status === "rejected" ? "rechazada" : "asentada"}
                  </span>
                </li>
              ))}
            </ReferenceGroup>
          )}

          {bookEntries.length > 0 && (
            <ReferenceGroup icon={BookMarked} title="Libros" count={bookEntries.length}>
              {bookEntries.map((b) => (
                <li key={b.key}>
                  <Link className={INLINE_LINK} href={`/admin/socios/libros/${b.number}`}>
                    {b.text}
                  </Link>
                </li>
              ))}
            </ReferenceGroup>
          )}

          {processEntries.length > 0 && (
            <ReferenceGroup icon={ClipboardCheck} title="Re-empadronamiento" count={processEntries.length}>
              {processEntries.map((p) => (
                <li key={p.key}>
                  <Link className={INLINE_LINK} href="/admin/reempadronamiento">
                    {p.text}
                  </Link>
                </li>
              ))}
            </ReferenceGroup>
          )}
        </div>
      )}
    </div>
  );
}
