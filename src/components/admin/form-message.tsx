import { cn } from "@/lib/utils";

const KIND_CLASSES = {
  error: "text-destructive",
  success: "text-success",
  warning: "text-warning",
  neutral: "text-muted-foreground",
} as const;

const BOX_CLASSES = {
  error: "border-destructive/40 bg-destructive/5",
  success: "border-success/40 bg-success/10",
  warning: "border-warning/40 bg-warning/10",
  neutral: "border-border bg-muted/50",
} as const;

// Mensaje post-acción único del panel (antes: 19 sitios, 6 estilos). `alert`
// interrumpe al lector de pantalla (errores y advertencias); `status` espera su
// turno (confirmaciones); los neutrales no anuncian nada. `as="span"` es para
// los dos sitios que viven dentro de una fila flex.
export function FormMessage({ kind, box = false, as: Tag = "p", className, children }: {
  kind: "error" | "success" | "warning" | "neutral";
  box?: boolean;
  as?: "p" | "span" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  const role = kind === "error" || kind === "warning" ? "alert"
    : kind === "success" ? "status" : undefined;
  return (
    <Tag
      role={role}
      className={cn(
        "text-sm",
        KIND_CLASSES[kind],
        box && cn("rounded-md border p-3", BOX_CLASSES[kind]),
        className,
      )}
    >
      {children}
    </Tag>
  );
}
