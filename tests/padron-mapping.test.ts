import { describe, expect, it } from "vitest";
import { civilDateUtc, excelDateToCivilUtc } from "@/lib/dates";
import {
  mapPadronRow, mapWithdrawalReason, type RawPadronRow, updateDataForExisting,
} from "@/lib/padron/mapping";

const base: RawPadronRow = {
  numero_socio: 14, apellido_nombre: "Perez Mariano", dni: 30111222,
  calle: "Los Andes", altura: 26, barrio: "Ciudadela", nacionalidad: null,
  fecha_nacimiento: new Date(Date.UTC(1983, 11, 10)), estado_civil: "Soltero",
  ocupacion: "Periodista", telefono: null, email: "m@yahoo.com.ar",
  debito_automatico: "Si", fecha_ingreso: new Date(Date.UTC(2019, 8, 1)),
  categoria_socio: "Activo", activo: "Si", deuda_tesoreria: null,
  fecha_egreso: null, motivo_baja: "-",
};

describe("dates", () => {
  it("civilDateUtc is noon UTC", () => {
    expect(civilDateUtc(2019, 9, 1).toISOString()).toBe("2019-09-01T12:00:00.000Z");
  });
  it("excelDateToCivilUtc keeps the civil day", () => {
    expect(excelDateToCivilUtc(new Date(Date.UTC(2019, 8, 1))).toISOString()).toBe("2019-09-01T12:00:00.000Z");
  });
});

describe("mapWithdrawalReason", () => {
  it("maps the known catalog", () => {
    expect(mapWithdrawalReason("Mora").reason).toBe("arrears");
    expect(mapWithdrawalReason("Fallecido").reason).toBe("death");
    expect(mapWithdrawalReason("Fallecida").reason).toBe("death");
    expect(mapWithdrawalReason("Domiciliada en Gasoducto").reason).toBe("moved_away");
    expect(mapWithdrawalReason("Anulada por domicilio El Bolsón.").reason).toBe("moved_away");
    expect(mapWithdrawalReason("-").reason).toBeNull();
    expect(mapWithdrawalReason(null).reason).toBeNull();
  });
  // REG-04 (Art. 5 inc. 2): el expulsado NO puede reingresar jamás. Sin este
  // caso el motivo caía en `other` y la puerta del wizard —que bloquea por
  // `reentryBlocked || withdrawalReason === "expulsion"`— lo dejaba pasar.
  // El libro de papel escribe el motivo a mano, así que se contemplan las
  // formas que efectivamente aparecen: participio en masculino y femenino, el
  // sustantivo con y sin tilde, y el motivo dentro de una frase más larga.
  it("maps every spelling of an expulsion", () => {
    for (const raw of [
      "Expulsado", "Expulsada", "Expulsión", "Expulsion", "EXPULSADO",
      "  expulsado  ", "Expulsado por acta 12", "Anulada por expulsión",
    ]) {
      expect(mapWithdrawalReason(raw)).toEqual({ reason: "expulsion" });
    }
  });

  it("falls back to other with warning", () => {
    const r = mapWithdrawalReason("texto raro");
    expect(r.reason).toBe("other");
    expect(r.warning).toContain("texto raro");
  });
});

