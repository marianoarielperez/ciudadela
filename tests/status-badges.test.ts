import { describe, expect, it } from "vitest";
import {
  activityBadgeVariant, memberStatusBadgeVariant, newsStatusBadgeVariant,
} from "@/lib/admin/status-badges";
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

describe("NEWS_STATUS_LABELS", () => {
  it("covers both statuses in es-AR", () => {
    expect(NEWS_STATUS_LABELS.draft).toBe("Borrador");
    expect(NEWS_STATUS_LABELS.published).toBe("Publicada");
  });
});
