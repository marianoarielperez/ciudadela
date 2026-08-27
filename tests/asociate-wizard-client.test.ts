import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withUploadedType } from "@/app/(public)/asociate/wizard-shared";

// Dos bugs de producción del wizard ASOCIATE (21/08/2026), los dos del cliente.
//
// Por qué buena parte de esto se verifica sobre la FUENTE y no con un render:
// el proyecto corre vitest en entorno node, sin jsdom — pero además, y esto es
// lo importante, **un test de clic no puede ver el bug de la subida**. Con
// `fireEvent.click` / `userEvent.click` / `element.click()` todo el despacho y
// la activation behavior del `<button type="submit">` ocurren de forma síncrona
// dentro de una tarea JS ya en curso, así que React no alcanza a flushear su
// render en el medio: el submit sale y la subida funciona IGUAL con el bug y sin
// él (medido en la investigación; por eso el smoke original no lo detectó). Sólo
// falla con un clic de usuario real, donde el flush síncrono de React cae justo
// entre el `onClick` y la activation behavior.
//
// Entonces no se finge cobertura con un clic: se fija la propiedad ESTRUCTURAL
// que hace imposible el bug —que ninguna ranura comparta estado de envío con
// otra, y que el clic no toque estado—, que es lo que un cambio futuro podría
// romper sin darse cuenta. El comportamiento con clics reales se verificó en el
// navegador (ver `.superpowers/sdd/wizard-fixes-report.md`).
const read = (...parts: string[]) =>
  readFileSync(path.resolve(import.meta.dirname, "..", ...parts), "utf8").replaceAll("\r\n", "\n");
const src = (...parts: string[]) => read("src", ...parts);

