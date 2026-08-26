// Paneles PRESENTACIONALES de la vista previa del cierre: reciben datos
// serializables y no tocan Prisma, así el test de pantalla los renderiza con
// `renderToStaticMarkup` (precedente `admin-health-screen`).
//
// Lo que esta pantalla existe para hacer bien: que el operador LEA el mapeo
// número viejo → número nuevo antes de apretar el botón. Los números que salen
// de acá son los números de socio definitivos del libro nuevo, y el paso solo
// se revierte restaurando un backup.
import Link from "next/link";

import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import type { ClosePreview } from "@/lib/reregistration/close-book";
import type { ClosePrecondition } from "@/lib/reregistration/close";

const NUM = "font-mono tabular-nums";

type Migrant = ClosePreview["migrants"][number];

/** El aviso con todas las letras. Es la frase acordada con el operador y el
 *  test de pantalla la fija: no la reescribas "más suave". */
export function IrreversibleWarning({ oldNumber, newNumber }: { oldNumber: number; newNumber: number }) {
  return (
    <FormMessage kind="warning" box>
      Este paso cierra el Libro N° <span className={NUM}>{oldNumber}</span> y abre el Libro N°{" "}
      <span className={NUM}>{newNumber}</span>. <strong>Solo se revierte restaurando un backup.</strong>
    </FormMessage>
  );
}

/** Los bloqueos vivos: con uno solo de estos, el botón no se ofrece. La
 *  transacción los re-valida igual adentro — esto es la versión legible. */
export function CloseBlockersNotice({ blockers }: { blockers: ClosePrecondition[] }) {
  if (blockers.length === 0) return null;
  return (
    <FormMessage kind="error" box as="div">
      <p className="font-medium">No se puede cerrar todavía:</p>
      <ul className="mt-1 list-disc pl-5">
        {blockers.map((b) => (
          <li key={b.kind}>
            {b.kind === "unresolved_presentations" ? (
              <>
                <span className={NUM}>{b.count}</span>{" "}
                {b.count === 1 ? "presentación espera" : "presentaciones esperan"} decisión de la Comisión.
              </>
            ) : (
              <>
                <span className={NUM}>{b.count}</span>{" "}
                {b.count === 1 ? "convocado sigue" : "convocados siguen"} sin desenlace: falta declarar sus bajas.
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1">
        Resolvelo desde el{" "}
        <Link className={INLINE_LINK} href="/admin/reempadronamiento/cierre">
          checklist del cierre
        </Link>{" "}
        y volvé.
      </p>
    </FormMessage>
  );
}

/** Las advertencias: ámbar, con nombres cuando los hay, y NINGUNA frena. La
 *  baja sin notificar se muestra acá por decisión del operador (advierte, no
 *  bloquea): cerrar con ella es legal pero es una persona a la que no le corre
 *  la ventana de recurso, y tiene que elegirlo a sabiendas. */
export function CloseWarnings({ arrears, unnotified }: {
  arrears: number;
  unnotified: Array<{ memberId: number; fullName: string; memberNumber: number | null }>;
}) {
  if (arrears === 0 && unnotified.length === 0) return null;
  return (
    <FormMessage kind="warning" box as="div">
      <p className="font-medium">Se puede cerrar, pero mirá esto antes:</p>
      <ul className="mt-1 list-disc pl-5">
        {unnotified.length > 0 && (
          <li>
            {unnotified.length === 1
              ? "Una baja declarada sigue sin notificar: "
              : `${unnotified.length} bajas declaradas siguen sin notificar: `}
            {unnotified.map((u, i) => (
              <span key={u.memberId}>
                {i > 0 && ", "}
                {u.fullName}
                {u.memberNumber !== null && (
                  <>
                    {" "}(N° <span className={NUM}>{u.memberNumber}</span>)
                  </>
                )}
              </span>
            ))}
            . A esas personas no les corre la ventana de recurso y la resolución no es oponible
            todavía. El cierre no las notifica.
          </li>
        )}
        {arrears > 0 && (
          <li>
            <span className={NUM}>{arrears}</span>{" "}
            {arrears === 1 ? "socio está" : "socios están"} en condición de cesantía por mora — otra
            causal, con su propia acta, que este cierre no toca. Verlos en{" "}
            <Link className={INLINE_LINK} href="/admin/tesoreria/deudores">
              Deudores
            </Link>
            .
          </li>
        )}
      </ul>
    </FormMessage>
  );
}

/** El mapeo completo, ordenado por número NUEVO: tabla en desktop, tarjetas en
 *  móvil (molde del Libro asentado). Nunca un thead sin filas: con cero
 *  migrantes el caller no llega acá. */
export function MigrationPreview({ migrants, oldNumber, newNumber }: {
  migrants: Migrant[];
  oldNumber: number;
  newNumber: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <span className={NUM}>{migrants.length}</span>
        {migrants.length === 1 ? " socio migra" : " socios migran"} al Libro N°{" "}
        <span className={NUM}>{newNumber}</span>, renumerados desde 1 por antigüedad.
      </p>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{`N° nuevo (Libro ${newNumber})`}</TableHead>
              <TableHead>{`N° anterior (Libro ${oldNumber})`}</TableHead>
              <TableHead>Apellido y nombre</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {migrants.map((m) => (
              <TableRow key={m.memberId}>
                <TableCell className={NUM}>{m.newNumber}</TableCell>
                <TableCell className={`${NUM} text-muted-foreground`}>{m.oldNumber}</TableCell>
                <TableCell>
                  <Link className={INLINE_LINK} href={`/admin/socios/${m.memberId}`}>
                    {m.fullName}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{CATEGORY_LABELS[m.category]}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={memberStatusBadgeVariant(m.status)}>{STATUS_LABELS[m.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {migrants.map((m) => (
          <Card key={m.memberId} size="sm">
            <CardHeader>
              <CardTitle as="h3" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <Link className={INLINE_LINK} href={`/admin/socios/${m.memberId}`}>{m.fullName}</Link>
                <Badge variant={memberStatusBadgeVariant(m.status)}>{STATUS_LABELS[m.status]}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                N° <span className={NUM}>{m.oldNumber}</span> {"→ N° "}
                <span className={`${NUM} font-medium text-foreground`}>{m.newNumber}</span>
                {" · "}
                {CATEGORY_LABELS[m.category]}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
