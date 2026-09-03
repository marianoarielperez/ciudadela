// El detalle de un acta, rediseñado (spec 2026-08-29): TODO lo que el acta
// respalda —las nueve clases de FKs entrantes, no sólo movimientos— y los
// botones de descarga de la constancia. Un acta que respalda una exención o un
// valor de cuota ya no se ve "vacía".
//
// Ni las exenciones ni las solicitudes ASENTADAS tienen sección propia:
// conceder, anular y asentar escriben también un Movement con la misma acta,
// así que ya aparecen en "Movimientos". Acá sólo se listan las solicitudes
// RECHAZADAS, que no dejan movimiento (ver el comentario de `references.ts`).
// Los REPORTES (M7) sí la tienen: una iniciativa tratada por la Comisión no
// escribe movimiento —quien reporta puede no ser socio— y su acta es todo el
// respaldo que hay.
import {
  BookMarked, ClipboardCheck, FileDown, FileText, Inbox, Megaphone, Users, Wallet,
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
import { REFERENCE_COUNT_SELECT, referenceCount } from "@/lib/minutes/references";
import { prisma } from "@/lib/prisma";
import { categoryLabel, filedVerb, KIND_LABELS } from "@/lib/reports/catalog";

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
      applications: {
        where: { status: "rejected" },
        orderBy: { id: "asc" },
        select: { id: true, fullName: true },
      },
      _count: { select: REFERENCE_COUNT_SELECT },
      feeValues: {
        orderBy: { validFrom: "asc" },
        select: { id: true, activeAmount: true, sharedAmount: true, validFrom: true },
      },
      booksOpened: { select: { id: true, number: true } },
      booksClosed: { select: { id: true, number: true } },
      processesCalled: { select: { id: true, book: { select: { number: true } } } },
      processesClosed: { select: { id: true, book: { select: { number: true } } } },
      // Las iniciativas TRATADAS con esta acta (M7, Art. 6.2). Se listan porque
      // `referenceCount` ya las cuenta: sin la sección, un acta que sólo
      // respalda el tratamiento de una iniciativa diría "1 asiento" arriba y no
      // mostraría ninguno abajo. Sin `description` ni un solo dato de quien
      // reportó: esto es un índice del libro de actas, no la ficha del reporte
      // (Ley 25.326, mismo criterio que `REPORT_LIST_SELECT`).
      reportsFiled: { orderBy: { id: "asc" }, select: { id: true, number: true, kind: true, category: true } },
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
  // El MISMO conteo que la tarjeta del listado (referenceCount sobre el
  // _count): dos derivaciones separadas ya habrían divergido con el filtro de
  // solicitudes rechazadas.
  const total = referenceCount(minute._count);

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
            <ReferenceGroup icon={Inbox} title="Solicitudes rechazadas" count={minute.applications.length}>
              {minute.applications.map((a) => (
                <li key={a.id}>
                  <Link className={INLINE_LINK} href={`/admin/solicitudes/${a.id}`}>
                    {a.fullName}
                  </Link>{" "}
                  <span className="text-muted-foreground">— rechazo asentado en esta acta</span>
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

          {minute.reportsFiled.length > 0 && (
            <ReferenceGroup icon={Megaphone} title="Reportes" count={minute.reportsFiled.length}>
              {minute.reportsFiled.map((r) => (
                <li key={r.id}>
                  <Link className={INLINE_LINK} href={`/admin/solicitudes/reportes/${r.id}`}>
                    {KIND_LABELS[r.kind]} N° {r.number ?? "—"}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    — {categoryLabel(r.kind, r.category)}, {filedVerb(r.kind).toLowerCase()} con esta acta
                  </span>
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