/** El CÓDIGO, sin comentarios: estos archivos están muy comentados y varios
 *  comentarios nombran a propósito lo que el código ya no puede hacer
 *  (`activeSlot`, el `useActionState` compartido). Sin esto los tests medirían
 *  la prosa en vez del programa. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ 	]*\/\/.*$/gm, "");

const stepDocuments = code(src("app", "(public)", "asociate", "step-documents.tsx"));
const wizard = code(src("app", "(public)", "asociate", "asociate-wizard.tsx"));

// ── Bug 1: el clic de "Subir" que se tragaba la ranura ──────────────────────
//
// Causa: las tres ranuras compartían UN `useActionState` en el wizard más un
// puntero `activeSlot` marcado en el `onClick` del botón. React flushea el
// update de un evento discreto de forma síncrona dentro del despacho del clic,
// así que en ese render el puntero ya apuntaba a la ranura nueva y `pending`
// seguía en `false`: la ranura se comía como propia una respuesta ajena (o el
// `{}` inicial), apagaba `hasFile`, y el navegador encontraba el botón
// `disabled` y NO disparaba el submit. Fallaba el primer clic de toda ranura y
// todo clic que movía el puntero.
describe("paso 5: cada ranura de documento es independiente", () => {
  it("NO existe un puntero de ranura activa en ninguna de las dos puntas", () => {
    // `activeSlot` es el nombre exacto del puntero que causaba el bug, pero lo
    // que se prohíbe es la clase: cualquier estado del paso que diga CUÁL de
    // las ranuras envió último.
    expect(stepDocuments).not.toContain("activeSlot");
    expect(wizard).not.toContain("activeSlot");
  });

  it("el estado de envío se declara DENTRO de DocumentSlot, uno por ranura", () => {
    const slotStart = stepDocuments.indexOf("function DocumentSlot(");
    expect(slotStart).toBeGreaterThan(0);
    const paso = stepDocuments.slice(0, slotStart);
    const ranura = stepDocuments.slice(slotStart);
    // El componente de la ranura crea el suyo...
    expect(ranura).toContain("useActionState<UploadState, FormData>(");
    // ...y el paso que las contiene NO tiene ninguno que repartir (el `import`
    // del hook está más arriba y no cuenta: lo que importa es dónde se LLAMA).
    expect(paso).not.toContain("useActionState<");
    expect(paso).not.toContain("useActionState(");
    // Y hay exactamente uno en el archivo: es el de la ranura, y como
    // `DocumentSlot` se renderiza tres veces, hay tres estados independientes.
    expect(stepDocuments.split("useActionState<UploadState, FormData>(")).toHaveLength(2);
  });

  it("el wizard ya no reparte un estado de subida compartido", () => {
    // Ni la action, ni el `state`/`formAction`/`pending` que viajaban al paso.
    expect(wizard).not.toContain("uploadDocumentAction");
    expect(wizard).not.toContain("uploadState");
    expect(wizard).not.toContain("uploadAction");
    // Lo único que sube de la ranura al wizard es QUÉ documento entró.
    expect(wizard).toContain("onUploaded={addUploaded}");
  });

  it("el botón Subir no tiene onClick: un clic no puede apagar el botón", () => {
    // Éste es el invariante que un clic de navegador rompía. Sin ningún
    // `setState` en el despacho del clic no hay render en el medio, así que el
    // botón no puede pasar a `disabled` antes de la activation behavior.
    const submit = stepDocuments.slice(
      stepDocuments.indexOf('<Button\n              type="submit"'),
    );
    expect(submit.startsWith("<Button")).toBe(true);
    const abre = submit.slice(0, submit.indexOf(">"));
    expect(abre).toContain("disabled={!hasFile || busy}");
    expect(abre).not.toContain("onClick");
  });

  it("el ajuste en render reconoce la respuesta por identidad, no por ser truthy", () => {
    // El `{}` inicial de `useActionState` es truthy: con `if (response)` el
    // primer clic de la sesión se apagaba solo. Ahora la única condición es que
    // la respuesta sea OTRA que la ya vista, y eso sólo pasa cuando la subida de
    // ESTA ranura termina.
    expect(stepDocuments).toContain("if (response !== seenResponse) {");
    expect(stepDocuments).not.toContain("if (response) {");
  });
});

describe("withUploadedType", () => {
  it("el frente re-subido no se duplica en la lista", () => {
    expect(withUploadedType(["dni_front"], "dni_front")).toEqual(["dni_front"]);
  });

  it("el dorso re-subido tampoco", () => {
    expect(withUploadedType(["dni_front", "dni_back"], "dni_back")).toEqual([
      "dni_front",
      "dni_back",
    ]);
  });

  it("los anexos se acumulan: dos anexos son dos entradas", () => {
    // La ranura cuenta las repeticiones para decir "2 archivos".
    expect(withUploadedType(["annex"], "annex")).toEqual(["annex", "annex"]);
  });

  it("un tipo nuevo se suma", () => {
    expect(withUploadedType([], "dni_front")).toEqual(["dni_front"]);
    expect(withUploadedType(["dni_front"], "dni_back")).toEqual(["dni_front", "dni_back"]);
  });

  it("no muta la lista anterior", () => {
    const prev: Array<"dni_front"> = ["dni_front"];
    withUploadedType(prev, "dni_back");
    expect(prev).toEqual(["dni_front"]);
  });
});

// ── Bug 2: recargar perdía el trámite ───────────────────────────────────────
//
// Después del paso 3 la solicitud YA existe en la base, pero el token de retome
// vivía sólo en el estado de React: una recarga —F5, o en iOS cambiar de app y
// volver— lo perdía, el vecino tenía que empezar de cero y al reintentar con el
// mismo DNI chocaba con "ya tenés una solicitud en trámite".
describe("el token de retome queda en la dirección apenas la solicitud existe", () => {
  it("el wizard escribe la URL de retome con el token recién creado", () => {
    expect(wizard).toContain("const createdToken = createState.created?.resumeToken;");
    expect(wizard).toContain(
      "window.history.replaceState(null, \"\", `/asociate/retomar/${encodeURIComponent(createdToken)}`);",
    );
  });

  it("el token va en el SEGMENTO de path, nunca en un query string", () => {
    // Es una credencial: en un query string se filtra por logs de proxy, por
    // `document.location` de terceros y por la barra de sugerencias. La ruta que
    // ya existe lo lleva como segmento y así tiene que quedar.
    expect(wizard).not.toMatch(/retomar\?[^`"']*token/);
    expect(wizard).not.toContain("?token=");
  });

  it("es replaceState y no pushState: el atrás no puede volver al paso 3", () => {
    // Volver al formulario ya enviado sólo puede terminar en un duplicado.
    expect(wizard).not.toContain("history.pushState");
  });

  it("la página de retome se sirve noindex/nofollow", () => {
    // robots.txt ya cubre el prefijo (tests/seo.test.ts); esto es la segunda
    // vuelta, la que viaja en la respuesta.
    const page = code(src("app", "(public)", "asociate", "retomar", "[token]", "page.tsx"));
    expect(page).toContain("robots: { index: false, follow: false }");
  });

  it("el Referrer-Policy impide que el token viaje a otro sitio", () => {
    // Ahora la URL con token está en la barra de TODOS los que se asocian, no
    // sólo de quien abrió el email. Un enlace saliente con
    // `no-referrer-when-downgrade` (el default de varios navegadores) mandaría
    // el path entero —token incluido— en el `Referer`.
    const config = code(read("next.config.ts"));
    expect(config).toContain('{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }');
  });
});

// ── Paso 1 "Tu DNI" (spec 2026-08-27): la aritmética que protege el retome ──
//
// La renumeración 5→6 no tiene cobertura de comportamiento (no hay jsdom), así
// que se fijan los DOS literales que, mal corridos, romperían el retome o
// permitirían reenviar el paso de datos sobre una solicitud con preapproval.
describe("el wizard de 6 pasos", () => {
  it("declara 6 pasos y el DNI es el paso 1", () => {
    expect(wizard).toContain("const TOTAL_STEPS = 6;");
    expect(wizard).toContain('1: "Tu DNI",');
  });

  it("con la solicitud creada no se navega por debajo del paso 5", () => {
    expect(wizard).toContain("const step = resumeToken && navStep < 5 ? 5 : navStep;");
  });

  it("el retome entra en el paso 6 con la documentación completa, o en el 5", () => {
    // El tercer número load-bearing de la renumeración: un desliz acá degrada
    // en silencio (la guarda de navStep lo absorbe y el retome cae un paso antes).
    expect(wizard).toContain("? 6");
    expect(wizard).toContain(": 5;");
  });

  it("el paso de datos manda el DNI verificado como campo oculto", () => {
    // El campo visible se quitó en la renumeración: si este hidden muere, el
    // alta entera falla recién en el submit con "DNI inválido".
    const stepPersonal = code(src("app", "(public)", "asociate", "step-personal.tsx"));
    expect(stepPersonal).toContain('<input type="hidden" name="dni" value={draft.dni} />');
  });
});
