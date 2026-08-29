// Detalle de una cuenta (módulo de usuarios). Secciones: Datos, Roles, Cuenta,
// Invitación y Actividad. La pantalla deshabilita EXACTAMENTE lo que las
// guardas del dominio rechazan (auto-degradación, último superadmin, cuentas
// de socios, invitación de una cuenta desactivada) y lo dice con el mismo
// texto: USER_GUARD_MESSAGES es la única fuente, acá no se reescribe ninguno.
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { userAccountBadgeVariant, userRoleBadgeVariant } from "@/lib/admin/status-badges";
import { requireSuperadminUsers } from "@/lib/auth/require-admin";
import { formatDateAR, formatDateTimeAR } from "@/lib/format";
import {
  ACCOUNT_STATE_LABELS, auditActionLabel, ROLE_LABELS,
} from "@/lib/users/labels";
import { getUserDetail } from "@/lib/users/query";
import { USER_GUARD_MESSAGES } from "@/lib/users/service";
import { prisma } from "@/lib/prisma";
import { EditUserForm } from "./edit-form";
import { InvitationButtons, SetActiveButton } from "./account-forms";
import { RoleActionButton } from "./role-forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Usuario — SIGeV" };

// Banners de éxito por searchParam (patrón Configuración). El de rol otorgado
// lleva el aviso del token: el JWT de 8 h no refleja un rol nuevo hasta que la
// persona re-ingresa (spec §2 decisión 4). Sin ese aviso el módulo genera
// tickets de "le otorgué el rol y no le anda".
const BANNERS: Record<string, { kind: "success" | "warning"; text: (name: string) => string }> = {
  "invitado=1": { kind: "success", text: () => "La cuenta se creó y la invitación salió por correo." },
  "invitado=2": { kind: "warning", text: () => "La cuenta se creó, pero el correo de invitación no salió. Reenvialo desde la sección Invitación." },
  "guardado=1": { kind: "success", text: () => "Datos guardados." },
  "rol=1": { kind: "success", text: (n) => `Rol otorgado. El cambio rige cuando ${n} cierre sesión y vuelva a entrar.` },
  "rol=2": { kind: "success", text: () => "Rol quitado. Deja de tener efecto de inmediato en cada acción del panel." },
  "cuenta=1": { kind: "success", text: () => "Cuenta reactivada." },
  "cuenta=2": { kind: "success", text: () => "Cuenta desactivada: no puede ingresar desde ahora." },
  "invitacion=1": { kind: "success", text: () => "Invitación reenviada." },
  "invitacion=2": { kind: "warning", text: () => "La invitación se reemitió, pero el correo no salió. Probá reenviarla de nuevo." },
  "invitacion=3": { kind: "success", text: () => "Invitación revocada: el enlace del buzón ya no sirve." },
};

function activeBanner(sp: Record<string, string | string[] | undefined>) {
  for (const key of Object.keys(BANNERS)) {
    const [k, v] = key.split("=");
    if ((Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) === v) return BANNERS[key];
  }
  return null;
}

// Qué habilita cada rol, en una línea. Los roles se otorgan cada dos años, en
// un recambio de Comisión: nadie recuerda de memoria qué implica cada uno, y el
// dato ya lo tiene el sistema (la lateral filtra por `superadminOnly`).
const ROLE_SCOPES: [string, string][] = [
  ["Admin", "solicitudes, socios, tesorería, actas y contenido."],
  ["Superadmin", "además usuarios, configuración, salud, padrón electoral y las acciones sensibles de tesorería."],
];

