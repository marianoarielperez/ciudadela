// Las claves de la tabla `configuration`, en un módulo PURO: no importa nada.
//
// Vivían dentro de `@/lib/config`, que importa `unstable_cache` de `next/cache` y
// el cliente de Prisma, y los evalúa al cargarse. Un módulo de dominio que sólo
// quería el NOMBRE de una clave se quedaba atado al runtime de Next: cuando
// `members/service.ts` importó `@/lib/config`, tres archivos de test que mockean
// `next/cache` entero se cayeron. La constante no necesita nada de eso.
//
// `@/lib/config` la re-exporta, así que las pantallas y las actions la siguen
// importando de donde siempre.
export const CONFIG_KEYS = {
  asociateActivo: "asociate_activo",
  contactPhone: "contact_phone",
  contactEmail: "contact_email",
  termsText: "terms_text",
  privacyConsentText: "privacy_consent_text",
  mpPlanActiveId: "mp_plan_active_id",
  mpPlanSharedId: "mp_plan_shared_id",
  /** Destinatarios del resumen diario a la Comisión (4C §6). CSV. Editable
   *  desde /admin/configuracion: cambiar quién lo recibe no puede exigir un
   *  deploy ni un reinicio de PM2. */
  digestRecipients: "digest_recipients",
  /** Bloquea los cambios de categoría mientras hay elecciones (Art. 5° ter).
   *  Lo leía `members/service.ts` con la clave escrita a mano; desde la 4C hay
   *  una pantalla que lo escribe (`/admin/padron-electoral`) y la clave vive en
   *  un solo lugar. */
  electionsOngoing: "elecciones_en_curso",
} as const;
