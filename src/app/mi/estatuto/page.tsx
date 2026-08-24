import { existsSync } from "node:fs";
import path from "node:path";
import { ScrollText } from "lucide-react";

import { EmptyState } from "@/components/admin/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/require-member";

export const metadata = { title: "Estatuto — Vecinal Ciudadela" };

export default async function MiEstatutoPage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null;
  const available = existsSync(path.join(process.cwd(), "datos", "estatuto.pdf"));
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Estatuto</h1>
        <p className="text-sm text-muted-foreground">
          El texto completo del estatuto de la Asociación Vecinal del Barrio Ciudadela.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <ScrollText className="size-4 text-primary" aria-hidden />
            Estatuto social
          </CardTitle>
        </CardHeader>
        <CardContent>
          {available ? (
            <a
              className="inline-flex min-h-12 items-center text-sm font-medium text-primary underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              href="/api/mi/estatuto"
              target="_blank"
              rel="noopener"
            >
              Abrir el estatuto (PDF)
            </a>
          ) : (
            <EmptyState
              size="card"
              description="El documento todavía no está publicado. Consultá en la sede."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
