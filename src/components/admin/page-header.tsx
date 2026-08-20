import Link from "next/link";

export type Crumb = { label: string; href?: string };

// Encabezado único de las pantallas del panel: migas + h1 + slot de acciones.
// flex-wrap + gap arreglan el pisado título/botón que 6 pantallas tenían en
// móvil. La última miga va sin href (es la pantalla actual).
export function PageHeader({ title, breadcrumb, actions, children }: {
  title: string;
  breadcrumb?: Crumb[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Ruta de navegación" className="text-sm text-muted-foreground">
          {breadcrumb.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`}>
              {i > 0 && <span aria-hidden> / </span>}
              {crumb.href ? (
                <Link href={crumb.href} className="text-primary hover:underline">{crumb.label}</Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
