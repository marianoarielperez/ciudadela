import { describe, expect, it } from "vitest";

import { describeMpError, mpErrorLog } from "@/lib/mp/error-log";

// El SDK de Mercado Pago hace `throw await response.json()`: lo que llega al
// catch es el CUERPO de la respuesta, un objeto plano. Estos tests fijan las
// tres formas que el helper tiene que sobrevivir —Error común, objeto del SDK,
// basura— y el enmascarado de direcciones (docs/08, Ley 25.326).

/** El cuerpo real de un 400 de `POST /preapproval`. */
const sdkError = {
  message: "Invalid parameter payer_email",
  error: "bad_request",
  status: 400,
  cause: [
    { code: 3034, description: "payer_email must be a valid email" },
    { code: "2062", description: "auto_recurring.transaction_amount is required" },
  ],
};

describe("describeMpError — Error común", () => {
  it("saca el mensaje y no inventa status", () => {
    const d = describeMpError(new Error("MP no devolvió la suscripción creada."));
    expect(d.message).toBe("MP no devolvió la suscripción creada.");
    expect(d.status).toBeNull();
    expect(d.cause).toEqual([]);
    expect(d.keys).toEqual([]);
  });

  it("usa el `name` cuando aporta algo (FetchError) y el `code` de sistema si lo hay", () => {
    const fetchError = Object.assign(new Error("request to https://api.mercadopago.com failed"), {
      name: "FetchError",
      code: "ETIMEDOUT",
    });
    expect(describeMpError(fetchError).code).toBe("ETIMEDOUT");

    const plain = Object.assign(new Error("boom"), { name: "FetchError" });
    expect(describeMpError(plain).code).toBe("FetchError");
  });

  it("aplana el mensaje multilínea: una entrada partida se pierde en el grep", () => {
    const d = describeMpError(new Error("primera línea\n  segunda línea"));
    expect(d.message).toBe("primera línea segunda línea");
  });

  it("recorta un mensaje enorme", () => {
    const d = describeMpError(new Error("x".repeat(5000)));
    expect(d.message.length).toBe(300);
  });
});

describe("describeMpError — objeto del SDK", () => {
  it("saca status, message, el `error` corto y todo el array `cause`", () => {
    const d = describeMpError(sdkError);
    expect(d.status).toBe(400);
    expect(d.message).toBe("Invalid parameter payer_email");
    expect(d.code).toBe("bad_request");
    expect(d.cause).toEqual([
      { code: "3034", description: "payer_email must be a valid email" },
      { code: "2062", description: "auto_recurring.transaction_amount is required" },
    ]);
  });

  it("lee el status del `api_response` cuando no viene suelto", () => {
    expect(describeMpError({ message: "nope", api_response: { status: 404 } }).status).toBe(404);
  });

  it("no se cuelga con un `cause` de otra forma (objeto suelto, strings)", () => {
    expect(describeMpError({ message: "a", cause: { code: 9, description: "sola" } }).cause).toEqual([
      { code: "9", description: "sola" },
    ]);
    expect(describeMpError({ message: "a", cause: ["texto pelado"] }).cause).toEqual([
      { code: "", description: "texto pelado" },
    ]);
    expect(describeMpError({ message: "a", cause: [null, undefined, {}] }).cause).toEqual([]);
  });

  it("corta el array `cause` en 5", () => {
    const cause = Array.from({ length: 20 }, (_, i) => ({ code: i, description: `d${i}` }));
    expect(describeMpError({ message: "a", cause }).cause).toHaveLength(5);
  });

  it("sin texto legible deja los NOMBRES de campo, que es lo único que queda", () => {
    const d = describeMpError({ raro: 1, otro: 2 });
    expect(d.message).toBe("");
    expect(d.keys).toEqual(["raro", "otro"]);
  });
});

