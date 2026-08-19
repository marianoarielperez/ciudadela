import { describe, expect, it } from "vitest";

import {
  buildPatch, cardSchema, changedFields, parseBirthDate, verificationTarget,
  type CardInput, type MemberSnapshot, type Patch,
} from "@/lib/members/card-edit";

// El socio tal como sale de la base. `joinedAt`, `status`, `category` y el
// número de socio están acá para poder afirmar que el patch NO los alcanza.
function member(over: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    fullName: "Pérez, Juan",
    dni: "20111222",
    birthDate: new Date("1970-05-10T12:00:00Z"),
    civilStatus: "Casado/a",
    nationality: "Argentina",
    occupation: "Albañil",
    phone: "297-4000000",
    streetId: 6,
    streetText: null,
    streetNumber: "1234",
    neighborhood: "Ciudadela",
    email: "juan@example.com",
    emailStatus: "verified",
    emailVerifiedAt: new Date("2026-08-01T10:00:00Z"),
    status: "active",
    ...over,
  } as MemberSnapshot;
}

// Lo que llega del formulario ya parseado. Por defecto, exactamente lo guardado:
// cada test cambia sólo el campo que le interesa.
function input(over: Partial<CardInput> = {}): CardInput {
  return {
    memberId: 1,
    fullName: "Pérez, Juan",
    dni: "20111222",
    birthDate: "1970-05-10",
    civilStatus: "Casado/a",
    nationality: "Argentina",
    occupation: "Albañil",
    phone: "297-4000000",
    streetId: 6,
    streetNumber: "1234",
    neighborhood: "Ciudadela",
    email: "juan@example.com",
    ...over,
  };
}

const BIRTH = new Date("1970-05-10T12:00:00Z");

describe("card-edit — lista blanca de campos", () => {
  // La invariante es legal, no cosmética: `joinedAt` define la antigüedad
  // estatutaria (voto y elegibilidad), `status`/`category` son asientos con acta
  // y el número de socio vive en Membership. Esta lista está escrita a mano acá
  // a propósito: si alguien agrega un `...d` al patch en un refactor, aparecen
  // claves nuevas y este test cae. Importarla del módulo lo haría tautológico.
  const WRITABLE = [
    "fullName", "dni", "birthDate", "civilStatus", "nationality", "occupation",
    "phone", "streetId", "streetText", "streetNumber", "neighborhood", "email",
    "emailStatus", "emailVerifiedAt",
  ];

  it("escribe exactamente los campos de ficha y ninguno más", () => {
    const { patch } = buildPatch(member(), input(), BIRTH);
    expect(Object.keys(patch).sort()).toEqual([...WRITABLE].sort());
  });

  it("no deja pasar joinedAt, status, category ni el número de socio", () => {
    // Un POST adulterado con los campos societarios encima: parseForm los
    // descarta (no están en el schema) y el patch tampoco los inventa.
    const raw = {
      ...input(),
      joinedAt: "1990-01-01", status: "active", category: "founder",
      withdrawalReason: "death", memberNumber: 7, reentryBlocked: false,
    } as unknown as CardInput;
    const { patch } = buildPatch(member(), raw, BIRTH);
    for (const forbidden of ["joinedAt", "status", "category", "withdrawalReason", "memberNumber", "reentryBlocked"]) {
      expect(patch).not.toHaveProperty(forbidden);
    }
  });

  it("el schema ignora los campos societarios que vengan en el FormData", () => {
    const parsed = cardSchema.parse({
      memberId: "1", fullName: "Pérez, Juan", joinedAt: "1990-01-01", status: "withdrawn",
      category: "founder", memberNumber: "7",
    });
    expect(Object.keys(parsed).sort()).toEqual(["fullName", "memberId"]);
  });
});

describe("card-edit — transiciones de emailStatus", () => {
  it("preserva verified cuando el email no cambió", () => {
    const m = member();
    const { patch } = buildPatch(m, input(), BIRTH);
    expect(patch.emailStatus).toBe("verified");
    expect(patch.emailVerifiedAt).toEqual(m.emailVerifiedAt);
  });

  // El bug que el implementador corrigió respecto del brief: el padrón importado
  // trae emails en mayúsculas, y abrir/guardar una ficha no puede degradar la
  // verificación por una diferencia de caja.
  it("no considera cambio la sola normalización de mayúsculas", () => {
    const m = member({ email: "JUAN@EXAMPLE.COM" });
    const { patch } = buildPatch(m, input({ email: "Juan@Example.com" }), BIRTH);
    expect(patch.email).toBe("juan@example.com");
    expect(patch.emailStatus).toBe("verified");
    expect(patch.emailVerifiedAt).toEqual(m.emailVerifiedAt);
  });

  it("baja a declared y limpia la fecha cuando cambia el email de un socio verificado", () => {
    const { patch } = buildPatch(member(), input({ email: "otro@example.com" }), BIRTH);
    expect(patch.email).toBe("otro@example.com");
    expect(patch.emailStatus).toBe("declared");
    expect(patch.emailVerifiedAt).toBeNull();
  });

  it("pasa a none y limpia la fecha cuando se borra el email de un socio verificado", () => {
    const { patch } = buildPatch(member(), input({ email: undefined }), BIRTH);
    expect(patch.email).toBeNull();
    expect(patch.emailStatus).toBe("none");
    expect(patch.emailVerifiedAt).toBeNull();
  });

  it("un email nuevo sobre una ficha sin email queda declared", () => {
    const m = member({ email: null, emailStatus: "none", emailVerifiedAt: null });
    const { patch } = buildPatch(m, input({ email: "NUEVO@example.com" }), BIRTH);
    expect(patch.email).toBe("nuevo@example.com");
    expect(patch.emailStatus).toBe("declared");
  });

  it("preserva bounced y declared si el email no cambió", () => {
    for (const st of ["bounced", "declared"] as const) {
      const m = member({ emailStatus: st, emailVerifiedAt: null });
      expect(buildPatch(m, input(), BIRTH).patch.emailStatus).toBe(st);
    }
  });

  it("guardar sin email una ficha que ya no tenía email no es un cambio", () => {
    const m = member({ email: null, emailStatus: "none", emailVerifiedAt: null });
    const { patch } = buildPatch(m, input({ email: undefined }), BIRTH);
    expect(patch.emailStatus).toBe("none");
  });
});

