import { BookOpen, ChartColumn, Files, Scale, ScrollText } from "lucide-react";
import type { InstitutionalDocument, InstitutionalDocumentType } from "@/generated/prisma/client";

import { EmptyState } from "@/components/admin/empty-state";
import { PanelHeader } from "@/components/admin/panel-header";
import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documentos — Vecinal Ciudadela" };

// Fila-link entera al PDF: target de pulgar (≥44px) y anillo de foco del panel.
function DocRow({ doc }: { doc: InstitutionalDocument }) {
  return (
    <li>
      <a
        href={`/api/mi/documentos/${doc.id}`}
        target="_blank"
        rel="noopener"
        className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{doc.title}</span>
          {doc.description && (
            <span className="block truncate text-xs text-muted-foreground">{doc.description}</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {/* Sólo el formato: la fecha de CARGA es contabilidad nuestra y no le
              dice nada al socio (para memorias y balances el ejercicio ya está
              en el título, y un documento resubido no cambia de contenido).
              La fecha sigue estando en el listado del admin, que es donde sirve. */}
          PDF
          {/* WCAG 3.2.5: el rótulo anuncia el formato pero no el cambio de
              contexto. Mismo recurso que /admin/tesoreria/recibos. */}
          <span className="sr-only"> (se abre en una pestaña nueva)</span>
        </span>
      </a>
    </li>
  );
}

function Section({ icon, title, docs }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  docs: InstitutionalDocument[];
}) {
  // Sección vacía = sección que no existe: nunca un encabezado sin filas.
  if (docs.length === 0) return null;
  return (
    <section className="space-y-3">
      <PanelHeader icon={icon} title={title} />
      <ul className="list-none space-y-2 p-0">
        {docs.map((d) => (
          <DocRow key={d.id} doc={d} />
        ))}
      </ul>
    </section>
  );
}

export default async function MiDocumentosPage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const rows = await prisma.institutionalDocument.findMany({
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
  });
  const featured = rows.find((r) => r.featured) ?? null;
  const byType = (type: InstitutionalDocumentType) =>
    rows.filter((r) => r.type === type && r.id !== featured?.id);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Documentos</h1>
        <p className="text-sm text-muted-foreground">
          El estatuto, las memorias y los balances de la asociación.
        </p>
      </div>
      {featured && (
        // La norma vigente, con el lenguaje visual de la credencial: rounded-2xl
        // + ring. Sobria y tipográfica — es un documento, no una tarjeta de
        // identidad.
        <section
          aria-label="Norma vigente"
          className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10"
        >
          <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-primary uppercase">
            <ScrollText className="size-4" aria-hidden />
            Norma vigente
          </p>
          <div>
            <h2 className="text-xl font-bold">{featured.title}</h2>
            {featured.description && (
              <p className="text-sm text-muted-foreground">{featured.description}</p>
            )}
          </div>
          <a
            href={`/api/mi/documentos/${featured.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-12 items-center text-sm font-medium text-primary underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Abrir el PDF
            <span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        </section>
      )}
      <Section icon={Scale} title="Normas" docs={byType("norm")} />
      <Section icon={BookOpen} title="Memorias" docs={byType("annual_report")} />
      <Section icon={ChartColumn} title="Balances" docs={byType("balance")} />
      <Section icon={Files} title="Otros documentos" docs={byType("other")} />
      {rows.length === 0 && (
        <EmptyState
          size="card"
          description="Los documentos van a aparecer acá cuando la Comisión los publique."
        />
      )}
    </div>
  );
}
