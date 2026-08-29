import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BackupPanel, CronsPanel, FailedNoticesPanel, HealthVerdict, MoneyPanel, MpPanel, PendingReceiptsPanel,
  type ResendRenderer,
} from "@/components/admin/health-panels";
import { CRON_EXPECTATION, type CronHealth, type CronState, type HealthSnapshot, type PendingReceiptState } from "@/lib/admin/health";
import { healthAlerts } from "@/lib/admin/health-alerts";
import type { BackupHealth } from "@/lib/admin/health-backup";
import { alertHrefFor, tabForAlertHref } from "@/lib/admin/salud-tabs";
import { CRON_JOB_LIST } from "@/lib/cron/auth";

// La pantalla de salud no se puede abrir en un navegador desde acá (no hay
// sesión), así que lo que se verifica es lo que decide si el operador la va a
// mirar: el VEREDICTO —qué grita y qué no— y el marcado de los seis paneles.
//
// El modo de falla que estos tests existen para impedir es uno solo: que la
// pantalla nazca en rojo por cosas que no requieren acción. Un cron que decidió
// no actuar está sano; un socio que se pasó a efectivo no es una avería.

const NOW = new Date("2026-08-25T15:00:00Z");
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

function run(over: Partial<NonNullable<CronHealth["lastRun"]>> = {}): NonNullable<CronHealth["lastRun"]> {
  return {
    id: "1",
    startedAt: new Date("2026-08-25T06:00:00Z"),
    finishedAt: new Date("2026-08-25T06:00:12Z"),
    ok: true,
    error: null,
    summary: null,
    ...over,
  };
}

/** Los cinco crons sanos: cada uno con una corrida reciente y limpia. */
function healthyCrons(): CronHealth[] {
  return CRON_JOB_LIST.map((job) => ({
    job,
    label: CRON_EXPECTATION[job].label,
    everyHours: CRON_EXPECTATION[job].everyHours,
    state: "ok" as CronState,
    lastRun: run(),
  }));
}

function snapshot(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    now: NOW,
    crons: healthyCrons(),
    mp: { lastEventAt: new Date("2026-08-24T12:00:00Z"), unprocessedWithError: 0, signatureRejections: 0, legacyIpns: 0 },
    money: {
      inboxOpen: 0, inboxTotal: 31,
      debits: { stoppedForActive: 0, aliveForWithdrawn: 0 },
      mismatches: [], mismatchesEver: 0,
    },
    failed: [], failedEver: 0,
    receipts: { rows: [], total: 0 },
    // Dos superadmins que pueden entrar es el sistema sano: con uno solo,
    // perder esa cuenta obliga a entrar por SQL (ver el describe de más abajo).
    signInReadySuperadmins: 2,
    // §7.3: nadie a mitad del canje del enlace de invitación. La pantalla lo
    // consume en la tarea 5; acá el fixture sólo declara el sistema sano.
    stuckAccess: [],
    ...over,
  };
}

const FRESH: BackupHealth = { state: "fresh", lastOkAt: new Date("2026-08-25T07:00:00Z") };

