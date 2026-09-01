import { cn } from "@/lib/utils";

const KIND_CLASSES = {
  error: "text-destructive",
  success: "text-success",
  warning: "text-warning",
  neutral: "text-muted-foreground",
  info: "text-primary",
} as const;

const BOX_CLASSES = {
  error: "border-destructive/40 bg-destructive/5",
  success: "border-success/40 bg-success/10",
  warning: "border-warning/40 bg-warning/10",
  neutral: "border-border bg-muted/50",
  info: "border-primary/40 bg-primary/5",
} as const;

// Mensaje post-acción único del panel (antes: 19 sitios, 6 estilos). `alert`
// interrumpe al lector de pantalla (errores y advertencias); `status` espera su
// turno (confirmaciones); los neutrales no anuncian nada. `as="span"` es para
// los dos sitios que viven dentro de una fila flex.
//
// `role` es la salida de emergencia: pisa el rol que se deduce del `kind`. Hace
// falta cuando un mensaje neutral SÍ tiene que anunciarse —el "Sin cambios que
// guardar" de la carga de fichas, donde se guarda con Ctrl+S y sin ese anuncio
// el operador ciego no distingue "no había nada que guardar" de "el guardado no
// se disparó"—. Sin la prop, el comportamiento es el de siempre.
//
// `role="none"` es el caso inverso: un `kind` que anunciaría (warning, error)
// usado como AYUDA ESTÁTICA de un campo y no como respuesta a una acción —la
// advertencia de calle fuera del catálogo, que ya está en pantalla mientras se
// tipea—. Un `role="alert"` ahí interrumpiría al lector de pantalla en cada
// tecla. No se puede expresar con `undefined` porque eso significa "deducilo del
// kind", así que hace falta un valor explícito que se traduce a "sin atributo".
//
// "info" (2026-09): nota institucional celeste del sitio público; sin anuncio,
// como neutral.
export function FormMessage({ kind, box = false, as: Tag = "p", role: roleOverride, className, children }: {
  kind: "error" | "success" | "warning" | "neutral" | "info";
  box?: boolean;
  as?: "p" | "span" | "div";
  role?: "status" | "alert" | "none";
  className?: string;
  children: React.ReactNode;
}) {
  const resolved = roleOverride ?? (kind === "error" || kind === "warning" ? "alert"
    : kind === "success" ? "status" : undefined);
  const role = resolved === "none" ? undefined : resolved;
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