describe("card-edit — changedFields", () => {
  it("no reporta nada cuando el patch es idéntico a lo guardado", () => {
    const m = member();
    const { patch } = buildPatch(m, input(), BIRTH);
    expect(changedFields(m, patch)).toEqual([]);
  });

  it("reporta sólo los campos tocados", () => {
    const m = member();
    const { patch } = buildPatch(m, input({ occupation: "Jubilado", phone: "297-4111111" }), BIRTH);
    expect(changedFields(m, patch).sort()).toEqual(["occupation", "phone"]);
  });

  it("compara fechas por valor y no por identidad de objeto", () => {
    const m = member();
    // Otra instancia de Date con el mismo instante: no es un cambio.
    const same = buildPatch(m, input(), new Date("1970-05-10T12:00:00Z")).patch;
    expect(changedFields(m, same)).toEqual([]);
    const other = buildPatch(m, input({ birthDate: "1970-05-11" }), new Date("1970-05-11T12:00:00Z")).patch;
    expect(changedFields(m, other)).toEqual(["birthDate"]);
  });

  it("detecta el borrado de una fecha y la carga de una ficha que no la tenía", () => {
    const m = member();
    expect(changedFields(m, buildPatch(m, input({ birthDate: undefined }), null).patch)).toEqual(["birthDate"]);
    const sinFecha = member({ birthDate: null });
    expect(changedFields(sinFecha, buildPatch(sinFecha, input(), BIRTH).patch)).toEqual(["birthDate"]);
  });

  it("cambiar el email reporta email, emailStatus y emailVerifiedAt", () => {
    const m = member();
    const { patch } = buildPatch(m, input({ email: "otro@example.com" }), BIRTH);
    expect(changedFields(m, patch).sort()).toEqual(["email", "emailStatus", "emailVerifiedAt"]);
  });

  it("elegir una calle del catálogo borra el texto libre y lo reporta", () => {
    const m = member({ streetId: null, streetText: "Hernandez , Jose" });
    const { patch } = buildPatch(m, input({ streetId: 6, streetText: "Hernandez , Jose" }), BIRTH);
    expect(patch.streetId).toBe(6);
    expect(patch.streetText).toBeNull();
    expect(changedFields(m, patch).sort()).toEqual(["streetId", "streetText"]);
  });

  it("sin calle de catálogo conserva el texto libre", () => {
    const m = member({ streetId: null, streetText: null });
    const { patch } = buildPatch(m, input({ streetId: undefined, streetText: "Pasaje sin nombre" }), BIRTH);
    expect(patch.streetId).toBeNull();
    expect(patch.streetText).toBe("Pasaje sin nombre");
  });

  it("los campos vacíos borran el dato guardado", () => {
    const m = member();
    const vacio = input({
      dni: undefined, civilStatus: undefined, nationality: undefined, occupation: undefined,
      phone: undefined, streetId: undefined, streetNumber: undefined, neighborhood: undefined,
    });
    const { patch } = buildPatch(m, vacio, BIRTH);
    const nulls: Array<keyof Patch> = [
      "dni", "civilStatus", "nationality", "occupation", "phone", "streetId",
      "streetNumber", "neighborhood",
    ];
    for (const key of nulls) expect(patch[key]).toBeNull();
    expect(changedFields(m, patch).sort()).toEqual([...nulls].sort());
  });
});

