"use server";
// ABM de noticias. Cada action de este archivo es un endpoint HTTP público:
// Next NO despacha una server action por su URL sino por el id del encabezado
// `Next-Action` contra un manifiesto global del build, así que ni el proxy
// (matcher `/admin/:path*`) ni el chequeo de rol de `admin/layout.tsx` corren
// acá. Ver el encabezado de `@/lib/auth/require-admin`. El `requireAdmin()` que
// abre cada función no es ceremonia: es el único control que hay.
//
// La otra frontera es `sanitizeNewsBody`: el cuerpo se renderiza después con
// `dangerouslySetInnerHTML` SIN volver a sanitizar, así que todo camino de
// escritura pasa por la allowlist antes del create/update. Nunca persistir
// `parsed.data.body` crudo.
import { headers } from "next/headers";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import {
  NEWS_BODY_MAX_BYTES,
  NEWS_BODY_TOO_LONG,
  newsBodyByteLength,
  newsFormSchema,
} from "@/lib/news/schema";
import { slugify } from "@/lib/news/slug";
import { newsBodyIsEmpty, sanitizeNewsBody } from "@/lib/news/sanitize";
import { deleteNewsCover, saveNewsCover } from "@/lib/news/images";
import { CACHE_TAGS } from "@/lib/news/query";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (es un endpoint).
async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el resto del panel: las demás cabeceras de IP las
  // puede fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Los tres mensajes van en castellano a propósito: una server action es un
// endpoint público, así que un `id` ausente, "abc" o "1.5" son tráfico
// esperable y el texto que devuelve zod por defecto ("Invalid input: expected
// number, received NaN") terminaría en pantalla tal cual.
const idSchema = z.object({
  id: z.coerce.number("Noticia inválida.").int("Noticia inválida.").positive("Noticia inválida."),
});

// El File NO pasa por parseForm (descarta no-strings a propósito): se lee
// directo del FormData. Devuelve undefined si el input vino vacío.
function coverFrom(formData: FormData): File | undefined {
  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) return undefined;
  return file;
}

// El slug lo puede fijar el operador; si lo deja en blanco se deriva del título.
function slugFor(title: string, given: string | undefined): string {
  return given && given !== "" ? given : slugify(title);
}

const DUPLICATE_SLUG = "Ya existe una noticia con esa URL. Cambiá el campo URL.";
const NOT_FOUND = "La noticia no existe.";
const EMPTY_BODY = "Escribí el contenido de la noticia.";

