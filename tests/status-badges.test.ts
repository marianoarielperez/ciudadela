import { describe, expect, it } from "vitest";
import {
  activityBadgeVariant, applicationStatusBadgeVariant, arrearsBadgeVariant, feeStatusBadgeVariant,
  memberStatusBadgeVariant, newsStatusBadgeVariant, receiptBadgeVariant, unmatchedStatusBadgeVariant,
} from "@/lib/admin/status-badges";
import { UNMATCHED_STATUS_LABELS } from "@/lib/admin/unmatched-labels";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/labels";
import { NEWS_STATUS_LABELS } from "@/lib/news/labels";

describe("memberStatusBadgeVariant", () => {
  // El mapa canónico es el que usaba el padrón; la ficha había divergido
  // (colapsaba suspended en outline). Un suspendido se ve IGUAL en todos lados.
  it("maps each member status", () => {
    expect(memberStatusBadgeVariant("active")).toBe("default");
    expect(memberStatusBadgeVariant("suspended")).toBe("secondary");
    expect(memberStatusBadgeVariant("withdrawn")).toBe("outline");
  });
});

describe("newsStatusBadgeVariant", () => {
  it("maps each news status", () => {
    expect(newsStatusBadgeVariant("published")).toBe("default");
    expect(newsStatusBadgeVariant("draft")).toBe("secondary");
  });
});

describe("activityBadgeVariant", () => {
  it("maps active flag", () => {
    expect(activityBadgeVariant(true)).toBe("default");
    expect(activityBadgeVariant(false)).toBe("secondary");
  });
});

describe("applicationStatusBadgeVariant", () => {
  // La bandeja tiene que resaltar lo accionable: lo que espera acta es lo único
  // celeste, lo terminal (completada, vencida, iniciada sin avanzar) va apagado.
  it("maps every application status", () => {
    expect(applicationStatusBadgeVariant("approved_pending_minute")).toBe("default");
    expect(applicationStatusBadgeVariant("pending_board")).toBe("secondary");
    expect(applicationStatusBadgeVariant("pending_payment")).toBe("secondary");
    expect(applicationStatusBadgeVariant("rejected")).toBe("destructive");
    expect(applicationStatusBadgeVariant("started")).toBe("outline");
    expect(applicationStatusBadgeVariant("completed")).toBe("outline");
    expect(applicationStatusBadgeVariant("expired")).toBe("outline");
  });
});

describe("APPLICATION_STATUS_LABELS", () => {
  // El Record<ApplicationStatus, string> lo exige tsc; lo que se fija acá es que
  // ninguna etiqueta quede vacía ni repetida (dos estados con el mismo nombre
  // vuelven la bandeja ilegible).
  it("covers the seven statuses with distinct es-AR labels", () => {
    const labels = Object.values(APPLICATION_STATUS_LABELS);
    expect(labels).toHaveLength(7);
    expect(new Set(labels).size).toBe(7);
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
    expect(APPLICATION_STATUS_LABELS.started).toBe("Iniciada");
    expect(APPLICATION_STATUS_LABELS.pending_payment).toBe("Esperando pago");
    expect(APPLICATION_STATUS_LABELS.rejected).toBe("Rechazada");
  });
});

describe("NEWS_STATUS_LABELS", () => {
  it("covers both statuses in es-AR", () => {
    expect(NEWS_STATUS_LABELS.draft).toBe("Borrador");
    expect(NEWS_STATUS_LABELS.published).toBe("Publicada");
  });
});

describe("treasury badges", () => {
  it("la mora escala: 1 secondary, 2 default, 4 destructive", () => {
    expect(arrearsBadgeVariant(0)).toBe("outline");
    expect(arrearsBadgeVariant(1)).toBe("secondary");
    expect(arrearsBadgeVariant(2)).toBe("default");
    expect(arrearsBadgeVariant(4)).toBe("destructive");
  });
  it("recibo anulado es destructive; cuota pagada default, pendiente secondary", () => {
    expect(receiptBadgeVariant(true)).toBe("destructive");
    expect(receiptBadgeVariant(false)).toBe("default");
    expect(feeStatusBadgeVariant("paid")).toBe("default");
    expect(feeStatusBadgeVariant("pending")).toBe("secondary");
    expect(feeStatusBadgeVariant("voided")).toBe("outline");
  });
});

describe("unmatchedStatusBadgeVariant", () => {
  // Las cuatro vidas de una fila de la bandeja se ven distintas: la que espera
  // decisión (celeste), la aplicada a un socio, la descartada y el ingreso no
  // societario. Que dos compartan variante volvería la columna ilegible —
  // "descartado" y "es plata nuestra pero de nadie" son afirmaciones opuestas.
  it("le da una variante propia a cada estado", () => {
    const variants = (["open", "matched", "dismissed", "other_income"] as const).map(unmatchedStatusBadgeVariant);
    expect(variants).toEqual(["default", "outline", "secondary", "ghost"]);
    expect(new Set(variants).size).toBe(4);
  });
  it("cada estado tiene su etiqueta en es-AR y ninguna se repite", () => {
    const labels = Object.values(UNMATCHED_STATUS_LABELS);
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size).toBe(4);
    expect(UNMATCHED_STATUS_LABELS.other_income).toBe("Ingreso no societario");
  });
});