describe("card-edit — parseBirthDate", () => {
  const NOW = new Date("2026-08-19T00:00:00Z").getTime();

  it("acepta una fecha civil y la guarda a mediodía UTC", () => {
    const r = parseBirthDate("1970-05-10", NOW);
    expect(r).toEqual({ ok: true, value: new Date("1970-05-10T12:00:00Z") });
  });

  it("sin fecha devuelve null", () => {
    expect(parseBirthDate(undefined, NOW)).toEqual({ ok: true, value: null });
  });

  // El regex del schema deja pasar días que no existen; sin esta guarda
  // `civilDateUtc` desbordaría al 3 de marzo en silencio.
  it("rechaza días que no existen en vez de desbordarlos", () => {
    for (const raw of ["1983-02-31", "2026-13-01", "1990-04-31", "2026-00-10", "1990-06-00"]) {
      expect(parseBirthDate(raw, NOW).ok).toBe(false);
    }
  });

  it("respeta el año bisiesto", () => {
    expect(parseBirthDate("1984-02-29", NOW).ok).toBe(true);
    expect(parseBirthDate("1983-02-29", NOW).ok).toBe(false);
  });

  it("rechaza fechas anteriores a 1900 y posteriores a hoy", () => {
    expect(parseBirthDate("1899-12-31", NOW)).toEqual({
      ok: false, error: "La fecha de nacimiento tiene que estar entre 1900 y hoy.",
    });
    expect(parseBirthDate("0198-01-01", NOW).ok).toBe(false);
    expect(parseBirthDate("2027-01-01", NOW).ok).toBe(false);
    expect(parseBirthDate("1900-01-01", NOW).ok).toBe(true);
  });
});

describe("card-edit — qué correo de acceso le corresponde al socio", () => {
  const base = {
    status: "active", email: "juan@example.com", emailStatus: "declared", userId: null,
  } as const;

  it("acepta al socio vigente con email sin verificar", () => {
    expect(verificationTarget(base)).toEqual({
      ok: true, email: "juan@example.com", kind: "email_verification",
    });
  });

  // La suspensión es temporal y no le saca el domicilio electrónico.
  it("acepta al socio suspendido", () => {
    expect(verificationTarget({ ...base, status: "suspended" })).toEqual({
      ok: true, email: "juan@example.com", kind: "email_verification",
    });
  });

  // El caso que motivó la guarda: baja por fallecimiento con el email del
  // familiar en la ficha. El correo lo invitaría a crear la contraseña del socio.
  it("rechaza al socio dado de baja aunque tenga email cargado", () => {
    expect(verificationTarget({ ...base, status: "withdrawn" })).toEqual({
      ok: false, error: "El socio está dado de baja: no corresponde invitarlo al portal.",
    });
  });

  it("rechaza la baja antes que cualquier otra guarda", () => {
    expect(verificationTarget({ status: "withdrawn", email: null, emailStatus: "none", userId: null }).ok).toBe(false);
    expect(verificationTarget({ ...base, status: "withdrawn", emailStatus: "verified" })).toEqual({
      ok: false, error: "El socio está dado de baja: no corresponde invitarlo al portal.",
    });
    // Verificado, sin cuenta y de baja: la baja gana igual, no se reinvita.
    expect(verificationTarget({ ...base, status: "withdrawn", emailStatus: "verified", userId: null })).toEqual({
      ok: false, error: "El socio está dado de baja: no corresponde invitarlo al portal.",
    });
  });

  it("rechaza al socio sin email cargado", () => {
    expect(verificationTarget({ ...base, email: null, emailStatus: "none" })).toEqual({
      ok: false, error: "El socio no tiene email cargado. Guardá la ficha primero.",
    });
    // La falta de email gana sobre la rama de reinvitación: sin dirección no hay
    // a dónde mandar nada.
    expect(verificationTarget({ ...base, email: null, emailStatus: "verified" }).ok).toBe(false);
  });

  // Un rebote no bloquea el reenvío a la misma dirección (M-7 del review).
  it("permite reenviar tras un rebote", () => {
    expect(verificationTarget({ ...base, emailStatus: "bounced" })).toEqual({
      ok: true, email: "juan@example.com", kind: "email_verification",
    });
  });

  // I1 del review de la Task 14: el socio verifica desde el celular y cierra la
  // pestaña antes de elegir la contraseña. Sin esta rama quedaba trabado para
  // siempre (el recupero no lo alcanza: todavía no tiene `User`).
  it("manda la invitación de contraseña si el email ya está verificado y no hay cuenta", () => {
    expect(verificationTarget({ ...base, emailStatus: "verified", userId: null })).toEqual({
      ok: true, email: "juan@example.com", kind: "password_invitation",
    });
  });

  // Con cuenta creada la reinvitación deja de corresponder: eso es un recupero
  // de contraseña, que va contra la cuenta y no contra la ficha.
  it("rechaza reinvitar al socio que ya tiene cuenta", () => {
    expect(verificationTarget({ ...base, emailStatus: "verified", userId: 7 })).toEqual({
      ok: false,
      error: "El socio ya tiene su cuenta creada. Si perdió la contraseña, tiene que pedir el restablecimiento desde la pantalla de ingreso.",
    });
  });

  // Con cuenta vinculada pero email todavía sin confirmar sigue faltando la
  // verificación: el domicilio electrónico fehaciente no depende de la cuenta.
  it("manda la verificación al socio con cuenta y email sin verificar", () => {
    expect(verificationTarget({ ...base, userId: 7 })).toEqual({
      ok: true, email: "juan@example.com", kind: "email_verification",
    });
  });
});
