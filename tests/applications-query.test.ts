import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  APPLICATIONS_PAGE_SIZE, APPROVED_AFTER_EXPIRY_ACTION, applicationsWhere,
  fetchApprovedAfterExpiry, lateEntryNotice, makeApplicationQueries, parseApplicationFilters,
  parseApplicationsPage, showsNoDebitBadge, showsReentryBadge, subscriptionIsActive,
} from "@/lib/applications/query";

describe("parseApplicationFilters", () => {
  it("acepta estados válidos y descarta basura", () => {
    expect(parseApplicationFilters({ status: "pending_board" })).toEqual({ status: "pending_board" });
    expect(parseApplicationFilters({ status: "nope" })).toEqual({});
  });

  it("recorta la búsqueda y descarta la que queda vacía", () => {
    expect(parseApplicationFilters({ q: "  pérez  " })).toEqual({ q: "pérez" });
    expect(parseApplicationFilters({ q: "   " })).toEqual({});
    expect(parseApplicationFilters({})).toEqual({});
  });

  // Next entrega `string[]` cuando el parámetro viene repetido (`?q=a&q=b`), y
  // un array llegaría entero al `where` de Prisma. Se toma la primera ocurrencia,
  // igual que `parsePadronFilters`.
  it("toma el primer valor cuando el parámetro viene repetido", () => {
    expect(parseApplicationFilters({ q: ["301", "999"], status: ["started", "rejected"] }))
      .toEqual({ q: "301", status: "started" });
  });

  it("acepta los siete estados del enum", () => {
    for (const status of [
      "started", "pending_payment", "approved_pending_minute", "pending_board",
      "completed", "rejected", "expired",
    ]) {
      expect(parseApplicationFilters({ status })).toEqual({ status });
    }
  });
});

describe("applicationsWhere", () => {
  it("sin filtros no restringe nada", () => {
    expect(applicationsWhere({})).toEqual({});
  });

  it("q numérica busca por DNI con prefijo; q de texto por nombre", () => {
    expect(applicationsWhere({ q: "301" })).toEqual({ dni: { startsWith: "301" } });
    expect(applicationsWhere({ q: "pérez" })).toEqual({ fullName: { contains: "pérez" } });
  });

  it("el OR de búsqueda convive con el filtro de estado", () => {
    expect(applicationsWhere({ q: "301", status: "started" })).toEqual({
      dni: { startsWith: "301" }, status: "started",
    });
  });

  it("un DNI parcial con puntos no se toma como número", () => {
    // "30.111.222" no es \d+: cae en la rama de nombre y no devuelve nada, que es
    // preferible a mandar los puntos a un startsWith de DNI (que tampoco matchea).
    expect(applicationsWhere({ q: "30.111.222" })).toEqual({ fullName: { contains: "30.111.222" } });
  });
});

describe("parseApplicationsPage", () => {
  it("cae a 1 con basura, vacío o números no positivos", () => {
    expect(parseApplicationsPage({})).toBe(1);
    expect(parseApplicationsPage({ page: "abc" })).toBe(1);
    expect(parseApplicationsPage({ page: "0" })).toBe(1);
    expect(parseApplicationsPage({ page: "-3" })).toBe(1);
    expect(parseApplicationsPage({ page: "1.5" })).toBe(1);
  });

  it("honra una página válida, incluso repetida", () => {
    expect(parseApplicationsPage({ page: "3" })).toBe(3);
    expect(parseApplicationsPage({ page: ["2", "9"] })).toBe(2);
  });
});

