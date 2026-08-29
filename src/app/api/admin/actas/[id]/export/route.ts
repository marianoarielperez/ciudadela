// Descarga de la "Constancia de asientos del sistema" de un acta, en PDF o
// Word. Molde: el export del libro (`api/admin/libros/[numero]/export`) —
// misma guarda, mismas cabeceras, mismo asiento con metadatos.
//
// El archivo lleva datos personales COMPLETOS (nombre, DNI, N° de socio) por
// decisión del operador (spec 29/08/2026): es el insumo del acta real del
// libro. Por eso: `requireAdmin` acá adentro (el layout no cubre route
// handlers), `no-store, private`, y auditoría por descarga cuyo detail lleva
// SOLO metadatos — nunca los datos de las filas (Ley 25.326, mismo criterio
// que `minuteEditAuditDetail`).
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { minuteExportModel } from "@/lib/minutes/export-content";
import { renderMinuteDocx } from "@/lib/minutes/export-docx";
import { renderMinutePdf } from "@/lib/minutes/export-pdf";
import { prisma } from "@/lib/prisma";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id } = await params;
  const minuteId = Number(id);
  if (!Number.isInteger(minuteId) || minuteId <= 0) {
    return new Response("Acta inexistente", { status: 404 });
  }

  const formato = new URL(req.url).searchParams.get("formato");
  if (formato !== "pdf" && formato !== "docx") {
    return new Response("Formato inválido", { status: 400 });
  }

  const minute = await prisma.minute.findUnique({
    where: { id: minuteId },
    include: {
      movements: {
        orderBy: { id: "asc" },
        select: {
          type: true, previousCategory: true, newCategory: true, reason: true,
          member: {
            select: {
              fullName: true, dni: true,
              // El N° de socio vive en la membresía; la del libro más alto es
              // la vigente (o la última que tuvo, si ya migró o es baja).
              memberships: {
                orderBy: { bookId: "desc" }, take: 1,
                select: { memberNumber: true },
              },
            },
          },
        },
      },
      // Sólo las RECHAZADAS: una solicitud asentada ya escribió su Movement de
      // alta/reingreso con esta misma acta — listarla acá imprimiría dos
      // renglones por el mismo hecho (ver `references.ts`).
      applications: {
        where: { status: "rejected" },
        orderBy: { id: "asc" },
        select: { fullName: true, dni: true, status: true },
      },
      feeValues: {
        orderBy: { validFrom: "asc" },
        select: { activeAmount: true, sharedAmount: true, validFrom: true },
      },
      booksOpened: { select: { number: true } },
      booksClosed: { select: { number: true } },
      processesCalled: { select: { book: { select: { number: true } } } },
      processesClosed: { select: { book: { select: { number: true } } } },
    },
  });
  if (!minute) return new Response("Acta inexistente", { status: 404 });

  const model = minuteExportModel({
    type: minute.type,
    number: minute.number,
    date: minute.date,
    description: minute.description,
    movements: minute.movements.map((mv) => ({
      type: mv.type,
      member: { fullName: mv.member.fullName, dni: mv.member.dni },
      memberNumber: mv.member.memberships[0]?.memberNumber ?? null,
      previousCategory: mv.previousCategory,
      newCategory: mv.newCategory,
      reason: mv.reason,
    })),
    feeValues: minute.feeValues.map((v) => ({
      activeAmount: Number(v.activeAmount),
      sharedAmount: Number(v.sharedAmount),
      validFrom: v.validFrom,
    })),
    applications: minute.applications,
    booksOpened: minute.booksOpened,
    booksClosed: minute.booksClosed,
    processesCalled: minute.processesCalled.map((p) => ({ bookNumber: p.book.number })),
    processesClosed: minute.processesClosed.map((p) => ({ bookNumber: p.book.number })),
    generatedAt: new Date(),
  });

  const bytes =
    formato === "pdf" ? await renderMinutePdf(model) : await renderMinuteDocx(model);

  // La auditoría va DESPUÉS de tener los bytes: si la generación falla no queda
  // asiento de una descarga que no ocurrió. Metadatos únicamente.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "minute_export",
    entity: "minute",
    entityId: minute.id,
    detail: {
      type: minute.type,
      number: minute.number,
      format: formato,
      entries: model.totalEntries,
    },
    ip,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[formato],
      "Content-Disposition": `attachment; filename="${model.fileBase}.${formato}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
