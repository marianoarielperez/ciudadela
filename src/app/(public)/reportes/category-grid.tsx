"use client";
// El mosaico de categorías (spec §6.1): radios nativos dentro de mosaicos, dos
// columnas en el celular y cuatro en escritorio. El foco lo lleva el radio y la
// tarjeta lo muestra con `has-[:focus-visible]` (mismo gesto que ChoiceCard).
import { CLAIM_CATEGORIES, INITIATIVE_CATEGORIES, type ReportKindSlug } from "@/lib/reports/catalog";
import { cn } from "@/lib/utils";
import { ReportIcon } from "./report-icons";

export function CategoryGrid({
  kind,
  value,
  onChange,
  name = "category",
}: {
  kind: ReportKindSlug;
  value: string;
  onChange: (slug: string) => void;
  /** El `name` del grupo de radios. Se puede cambiar para que dos mosaicos en
   *  la misma página no compartan grupo (los radios nativos se agrupan por
   *  nombre y el foco viajaría entre los dos). */
  name?: string;
}) {
  const options = kind === "claim" ? CLAIM_CATEGORIES : INITIATIVE_CATEGORIES;
  return (
    <fieldset>
      <legend className="text-sm font-medium">
        {kind === "claim" ? "¿De qué se trata?" : "¿Qué tipo de iniciativa es?"}
      </legend>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {options.map((c) => {
          const checked = value === c.slug;
          return (
            <label
              key={c.slug}
              className={cn(
                "flex min-h-24 cursor-pointer flex-col items-start justify-between gap-2 rounded-xl border-2 p-3 transition-colors",
                "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                name={name}
                value={c.slug}
                checked={checked}
                onChange={() => onChange(c.slug)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg",
                  checked ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                )}
              >
                <ReportIcon name={c.icon} className="size-5" />
              </span>
              <span className="text-sm leading-tight font-semibold">{c.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
