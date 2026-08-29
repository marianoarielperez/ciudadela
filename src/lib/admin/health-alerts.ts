// El veredicto de /admin/salud: de todo lo que la capa de datos mide, ¿qué pide
// que alguien haga algo HOY?
//
// Existe por el modo de falla que hunde a cualquier tablero de estado: si la
// pantalla nace en rojo, o grita por cosas que no requieren acción, el operador
// aprende a no mirarla y deja de servir. Así que el veredicto tiene DOS niveles
// y la frontera entre ellos es una sola pregunta: **¿hay algo que hacer, y hay
// algo que hacer que lo apague?**
//
//   act    — algo se rompió y hay una salida concreta. Es lo único que se pinta
//            con el token destructivo.
//   review — vale mirarlo, pero no es una rotura: una ausencia (un cron que
//            todavía no corrió), una cola normal de trabajo (la bandeja) o un
//            cruce que puede ser perfectamente sano.
//
// Los dos casos que la fase 4C peleó explícitamente y que por eso NO son `act`:
//
//   1. Un cron que decide no actuar ESTÁ SANO. `accrual`, `reminder` y `digest`
//      no escriben fila la mayoría de los días, y `CRON_EXPECTATION` ya mide a
//      cada uno con su propia vara. Cuando aun así quedan viejos, es una
//      ausencia (`stale`/`never`) y va a `review`, nunca a `act`.
//   2. `debits.stoppedForActive` tiene un falso positivo conocido que ninguna
//      acción apaga —el socio vigente que se pasó a efectivo y le cancelaron el
//      débito— así que va a `review`. Su gemelo `aliveForWithdrawn` sí es `act`:
//      es plata que se le sigue cobrando a alguien que se dio de baja, y el
//      botón «Cancelar el débito» lo resuelve.
//
// Función PURA sobre el snapshot: la tabla entera de casos se prueba sin base y
// sin fixtures (patrón de `applications/eligibility.ts`).
import type { BackupHealth } from "./health-backup";
import type { HealthSnapshot } from "./health";

export type HealthAlert = {
  /** Identificador estable para el `key` de React y para los tests. */
  key: string;
  label: string;
  /** A dónde va el operador. Un `#ancla` baja al panel de esta misma pantalla. */
  href: string;
};

