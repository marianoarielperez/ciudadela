// Estado vacío con la acción que lo resuelve (los de lista repiten el CTA del
// encabezado; los de tarjeta son una línea). `size="list"` reemplaza a la tabla
// entera: nunca renderizar un thead sin filas.
export function EmptyState({ description, action, size = "list" }: {
  description: string;
  action?: React.ReactNode;
  size?: "list" | "card";
}) {
  if (size === "card") {
    return <p className="text-sm text-muted-foreground">{description}</p>;
  }
  return (
    <div className="space-y-3 rounded-xl border border-dashed p-6 text-center">
      <p className="text-sm text-muted-foreground">{description}</p>
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );
}