describe("makeApplicationQueries.fetchPage", () => {
  type Args = Record<string, unknown>;
  function db(rows: unknown[], total: number) {
    const findMany = vi.fn<(args: Args) => Promise<unknown[]>>(async () => rows);
    const count = vi.fn<(args: Args) => Promise<number>>(async () => total);
    return { db: { application: { findMany, count } } as never, findMany, count };
  }

  it("pagina con el mismo where que cuenta, y ordena por fecha descendente", async () => {
    const { db: client, findMany, count } = db([], 120);
    await makeApplicationQueries(client).fetchPage({ status: "pending_board" }, 2);

    const [arg] = findMany.mock.calls[0];
    expect(arg.where).toEqual({ status: "pending_board" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.skip).toBe(APPLICATIONS_PAGE_SIZE);
    expect(arg.take).toBe(APPLICATIONS_PAGE_SIZE);
    expect(count.mock.calls[0][0].where).toEqual({ status: "pending_board" });
  });

  // La bandeja muestra el DNI y el nombre, pero NO tiene por qué traerse el
  // domicilio, el teléfono ni el hash del token de retome: `select` explícito.
  it("selecciona sólo las columnas que la tabla muestra", async () => {
    const { db: client, findMany } = db([], 0);
    await makeApplicationQueries(client).fetchPage({}, 1);

    const select = findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual([
      "createdAt", "dni", "emailVerifiedAt", "fullName", "id", "memberId",
      "requestedCategory", "status", "subscriptions", "wantsDebit",
    ]);
    expect(select).not.toHaveProperty("resumeTokenHash");
    expect(select).not.toHaveProperty("ip");
    // De la suscripción, SÓLO el estado: `payerEmail` es un dato personal que la
    // tabla no muestra (docs/08). Y una sola, la última: es para el badge.
    expect(select.subscriptions).toEqual({
      select: { status: true }, orderBy: { createdAt: "desc" }, take: 1,
    });
  });

  // El badge "Sin débito" no lo puede afirmar el asiento de auditoría solo: hace
  // falta el estado VIVO de la suscripción, y viene aplanado en la fila para que
  // ninguna pantalla tenga que repetir el `[0]`.
  it("aplana la última suscripción en `subscriptionStatus`", async () => {
    const { db: client } = db(
      [
        { id: 1, subscriptions: [{ status: "cancelled" }] },
        { id: 2, subscriptions: [] },
      ],
      2,
    );
    const res = await makeApplicationQueries(client).fetchPage({}, 1);
    expect(res.rows.map((r) => r.subscriptionStatus)).toEqual(["cancelled", null]);
    expect(res.rows[0]).not.toHaveProperty("subscriptions");
  });

  // Un `?page=99` tipeado a mano —o un filtro que achica la bandeja mientras se
  // navega— devolvería una tabla vacía sin explicar por qué. Se acota al final,
  // igual que el padrón (`fetchPadronPage`).
  it("acota una página más allá del final y nunca dice 'página 1 de 0'", async () => {
    const { db: client, findMany } = db([], 3);
    const empty = await makeApplicationQueries(client).fetchPage({}, 99);
    expect(empty.page).toBe(1);
    expect(empty.pageCount).toBe(1);
    expect(findMany.mock.calls[0][0].skip).toBe(0);

    const { db: c2 } = db([], 0);
    const none = await makeApplicationQueries(c2).fetchPage({}, 1);
    expect(none.pageCount).toBe(1);
    expect(none.total).toBe(0);
  });

  it("devuelve el total del filtro, no el de la página", async () => {
    const { db: client } = db([{ id: 1 }], 120);
    const res = await makeApplicationQueries(client).fetchPage({}, 1);
    expect(res.total).toBe(120);
    expect(res.pageCount).toBe(3);
    expect(res.pageSize).toBe(APPLICATIONS_PAGE_SIZE);
    expect(res.rows).toHaveLength(1);
  });
});

// El asiento le escribe `memberId` a TODA solicitud que completa (contrato de la
// Task 15: de ahí cuelga la verificación tardía de email), así que después del
// asiento ese campo NO distingue un alta de un reingreso. La bandeja llegó a
// mostrar "Alta completada · Reingreso" sobre una solicitud que acababa de CREAR
// al socio que decía estar readmitiendo — en la pantalla con la que la Comisión
// prepara el acta.
describe("showsReentryBadge", () => {
  it("una solicitud viva con ficha matcheada SÍ es un reingreso por venir (REG-25)", () => {
    for (const status of ["pending_payment", "approved_pending_minute", "pending_board"] as const) {
      expect(showsReentryBadge({ status, memberId: 99 })).toBe(true);
    }
  });

  it("sin ficha matcheada nunca", () => {
    expect(showsReentryBadge({ status: "pending_board", memberId: null })).toBe(false);
  });

  // Asentada, la bandeja no puede afirmarlo con esta fila: la señal real es el
  // Movement (`admission` vs `readmission`) y eso es una consulta por fila. El
  // detalle la hace; el listado se calla.
  it("una vez asentada, la bandeja no lo afirma", () => {
    expect(showsReentryBadge({ status: "completed", memberId: 306 })).toBe(false);
  });

  it("el rechazo conserva la señal: ahí `memberId` sigue siendo la ficha matcheada", () => {
    expect(showsReentryBadge({ status: "rejected", memberId: 99 })).toBe(true);
  });
});

// El aviso de la bandeja cuelga de este asiento y de nada más: el estado final
// de una solicitud revivida es `approved_pending_minute`, idéntico al de una
// aceptación normal con su débito en pie.
describe("fetchApprovedAfterExpiry", () => {
  it("marca sólo las que tienen el asiento, con UNA consulta para toda la página", async () => {
    const findMany = vi.fn(async () => [{ entityId: "7" }, { entityId: "9" }]);
    const db = { auditLog: { findMany } } as never;

    const revived = await fetchApprovedAfterExpiry(db, [7, 8, 9]);

    expect([...revived].sort()).toEqual([7, 9]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const [args] = findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(args).toMatchObject({
      where: {
        action: APPROVED_AFTER_EXPIRY_ACTION,
        entity: "application",
        // `entityId` es VARCHAR en `audit_log`: con números el IN no matchea.
        entityId: { in: ["7", "8", "9"] },
      },
    });
  });

  it("con una página vacía no consulta nada", async () => {
    const findMany = vi.fn(async () => []);
    const revived = await fetchApprovedAfterExpiry({ auditLog: { findMany } } as never, []);
    expect(revived.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

// ── El aviso del pago tardío ────────────────────────────────────────────────
// El asiento prueba UNA cosa: que el pago llegó cuando la solicitud ya estaba
// vencida. NO prueba que el débito haya quedado cancelado — `cancelPreapproval`
// es best-effort en el cron y su catch cuenta el error y sigue. Afirmar "quedó
// sin débito" sobre un preapproval que sigue vivo manda al operador a crear un
// SEGUNDO débito sobre el mismo vecino.
describe("lateEntryNotice", () => {
  it("sin asiento no hay aviso, esté como esté la suscripción", () => {
    for (const status of [null, "cancelled", "authorized", "paused"]) {
      expect(lateEntryNotice(false, status)).toBeNull();
    }
  });

  it("con la suscripción cancelada SÍ se puede afirmar que no hay débito", () => {
    expect(lateEntryNotice(true, "cancelled")).toBe("no_debit");
  });

  it("sin fila de suscripción tampoco hay débito que perder", () => {
    expect(lateEntryNotice(true, null)).toBe("no_debit");
    expect(lateEntryNotice(true, undefined)).toBe("no_debit");
  });

  // El caso del fix: la cancelación del cron falló, el preapproval sigue
  // cobrando y el aviso NO puede mandar a gestionar un débito nuevo.
  it("con la suscripción activa el aviso cambia: hay que verificar, no rehacer", () => {
    expect(lateEntryNotice(true, "authorized")).toBe("verify");
  });

  it("cualquier otro estado de MP también cae en verificar (lista blanca)", () => {
    for (const status of ["pending", "paused", "un_estado_nuevo_de_mp"]) {
      expect(lateEntryNotice(true, status)).toBe("verify");
    }
  });
});

describe("showsNoDebitBadge", () => {
  it("la bandeja afirma 'Sin débito' sólo con la suscripción cancelada", () => {
    expect(showsNoDebitBadge(true, "cancelled")).toBe(true);
    expect(showsNoDebitBadge(true, null)).toBe(true);
  });

  // Fix 2 de la re-revisión: el asiento es permanente, así que colgando el badge
  // de él la fila gritaba "Sin débito" para siempre — también después de que el
  // operador rehiciera la suscripción. Colgando del estado vivo, se apaga solo.
  it("una vez que la suscripción vuelve a estar activa, el badge se apaga", () => {
    expect(showsNoDebitBadge(true, "authorized")).toBe(false);
  });

  it("sin asiento nunca", () => {
    expect(showsNoDebitBadge(false, "cancelled")).toBe(false);
  });
});

describe("subscriptionIsActive", () => {
  it("sólo `authorized` está cobrando", () => {
    expect(subscriptionIsActive("authorized")).toBe(true);
    for (const status of ["pending", "paused", "cancelled", null, undefined]) {
      expect(subscriptionIsActive(status)).toBe(false);
    }
  });
});

// ── Los dos textos, en la pantalla ──────────────────────────────────────────
// El helper decide cuál de los dos avisos va; que cada rama diga lo que
// corresponde es cosa de la página, y es justamente lo que se rompió: el aviso
// AFIRMABA una cancelación que puede no haber ocurrido. Las dos pantallas son
// server components que leen prisma, así que se verifica la fuente (mismo
// criterio estructural que `ADMIN_NAV routes`), no un render.
describe("el aviso del pago tardío en pantalla", () => {
  const src = (...parts: string[]) =>
    readFileSync(path.resolve(import.meta.dirname, "..", "src", ...parts), "utf8");
  const detail = src("app", "admin", "solicitudes", "[id]", "page.tsx");
  const [beforeVerify, afterVerify] = detail.split('{revivedEntry && lateEntry === "verify" && (');
  const noDebitBlock = beforeVerify.split('{revivedEntry && lateEntry === "no_debit" && (')[1];
  const verifyBlock = afterVerify?.split("{pendingCancellation")[0];

  it("la rama de la suscripción cancelada es la ÚNICA que afirma que no hay débito", () => {
    expect(noDebitBlock).toBeDefined();
    expect(noDebitBlock).toContain("quedó sin débito automático");
    expect(noDebitBlock).toContain("volvé a");
    // Y nada más en la pantalla lo afirma.
    expect(detail.split("quedó sin débito automático")).toHaveLength(2);
  });

  it("la rama de la suscripción viva manda a verificar en MP, no a rehacer el débito", () => {
    expect(verifyBlock).toBeDefined();
    expect(verifyBlock).toContain("Verificá el preapproval en el panel de Mercado Pago");
    expect(verifyBlock).toContain("dos");
    // Lo que NO puede decir: que quedó sin débito, ni que la cancelación se hizo.
    expect(verifyBlock).not.toContain("quedó sin débito");
    expect(verifyBlock).not.toContain("se canceló la");
  });

  it("las dos ramas fechan el pago tardío", () => {
    for (const block of [noDebitBlock, verifyBlock]) {
      expect(block).toContain("formatDateAR(revivedEntry.createdAt)");
      expect(block).toContain("ya estaba vencida");
    }
  });

  // La bandeja no cuelga el badge del asiento pelado: lo cruza con el estado
  // vivo que ahora viaja en la fila.
  it("el badge de la bandeja se deriva del estado vivo de la suscripción", () => {
    const inbox = src("app", "admin", "solicitudes", "page.tsx");
    expect(inbox).toContain("showsNoDebitBadge(revived.has(app.id), app.subscriptionStatus)");
    expect(inbox).not.toContain("{revived.has(app.id) && (");
  });
});
