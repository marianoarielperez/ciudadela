// El PDF de un reporte, a pedido (spec §8). Es el papel que el operador lleva o
// manda al organismo, así que se genera cuando se pide y NO se guarda: no hay
// serie numerada que sostener —eso es de los recibos (REG-33)— y el reporte ya
// está en la base.
//
// Cuatro cosas que no se ven en la respuesta y son todo lo que hace correcta a
// esta ruta:
//
//  1. `requireAdmin()` PRIMERO, antes de tocar la base o el disco.
//  2. Se leen las FOTOS y nunca las caras del DNI. El PDF va afuera de la
//     asociación: un documento de identidad no puede viajar adentro, y por eso
//     el filtro está acá y no en una opción del generador.
//  3. El mini-mapa falla SUAVE y con timeout (`renderStaticMap` devuelve `null`):
//     un reclamo que no se puede imprimir porque el IGN está caído es peor que
//     un reclamo sin foto aérea. El PDF lo dice cuando salió sin mapa.
//  4. La auditoría va DESPUÉS de tener los bytes y lleva sólo METADATOS
//     (`hasMap`, `photos`): ni el nombre del vecino, ni su descripción, ni las
//     rutas del disco (regla del proyecto, Ley 25.326).
//
// La CSP dura que emite este handler no llega sola al navegador: Next copia las
// cabeceras de `headers()` de `next.config.ts` con `setHeader`, que REEMPLAZA.
// La entrada específica de esta ruta está en `next.config.ts` con el mismo valor
// y `tests/report-file-routes.test.ts` verifica que no se desincronicen.
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { minuteName } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { AGENCY_LABELS, categoryLabel, subtypeLabel } from "@/lib/reports/catalog";
import { parsePositiveInt, REPORT_FILE_CSP, REPORT_FILE_NOT_FOUND } from "@/lib/reports/file-response";
import { renderReportPdf } from "@/lib/reports/pdf";
import { MAX_PHOTOS } from "@/lib/reports/rules";
import { renderStaticMap } from "@/lib/reports/static-map";
import { reportFileStore } from "@/lib/reports/storage";

// sharp y pdf-lib son de Node: esta ruta no puede correr en el edge runtime.
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id } = await params;
  const reportId = parsePositiveInt(id);
  if (reportId === null) return new Response(REPORT_FILE_NOT_FOUND, { status: 404 });

  const r = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      files: true,
      filedMinute: { select: { type: true, number: true } },
      member: {
        select: {
          memberships: {
            where: { book: { status: "open" } },
            select: { memberNumber: true },
            take: 1,
          },
        },
      },
    },
  });
  // Un borrador no es un reporte todavía: no se envió, no tiene número que
  // presentar y su contenido puede estar a medias. Se trata como inexistente.
  if (!r || r.status === "draft") return new Response(REPORT_FILE_NOT_FOUND, { status: 404 });

  const photos: Buffer[] = [];
  for (const f of r.files.filter((f) => f.kind === "photo").slice(0, MAX_PHOTOS)) {
    try {
      photos.push(await reportFileStore.read(f));
    } catch {
      // Una foto perdida en disco no frena el PDF, y el error crudo NO se
      // loguea: trae la ruta absoluta en el `message` (Ley 25.326).
    }
  }

  const lat = r.lat === null ? null : Number(r.lat);
  const lng = r.lng === null ? null : Number(r.lng);
  const map = lat !== null && lng !== null ? await renderStaticMap({ lat, lng }) : null;

  // El papel que va al organismo lleva el N° PÚBLICO, que es el que el vecino
  // tiene en su acuse. El respaldo por `id` no debería usarse nunca —un borrador
  // ya salió por 404 y el envío escribe el número en su misma transacción— pero
  // un PDF sin número no se puede citar en ningún expediente.
  const shown = r.number ?? r.id;

  const bytes = await renderReportPdf(
    {
      number: shown,
      kind: r.kind,
      status: r.status as "received" | "filed" | "dismissed",
      categoryLabel: categoryLabel(r.kind, r.category),
      // El tipo es de los reclamos: una iniciativa sólo tiene categoría.
      subtypeLabel: r.kind === "claim" ? subtypeLabel(r.category, r.subtype) || null : null,
      description: r.description ?? "",
      street: [r.streetName, r.addressDetail].filter(Boolean).join(" ") || null,
      lat,
      lng,
      outsideBoundary: r.outsideBoundary,
      scplTicket: r.scplTicket,
      submittedAt: r.submittedAt,
      reporter: {
        name: r.reporterName,
        dni: r.reporterDni,
        phone: r.reporterPhone,
        email: r.reporterEmail,
        memberNumber: r.member?.memberships[0]?.memberNumber ?? null,
      },
      // `identityLines` (puro, testeado) es lo que decide si algo de lo de
      // arriba llega al papel: reservado = nada.
      anonymous: r.anonymous,
      filed:
        r.status === "filed" && r.filedAt
          ? {
              agencyLabel:
                r.filedAgency === "other"
                  ? r.filedAgencyOther
                  : r.filedAgency
                    ? AGENCY_LABELS[r.filedAgency]
                    : null,
              at: r.filedAt,
              reference: r.filedReference,
              // El acta va NOMBRADA por tipo y número, nunca por su id.
              minuteName: r.filedMinute ? minuteName(r.filedMinute) : null,
            }
          : null,
      dismissed:
        r.status === "dismissed" && r.dismissedAt
          ? { at: r.dismissedAt, reason: r.dismissReason }
          : null,
      printedAt: new Date(),
    },
    { photos, map },
  );

  // Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el
  // módulo realip y la sobrescribe, así que no se puede rotar por request.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "report_pdf_export",
    entity: "report",
    entityId: r.id,
    detail: { hasMap: map !== null, photos: photos.length },
    ip,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline`: el operador lo mira antes de mandarlo al organismo.
      "Content-Disposition": `inline; filename="reporte-${shown}.pdf"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": REPORT_FILE_CSP,
    },
  });
}
