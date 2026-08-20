import { describe, expect, it } from "vitest";
import { syncFormResetToState } from "@/components/admin/use-form-reset-sync";

// El proyecto corre los tests en entorno node (sin jsdom): armamos controles
// falsos con un matcher de selectores mínimo. Alcanza porque el hook solo usa
// `querySelectorAll` y las propiedades `name`, `value` y `checked`, y deja el
// selector real bajo prueba: si dejara de nombrar a los checkboxes, no habría
// con qué re-tildarlos y estos casos fallarían.
type Control = { tag: "select" | "input"; type?: string; name: string; value: string; checked?: boolean };

function fakeRoot(controls: Control[]) {
  function matches(c: Control, selector: string): boolean {
    return selector.split(",").some((raw) => {
      const m = /^\s*([a-z]+)(?:\[type=([a-z]+)\])?\s*$/.exec(raw);
      if (!m) throw new Error(`selector no soportado por el fake: ${raw}`);
      return c.tag === m[1] && (m[2] === undefined || c.type === m[2]);
    });
  }
  return {
    querySelectorAll: (selector: string) => controls.filter((c) => matches(c, selector)),
  } as unknown as HTMLElement;
}

const checkbox = (name: string, checked: boolean, value = "on"): Control =>
  ({ tag: "input", type: "checkbox", name, value, checked });

describe("syncFormResetToState", () => {
  it("vuelve a tildar el checkbox que el reset de React destildó", () => {
    // Caso real: "Quitar la portada actual" tildado, la acción rechaza por slug
    // repetido y el reset lo apaga. Si nadie lo re-tilda, el operador corrige
    // la URL, guarda, y la portada queda puesta sin que nadie se lo diga.
    const el = checkbox("removeCover", false);
    syncFormResetToState(fakeRoot([el]), { removeCover: "on" });
    expect(el.checked).toBe(true);
  });

  it("destilda el checkbox que el estado dice apagado", () => {
    const el = checkbox("removeCover", true);
    syncFormResetToState(fakeRoot([el]), { removeCover: "" });
    expect(el.checked).toBe(false);
  });

  it("no toca un checkbox que no está en el estado", () => {
    const el = checkbox("otro", true);
    syncFormResetToState(fakeRoot([el]), { removeCover: "on" });
    expect(el.checked).toBe(true);
  });

  it("re-tilda un GRUPO de checkboxes con el mismo name desde una lista CSV", () => {
    // Caso real: el calendario de salones manda los días como varios inputs
    // `weekdays`. La action rechaza por solapamiento, el reset los apaga a
    // todos, y sin esto el operador tiene que volver a tildarlos uno por uno.
    const dias = [1, 2, 3, 4, 5].map((d) => checkbox("weekdays", false, String(d)));
    syncFormResetToState(fakeRoot(dias), { weekdays: "2,4" });
    expect(dias.map((d) => d.checked)).toEqual([false, true, false, true, false]);
  });

  it("destilda el día que salió de la lista CSV", () => {
    const dias = [2, 4].map((d) => checkbox("weekdays", true, String(d)));
    syncFormResetToState(fakeRoot(dias), { weekdays: "4" });
    expect(dias.map((d) => d.checked)).toEqual([false, true]);
  });

  it("una lista CSV vacía deja todo el grupo destildado", () => {
    const dias = [1, 2].map((d) => checkbox("weekdays", true, String(d)));
    syncFormResetToState(fakeRoot(dias), { weekdays: "" });
    expect(dias.map((d) => d.checked)).toEqual([false, false]);
  });

  // Los tres casos que siguen fijan la SEMÁNTICA de la lista CSV: pertenencia
  // por token exacto, no por substring. Con values de un solo carácter las dos
  // reglas dan lo mismo, así que sin valores donde uno es prefijo del otro el
  // test pasaría igual con `wanted.includes(el.value)` — y este hook lo comparten
  // noticias, actas y el modo carga del padrón, así que la regla tiene que
  // quedar clavada acá y no en un comentario.
  it("un value que es PREFIJO de otro no se cuela: estado '1' no tilda el value '12'", () => {
    const uno = checkbox("grupo", false, "1");
    const doce = checkbox("grupo", true, "12");
    syncFormResetToState(fakeRoot([uno, doce]), { grupo: "1" });
    expect(uno.checked).toBe(true);
    expect(doce.checked).toBe(false);
  });

  it("y al revés: estado '12' no tilda el value '1'", () => {
    // Este es el caso que mata la pertenencia por substring: "12".includes("1")
    // es true, pero "1" no está en la lista ["12"].
    const uno = checkbox("grupo", true, "1");
    const doce = checkbox("grupo", false, "12");
    syncFormResetToState(fakeRoot([uno, doce]), { grupo: "12" });
    expect(uno.checked).toBe(false);
    expect(doce.checked).toBe(true);
  });

  it("con varios tokens tampoco: '12,3' tilda 12 y 3, no 1 ni 2", () => {
    const items = ["1", "2", "3", "12"].map((v) => checkbox("grupo", true, v));
    syncFormResetToState(fakeRoot(items), { grupo: "12,3" });
    expect(items.map((i) => i.checked)).toEqual([false, false, true, true]);
  });

  it("LÍMITE conocido: un value con coma adentro no se puede representar y queda destildado", () => {
    // La coma es el separador, así que "a,b" se lee como los tokens "a" y "b" y
    // nunca como el value literal "a,b". No es un bug latente: hoy todos los
    // values son "on" o un dígito del 1 al 7. Queda escrito acá para que, si
    // algún formulario futuro quiere values libres, el test lo frene en vez de
    // que aparezca como un checkbox que no se re-tilda nunca.
    const raro = checkbox("grupo", true, "a,b");
    syncFormResetToState(fakeRoot([raro]), { grupo: "a,b" });
    expect(raro.checked).toBe(false);
  });

  it("sigue re-afirmando selects y radios", () => {
    const select: Control = { tag: "select", name: "category", value: "active" };
    const si: Control = { tag: "input", type: "radio", name: "kind", value: "board", checked: false };
    const no: Control = { tag: "input", type: "radio", name: "kind", value: "assembly", checked: true };
    syncFormResetToState(fakeRoot([select, si, no]), { category: "collaborator", kind: "board" });
    expect(select.value).toBe("collaborator");
    expect(si.checked).toBe(true);
    expect(no.checked).toBe(false);
  });
});