export default async function UsuarioDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSuperadminUsers();
  if (!actor.ok) {
    // Pantalla de bloqueo, no redirect: el rebote /ingresar → /redirigir →
    // /admin marearía a un admin común con sesión válida (molde Configuración).
    return (
      <div className="space-y-4">
        <PageHeader title="Usuario" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const [{ id: rawId }, sp] = await Promise.all([props.params, props.searchParams]);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  // Una sola marca de tiempo para toda la pantalla: el estado derivado de la
  // cuenta y el vencimiento de la invitación se leen del MISMO instante.
  const now = new Date();
  const user = await getUserDetail(prisma, id, now);
  if (!user) notFound();

  const label = user.name ?? user.email;
  const isSelf = user.id === actor.actorId;
  const managed = user.roles.includes("admin") || user.roles.includes("superadmin");
  // Último superadmin activo: quitarle el rol o desactivarlo dejaría al sistema
  // sin ninguno, y eso es lo que la transacción cuenta DESPUÉS de escribir. Si
  // la cuenta ya está desactivada no suma al conteo, así que no es "el último".
  const lastSuperadmin =
    user.roles.includes("superadmin") && user.active && user.activeSuperadmins <= 1;
  const invitationExpired = user.invitation !== null && user.invitation.expiresAt < now;
  const banner = activeBanner(sp);

  return (
    <div className="space-y-6">
      <PageHeader
        // La entidad va en el <h1>; la última miga es un sustantivo corto.
        title={label}
        breadcrumb={[{ label: "Usuarios", href: "/admin/usuarios" }, { label: "Detalle" }]}
      >
        <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <span className="break-all">{user.email}</span>
          <Badge variant={userAccountBadgeVariant(user.state)}>
            {ACCOUNT_STATE_LABELS[user.state]}
          </Badge>
        </p>
      </PageHeader>

      {banner && <FormMessage kind={banner.kind} box>{banner.text(label)}</FormMessage>}

      <section aria-labelledby="datos-title" className="space-y-3">
        <h2 id="datos-title" className="text-lg font-semibold">Datos</h2>
        {managed ? (
          <EditUserForm
            userId={user.id}
            name={user.name ?? ""}
            email={user.email}
            memberId={user.member?.id ?? null}
          />
        ) : (
          // `updateManagedUser` sólo acepta cuentas de gestión: el nombre de un
          // socio puro sale de su ficha (`fullName`) y editarlo desde acá lo
          // desincronizaría. Un formulario que siempre va a ser rechazado no se
          // ofrece.
          <>
            <dl className="grid max-w-md grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Nombre</dt>
                <dd>{user.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{user.email}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              {user.member ? (
                <>
                  Esta cuenta no tiene roles de gestión: su nombre y su email se editan desde{" "}
                  <Link className={INLINE_LINK} href={`/admin/socios/${user.member.id}`}>
                    la ficha del socio
                  </Link>
                  .
                </>
              ) : (
                "Esta cuenta no tiene roles de gestión: sus datos no se editan desde esta pantalla."
              )}
            </p>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          Último ingreso:{" "}
          <span className="font-mono tabular-nums">
            {user.lastLoginAt ? formatDateTimeAR(user.lastLoginAt) : "nunca"}
          </span>
        </p>
      </section>

      <section aria-labelledby="roles-title" className="space-y-3">
        <h2 id="roles-title" className="text-lg font-semibold">Roles</h2>
        <p className="flex flex-wrap gap-1">
          {user.roles.length === 0 && <span className="text-sm text-muted-foreground">Sin roles.</span>}
          {user.roles.map((r) => (
            <Badge key={r} variant={userRoleBadgeVariant(r)}>{ROLE_LABELS[r] ?? r}</Badge>
          ))}
        </p>
        <dl className="space-y-1 text-sm text-muted-foreground">
          {ROLE_SCOPES.map(([role, scope]) => (
            <div key={role} className="flex flex-wrap items-baseline gap-x-1">
              <dt className="font-medium text-foreground">{role}:</dt>
              <dd className="min-w-0">{scope}</dd>
            </div>
          ))}
        </dl>
        {user.member && (
          <p className="text-sm text-muted-foreground">
            El rol Socio lo gobierna el ciclo del socio (alta de acceso, baja y readmisión):{" "}
            <Link className={INLINE_LINK} href={`/admin/socios/${user.member.id}`}>ver la ficha</Link>.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <RoleActionButton
            userId={user.id}
            userLabel={label}
            role="admin"
            mode={user.roles.includes("admin") ? "revoke" : "grant"}
          />
          <RoleActionButton
            userId={user.id}
            userLabel={label}
            role="superadmin"
            mode={user.roles.includes("superadmin") ? "revoke" : "grant"}
            disabledReason={
              user.roles.includes("superadmin")
                ? isSelf
                  ? USER_GUARD_MESSAGES.selfSuperadmin
                  : lastSuperadmin
                    ? USER_GUARD_MESSAGES.lastSuperadmin
                    : undefined
                : undefined
            }
          />
        </div>
      </section>

      <section aria-labelledby="cuenta-title" className="space-y-3">
        <h2 id="cuenta-title" className="text-lg font-semibold">Cuenta</h2>
        {managed ? (
          <SetActiveButton
            userId={user.id}
            userLabel={label}
            active={user.active}
            disabledReason={
              user.active && isSelf
                ? USER_GUARD_MESSAGES.selfDisable
                : user.active && lastSuperadmin
                  ? USER_GUARD_MESSAGES.lastSuperadmin
                  : undefined
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {USER_GUARD_MESSAGES.notManaged}
            {user.member && (
              <>
                {" "}
                <Link className={INLINE_LINK} href={`/admin/socios/${user.member.id}`}>Ver la ficha</Link>.
              </>
            )}
          </p>
        )}
      </section>

      {managed && user.passwordChangedAt === null && (
        <section aria-labelledby="invitacion-title" className="space-y-3">
          <h2 id="invitacion-title" className="text-lg font-semibold">Invitación</h2>
          <p className="text-sm text-muted-foreground">
            {user.invitation
              ? invitationExpired
                ? `La invitación venció el ${formatDateAR(user.invitation.expiresAt)}: reenviala para que pueda crear su contraseña.`
                : `Invitación pendiente: vence el ${formatDateAR(user.invitation.expiresAt)}.`
              : "No hay una invitación viva: la cuenta no puede crear su contraseña hasta que le reenvíes una."}
          </p>
          <InvitationButtons
            userId={user.id}
            userLabel={label}
            // Las dos guardas de invitación que el dominio rechaza, con su
            // texto: una cuenta desactivada no recibe invitación, y no hay nada
            // que revocar si no quedó ninguna viva.
            resendDisabledReason={user.active ? undefined : USER_GUARD_MESSAGES.inactiveInvitation}
            revokeDisabledReason={user.invitation ? undefined : USER_GUARD_MESSAGES.noInvitation}
          />
        </section>
      )}

      <section aria-labelledby="actividad-title" className="space-y-3">
        <h2 id="actividad-title" className="text-lg font-semibold">Actividad</h2>
        {user.activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad registrada.</p>
        ) : (
          <ul className="list-none divide-y rounded-xl border p-0 text-sm">
            {user.activity.map((a) => {
              const role = (a.detail as { role?: string } | null)?.role;
              return (
                <li key={String(a.id)} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {auditActionLabel(a.action)}
                    {role ? ` (${ROLE_LABELS[role] ?? role})` : ""}
                    {a.actor ? <span className="text-muted-foreground">{` — por ${a.actor}`}</span> : ""}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDateTimeAR(a.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
