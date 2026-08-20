// Tags de caché del sitio público. Las actions del ABM invalidan con
// updateTag(CACHE_TAGS.news) etc. — en Next 16.3.1 revalidateTag pide un
// segundo argumento de perfil y no se puede llamar desde una server action.
//
// Vive en su propio módulo porque es transversal: lo consumen noticias,
// actividades y configuración, y colgarlo de cualquiera de esos módulos
// obliga a los demás a importar desde un vecino que no les incumbe.
export const CACHE_TAGS = { news: "news", activities: "activities", config: "config" } as const;