// Borrado de portada que NO puede tumbar el flujo. Se usa en los caminos donde
// la escritura en la base ya salió bien y ya se auditó: ahí un EACCES/EPERM del
// filesystem solo deja un archivo huérfano (basura benigna en disco), mientras
// que dejar propagar el error le daría al operador un crash por una operación
// que en realidad funcionó, y de paso saltearía `updateTag`/`redirect`, que es
// lo que deja el panel mostrando datos viejos.
async function deleteCoverBestEffort(fileName: string): Promise<void> {
  try {
    await deleteNewsCover(fileName);
  } catch (err) {
    console.error("[noticias] no se pudo borrar la portada", fileName, err);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "P2002";
}

type ActionState = { error?: string };

export async function createNewsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(newsFormSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  // Frontera de seguridad: lo que se persiste es SIEMPRE la salida del
  // sanitizador, nunca el HTML que mandó el navegador.
  const body = sanitizeNewsBody(parsed.data.body);
  // Un cuerpo que era puro markup prohibido queda vacío después de limpiarlo:
  // eso no es una noticia, es un intento fallido.
  if (newsBodyIsEmpty(body)) return { error: EMPTY_BODY };
  // Segunda medición, sobre el texto que REALMENTE va a la columna TEXT: el
  // schema midió el cuerpo crudo, pero sanitizar puede agrandarlo (cada `&` se
  // escapa a `&amp;`, 1 byte → 5, y cada <a> recibe rel="noopener noreferrer").
  // Sin esto, `<p>` + "& " ×12.000 pasa las dos guardas del schema con 24.007
  // bytes crudos y llega al driver con 72.007, por encima de los 65.535 de TEXT.
  if (newsBodyByteLength(body) > NEWS_BODY_MAX_BYTES) return { error: NEWS_BODY_TOO_LONG };
  const slug = slugFor(parsed.data.title, parsed.data.slug);

  let coverImagePath: string | null = null;
  const cover = coverFrom(formData);
  if (cover) {
    const saved = await saveNewsCover(cover);
    if (!saved.ok) return { error: saved.error };
    coverImagePath = saved.fileName;
  }

  const ip = await clientIp();
  let newsId: number;
  try {
    const news = await prisma.news.create({
      data: { title: parsed.data.title, slug, body, coverImagePath, authorId: actor.actorId },
    });
    newsId = news.id;
  } catch (e) {
    // La portada ya está en disco: si el INSERT falló, no dejar el huérfano.
    if (coverImagePath) await deleteNewsCover(coverImagePath);
    if (isUniqueViolation(e)) return { error: DUPLICATE_SLUG };
    throw e;
  }
  // El asiento va FUERA del try: adentro, un error suyo caería en el catch de
  // arriba y borraría la portada de una fila que quedó creada — justo la
  // corrupción que ese catch previene. Hoy `audit()` se traga sus errores, pero
  // esa dependencia es invisible y se rompería con un `auditStrict`.
  await audit({
    userId: actor.actorId,
    action: "news_create",
    entity: "news",
    entityId: newsId,
    detail: { title: parsed.data.title, slug },
    ip,
  });
  updateTag(CACHE_TAGS.news);
  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect(`/admin/noticias/${newsId}`);
}

export async function updateNewsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsedId = parseForm(idSchema, formData);
  if (!parsedId.ok) return { error: parsedId.error };
  const parsed = parseForm(newsFormSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const body = sanitizeNewsBody(parsed.data.body);
  if (newsBodyIsEmpty(body)) return { error: EMPTY_BODY };
  // Igual que en el alta: la medición que vale es la del cuerpo ya sanitizado.
  if (newsBodyByteLength(body) > NEWS_BODY_MAX_BYTES) return { error: NEWS_BODY_TOO_LONG };

  const existing = await prisma.news.findUnique({ where: { id: parsedId.data.id } });
  if (!existing) return { error: NOT_FOUND };

  const slug = slugFor(parsed.data.title, parsed.data.slug);

  // Portada: nueva imagen reemplaza; checkbox removeCover borra; si no, queda.
  let coverImagePath = existing.coverImagePath;
  let newCover: string | null = null;
  const cover = coverFrom(formData);
  if (cover) {
    const saved = await saveNewsCover(cover);
    if (!saved.ok) return { error: saved.error };
    newCover = saved.fileName;
    coverImagePath = saved.fileName;
  } else if (parsed.data.removeCover === "on") {
    coverImagePath = null;
  }

  try {
    await prisma.news.update({
      where: { id: existing.id },
      data: { title: parsed.data.title, slug, body, coverImagePath },
    });
  } catch (e) {
    if (newCover) await deleteNewsCover(newCover);
    if (isUniqueViolation(e)) return { error: DUPLICATE_SLUG };
    throw e;
  }
  // Fuera del try, por lo mismo que en el alta: un error del asiento no puede
  // caer en el catch que borra la portada nueva.
  await audit({
    userId: actor.actorId,
    action: "news_update",
    entity: "news",
    entityId: existing.id,
    detail: { title: parsed.data.title, slug },
    ip: await clientIp(),
  });
  // Recién acá, con la fila ya actualizada y ya auditada, se borra la portada
  // anterior: si se borrara antes y el UPDATE fallara, la fila apuntaría a un
  // archivo que no está; y si se borrara antes del asiento, un fallo de fs
  // dejaría el UPDATE sin rastro en auditoría.
  if (existing.coverImagePath && existing.coverImagePath !== coverImagePath) {
    await deleteCoverBestEffort(existing.coverImagePath);
  }
  updateTag(CACHE_TAGS.news);
  redirect(`/admin/noticias/${existing.id}`);
}

export async function publishNewsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.news.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: NOT_FOUND };
  if (existing.status === "published") return { error: "La noticia ya está publicada." };
  await prisma.news.update({
    where: { id: existing.id },
    // publishedAt se fija la PRIMERA vez y no se pisa al re-publicar: es la
    // fecha que ve el vecino y la que ordena la cartelera.
    data: { status: "published", publishedAt: existing.publishedAt ?? new Date() },
  });
  await audit({
    userId: actor.actorId,
    action: "news_publish",
    entity: "news",
    entityId: existing.id,
    detail: { slug: existing.slug },
    ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.news);
  redirect(`/admin/noticias/${existing.id}`);
}

export async function unpublishNewsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.news.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: NOT_FOUND };
  if (existing.status !== "published") return { error: "La noticia no está publicada." };
  await prisma.news.update({ where: { id: existing.id }, data: { status: "draft" } });
  await audit({
    userId: actor.actorId,
    action: "news_unpublish",
    entity: "news",
    entityId: existing.id,
    detail: { slug: existing.slug },
    ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.news);
  redirect(`/admin/noticias/${existing.id}`);
}

export async function deleteNewsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.news.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: NOT_FOUND };
  await prisma.news.delete({ where: { id: existing.id } });
  // El asiento va ANTES de tocar el disco: `deleteNewsCover` propaga cualquier
  // error que no sea ENOENT, y con un EACCES/EPERM la fila ya estaría borrada y
  // el borrado quedaría sin rastro en auditoría — una acción sensible sin
  // asiento, que es una regla dura del proyecto.
  await audit({
    userId: actor.actorId,
    action: "news_delete",
    entity: "news",
    entityId: existing.id,
    detail: { title: existing.title, slug: existing.slug, status: existing.status },
    ip: await clientIp(),
  });
  // Recién con la fila borrada se saca el archivo: al revés dejaría una noticia
  // viva apuntando a una portada que ya no está.
  if (existing.coverImagePath) await deleteCoverBestEffort(existing.coverImagePath);
  updateTag(CACHE_TAGS.news);
  redirect("/admin/noticias");
}