describe("mapPadronRow", () => {
  it("maps a vigente with email and auto debit", () => {
    const m = mapPadronRow(base);
    expect(m.memberNumber).toBe(14);
    expect(m.member.status).toBe("active");
    expect(m.member.category).toBe("active");
    expect(m.member.dni).toBe("30111222");
    expect(m.member.emailStatus).toBe("declared");
    expect(m.member.autoDebit).toBe(true);
    expect(m.member.joinedAt.toISOString()).toBe("2019-09-01T12:00:00.000Z");
    expect(m.member.streetText).toBe("Los Andes");
    expect(m.member.streetNumber).toBe("26");
    expect(m.warnings).toEqual([]);
  });
  it("maps a baja por mora con deuda", () => {
    const m = mapPadronRow({ ...base, activo: "No", deuda_tesoreria: "Si",
      motivo_baja: "Mora", fecha_egreso: new Date(Date.UTC(2025, 7, 31)),
      email: null, debito_automatico: "No", categoria_socio: "Adherente" });
    expect(m.member.status).toBe("withdrawn");
    expect(m.member.category).toBe("adherent");
    expect(m.member.withdrawalReason).toBe("arrears");
    expect(m.member.debtAtWithdrawal).toBe(true);
    expect(m.member.leftAt?.toISOString()).toBe("2025-08-31T12:00:00.000Z");
    expect(m.member.emailStatus).toBe("none");
  });
  it("warns on missing dni and on baja without fecha_egreso", () => {
    const m = mapPadronRow({ ...base, dni: null, activo: "No", motivo_baja: "Fallecido", fecha_egreso: null });
    expect(m.member.dni).toBeNull();
    expect(m.member.leftAt).toBeNull();
    expect(m.warnings.some((w) => w.includes("sin DNI"))).toBe(true);
    expect(m.warnings.some((w) => w.includes("sin fecha_egreso"))).toBe(true);
  });
  // Defensa en profundidad: el motivo se puede editar después desde el panel,
  // el flag no se apaga solo. La puerta del wizard mira las DOS señales
  // (`eligibility.ts:64`), así que el import tiene que dejar puestas las dos.
  it("marks an expelled member as blocked for reentry", () => {
    const m = mapPadronRow({ ...base, activo: "No", motivo_baja: "Expulsado",
      fecha_egreso: new Date(Date.UTC(2024, 4, 10)) });
    expect(m.member.withdrawalReason).toBe("expulsion");
    expect(m.member.reentryBlocked).toBe(true);
    expect(m.warnings).toEqual([]);
  });

  it("leaves reentryBlocked off for every other reason", () => {
    for (const motivo of ["Mora", "Fallecido", "Domiciliada en Gasoducto", "texto raro", "-"]) {
      const m = mapPadronRow({ ...base, activo: "No", motivo_baja: motivo,
        fecha_egreso: new Date(Date.UTC(2024, 4, 10)) });
      expect(m.member.reentryBlocked).toBe(false);
    }
  });

  // Una ficha VIGENTE no arrastra ni motivo ni bloqueo, pase lo que pase en la
  // columna: `activo=Si` con un motivo escrito es un dato sucio del libro, no
  // una expulsión (y el bloqueo quedaría invisible en la ficha de un socio).
  it("never blocks a member that is still active", () => {
    const m = mapPadronRow({ ...base, activo: "Si", motivo_baja: "Expulsado" });
    expect(m.member.withdrawalReason).toBeNull();
    expect(m.member.reentryBlocked).toBe(false);
  });

  it("throws on unknown category or activo flag", () => {
    expect(() => mapPadronRow({ ...base, categoria_socio: "Vitalicio" })).toThrow();
    expect(() => mapPadronRow({ ...base, activo: "quizas" })).toThrow();
  });
});

// `import-padron.ts --update-existing` pisa la ficha con lo que diga el Excel.
// Para `reentryBlocked` eso no puede valer: el flag lo prende también
// `memberService.withdraw` al asentar una expulsión POSTERIOR a la foto del
// padrón, y bajarlo reabriría la puerta que REG-04 cierra para siempre.
describe("updateDataForExisting", () => {
  const incoming = (motivo: string) =>
    mapPadronRow({ ...base, activo: "No", motivo_baja: motivo, fecha_egreso: new Date(Date.UTC(2024, 4, 10)) })
      .member;

  it("never lowers a reentry block that the ficha already has", () => {
    const data = updateDataForExisting(incoming("Mora"), { reentryBlocked: true });
    expect(data.reentryBlocked).toBe(true);
    expect(data.withdrawalReason).toBe("arrears");
  });

  it("turns the block on when the padron says expulsion", () => {
    expect(updateDataForExisting(incoming("Expulsado"), { reentryBlocked: false }).reentryBlocked).toBe(true);
  });

  it("leaves the block off when neither side has it, and copies everything else", () => {
    const data = updateDataForExisting(incoming("Mora"), { reentryBlocked: false });
    expect(data.reentryBlocked).toBe(false);
    expect(data).toEqual({ ...incoming("Mora"), reentryBlocked: false });
  });
});
