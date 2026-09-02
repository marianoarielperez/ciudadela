// Cómo se le cuenta al wizard un borrador que ya existe. Sin id, sin ip, sin
// descripción: sólo lo que decide la pantalla (mismo criterio que el
// `ApplicationSnapshot` de ASOCIATE).
//
// Puro y sin Prisma: el tipo de la fila entra como `import type`, así que este
// módulo se puede importar desde un test sin `DATABASE_URL` (CLAUDE.md).
import type { ReportWithFiles } from "@/lib/reports/service";
import type { ReportSnapshot } from "./wizard-shared";

export function snapshotOf(r: ReportWithFiles): ReportSnapshot {
  // Los cuatro campos juntos o nada: el paso 2 se salta sólo si en la base ya
  // está TODO lo que ese paso guarda. Con tres de cuatro, el vecino vuelve a
  // verlo con lo que había cargado.
  const complete = Boolean(r.reporterName && r.reporterDni && r.reporterPhone && r.reporterEmail);
  return {
    status: r.status,
    kind: r.kind,
    anonymous: r.anonymous,
    reporterComplete: complete,
    reporter: complete
      ? {
          name: r.reporterName ?? "",
          dni: r.reporterDni ?? "",
          phone: r.reporterPhone ?? "",
          email: r.reporterEmail ?? "",
        }
      : null,
    // Sólo id y tipo: el `path` en disco no tiene por qué viajar al navegador
    // (los archivos se sirven por ruta autenticada, nunca por su ruta real).
    files: r.files.map((f) => ({ id: f.id, kind: f.kind })),
    // El N° visible ES el id, y sólo existe cuando ya se envió: un borrador no
    // tiene número que mostrar.
    number: r.status === "draft" ? null : r.id,
  };
}
