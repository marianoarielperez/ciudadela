import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/admin/form-message";
import { formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, EMAIL_STATUS_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { streetLabel } from "@/app/(public)/asociate/wizard-shared";
import { AddressForm } from "./address-form";
import { ContactForm } from "./contact-form";
import { EmailForm } from "./email-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis datos — Vecinal Ciudadela" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export default async function MiDatosPage() {
  // La página se autoriza sola. El suspendido VE sus datos (allowSuspended)
  // pero no los edita: las actions bloquean y acá ni se le muestran los
  // formularios.
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null;
  const canEdit = actor.suspension === null;
  const [member, streets] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: {
        fullName: true, dni: true, birthDate: true, category: true, status: true,
        joinedAt: true, phone: true, email: true, emailStatus: true,
        streetId: true, streetText: true, streetNumber: true, neighborhood: true,
        addressPendingReview: true,
        street: { select: { name: true } },
      },
    }),
    prisma.street.findMany({
      orderBy: { loadOrder: "asc" },
      select: { id: true, name: true, loadOrder: true },
    }),
  ]);
  const address = member.street
    ? `${streetLabel(member.street.name)} ${member.streetNumber ?? ""}`.trim()
    : [member.streetText, member.streetNumber].filter(Boolean).join(" ") || null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Mis datos</h1>
        <p className="text-sm text-muted-foreground">
          Tu ficha del padrón. Podés actualizar tu teléfono, tu domicilio y tu email; el resto lo
          corrige la vecinal en la sede.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Identidad</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Row label="Apellido y nombre" value={member.fullName} />
            <Row label="DNI" value={member.dni} />
            <Row
              label="Fecha de nacimiento"
              value={member.birthDate ? formatDateAR(member.birthDate) : null}
            />
            <Row
              label="Categoría"
              value={<Badge variant="secondary">{CATEGORY_LABELS[member.category]}</Badge>}
            />
            <Row label="Estado" value={STATUS_LABELS[member.status]} />
            <Row label="Ingreso" value={formatDateAR(member.joinedAt)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Contacto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit ? (
            <ContactForm phone={member.phone ?? ""} />
          ) : (
            <dl>
              <Row label="Teléfono" value={member.phone} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Domicilio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {member.addressPendingReview && (
            <FormMessage kind="neutral" box>
              Tu último cambio de domicilio está pendiente de constatación por la Comisión.
            </FormMessage>
          )}
          {canEdit ? (
            <AddressForm
              streets={streets}
              streetId={member.streetId}
              streetText={member.streetText}
              streetNumber={member.streetNumber ?? ""}
              neighborhood={member.neighborhood ?? ""}
            />
          ) : (
            <dl>
              <Row label="Domicilio" value={address} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Email de ingreso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="divide-y divide-border">
            <Row label="Email" value={member.email} />
            <Row label="Estado" value={EMAIL_STATUS_LABELS[member.emailStatus]} />
          </dl>
          {canEdit && <EmailForm />}
        </CardContent>
      </Card>
    </div>
  );
}
