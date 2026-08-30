import { describe, expect, it, vi } from "vitest";

// El módulo de documentos institucionales absorbió al estatuto, pero /mi/estatuto
// quedó en pie como redirect: es la URL que el M5 le mostró al socio y la que
// puede estar en sus marcadores. Sin este test, la página se puede vaciar o
// apuntar a cualquier lado con la suite entera en verde — y el síntoma sería un
// 404 para el socio que guardó el enlace, que es justo a quien se quiso cubrir.
const h = vi.hoisted(() => ({
  // Como el real: `redirect` NUNCA devuelve (tipo `never`), corta la ejecución
  // tirando. Un spy que devuelve undefined dejaría pasar una página que después
  // del redirect siguiera haciendo cosas.
  redirect: vi.fn((): never => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import MiEstatutoPage from "@/app/mi/estatuto/page";

describe("/mi/estatuto", () => {
  it("redirige a /mi/documentos (marcadores del M5)", () => {
    expect(() => MiEstatutoPage()).toThrow("NEXT_REDIRECT");
    expect(h.redirect).toHaveBeenCalledWith("/mi/documentos");
  });
});
