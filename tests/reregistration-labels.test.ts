import { describe, expect, it } from "vitest";
import {
  BoardNoticeKind, NotificationType, PresentationChannel, PresentationStatus,
  ReregistrationStatus,
} from "@/generated/prisma/enums";
import {
  BOARD_NOTICE_KIND_LABELS, NOTIFICATION_TYPE_LABELS, PRESENTATION_CHANNEL_LABELS,
  PRESENTATION_STATUS_LABELS, PROCESS_STATUS_LABELS,
} from "@/lib/members/labels";

// Los enums del M6 se muestran en pantallas que lee el vecino y en la cartelera
// de la sede. Los consumidores indexan el mapa SIN respaldo, así que un valor
// sin etiqueta no sale crudo en inglés ("in_person"): sale `undefined`, que
// React no dibuja — la celda queda VACÍA, que es peor, porque no se lee como un
// error sino como un dato que falta. El `Record<Enum, string>` ya lo exige tsc;
// lo que se fija acá es lo que tsc no ve: que ninguna etiqueta quede vacía y que
// dos valores distintos no se llamen igual, que en una lista de presentaciones
// es indistinguible de un bug.
function expectComplete(values: readonly string[], labels: Record<string, string>) {
  for (const value of values) {
    expect(labels[value], `falta la etiqueta de "${value}"`).toBeTypeOf("string");
    expect(labels[value].trim().length).toBeGreaterThan(0);
  }
  const own = values.map((v) => labels[v]);
  expect(new Set(own).size).toBe(values.length);
}

describe("PRESENTATION_STATUS_LABELS", () => {
  it("covers every PresentationStatus with a distinct es-AR label", () => {
    expectComplete(Object.values(PresentationStatus), PRESENTATION_STATUS_LABELS);
    expect(PRESENTATION_STATUS_LABELS.pending).toBe("Sin presentar");
    expect(PRESENTATION_STATUS_LABELS.withdrawn).toBe("Baja declarada");
  });
});

describe("PROCESS_STATUS_LABELS", () => {
  it("covers every ReregistrationStatus with a distinct es-AR label", () => {
    expectComplete(Object.values(ReregistrationStatus), PROCESS_STATUS_LABELS);
  });
});

describe("BOARD_NOTICE_KIND_LABELS", () => {
  it("covers every BoardNoticeKind with a distinct es-AR label", () => {
    expectComplete(Object.values(BoardNoticeKind), BOARD_NOTICE_KIND_LABELS);
  });
});

describe("PRESENTATION_CHANNEL_LABELS", () => {
  it("covers every PresentationChannel with a distinct es-AR label", () => {
    expectComplete(Object.values(PresentationChannel), PRESENTATION_CHANNEL_LABELS);
  });
});

describe("NOTIFICATION_TYPE_LABELS", () => {
  // El M6 le suma dos tipos al enum. El mapa es viejo y compartido: si alguien
  // agrega un tipo sin etiqueta, la pantalla de notificaciones lo muestra crudo.
  it("still covers every NotificationType, including the M6 ones", () => {
    expectComplete(Object.values(NotificationType), NOTIFICATION_TYPE_LABELS);
    expect(NOTIFICATION_TYPE_LABELS.presentation_received).toBe("Presentación recibida");
    expect(NOTIFICATION_TYPE_LABELS.presentation_observed).toBe("Presentación observada");
  });
});
