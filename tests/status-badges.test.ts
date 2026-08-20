import { describe, expect, it } from "vitest";
import {
  activityBadgeVariant, applicationStatusBadgeVariant, memberStatusBadgeVariant, newsStatusBadgeVariant,
} from "@/lib/admin/status-badges";
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
