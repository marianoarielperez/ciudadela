import { beforeEach, describe, expect, it, vi } from "vitest";

// El barrio del re-empadronamiento no se elige: la residencia en Ciudadela es
// requisito estatutario del adherente (Art. 5 inc. 3) y la cohorte convocada es
// toda adherente. Este archivo fija las dos mitades de esa decisión:
//
//   1. el valor que se guarda es EXACTAMENTE el del padrón ("Ciudadela": así lo
//      escriben 277 de las 278 filas del Libro N° 1, y el importador copia esa
//      columna tal cual);
//   2. la action lo escribe desde la constante y NO lo lee del formulario, así
//      que un POST armado a mano —el `<select>` ya no existe en la pantalla, y
//      eso solo no protege nada— no puede meter otro barrio en el padrón.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo.
const mocks = vi.hoisted(() => ({
  saveData: vi.fn(),
  limiter: { check: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), auditStrict: vi.fn() }));
vi.mock("@/lib/auth/rate-limiter", () => ({
  publicTokenLimiter: mocks.limiter,
  reregistrationLookupLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
  reregistrationResendLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
}));
vi.mock("@/lib/reregistration/presentation", () => ({
  presentations: { saveData: mocks.saveData },
  PRESENTATION_MAX_ANNEXES: 2,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "1.2.3.4", "user-agent": "vitest" }),
}));

import { savePresentationDataAction } from "@/app/(public)/reempadronate/actions";
import { REREGISTRATION_NEIGHBOURHOOD } from "@/lib/reregistration/presentation-rules";

/** Un paso 2 completo y válido. El barrio NO está: el formulario ya no lo
 *  manda, y que la action igual funcione es la mitad de lo que se prueba. */
function validForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const entries: Record<string, string> = {
    token: "una-llave-cualquiera",
    birthDate: "1970-05-04",
    civilStatus: "Casado/a",
    nationality: "Argentina",
    occupation: "Docente",
    streetId: "7",
    streetNumber: "1234",
    phone: "297 4000000",
    email: "vecina@ejemplo.com",
    emailConfirm: "vecina@ejemplo.com",
    ...over,
  };
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limiter.check.mockReturnValue(true);
  mocks.saveData.mockResolvedValue({ ok: true });
});

describe("el barrio del wizard REEMPADRONATE", () => {
  it("es el del padrón, tal cual lo escribe el Libro N° 1", () => {
    expect(REREGISTRATION_NEIGHBOURHOOD).toBe("Ciudadela");
  });

  it("se guarda aunque el formulario no lo mande: el campo dejó de ser elegible", async () => {
    const res = await savePresentationDataAction({}, validForm());

    expect(res).toEqual({ saved: true });
    expect(mocks.saveData).toHaveBeenCalledTimes(1);
    expect(mocks.saveData.mock.calls[0][0].data.neighborhood).toBe(REREGISTRATION_NEIGHBOURHOOD);
  });

  it("ignora un barrio metido a mano en el POST", async () => {
    const res = await savePresentationDataAction({}, validForm({ neighborhood: "Pueyrredón" }));

    expect(res).toEqual({ saved: true });
    expect(mocks.saveData.mock.calls[0][0].data.neighborhood).toBe(REREGISTRATION_NEIGHBOURHOOD);
  });
});