function withCron(job: (typeof CRON_JOB_LIST)[number], state: CronState, lastRun: CronHealth["lastRun"]) {
  return snapshot({
    crons: healthyCrons().map((c) => (c.job === job ? { ...c, state, lastRun } : c)),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("healthAlerts: el martes que todo anda", () => {
  it("no dice absolutamente nada", () => {
    // Éste es el caso más frecuente y el que decide si la pantalla se sigue
    // abriendo. Una sola alerta de más acá y el tablero deja de servir.
    const alerts = healthAlerts(snapshot(), FRESH);
    expect(alerts.act).toEqual([]);
    expect(alerts.review).toEqual([]);
  });

  it("una bandeja con trabajo no es una avería", () => {
    const alerts = healthAlerts(snapshot({
      money: { ...snapshot().money, inboxOpen: 4 },
    }), FRESH);
    expect(alerts.act).toEqual([]);
    expect(alerts.review.map((a) => a.key)).toEqual(["inbox"]);
    expect(alerts.review[0].label).toContain("4 cobros");
  });
});

describe("healthAlerts: un cron que no actuó está sano", () => {
  it("el devengo sin correr hace un mes no aparece", () => {
    // `CRON_EXPECTATION` mide al devengo con vara mensual: 30 días es `ok` y no
    // hay nada que decir.
    const alerts = healthAlerts(withCron("accrual", "ok", run({
      startedAt: new Date("2026-08-01T06:00:00Z"), finishedAt: new Date("2026-08-01T06:01:00Z"),
    })), FRESH);
    expect(alerts.act).toEqual([]);
    expect(alerts.review).toEqual([]);
  });

  it("stale y never van a 'para revisar', nunca a 'para atender'", () => {
    for (const state of ["stale", "never"] as const) {
      const alerts = healthAlerts(
        withCron("accrual", state, state === "never" ? null : run({ startedAt: new Date("2026-06-01T06:00:00Z") })),
        FRESH,
      );
      expect(alerts.act, state).toEqual([]);
      expect(alerts.review.map((a) => a.key), state).toEqual(["cron-accrual"]);
    }
  });

  it("al resumen se le dice 'sin novedades', nunca 'atrasado'", () => {
    // Con los débitos alrededor del 10, la ventana del 12 al 31 puede ser
    // silencio perfectamente sano: ~20 días por encima del umbral de 14.
    const alerts = healthAlerts(
      withCron("digest", "stale", run({ startedAt: new Date("2026-08-05T06:00:00Z") })),
      FRESH,
    );
    expect(alerts.act).toEqual([]);
    expect(alerts.review[0].label).toContain("sin novedades");
    expect(alerts.review[0].label).toContain("20 días");
    expect(alerts.review[0].label).not.toContain("atrasad");
  });

  it("terminar con errores y quedar colgada SÍ son para atender, y se distinguen", () => {
    const errors = healthAlerts(withCron("reconcile", "errors", run({ ok: false, error: "EAUTH" })), FRESH);
    expect(errors.act.map((a) => a.key)).toEqual(["cron-reconcile"]);
    expect(errors.act[0].label).toContain("errores");

    const hung = healthAlerts(withCron("reconcile", "hung", run({ finishedAt: null })), FRESH);
    expect(hung.act[0].label).toContain("nunca cerró");
  });
});

describe("healthAlerts: backup", () => {
  it("sin rastro es para atender; atrasado, sin configurar y sin permisos son para revisar", () => {
    const cases: Array<[BackupHealth, "act" | "review"]> = [
      [{ state: "missing", lastOkAt: null }, "act"],
      [{ state: "stale", lastOkAt: new Date("2026-08-20T07:00:00Z") }, "review"],
      [{ state: "unreadable", lastOkAt: null }, "review"],
      [{ state: "unconfigured", lastOkAt: null }, "review"],
    ];
    for (const [backup, bucket] of cases) {
      const alerts = healthAlerts(snapshot(), backup);
      expect(alerts[bucket].map((a) => a.key), backup.state).toEqual(["backup"]);
      expect(alerts[bucket === "act" ? "review" : "act"], backup.state).toEqual([]);
    }
  });

  it("un backup fresco no dice nada", () => {
    expect(healthAlerts(snapshot(), FRESH).review).toEqual([]);
  });
});

describe("healthAlerts: los dos contadores de débito no son lo mismo", () => {
  it("el socio vigente que dejó de pagar por débito es 'para revisar'", () => {
    // Falso positivo conocido y sin acción que lo apague: el que se pasó a
    // efectivo y canceló su débito cae acá. Pintarlo de rojo sería una alarma
    // permanente por algo que está bien.
    const alerts = healthAlerts(snapshot({
      money: { ...snapshot().money, debits: { stoppedForActive: 3, aliveForWithdrawn: 0 } },
    }), FRESH);
    expect(alerts.act).toEqual([]);
    expect(alerts.review.map((a) => a.key)).toEqual(["debits-stopped"]);
  });

  it("el socio dado de baja con el débito vivo es 'para atender' y manda a Suscripciones", () => {
    const alerts = healthAlerts(snapshot({
      money: { ...snapshot().money, debits: { stoppedForActive: 0, aliveForWithdrawn: 1 } },
    }), FRESH);
    expect(alerts.act).toHaveLength(1);
    expect(alerts.act[0].href).toBe("/admin/tesoreria/suscripciones");
    expect(alerts.act[0].label).toContain("1 socio dado de baja");
  });
});

// Hallazgo del primer día en producción: el panel decía "51 avisos se
// rechazaron por firma inválida" y 49 eran IPN legacy, o sea MP funcionando
// normal. Se cuentan aparte y las legacy NO alertan: no hay nada que hacer con
// ellas, y una alarma que ninguna acción apaga enseña a ignorar el tablero.
describe("healthAlerts: las IPN legacy son dato, no alarma", () => {
  it("cientos de IPN legacy no emiten ni act ni review", () => {
    const alerts = healthAlerts(snapshot({
      mp: { lastEventAt: NOW, unprocessedWithError: 0, signatureRejections: 0, legacyIpns: 490 },
    }), FRESH);
    expect(alerts.act).toEqual([]);
    expect(alerts.review).toEqual([]);
  });

  it("pero una firma inválida real sigue apareciendo en review", () => {
    const alerts = healthAlerts(snapshot({
      mp: { lastEventAt: NOW, unprocessedWithError: 0, signatureRejections: 1, legacyIpns: 490 },
    }), FRESH);
    expect(alerts.act).toEqual([]);
    expect(alerts.review.map((a) => a.key)).toEqual(["mp-signature"]);
  });
});

describe("healthAlerts: los mismatches son historia, no una alarma", () => {
  it("no generan ninguna alerta por más que haya cientos", () => {
    const alerts = healthAlerts(snapshot({
      money: { ...snapshot().money, mismatchesEver: 300 },
    }), FRESH);
    expect(alerts.act).toEqual([]);
    expect(alerts.review).toEqual([]);
  });
});

// La garantía de "nunca cero superadmins activos" es INTRA-MÓDULO: la cuentan
// `revokeRole` y `setUserActive` después de escribir y dentro de la
// transacción. La baja de un socio apaga `User.active` de la cuenta vinculada
// sin mirar roles y desde una pantalla que sólo exige admin, así que con la
// única superadmin siendo además socia el sistema puede quedar en cero sin que
// ninguna guarda se entere. Mientras esa guarda de raíz no exista, el aviso es
// esta alerta.
describe("healthAlerts: quedarse con un solo superadmin que pueda entrar", () => {
  it("con dos o más no dice absolutamente nada", () => {
    const alerts = healthAlerts(snapshot({ signInReadySuperadmins: 2 }), FRESH);
    expect(alerts.act).toEqual([]);
    expect(alerts.review).toEqual([]);
  });

  it("con uno solo es 'para atender', y el texto nombra la salida que lo apaga", () => {
    // Es `act` y no `review` porque cumple los dos términos de la frontera: el
    // estado es una rotura real —perder esa cuenta obliga a entrar por SQL— y
    // hay una acción concreta que lo apaga. Una alerta que sólo dijera el
    // problema sería de las que enseñan a ignorar el tablero.
    const alerts = healthAlerts(snapshot({ signInReadySuperadmins: 1 }), FRESH);
    expect(alerts.act.map((a) => a.key)).toEqual(["superadmins"]);
    expect(alerts.act[0].href).toBe("/admin/usuarios");
    expect(alerts.act[0].label).toContain("Otorgale el rol de superadmin a una segunda cuenta");
    expect(alerts.review).toEqual([]);
  });

  // El caso medido en la verificación en vivo: se creó una segunda cuenta de
  // gestión, se le revocó la invitación y se le otorgó superadmin. Está activa,
  // no tiene contraseña y hoy NO entra, así que el conteo llega acá como 1 y la
  // alerta sigue encendida (el camino entero, de la fila de la base a este
  // renglón, está en admin-health.test.ts). Lo que se verifica acá es que el
  // TEXTO no mienta: dice "que pueda entrar" y no "activo", y explica por qué
  // esa segunda cuenta no lo apagó. El paréntesis nombra las DOS condiciones
  // del criterio (nunca entró Y nunca creó contraseña) porque quedarse con la
  // contraseña sola sería falso para las cuentas anteriores al 19/08/2026, que
  // tienen `passwordChangedAt: null` y entran igual.
  it("el texto dice que una cuenta que nunca entró ni creó contraseña no cuenta", () => {
    const alerts = healthAlerts(snapshot({ signInReadySuperadmins: 1 }), FRESH);
    expect(alerts.act[0].label).toContain("Queda un solo superadmin que pueda entrar");
    expect(alerts.act[0].label).toContain("una que nunca inició sesión ni creó su contraseña no cuenta");
    expect(alerts.act[0].label).not.toContain("superadmin activo");
  });

  it("en cero no ofrece una salida por pantalla que no existe", () => {
    // Sin ningún superadmin que pueda entrar nadie puede ni abrir
    // /admin/usuarios: el correo y la base es lo único cierto que queda.
    const alerts = healthAlerts(snapshot({ signInReadySuperadmins: 0 }), FRESH);
    expect(alerts.act.map((a) => a.key)).toEqual(["superadmins"]);
    expect(alerts.act[0].label).toContain("desde la base");
    expect(alerts.act[0].label).not.toContain("Otorgale");
  });

  it("el veredicto lo pinta en rojo y lo enlaza a Usuarios", () => {
    const html = render(createElement(HealthVerdict, {
      alerts: healthAlerts(snapshot({ signInReadySuperadmins: 1 }), FRESH), now: NOW,
    }));
    expect(html).toContain("Hay una cosa para atender");
    expect(html).toContain("text-destructive");
    expect(html).toContain('href="/admin/usuarios"');
  });
});

describe("healthAlerts: avisos y recibos", () => {
  it("un aviso que no salió es para atender", () => {
    const alerts = healthAlerts(snapshot({
      failed: [{
        id: "1", sentAt: NOW, type: "receipt", error: "EAUTH", payloadSummary: "recibo 2026-00042",
        memberId: 3, memberName: "Pérez", applicationId: null, receiptNumber: "2026-00042",
      }],
      failedEver: 9,
    }), FRESH);
    expect(alerts.act.map((a) => a.key)).toEqual(["failed-notices"]);
    expect(alerts.act[0].label).toContain("1 aviso por email no salió");
  });

  it("el recibo que falló es para atender; el que nunca se intentó, para revisar", () => {
    const rows = (["failed", "not_attempted", "sent", "no_email"] as PendingReceiptState[]).map((state, i) => ({
      id: i + 1, number: `2026-0000${i + 1}`, issuedAt: NOW, state,
      memberId: 1, applicationId: null, memberName: "Pérez", error: state === "failed" ? "EAUTH" : null,
    }));
    const alerts = healthAlerts(snapshot({ receipts: { rows, total: 4 } }), FRESH);
    expect(alerts.act.map((a) => a.key)).toEqual(["receipts-failed"]);
    expect(alerts.review.map((a) => a.key)).toEqual(["receipts-not-attempted"]);
    // `sent` y `no_email` no producen alerta: no hay nada que nadie pueda hacer.
    expect(alerts.act).toHaveLength(1);
    expect(alerts.review).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("HealthVerdict", () => {
  it("con todo sano abre en verde y en una línea", () => {
    const html = render(createElement(HealthVerdict, { alerts: { act: [], review: [] }, now: NOW }));
    expect(html).toContain("Todo en orden");
    expect(html).toContain("text-success");
    expect(html).not.toContain("text-destructive");
  });

  it("con algo para revisar y nada roto NO usa el rojo", () => {
    const html = render(createElement(HealthVerdict, {
      alerts: { act: [], review: [{ key: "inbox", label: "4 cobros esperan una decisión.", href: "/x" }] },
      now: NOW,
    }));
    expect(html).toContain("No hay nada roto");
    expect(html).toContain("Para revisar");
    expect(html).not.toContain("text-destructive");
  });

  it("con algo para atender cuenta cuántas cosas son y las enlaza", () => {
    const html = render(createElement(HealthVerdict, {
      alerts: {
        act: [
          { key: "a", label: "La conciliación terminó con errores.", href: "#tareas" },
          { key: "b", label: "2 avisos por email no salieron.", href: "#avisos" },
        ],
        review: [{ key: "c", label: "La bandeja tiene 4 cobros.", href: "/admin/tesoreria/sin-conciliar" }],
      },
      now: NOW,
    }));
    expect(html).toContain("Hay 2 cosas para atender");
    expect(html).toContain("text-destructive");
    // El veredicto traduce el ancla pelada a `?tab=X#ancla` (alertHrefFor):
    // activa la pestaña del panel y scrollea hasta él.
    expect(html).toContain('href="?tab=tareas#tareas"');
    // Las rutas absolutas NO se traducen: navegan solas.
    expect(html).toContain('href="/admin/tesoreria/sin-conciliar"');
    // Lo que hay para revisar sigue estando, pero abajo y sin gritar.
    expect(html).toContain("Para revisar");
  });

  it("no se anuncia como una alerta al lector de pantalla", () => {
    // Es el estado de la pantalla al abrirla, no la respuesta a una acción: un
    // role="alert" interrumpiría al lector en cada recarga.
    const html = render(createElement(HealthVerdict, { alerts: { act: [], review: [] }, now: NOW }));
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });
});

describe("las anclas del veredicto existen en los paneles", () => {
  it("cada `#ancla` que puede emitir healthAlerts tiene su id en la pantalla", () => {
    // El veredicto sólo sirve si al hacer clic se llega a algún lado. Sin este
    // test, renombrar un `id` deja links muertos y nadie se entera.
    const rows = (["failed", "not_attempted"] as PendingReceiptState[]).map((state, i) => ({
      id: i + 1, number: `2026-0000${i + 1}`, issuedAt: NOW, state,
      memberId: 1, applicationId: null, memberName: "Pérez", error: null,
    }));
    const broken = snapshot({
      crons: healthyCrons().map((c) => ({ ...c, state: "errors" as CronState, lastRun: run({ ok: false, error: "EAUTH" }) })),
      mp: { lastEventAt: null, unprocessedWithError: 2, signatureRejections: 3, legacyIpns: 49 },
      money: {
        inboxOpen: 4, inboxTotal: 40,
        debits: { stoppedForActive: 2, aliveForWithdrawn: 1 },
        mismatches: [], mismatchesEver: 0,
      },
      failed: [{
        id: "1", sentAt: NOW, type: "receipt", error: "EAUTH", payloadSummary: "recibo 2026-00042",
        memberId: 3, memberName: "Pérez", applicationId: null, receiptNumber: "2026-00042",
      }],
      failedEver: 1,
      receipts: { rows, total: 2 },
      // También el destino de la alerta nueva entra en el barrido de abajo: es
      // una ruta absoluta y tiene que seguir siéndolo.
      signInReadySuperadmins: 1,
    });
    const alerts = healthAlerts(broken, { state: "missing", lastOkAt: null });
    const anchors = [...alerts.act, ...alerts.review]
      .map((a) => a.href)
      .filter((h) => h.startsWith("#"))
      .map((h) => h.slice(1));
    expect(anchors.length).toBeGreaterThan(0);

    // Con las pestañas, "seguir el link" es activar la solapa + scrollear al
    // ancla. Cada href que el veredicto puede emitir tiene que mapear a una
    // pestaña (las anclas) o ser una ruta absoluta que navega sola.
    for (const alert of [...alerts.act, ...alerts.review]) {
      if (alert.href.startsWith("#")) {
        expect(tabForAlertHref(alert.href), alert.href).not.toBeNull();
        expect(alertHrefFor(alert.href), alert.href).toMatch(/^\?tab=[a-z]+#[a-z-]+$/);
      } else {
        expect(alert.href, alert.href).toMatch(/^\/admin\//);
      }
    }

    const screen = [
      render(createElement(CronsPanel, { crons: broken.crons, now: NOW })),
      render(createElement(BackupPanel, { backup: { state: "missing", lastOkAt: null }, now: NOW })),
      render(createElement(MpPanel, { mp: broken.mp, now: NOW })),
      render(createElement(MoneyPanel, { money: broken.money })),
      render(createElement(FailedNoticesPanel, { failed: broken.failed, failedEver: 1, renderResend: stubResend })),
      render(createElement(PendingReceiptsPanel, { receipts: broken.receipts, renderResend: stubResend })),
    ].join("");
    for (const anchor of new Set(anchors)) {
      expect(screen, anchor).toContain(`id="${anchor}"`);
    }
  });

  it("los seis paneles se titulan con un h2 real", () => {
    // La pantalla es larga: quien la recorre por encabezados tiene que encontrar
    // los seis bloques, incluidos los dos que son tarjetas.
    const screen = [
      render(createElement(CronsPanel, { crons: healthyCrons(), now: NOW })),
      render(createElement(BackupPanel, { backup: FRESH, now: NOW })),
      render(createElement(MpPanel, { mp: snapshot().mp, now: NOW })),
      render(createElement(MoneyPanel, { money: snapshot().money })),
      render(createElement(FailedNoticesPanel, { failed: [], failedEver: 0, renderResend: stubResend })),
      render(createElement(PendingReceiptsPanel, { receipts: { rows: [], total: 0 }, renderResend: stubResend })),
    ].join("");
    expect(screen.match(/<h2\b/g) ?? []).toHaveLength(6);
  });
});

describe("CronsPanel", () => {
  it("dice la frecuencia esperada de cada tarea, que es lo que evita leer un mes como atraso", () => {
    const html = render(createElement(CronsPanel, { crons: healthyCrons(), now: NOW }));
    expect(html).toContain("una vez por mes");   // devengo y recordatorio
    expect(html).toContain("una vez por día");   // conciliación y solicitudes
    expect(html).toContain("cuando hay novedades"); // resumen
    expect(html).toContain("Al día");
  });

  it("una corrida sin cerrar se ve distinta de una que terminó mal", () => {
    const hung = render(createElement(CronsPanel, {
      crons: [{ ...healthyCrons()[0], state: "hung", lastRun: run({ finishedAt: null }) }], now: NOW,
    }));
    expect(hung).toContain("Quedó colgada");
    expect(hung).toContain("sin cerrar");

    const bad = render(createElement(CronsPanel, {
      crons: [{ ...healthyCrons()[0], state: "errors", lastRun: run({ ok: false, error: "EAUTH" }) }], now: NOW,
    }));
    expect(bad).toContain("Terminó con errores");
    expect(bad).toContain("EAUTH");
  });

  it("el summary se muestra como pares clave/valor sin asumir su forma", () => {
    const html = render(createElement(CronsPanel, {
      crons: [{ ...healthyCrons()[0], lastRun: run({ summary: { applied: 3, deferred: 0, errors: [] } }) }],
      now: NOW,
    }));
    expect(html).toContain("applied");
    expect(html).toContain("deferred");
    // Un arreglo vacío no se imprime como "[]" crudo.
    expect(html).not.toContain("[]");
  });

  it("un summary que no es un objeto no rompe la fila", () => {
    const html = render(createElement(CronsPanel, {
      crons: [{ ...healthyCrons()[0], lastRun: run({ summary: [1, 2, 3] }) }], now: NOW,
    }));
    expect(html).toContain("[1,2,3]");
  });

  it("un preapproval_id no se publica entero, ni dentro del texto de un error", () => {
    // Medido contra la base local: el `errors[]` del reconcile trae el mensaje
    // crudo de la API de Mercado Pago, que nombra el débito en claro. Se recorta
    // a los 8 primeros —la misma forma que usa Tesorería → Suscripciones— para
    // poder reconocerlo sin publicarlo.
    const id = "5eed0000000000000000000000000001";
    const html = render(createElement(CronsPanel, {
      crons: [{
        ...healthyCrons()[0],
        lastRun: run({ summary: { errors: [`sync: status=404 The preapproval with id ${id} does not exist`] } }),
      }],
      now: NOW,
    }));
    expect(html).not.toContain(id);
    expect(html).toContain("5eed0000…");
    // El resto del mensaje sobrevive: sin él el error no se puede diagnosticar.
    expect(html).toContain("status=404");
  });

  it("también recorta el id cuando viene en `error` y no en el summary", () => {
    const id = "5eed0000000000000000000000000001";
    const html = render(createElement(CronsPanel, {
      crons: [{
        ...healthyCrons()[0], state: "errors",
        lastRun: run({ ok: false, error: `preapproval ${id} roto` }),
      }],
      now: NOW,
    }));
    expect(html).not.toContain(id);
    expect(html).toContain("5eed0000…");
  });

  it("una tarea que nunca corrió no muestra fecha inventada", () => {
    const html = render(createElement(CronsPanel, {
      crons: [{ ...healthyCrons()[0], state: "never", lastRun: null }], now: NOW,
    }));
    expect(html).toContain("Nunca corrió");
  });
});

describe("BackupPanel", () => {
  it("sin configurar explica que falta la variable y no acusa un backup roto", () => {
    const html = render(createElement(BackupPanel, {
      backup: { state: "unconfigured", lastOkAt: null }, now: NOW,
    }));
    expect(html).toContain("Sin configurar");
    expect(html).toContain("BACKUP_DIR");
  });

  it("sin permisos culpa a los permisos del panel, no al backup", () => {
    const html = render(createElement(BackupPanel, {
      backup: { state: "unreadable", lastOkAt: null }, now: NOW,
    }));
    expect(html).toContain("permiso");
  });

  it("al día muestra cuándo fue el último éxito", () => {
    const html = render(createElement(BackupPanel, { backup: FRESH, now: NOW }));
    expect(html).toContain("Al día");
    expect(html).toContain("hace 8 horas");
  });
});

describe("MpPanel", () => {
  it("el silencio total se destaca; las dos ventanas se escriben, no se esconden", () => {
    const html = render(createElement(MpPanel, {
      mp: { lastEventAt: null, unprocessedWithError: 2, signatureRejections: 1, legacyIpns: 49 }, now: NOW,
    }));
    expect(html).toContain("Nunca llegó ningún aviso");
    expect(html).toContain("últimas 72 horas");
    expect(html).toContain("últimas 24 horas");
  });

  it("las IPN legacy se muestran como lo que son: formato viejo que se descarta a propósito", () => {
    const html = render(createElement(MpPanel, {
      mp: { lastEventAt: NOW, unprocessedWithError: 0, signatureRejections: 0, legacyIpns: 49 }, now: NOW,
    }));
    expect(html).toContain("49");
    expect(html).toContain("legítim");
    expect(html).toContain("formato viejo");
    // Y no se redacta como un rechazo: el renglón de firma es otro.
    expect(html).not.toContain("49</span> aviso se rechazó");
  });
});

describe("MoneyPanel", () => {
  const money = snapshot().money;

  it("los dos contadores de débito se nombran distinto: una cancelada no es una avería", () => {
    const html = render(createElement(MoneyPanel, {
      money: { ...money, debits: { stoppedForActive: 2, aliveForWithdrawn: 1 } },
    }));
    expect(html).toContain("dado de baja tiene");
    expect(html).toContain("el débito todavía vivo");
    expect(html).toContain("dejaron");
    // La etiqueta vieja contaba las canceladas y hacía subir la alarma al hacer
    // lo correcto: no puede volver.
    expect(html).not.toContain("suscripciones no activas");
  });

  it("la bandeja separa la cola de la historia", () => {
    const html = render(createElement(MoneyPanel, { money: { ...money, inboxOpen: 2, inboxTotal: 31 } }));
    expect(html).toContain("cobros esperan");
    expect(html).toContain("desde que existe");
  });

  it("en cero se apaga: sin link y sin instructivo de qué hacer", () => {
    // Un "0" enlazado con su "hacé esto" al lado es exactamente el ruido que
    // enseña a saltear el panel.
    const html = render(createElement(MoneyPanel, { money }));
    expect(html).toContain("Ningún cobro de Mercado Pago");
    expect(html).toContain("Ningún socio dado de baja");
    expect(html).toContain("siguen cobrando");
    expect(html).not.toContain("Cancelar el débito");
    expect(html).not.toContain('href="/admin/tesoreria/suscripciones"');
    // El acumulado histórico de la bandeja sí sigue estando: es contexto.
    expect(html).toContain("desde que existe");
  });

  it("sin divergencias no se renderiza una tabla vacía", () => {
    const html = render(createElement(MoneyPanel, { money }));
    expect(html).not.toContain("<thead");
    expect(html).toContain("Ningún link cobró");
  });

  it("una diferencia a favor y una en contra se distinguen", () => {
    const base = {
      id: "1", createdAt: NOW, paymentId: 5, memberId: 3, memberName: "Pérez", n: 1,
    };
    const html = render(createElement(MoneyPanel, {
      money: {
        ...money,
        mismatches: [
          { ...base, expected: 10_000, amount: 8_000 },
          { ...base, id: "2", expected: 10_000, amount: 12_000 },
        ],
        mismatchesEver: 2,
      },
    }));
    expect(html).toContain("data-variant=\"destructive\"");
    expect(html).toContain("data-variant=\"secondary\"");
    expect(html).toContain("registro histórico");
  });

  it("una lista recortada dice de cuántos sale", () => {
    const html = render(createElement(MoneyPanel, {
      money: {
        ...money,
        mismatches: [{ id: "1", createdAt: NOW, paymentId: 5, memberId: 3, memberName: "P", n: 1, expected: 1, amount: 2 }],
        mismatchesEver: 40,
      },
    }));
    expect(html).toContain("40");
    expect(html).toContain("más recientes");
  });
});

// El doble del botón: no importa qué renderiza, importa a QUÉ fila se le ofrece.
const stubResend: ResendRenderer = ({ kind, id }) =>
  createElement("span", { "data-resend": `${kind}:${id}` }, "Reenviar");

describe("FailedNoticesPanel", () => {
  const notice = (over: Partial<HealthSnapshot["failed"][number]> = {}): HealthSnapshot["failed"][number] => ({
    id: "1", sentAt: NOW, type: "receipt", error: "EAUTH", payloadSummary: "recibo 2026-00042",
    memberId: 3, memberName: "Pérez", applicationId: null, receiptNumber: "2026-00042", ...over,
  });

  it("sin avisos fallidos no hay tabla, y el vacío aclara que la allowlist no cuenta", () => {
    const html = render(createElement(FailedNoticesPanel, { failed: [], failedEver: 0, renderResend: stubResend }));
    expect(html).not.toContain("<thead");
    expect(html).toContain("lista de prueba del entorno");
  });

  it("ofrece reenviar sólo lo que el sistema puede rehacer solo", () => {
    const html = render(createElement(FailedNoticesPanel, {
      failed: [
        notice(),
        notice({ id: "2", type: "fee_reminder", payloadSummary: "recordatorio 2026-09", receiptNumber: null }),
      ],
      failedEver: 2,
      renderResend: stubResend,
    }));
    expect(html).toContain('data-resend="notification:1"');
    expect(html).not.toContain('data-resend="notification:2"');
    expect(html).toContain("Rehacer desde su pantalla");
  });

  it("nunca muestra a qué casilla iba: sólo de qué entidad viene", () => {
    const html = render(createElement(FailedNoticesPanel, {
      failed: [notice({ memberId: null, memberName: null, applicationId: 7 })],
      failedEver: 1,
      renderResend: stubResend,
    }));
    expect(html).toContain("Solicitud 7");
    expect(html).not.toContain("@");
  });

  it("una lista recortada dice de cuántos sale, sin llamarla cola de trabajo", () => {
    const html = render(createElement(FailedNoticesPanel, {
      failed: [notice()], failedEver: 120, renderResend: stubResend,
    }));
    expect(html).toContain("120");
    expect(html).toContain("intentos fallidos registrados");
  });
});

describe("PendingReceiptsPanel", () => {
  const row = (state: PendingReceiptState, id: number) => ({
    id, number: `2026-0000${id}`, issuedAt: NOW, state,
    memberId: 5, applicationId: null, memberName: "Pérez", error: state === "failed" ? "EAUTH" : null,
  });

  it("sin recibos pendientes no hay tabla", () => {
    const html = render(createElement(PendingReceiptsPanel, {
      receipts: { rows: [], total: 0 }, renderResend: stubResend,
    }));
    expect(html).not.toContain("<thead");
  });

  it("ofrece reenviar sólo donde tiene sentido", () => {
    const html = render(createElement(PendingReceiptsPanel, {
      receipts: {
        rows: [row("failed", 1), row("not_attempted", 2), row("sent", 3), row("no_email", 4)],
        total: 4,
      },
      renderResend: stubResend,
    }));
    expect(html).toContain('data-resend="receipt:1"');
    expect(html).toContain('data-resend="receipt:2"');
    // `sent` le duplicaría el PDF al socio; `no_email` no tiene a dónde ir.
    expect(html).not.toContain('data-resend="receipt:3"');
    expect(html).not.toContain('data-resend="receipt:4"');
    expect(html).toContain("Nada que hacer");
  });

  it("cada estado explica por qué la fila sigue ahí", () => {
    const html = render(createElement(PendingReceiptsPanel, {
      receipts: { rows: [row("not_attempted", 1), row("sent", 2)], total: 2 },
      renderResend: stubResend,
    }));
    expect(html).toContain("No se intentó");
    expect(html).toContain("Salió, falta el sello");
    expect(html).toContain("duplicaría el PDF");
  });

  it("avisa que con la allowlist puesta esta lista se llena sola", () => {
    // Es la diferencia entre un panel que explica y uno que acusa: en producción
    // la variable está puesta y estas filas no son culpa de nadie.
    const html = render(createElement(PendingReceiptsPanel, {
      receipts: { rows: [row("not_attempted", 1)], total: 1 }, renderResend: stubResend,
    }));
    expect(html).toContain("EMAIL_ALLOWLIST");
    expect(html).toContain("se vacía al sacar la variable");
  });
});
