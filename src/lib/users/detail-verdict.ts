// El VEREDICTO de la pantalla de detalle de una cuenta: dado el usuario y quién
// lo está mirando, qué acciones están bloqueadas hoy y con qué motivo.
//
// Módulo PURO (sin Prisma, sin React): existe por la misma razón que
// `members/debit-adhesion.ts` —"una función pura compartida por pantalla y
// action"—. Lo que la pantalla muestra deshabilitado tiene que ser EXACTAMENTE
// lo que la action rechaza, con el MISMO texto, y esa invariante es la que
// concentra el módulo entero de usuarios: decidida en ternarios dentro del JSX
// no se puede testear, y basta con que alguien toque una rama para que la
// pantalla ofrezca un botón que el dominio va a rechazar (o esconda uno que
// aceptaría — que es como apareció el caso de la invitación viva de abajo).
//
// Los mensajes NO se escriben acá: salen de `USER_GUARD_MESSAGES`, que es la
// única fuente (patrón GRANT_GUARD_MESSAGES de la exención).
//
// El juez sigue siendo el dominio: esto es la pantalla diciendo por adelantado
// lo mismo, nunca la autorización. Las guardas reales se revalidan dentro de la
// transacción de `service.ts`.
import { USER_GUARD_MESSAGES, MANAGED_ROLES } from "@/lib/users/service";

/** Lo que el veredicto necesita de la cuenta. Estructural a propósito: el
 *  `UserDetail` de `query.ts` se le pasa entero sin adaptarlo. */
export type UserDetailVerdictInput = {
  id: number;
  active: boolean;
  roles: readonly string[];
  /** Sello del último cambio de contraseña. `null` = nunca creó la suya. */
  passwordChangedAt: Date | null;
  /** La última invitación de gestión SIN usar (viva o vencida), o `null`.
   *  Vencida cuenta: `revokeForUser` borra los `usedAt: null` sin mirar la
   *  fecha, así que "hay algo que revocar" es exactamente esto. */
  invitation: { expiresAt: Date } | null;
  /** Cuántos superadmins ACTIVOS hay en total, contando a éste. */
  activeSuperadmins: number;
};

export type UserDetailVerdict = {
  /** La cuenta tiene rol de gestión: es la condición que `updateManagedUser`,
   *  `setUserActive` y `resendInvitation` exigen antes que nada. */
  managed: boolean;
  /** Si la sección Invitación se renderiza. Ver el comentario de abajo: no es
   *  `passwordChangedAt === null`. */
  showInvitation: boolean;
  /** Motivo por el que la action rechazaría HOY, o `undefined` si la aceptaría.
   *  Cada campo es una acción de la pantalla. */
  revokeSuperadmin?: string;
  revokeAdmin?: string;
  setActive?: string;
  editData?: string;
  resendInvitation?: string;
  revokeInvitation?: string;
};

export function userDetailVerdict(
  user: UserDetailVerdictInput,
  actorId: number,
): UserDetailVerdict {
  const isSelf = user.id === actorId;
  const managed = user.roles.some((r) => (MANAGED_ROLES as readonly string[]).includes(r));
  const redeemed = user.passwordChangedAt !== null;

  // Último superadmin ACTIVO: quitarle el rol o desactivarlo dejaría al sistema
  // sin ninguno, y eso es lo que la transacción cuenta DESPUÉS de escribir. Si
  // la cuenta ya está desactivada no suma al conteo, así que no es "el último"
  // — por eso `active` está acá adentro y no repetido en cada uso.
  const lastSuperadmin =
    user.roles.includes("superadmin") && user.active && user.activeSuperadmins <= 1;

  return {
    managed,

    // El caso que el plan original no vio: una cuenta invitada que en vez de
    // usar el enlace entra por "olvidé mi contraseña". `passwordReset.reset`
    // sella `passwordChangedAt` y revoca SÓLO los `password_reset`: el
    // `admin_invitation` sigue vivo hasta 7 días y todavía permite fijarle la
    // contraseña a esa cuenta. Con la sección atada a `passwordChangedAt`, el
    // encabezado mostraba "Invitación pendiente" y no había ninguna manera de
    // matar el enlace. `revokeInvitation` no tiene guarda `alreadyRedeemed`:
    // acepta ese caso perfectamente.
    showInvitation: managed && (!redeemed || user.invitation !== null),

    // `revokeRole("superadmin")`: guarda 1 (self, fuera de la tx) y guarda 2
    // (cero superadmins activos, después de la escritura y adentro). El botón
    // sólo está en modo "quitar" si la cuenta tiene el rol; sin el rol no hay
    // nada que bloquear.
    revokeSuperadmin: !user.roles.includes("superadmin")
      ? undefined
      : isSelf
        ? USER_GUARD_MESSAGES.selfSuperadmin
        : lastSuperadmin
          ? USER_GUARD_MESSAGES.lastSuperadmin
          : undefined,

    // Quitar Admin no tiene ninguna guarda propia en el dominio: `revokeRole`
    // sólo exige que la cuenta exista y que tenga el rol (las dos cosas ciertas
    // cuando el botón aparece en modo "quitar"). Se declara igual —en vez de
    // omitirse— para que quede escrito que la ausencia de motivo es una
    // verificación, no un olvido. Ojo: quitar Admin a un superadmin lo deja sin
    // Admin pero con Superadmin, y el sistema no queda sin superadmins.
    revokeAdmin: undefined,

    // `setUserActive`: sólo cuentas de gestión; no desactivarse a sí mismo; no
    // dejar cero superadmins activos. Las dos últimas sólo aplican al
    // DESACTIVAR — con la cuenta ya desactivada el botón reactiva, que no tiene
    // guarda—, y `lastSuperadmin` ya exige `active`.
    setActive: !managed
      ? USER_GUARD_MESSAGES.notManaged
      : user.active && isSelf
        ? USER_GUARD_MESSAGES.selfDisable
        : lastSuperadmin
          ? USER_GUARD_MESSAGES.lastSuperadmin
          : undefined,

    // `updateManagedUser` sólo acepta cuentas de gestión: el nombre de un socio
    // puro sale de su ficha (`fullName`) y editarlo desde acá lo desincroniza.
    editData: managed ? undefined : USER_GUARD_MESSAGES.notManaged,

    // `resendInvitation`, en el ORDEN en que el servicio corta: gestión,
    // contraseña ya creada, cuenta desactivada.
    resendInvitation: !managed
      ? USER_GUARD_MESSAGES.notManaged
      : redeemed
        ? USER_GUARD_MESSAGES.alreadyRedeemed
        : !user.active
          ? USER_GUARD_MESSAGES.inactiveInvitation
          : undefined,

    // `revokeInvitation` tiene UNA sola guarda: que `revokeForUser` haya
    // borrado algo. No mira `managed` ni `passwordChangedAt`.
    revokeInvitation: user.invitation === null ? USER_GUARD_MESSAGES.noInvitation : undefined,
  };
}