export type HealthAlerts = { act: HealthAlert[]; review: HealthAlert[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const daysAgo = (from: Date, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));

export function healthAlerts(health: HealthSnapshot, backup: BackupHealth): HealthAlerts {
  const act: HealthAlert[] = [];
  const review: HealthAlert[] = [];
  const now = health.now;

  for (const cron of health.crons) {
    const key = `cron-${cron.job}`;
    if (cron.state === "errors") {
      act.push({ key, label: `${cron.label}: la última corrida terminó con errores.`, href: "#tareas" });
    } else if (cron.state === "hung") {
      act.push({ key, label: `${cron.label}: una corrida se abrió y nunca cerró.`, href: "#tareas" });
    } else if (cron.state === "never") {
      review.push({ key, label: `${cron.label}: todavía no corrió ninguna vez.`, href: "#tareas" });
    } else if (cron.state === "stale" && cron.lastRun) {
      const d = plural(daysAgo(cron.lastRun.startedAt, now), "día", "días");
      // El resumen no se manda los días sin novedades, así que su antigüedad NO
      // es un atraso: es silencio. Decirle "atrasado" al silencio sano es
      // exactamente cómo se entrena a un operador a ignorar el tablero.
      review.push({
        key,
        label: cron.job === "digest"
          ? `${cron.label}: sin novedades que contar desde hace ${d}.`
          : `${cron.label}: la última corrida fue hace ${d}.`,
        href: "#tareas",
      });
    }
  }

  if (backup.state === "missing") {
    act.push({ key: "backup", label: "No hay rastro de ningún backup nocturno correcto.", href: "#backup" });
  } else if (backup.state === "stale" && backup.lastOkAt) {
    const d = plural(daysAgo(backup.lastOkAt, now), "día", "días");
    review.push({ key: "backup", label: `El último backup correcto es de hace ${d}.`, href: "#backup" });
  } else if (backup.state === "unreadable") {
    review.push({ key: "backup", label: "El panel no puede leer el sello del backup.", href: "#backup" });
  } else if (backup.state === "unconfigured") {
    review.push({ key: "backup", label: "El panel no sabe si el backup corre: falta configurarlo.", href: "#backup" });
  }

  // Un solo superadmin que pueda entrar es `act`, y la frontera se cumple en
  // los dos términos: el estado es una rotura real —perder esa cuenta deja el
  // sistema sin nadie que pueda administrarlo, y volver a entrar es SQL contra
  // la base de producción— y hay UNA salida concreta que lo apaga, que la
  // alerta nombra: otorgarle el rol a una segunda cuenta desde /admin/usuarios.
  //
  // El conteo mira `signInReadySuperadmins` y NO el `where` de las guardas del
  // dominio, que cuentan cuentas ACTIVAS a secas. Es la corrección que salió de
  // la verificación en vivo: una cuenta de gestión recién creada, con la
  // invitación revocada y el rol otorgado, está activa y NO puede iniciar
  // sesión —nace con `passwordChangedAt: null` y un hash incanjeable—, y sin
  // embargo apagaba la alerta. Una red de seguridad que sólo funciona si el
  // segundo superadmin recupera su contraseña por correo, y sólo si controla
  // esa casilla, no es la red que esta línea promete. Las guardas siguen
  // contando activos: son otra pregunta ("¿queda alguien con el rol?"), y ahí
  // una cuenta recuperable sí cuenta.
  //
  // El criterio cuenta a quien tiene contraseña creada O entró alguna vez, y el
  // segundo término tampoco es teórico: `passwordChangedAt` quedó en null para
  // todas las cuentas anteriores al 19/08/2026 (la migración no rellenó la
  // columna), y medido contra producción el ÚNICO superadmin es una de ésas y
  // entra todos los días. Sin `lastLoginAt` este renglón habría salido a
  // producción en rojo diciendo lo contrario de lo que pasa.
  //
  // No es de la familia de `inboxTotal`, `failedEver` o los mismatches, que
  // están en `review` o no alertan: aquéllos son contadores acumulativos que
  // ninguna acción baja. Éste es el estado de HOY y se apaga solo al
  // resolverse. Que hoy esté encendido —hay un único superadmin— es el punto:
  // el módulo de usuarios garantiza "nunca cero superadmins activos" sólo
  // PUERTAS ADENTRO (revokeRole y setUserActive cuentan después de escribir y
  // dentro de la transacción), y la baja de un socio apaga `User.active` de la
  // cuenta vinculada sin mirar roles, desde una pantalla que sólo exige admin.
  // Con la única superadmin siendo además socia, ese camino deja el sistema en
  // cero. Mientras la guarda de raíz no exista, esta línea es el aviso.
  if (health.signInReadySuperadmins <= 1) {
    act.push({
      key: "superadmins",
      label: health.signInReadySuperadmins === 0
        // Sin ninguno no queda salida por pantalla —esta misma exige
        // superadmin—: decirlo es más útil que ofrecer un botón imposible.
        // Puede quedar alguna cuenta con el rol y sin contraseña, así que el
        // camino por correo se nombra: es lo único cierto que queda antes de
        // la base.
        ? "Ningún superadmin puede entrar: sólo se recupera restableciendo la contraseña por correo o desde la base."
        // "que pueda entrar" y no "activo": el paréntesis dice por qué una
        // segunda cuenta recién creada no apagó este renglón. Nombra las DOS
        // condiciones porque el criterio son las dos: decir sólo "que no creó
        // su contraseña" sería falso para una cuenta vieja, que la tiene en
        // null y sin embargo entra.
        : "Queda un solo superadmin que pueda entrar: si se pierde esa cuenta, nadie puede administrar el sistema. Otorgale el rol de superadmin a una segunda cuenta desde Usuarios (una que nunca inició sesión ni creó su contraseña no cuenta).",
      href: "/admin/usuarios",
    });
  }

  if (health.mp.unprocessedWithError > 0) {
    act.push({
      key: "mp-error",
      label: `${plural(health.mp.unprocessedWithError, "aviso de Mercado Pago quedó", "avisos de Mercado Pago quedaron")} con error en las últimas 72 h.`,
      href: "#mercado-pago",
    });
  }
  if (health.mp.lastEventAt === null) {
    review.push({ key: "mp-silence", label: "Mercado Pago nunca envió un aviso a este sistema.", href: "#mercado-pago" });
  }
  // `mp.legacyIpns` NO alerta y es deliberado: son notificaciones legítimas de
  // MP en un formato que no implementamos, no hay ninguna acción que las baje y
  // el volumen normal es de decenas por día. Hasta este arreglo se sumaban al
  // contador de firma y el panel amanecía en producción anunciando 51 "firmas
  // inválidas" de las que 49 eran esto. Se muestran en el panel de MP como
  // contexto, y ahí se quedan.
  if (health.mp.signatureRejections > 0) {
    review.push({
      key: "mp-signature",
      label: `${plural(health.mp.signatureRejections, "aviso se rechazó", "avisos se rechazaron")} por firma inválida en las últimas 24 h.`,
      href: "#mercado-pago",
    });
  }

  if (health.money.debits.aliveForWithdrawn > 0) {
    act.push({
      key: "debits-alive",
      label: `${plural(health.money.debits.aliveForWithdrawn, "socio dado de baja tiene", "socios dados de baja tienen")} el débito automático todavía vivo.`,
      href: "/admin/tesoreria/suscripciones",
    });
  }
  if (health.money.debits.stoppedForActive > 0) {
    review.push({
      key: "debits-stopped",
      label: `${plural(health.money.debits.stoppedForActive, "socio vigente dejó", "socios vigentes dejaron")} de pagar por débito automático.`,
      href: "/admin/tesoreria/suscripciones",
    });
  }
  if (health.money.inboxOpen > 0) {
    review.push({
      key: "inbox",
      label: `${plural(health.money.inboxOpen, "cobro espera", "cobros esperan")} una decisión en la bandeja sin conciliar.`,
      href: "/admin/tesoreria/sin-conciliar",
    });
  }

  if (health.failed.length > 0) {
    act.push({
      key: "failed-notices",
      label: `${plural(health.failed.length, "aviso por email no salió", "avisos por email no salieron")}.`,
      href: "#avisos",
    });
  }

  // §7.3 del diagnóstico de la invitación perdida. Review y no act: nada está
  // roto —hay gente esperando— y la salida que lo apaga es el botón de envío de
  // la ficha. No es un contador acumulativo de los que enseñan a ignorar el
  // tablero: la lista sólo trae a quien TODAVÍA se puede destrabar, y se vacía
  // sola cuando crean su cuenta.
  if (health.stuckAccess.length > 0) {
    review.push({
      key: "stuck-access",
      label: `${plural(health.stuckAccess.length, "socio verificó su email y sigue sin cuenta", "socios verificaron su email y siguen sin cuenta")} de acceso.`,
      href: "#accesos",
    });
  }

  const receiptsFailed = health.receipts.rows.filter((r) => r.state === "failed").length;
  const receiptsNotAttempted = health.receipts.rows.filter((r) => r.state === "not_attempted").length;
  if (receiptsFailed > 0) {
    act.push({
      key: "receipts-failed",
      label: `${plural(receiptsFailed, "recibo no se pudo enviar", "recibos no se pudieron enviar")} por email.`,
      href: "#recibos",
    });
  }
  if (receiptsNotAttempted > 0) {
    review.push({
      key: "receipts-not-attempted",
      label: `${plural(receiptsNotAttempted, "recibo quedó", "recibos quedaron")} sin ningún intento de envío.`,
      href: "#recibos",
    });
  }

  return { act, review };
}
