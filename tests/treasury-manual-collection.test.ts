// La hoja imprimible de gestión manual (spec 4C §5, decisión 2 del operador).
//
// Se renderiza de verdad (mismo recurso que `member-auto-debit`) porque lo que
// se afirma acá es sobre PAPEL: qué datos salen del sistema impresos y cuáles
// NO (Ley 25.326), a quién lista, y que la hoja no mienta sobre la fecha de los
// números que muestra.
//
// La cobertura sigue la partición del código, y son TRES piezas, no una:
//
//  - `ManualCollectionSheet` decide qué columnas salen impresas. Ahí van las
//    aserciones de privacidad de la tabla y las del contenido de cada fila.
//  - `GestionManualPage` decide a quién lista, quién puede verla y qué queda
//    asentado. Renderizarla entera es además la única forma de cubrir lo que
//    imprime el MARCO de la pantalla —encabezado, botones, miga—, que no está
//    en el componente de la hoja y también termina en el papel.
//  - `TesoreriaLayout` pone el encabezado del módulo y las pestañas por URL, que
//    son navegación y no van al papel de ninguna de las dos.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

type AdminDouble = { ok: boolean; actorId?: number; reason?: string; error?: string };

const mocks = vi.hoisted(() => ({
  admin: vi.fn(async (): Promise<AdminDouble> => ({ ok: true, actorId: 1 })),
  fetchDebtors: vi.fn(async (): Promise<unknown[]> => []),
  current: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: { current: mocks.current } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/tesoreria/deudores/gestion-manual" }));

import TesoreriaLayout from "@/app/admin/tesoreria/layout";
import GestionManualPage from "@/app/admin/tesoreria/deudores/gestion-manual/page";
import { ManualCollectionSheet } from "@/app/admin/tesoreria/deudores/gestion-manual/sheet";
import { audit } from "@/lib/audit";
import { fetchDebtors, type DebtorRow } from "@/lib/treasury/debtors";
import { feeValueReader } from "@/lib/treasury/fee-values";

vi.mock("@/lib/treasury/debtors", async (orig) => ({
  ...(await orig<typeof import("@/lib/treasury/debtors")>()),
  fetchDebtors: mocks.fetchDebtors,
}));

const PRINTED_AT = new Date("2026-09-15T14:00:00Z");

const debtor = (over: Partial<DebtorRow> = {}): DebtorRow => ({
  memberId: 1,
  memberNumber: 144,
  fullName: "Skardius, Ana",
  category: "active",
  status: "active",
  pendingCount: 4,
  debt: 24000,
  level: 4,
  lastPaidAt: new Date("2026-04-10T12:00:00Z"),
  phone: "297-4000000",
  emailUsable: false,
  address: "Pizarro, Francisco 1250",
  ...over,
});

const sheet = (rows: DebtorRow[], feeValue: { validFrom: Date } | null = { validFrom: new Date("2026-07-01T12:00:00Z") }) =>
  renderToStaticMarkup(createElement(ManualCollectionSheet, { rows, feeValue, printedAt: PRINTED_AT }));

/** Los encabezados de la tabla, en orden. Es la lista de lo que sale impreso:
 *  una columna nueva no puede aparecer sin que este test lo diga. */
// El espacio después de `th` no es cosmético: sin él, `<th` también entra en
// `<thead …>` y la primera "columna" se lleva media tabla adentro.
const columns = (html: string) => [...html.matchAll(/<th [^>]*>(.*?)<\/th>/g)].map((m) => m[1]);

// Las nueve columnas acordadas (A4 apaisado). El orden no es decorativo: primero
// a quién se llama y de qué categoría es, después por dónde, después qué se le
// dice, y al final el renglón en blanco donde se anota cómo salió.
const COLUMNS = [
  "N°", "Socio", "Categoría", "Domicilio", "Teléfono", "Cuotas", "Deuda", "Último pago", "Gestión",
];

// El ancho de cada columna, en orden. Va acá y no sólo en el componente porque
// con `table-fixed` el reparto ES el diseño de la hoja: sobre los 277 mm útiles
// del A4 apaisado, mover un porcentaje decide si "$ 138.000,00" entra en su
// celda o se derrama sobre la vecina. El test suma 100 para que una columna
// nueva no pueda entrar robándole ancho a otra en silencio.
const WIDTHS = ["5%", "19%", "6%", "17%", "10%", "6%", "11%", "10%", "16%"];
const widths = (html: string) =>
  [...html.matchAll(/<th [^>]*class="[^"]*w-\[(\d+)%\]/g)].map((m) => `${m[1]}%`);

describe("ManualCollectionSheet: qué sale impreso", () => {
  it("lleva lo que hace falta para llamar o tocar el timbre: número, nombre, domicilio, teléfono, cuotas y deuda", () => {
    const html = sheet([debtor()]);
    expect(html).toContain("144");
    expect(html).toContain("Skardius, Ana");
    // El domicilio es el canal del vecino sin teléfono ni casilla (enmienda del
    // operador, 24/08/2026): la visita es lo único que le queda.
    expect(html).toContain("Pizarro, Francisco 1250");
    expect(html).toContain("24.000");
    expect(html).toContain("297-4000000");
    // El último pago distingue al que se atrasó del que nunca pagó.
    expect(html).toContain("10/04/2026");
  });

  it("imprime exactamente las nueve columnas acordadas, en orden", () => {
    // Esta es LA guarda de privacidad de la hoja, y por eso mira la lista
    // completa y no cada columna por separado: agregar una décima —el DNI, la
    // casilla, cualquier cosa que se le ocurra a una pantalla futura— rompe acá.
    // Comparar contra strings de un fixture no serviría: `DebtorRow` no tiene
    // DNI ni email, así que esa aserción no podría fallar nunca.
    expect(columns(sheet([debtor()]))).toEqual(COLUMNS);
  });

  it("dice la categoría del socio: cambia cómo se le habla y si es cesanteable", () => {
    // Repuesta por el operador el 24/08/2026. Sale de `CATEGORY_LABELS`, que es
    // lo que nombra el Libro: la hoja no puede llamar distinto a lo que la ficha
    // llama "Adherente".
    expect(sheet([debtor({ category: "adherent" })])).toContain("Adherente");
    expect(sheet([debtor({ category: "active" })])).toContain("Activo");
  });

  it("reparte los 277 mm del A4 en los anchos acordados, y suman 100", () => {
    // Con `table-fixed` el navegador reparte exactamente esto. La categoría se
    // pagó con el ancho de la columna de gestión (22% → 16%) y NO con el del
    // nombre ni el del domicilio: un nombre partido en dos renglones cuesta más
    // que un renglón de anotación más corto (decisión del operador).
    const w = widths(sheet([debtor()]));
    expect(w).toEqual(WIDTHS);
    expect(w.reduce((acc, p) => acc + Number(p.slice(0, -1)), 0)).toBe(100);
  });

  it("NO imprime el DNI ni la casilla de correo del socio", () => {
    // La hoja se imprime y sale del sistema: queda sobre un escritorio. El DNI
    // no hace falta para llamar por teléfono (Ley 25.326, docs/08), y la casilla
    // de estas filas no existe o rebota — imprimirla invitaría a escribirle a un
    // buzón muerto.
    const html = sheet([debtor()]).toLowerCase();
    expect(html).not.toContain("dni");
    expect(html).not.toContain("email");
    expect(html).not.toContain("correo");
  });

  it("deja la columna de gestión en blanco: es el renglón que se escribe a mano", () => {
    // La gestión NO se registra en el sistema (decisión del operador, dos
    // veces): la hoja es la herramienta de la reunión, no un formulario.
    const html = sheet([debtor()]);
    expect(columns(html).at(-1)).toBe("Gestión");
    // La última celda de la fila viene vacía y con la línea que separa los datos
    // del espacio para escribir.
    expect(html).toMatch(/<td [^>]*border-l[^>]*><\/td>/);
    expect(html).toContain("para anotar a mano cómo salió la gestión");
  });

  it("se imprime en A4 apaisado: en vertical, nueve columnas no entran legibles", () => {
    // La regla vive en la hoja y no en `globals.css` porque `@page` no se puede
    // acotar por ruta: en la hoja global daría vuelta el papel de todo el panel.
    expect(sheet([debtor()])).toContain("size: A4 landscape");
  });

  it("dice la fecha de los números: una hoja guardada en una carpeta no puede mentir", () => {
    // El devengo suma una cuota por mes a cada fila de esta lista: sin la fecha,
    // la deuda de septiembre se sigue leyendo como la de hoy en noviembre.
    expect(sheet([debtor()])).toContain("15/09/2026");
  });

  it("cuenta los socios y suma la deuda de la hoja", () => {
    const html = sheet([debtor(), debtor({ memberId: 2, memberNumber: 7, fullName: "Uno", debt: 6000 })]);
    expect(html).toContain("2 socios para contactar");
    expect(html).toContain("30.000");
  });

  it("en singular no dice '1 socios'", () => {
    expect(sheet([debtor()])).toContain("1 socio para contactar");
  });

  it("sin valor de cuota vigente avisa y no inventa un monto", () => {
    const html = sheet([debtor({ debt: null })], null);
    expect(html).toContain("No hay un valor de cuota vigente");
    expect(html).not.toContain("en total");
  });

  it("el socio sin teléfono queda en la hoja con un guión, y con su domicilio no lleva aviso", () => {
    // Una celda vacía en papel se lee como un error de impresión. Y con
    // domicilio cargado NO es un socio sin canal: a ese se lo visita, que es
    // justamente para lo que se agregó la columna.
    const html = sheet([debtor({ phone: null })]);
    expect(html).toContain("—");
    expect(html).toContain("Pizarro, Francisco 1250");
    expect(html).not.toContain("sólo se lo puede buscar por la cartelera");
  });

  it("el socio sin teléfono NI domicilio queda en la hoja, con su aviso", () => {
    // Ese sí se queda sin ningún canal: sacarlo de la lista lo dejaría afuera en
    // silencio, así que queda y la hoja dice cuántos son.
    const html = sheet([debtor({ phone: null, address: null })]);
    expect(html).toContain("Skardius, Ana");
    expect(html).toContain("sólo se lo puede buscar por la cartelera");
  });

  it("sin nadie que contactar no renderiza un thead sin filas", () => {
    const html = sheet([]);
    expect(html).toContain("recordatorio les llega solo");
    expect(html).not.toContain("<thead");
    expect(html).not.toContain("Teléfono");
  });
});

describe("GestionManualPage: a quién lista y quién puede verla", () => {
  it("lista SÓLO a los deudores sin casilla utilizable", async () => {
    // El que tiene email ya recibe el recordatorio de vencimiento: repetirlo en
    // la hoja haría que la Comisión lo llame para decirle lo que ya le llegó.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 1 });
    mocks.current.mockResolvedValueOnce({ validFrom: new Date("2026-07-01T12:00:00Z") });
    mocks.fetchDebtors.mockResolvedValueOnce([
      debtor({ memberId: 1, fullName: "Sin casilla", emailUsable: false }),
      debtor({ memberId: 2, fullName: "Con casilla", emailUsable: true }),
    ]);
    const html = renderToStaticMarkup(await GestionManualPage());
    expect(html).toContain("Sin casilla");
    expect(html).not.toContain("Con casilla");
    expect(html).toContain("1 socio para contactar");
  });

  it("pide la lista SIN filtros: la hoja es para la Comisión y va completa", async () => {
    mocks.fetchDebtors.mockResolvedValueOnce([]);
    await GestionManualPage();
    expect(vi.mocked(fetchDebtors).mock.calls.at(-1)?.[1]).toEqual({});
  });

  it("valúa la deuda al valor de cuota vigente que leyó, no a uno inventado", async () => {
    const feeValue = { validFrom: new Date("2026-07-01T12:00:00Z"), activeAmount: 6000, sharedAmount: 3000 };
    mocks.current.mockResolvedValueOnce(feeValue);
    mocks.fetchDebtors.mockResolvedValueOnce([]);
    await GestionManualPage();
    expect(vi.mocked(feeValueReader.current)).toHaveBeenCalled();
    expect(vi.mocked(fetchDebtors).mock.calls.at(-1)?.[2]).toBe(feeValue);
  });

  it("la ruta se autoriza sola: sin permisos vivos no se arma ninguna hoja", async () => {
    // El layout mira el token, que puede estar hasta 8 h desactualizado tras una
    // degradación. Acá hay teléfonos, domicilios y deudas de vecinos reales.
    mocks.admin.mockResolvedValueOnce({ ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." });
    mocks.fetchDebtors.mockClear();
    vi.mocked(audit).mockClear();
    const html = renderToStaticMarkup(await GestionManualPage());
    expect(html).toContain("Necesitás permisos de administrador.");
    expect(mocks.fetchDebtors).not.toHaveBeenCalled();
    // Nada salió del sistema, así que no hay nada que asentar.
    expect(audit).not.toHaveBeenCalled();
  });

  it("deja asiento de que la lista salió: quién, desde dónde y cuántas filas", async () => {
    // Una lista de datos personales que se imprime no tiene ningún control de
    // acceso después (Ley 25.326). Mismo criterio que `padron-export`, que
    // audita por exactamente el mismo motivo.
    vi.mocked(audit).mockClear();
    mocks.fetchDebtors.mockResolvedValueOnce([debtor(), debtor({ memberId: 2, fullName: "Otro, Juan" })]);
    await GestionManualPage();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, action: "manual_collection_sheet", detail: { rows: 2 }, ip: "10.0.0.7" }),
    );
  });

  it("el asiento no lleva NINGÚN dato del vecino: sólo metadatos", async () => {
    // El asiento es la prueba de que la lista salió, no una segunda copia de la
    // lista: duplicar nombres, teléfonos y domicilios en `audit_log` sería
    // agrandar el problema que el asiento existe para poder rastrear.
    vi.mocked(audit).mockClear();
    mocks.fetchDebtors.mockResolvedValueOnce([debtor()]);
    await GestionManualPage();
    const entry = JSON.stringify(vi.mocked(audit).mock.calls.at(-1)?.[0]);
    expect(entry).not.toContain("Skardius");
    expect(entry).not.toContain("297-4000000");
    expect(entry).not.toContain("Pizarro");
  });

  it("los controles de pantalla no se imprimen: en papel no hay dónde apretar", async () => {
    mocks.fetchDebtors.mockResolvedValueOnce([debtor()]);
    const html = renderToStaticMarkup(await GestionManualPage());
    // "Volver a Deudores" e "Imprimir" viven en un contenedor print:hidden…
    expect(html).toMatch(/print:hidden[\s\S]*Volver a Deudores/);
    // …y la miga es navegación, que `PageHeader` oculta para toda la pantalla
    // del panel que alguien mande a la impresora.
    expect(html).toMatch(/aria-label="Ruta de navegación" class="[^"]*print:hidden/);
  });
});

describe("TesoreriaLayout: el marco no llega al papel", () => {
  it("el encabezado del módulo y las pestañas no se imprimen", () => {
    // Es la única pantalla imprimible del panel que vive bajo un layout con
    // pestañas: sin esto la hoja arranca con "Tesorería" y una fila de siete
    // links antes del título real.
    const html = renderToStaticMarkup(
      createElement(TesoreriaLayout, null, createElement("p", null, "CONTENIDO")),
    );
    expect(html).toContain("Secciones de tesorería");
    // El contenedor print:hidden se abre antes del encabezado y se cierra justo
    // antes de los hijos: nada del marco queda fuera de él.
    expect(html).toMatch(/print:hidden[\s\S]*>Tesorería<[\s\S]*<\/nav><\/div><p>CONTENIDO/);
  });
});
