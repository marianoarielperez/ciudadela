// Solicitudes del socio (M5B, spec §7.1): presentar la baja por renuncia o un
// cambio de categoría, y seguir el estado de lo ya presentado. El suspendido
// VE esta pantalla (allowSuspended) pero no actúa: `canAct` decide qué se
// renderiza, y las tres actions vuelven a exigir la vigencia por su cuenta
// (REG-20) — la pantalla no es la única barrera.
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { RequestTypeIcon } from "@/components/admin/request-type-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/require-member";
import { formatDateTimeAR } from "@/lib/format";
import {
  REQUEST_STATUS_BADGE_VARIANT, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS,
} from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { CancelRequestForm, CategoryRequestForm, WithdrawalRequestForm } from "./request-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Solicitudes — Vecinal Ciudadela" };

export default async function MiSolicitudesPage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const canAct = actor.suspension === null;

  const [member, requests] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: { category: true },
    }),
    prisma.memberRequest.findMany({
      where: { memberId: actor.memberId },
      orderBy: { id: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Solicitudes</h1>
        <p className="text-sm text-muted-foreground">
          Presentá tu baja por renuncia o un cambio de categoría, y seguí acá el estado de lo que
          ya mandaste.
        </p>
      </div>

      {requests.length === 0 ? (
        <EmptyState description="Todavía no presentaste ninguna solicitud." />
      ) : (
        <div className="space-y-3">
          {requests.map((request) => {
            return (
              <Card key={request.id}>
                <CardHeader>
                  <CardTitle
                    as="h2"
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                  >
                    <span className="flex items-center gap-2">
                      <RequestTypeIcon type={request.type} className="size-4 text-primary" />
                      {REQUEST_TYPE_LABELS[request.type]}
                    </span>
                    <Badge variant={REQUEST_STATUS_BADGE_VARIANT[request.status]}>
                      {REQUEST_STATUS_LABELS[request.status]}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Presentada el {formatDateTimeAR(request.createdAt)}
                  </p>
                  {/* Texto plano SIEMPRE: viene de renderWithdrawalText o del
                      servicio, nunca HTML. */}
                  <p className="whitespace-pre-line text-sm">{request.text}</p>
                  {request.decisionNote && (
                    <FormMessage kind="neutral" box className="whitespace-pre-line">
                      {request.decisionNote}
                    </FormMessage>
                  )}
                  {request.status === "pending" && canAct && (
                    <CancelRequestForm requestId={request.id} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {canAct && (
        <div className="space-y-4">
          <WithdrawalRequestForm
            hasPending={requests.some((r) => r.type === "withdrawal" && r.status === "pending")}
          />
          <CategoryRequestForm
            currentCategory={member.category}
            hasPending={requests.some((r) => r.type === "category_change" && r.status === "pending")}
          />
        </div>
      )}
    </div>
  );
}
