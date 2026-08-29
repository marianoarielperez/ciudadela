import { beforeEach, describe, expect, it, vi } from "vitest";

// La MITAD GET del §7.2: la pantalla de la captura 2 del incidente. El socio 106
// no llegó a esta rama por un POST sino abriendo otra vez el enlace del correo, y
// hasta el fix leía "El enlace venció o ya fue usado" cuando su verificación
// había funcionado. El cableado de la página (token muerto → `ownerOf` → ficha
// mínima → `deadVerificationCopy`) no tenía ninguna prueba: se podía revertir al
// texto genérico con la suite entera en verde.
//
// Harness propio y no el de `dead-verification-copy.test.ts` a propósito: esta
// pantalla necesita `tokens.peek` gobernable, un doble de Prisma con
// `application` y el mock de `./confirm-form` (que arrastra la server action
// entera). Meter todo eso en el harness de la action perturbaría sus cuatro
// casos sin ganar nada.
//
// `VerificarPage` es un server component async: se lo IMPORTA y se lo LLAMA como
// función, y se afirma sobre el árbol de elementos que devuelve. No hay librería
// de render en este repo para páginas con componentes de cliente adentro, y no
// se agrega una: `JSON.stringify` del árbol alcanza para fijar QUÉ texto se
// muestra, que es lo único que este test tiene que proteger.
const h = vi.hoisted(() => ({
  peek: vi.fn(async (): Promise<unknown> => null),
  ownerOf: vi.fn(async (): Promise<unknown> => null),
  // Tipada con el argumento a la vista para poder afirmar sobre el `select`.
  memberFindUnique: vi.fn(async (_args?: { where: unknown; select: unknown }): Promise<unknown> => null),
  applicationFindUnique: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: h.memberFindUnique },
    application: { findUnique: h.applicationFindUnique },
  },
}));
vi.mock("@/lib/tokens", () => ({
  tokens: { peek: h.peek, ownerOf: h.ownerOf },
  makeTokens: vi.fn(),
  MEMBER_EMAIL_TOKEN_PURPOSES: ["email_verification", "password_invitation"],
}));
// El formulario es un componente de cliente que importa la server action entera
// (y con ella `next/headers`, el limitador y el mailer). La página sólo necesita
// que exista para armar el árbol; en la rama muerta ni siquiera se renderiza.
vi.mock("@/app/(public)/verificar/[token]/confirm-form", () => ({
  ConfirmForm: () => null,
}));

import VerificarPage from "@/app/(public)/verificar/[token]/page";
import { ACCESS_ERRORS } from "@/lib/members/access";

/** El texto del enlace muerto de una SOLICITUD vive en la página (es de esa rama
 *  y de ninguna otra); se lo ancla por su frase distintiva. */
const APPLICATION_DEAD = "es de un solo uso";

/** Lo que la pantalla dice, aplanado. El árbol de React serializa los textos de
 *  los hijos; los componentes (funciones) se caen solos del JSON, que es
 *  exactamente lo que no hace falta mirar acá. */
async function screenText(token = "RAW"): Promise<string> {
  const jsx = await VerificarPage({ params: Promise.resolve({ token }) });
  return JSON.stringify(jsx);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.peek.mockResolvedValue(null);
  h.ownerOf.mockResolvedValue(null);
  h.memberFindUnique.mockResolvedValue(null);
  h.applicationFindUnique.mockResolvedValue(null);
});

describe("GET /verificar/[token] con el enlace ya muerto (§7.2)", () => {
  it("ficha verificada y sin cuenta: la pantalla dice la verdad, no el genérico", async () => {
    h.ownerOf.mockResolvedValue({ memberId: 106, applicationId: null });
    h.memberFindUnique.mockResolvedValue({ status: "active", emailStatus: "verified", userId: null });

    const text = await screenText();
    expect(text).toContain(ACCESS_ERRORS.verifiedNoAccount);
    expect(text).not.toContain(ACCESS_ERRORS.dead);

    // El select sigue siendo el mínimo: tres campos y ninguno más. Escrito como
    // igualdad de forma —no como ausencia de un campo puntual— para que agregar
    // cualquier dato de la ficha a esta pantalla anónima ponga el test en rojo.
    const arg = h.memberFindUnique.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ id: 106 });
    expect(arg?.select).toEqual({ status: true, emailStatus: true, userId: true });
  });

  it("ficha que YA tiene cuenta: el trámite terminó, queda el genérico", async () => {
    h.ownerOf.mockResolvedValue({ memberId: 106, applicationId: null });
    h.memberFindUnique.mockResolvedValue({ status: "active", emailStatus: "verified", userId: 9 });

    const text = await screenText();
    expect(text).toContain(ACCESS_ERRORS.dead);
    expect(text).not.toContain(ACCESS_ERRORS.verifiedNoAccount);
  });

  it("el dueño es una SOLICITUD: su propio texto, y ninguna consulta de ficha", async () => {
    h.ownerOf.mockResolvedValue({ memberId: null, applicationId: 5 });

    const text = await screenText();
    expect(text).toContain(APPLICATION_DEAD);
    expect(text).not.toContain(ACCESS_ERRORS.verifiedNoAccount);
    expect(h.memberFindUnique).not.toHaveBeenCalled();
  });

  it("token sin rastro: el genérico, sin consultar ninguna ficha", async () => {
    const text = await screenText();
    expect(text).toContain(ACCESS_ERRORS.dead);
    expect(h.memberFindUnique).not.toHaveBeenCalled();
  });
});