describe("describeMpError — basura", () => {
  it("no explota con nada", () => {
    for (const junk of [undefined, null, 0, "", "boom", true, [], [1, 2], Symbol.iterator]) {
      expect(() => describeMpError(junk)).not.toThrow();
    }
    expect(describeMpError(undefined).message).toBe("");
    expect(describeMpError(null).message).toBe("");
    expect(describeMpError("boom").message).toBe("boom");
    expect(describeMpError(42).message).toBe("42");
  });
});

describe("enmascarado (docs/08, Ley 25.326)", () => {
  it("tapa la dirección que MP devuelve en el mensaje", () => {
    const d = describeMpError({
      message: "payer_email vecino@ejemplo.com.ar is already subscribed",
      status: 400,
    });
    expect(d.message).toBe("payer_email [email] is already subscribed");
    expect(d.message).not.toContain("vecino@");
  });

  it("la tapa también dentro del `cause`", () => {
    const d = describeMpError({
      message: "invalid",
      cause: [{ code: 3034, description: "the payer otro.vecino@gmail.com cannot pay" }],
    });
    expect(d.cause[0].description).toBe("the payer [email] cannot pay");
  });

  it("la línea de log completa sale enmascarada", () => {
    const line = mpErrorLog(
      "createPreapproval",
      { applicationId: 5 },
      { message: "payer_email vecino@ejemplo.com.ar is invalid", status: 400 },
    );
    expect(line).not.toContain("@ejemplo.com.ar");
    expect(line).toContain("[email]");
  });
});

describe("mpErrorLog", () => {
  it("pone adelante la operación y la referencia: qué llamada y sobre qué", () => {
    const line = mpErrorLog("createPreapproval", { applicationId: 5, planId: "plan-A" }, sdkError);
    expect(line).toBe(
      'mp:createPreapproval applicationId=5 planId=plan-A status=400 code=bad_request ' +
        'message="Invalid parameter payer_email" ' +
        "cause=[3034: payer_email must be a valid email | " +
        "2062: auto_recurring.transaction_amount is required]",
    );
  });

  it("saltea las referencias vacías y marca el status desconocido", () => {
    const line = mpErrorLog("cancelPreapproval", { applicationId: 7, preapprovalId: null }, new Error("red caída"));
    expect(line).toBe('mp:cancelPreapproval applicationId=7 status=? message="red caída"');
  });

  it("dice `(sin mensaje)` en vez de quedarse mudo, con los campos que había", () => {
    expect(mpErrorLog("getPlan", {}, { raro: 1 })).toBe(
      'mp:getPlan status=? message="(sin mensaje)" keys=[raro]',
    );
  });
});

// El hint que el gateway le cuelga a un 429 (`retryAfterMs`) se lee ACÁ, no con
// un lector paralelo en `retry.ts`: describeMpError es el único que sabe qué
// forma tiene un fallo de MP. Y va al log porque todavía no se MIDIÓ si MP lo
// manda: la línea de PM2 es la medición.
describe("describeMpError — retryAfterMs", () => {
  it("expone el retryAfterMs colgado por el gateway", () => {
    const e = Object.assign(new Error("payments/search respondió 429"), {
      status: 429,
      retryAfterMs: 7_000,
    });
    expect(describeMpError(e).retryAfterMs).toBe(7_000);
  });

  it("lo omite cuando falta, es cero o es basura", () => {
    expect(describeMpError({ status: 429, message: "x" }).retryAfterMs).toBeUndefined();
    expect(describeMpError({ status: 429, message: "x", retryAfterMs: 0 }).retryAfterMs).toBeUndefined();
    expect(describeMpError({ status: 429, message: "x", retryAfterMs: -1 }).retryAfterMs).toBeUndefined();
    expect(describeMpError({ status: 429, message: "x", retryAfterMs: "7" }).retryAfterMs).toBe(7);
  });

  it("mpErrorLog lo escribe, para medir si MP manda el header", () => {
    const e = Object.assign(new Error("payments/search respondió 429"), {
      status: 429,
      retryAfterMs: 7_000,
    });
    expect(mpErrorLog("searchPayments", {}, e)).toContain("retryAfterMs=7000");
  });
});
