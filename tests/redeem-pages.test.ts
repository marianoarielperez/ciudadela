import { describe, expect, it, vi } from "vitest";

// El módulo importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { REDEEM_CARD_SELECT, REDEEM_PAGE_COPY } from "@/lib/members/access";
import { ADMIN_REDEEM_PAGE_COPY, ADMIN_REDEEM_USER_SELECT } from "@/lib/users/admin-access";

// N10. /verificar y /acceso son URLs anónimas cuya única credencial es un token
// que viajó por correo, y la dirección de ese correo la tipea un operador desde
// una ficha de papel. Hasta acá las dos páginas saludaban por nombre, así que un
// dedazo de una letra le entregaba a un tercero, con un click, el nombre completo
// de un socio y su pertenencia a la asociación: exactamente lo que los dos
// correos de la mudanza se cuidan de no decir, y lo que docs/01 ("ninguna
// consulta pública revela datos del padrón"), docs/08 y la Ley 25.326 prohíben.
describe("las páginas públicas de canje no identifican al socio", () => {
  // La garantía es estructural y no de disciplina del que escribe la página: si
  // el nombre no se lee de la base, no hay forma de mostrarlo por descuido. Es el
  // mismo criterio con el que `loginEmailMovedNotice()` no puede filtrar la
  // dirección nueva — no la recibe.
  it("never reads the member's name from the database", () => {
    expect(REDEEM_CARD_SELECT).not.toHaveProperty("fullName");
    expect(REDEEM_CARD_SELECT).not.toHaveProperty("dni");
    // Y no es que falte por olvido: la lista es exactamente lo que las páginas
    // necesitan para decidir si el enlace sirve y qué dirección mostrar.
    expect(Object.keys(REDEEM_CARD_SELECT).sort()).toEqual(["email", "status"]);
  });

  // Los textos son constantes, no plantillas: no hay ningún hueco donde
  // interpolar un nombre ni un número de socio.
  it("has no interpolation hole in the copy", () => {
    for (const [key, text] of Object.entries(REDEEM_PAGE_COPY)) {
      expect(typeof text, key).toBe("string");
      expect(text, key).not.toMatch(/\$\{|\{\{|%s/);
    }
  });

  // El equilibrio que se buscó: el socio legítimo tiene que entender qué está
  // confirmando y para qué, sin que un desconocido se lleve una identidad.
  it("still gives the legitimate member enough context to finish", () => {
    expect(REDEEM_PAGE_COPY.verifyWhy).toContain("Asociación Vecinal del Barrio Ciudadela");
    expect(REDEEM_PAGE_COPY.verifyWhy).toContain("Art. 5° quater");
    expect(REDEEM_PAGE_COPY.createWhy).toContain("Asociación Vecinal del Barrio Ciudadela");
    // Y la salida para quien no esperaba nada de esto, en las dos páginas.
    expect(REDEEM_PAGE_COPY.verifyNotYou).toContain("Si no esperabas este correo");
    expect(REDEEM_PAGE_COPY.createNotYou).toContain("Si no esperabas este correo");
  });

  // Voseo (es-AR) y ninguna dirección de ejemplo pegada en el texto.
  it("is written in es-AR and carries no address of its own", () => {
    expect(REDEEM_PAGE_COPY.verifyLead).toContain("Confirmá");
    expect(REDEEM_PAGE_COPY.createLead).toContain("Elegí");
    for (const [key, text] of Object.entries(REDEEM_PAGE_COPY)) {
      expect(text, key).not.toContain("@");
    }
  });
});

// La Task 7 agregó, a la MISMA página, la rama de cuentas de gestión
// (/acceso/[token] cuando el token es "admin_invitation"). Mismo riesgo,
// mismo candado: sin esto, agregar `name: true` al select del `User` de esa
// rama pasa toda la suite igual y termina mostrando el nombre de una persona
// en una página anónima a la que se llega con un token que pudo ir a la
// casilla equivocada (Ley 25.326).
describe("la rama admin de /acceso tampoco identifica al titular", () => {
  it("never reads the user's name from the database", () => {
    expect(ADMIN_REDEEM_USER_SELECT).not.toHaveProperty("name");
    // Y no es que falte por olvido: es exactamente lo que la página necesita
    // para decidir si el enlace sirve y qué dirección mostrar.
    expect(Object.keys(ADMIN_REDEEM_USER_SELECT).sort()).toEqual(["active", "email"]);
  });

  it("has no interpolation hole in the copy", () => {
    for (const [key, text] of Object.entries(ADMIN_REDEEM_PAGE_COPY)) {
      expect(typeof text, key).toBe("string");
      expect(text, key).not.toMatch(/\$\{|\{\{|%s/);
    }
  });
});
