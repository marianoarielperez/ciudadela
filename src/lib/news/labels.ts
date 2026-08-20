// Etiquetas es-AR del estado de noticias. Antes vivían como const local en
// admin/noticias/page.tsx, con el mismo nombre que las del padrón: un solo lugar.
import type { NewsStatus } from "@/generated/prisma/client";

export const NEWS_STATUS_LABELS: Record<NewsStatus, string> = {
  draft: "Borrador",
  published: "Publicada",
};
