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
