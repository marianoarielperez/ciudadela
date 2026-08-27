# Mejora visual: HOME (footer + Ingresar) y dashboard /admin

**Fecha:** 27/08/2026 · **Estado:** aprobado por el operador (3 rondas de preguntas + presentación de diseño)
**Alcance:** SOLO cambios visuales. Cero cambios de lógica, queries, actions o datos.

## Contexto

El sitio público y el panel funcionan; lo que se pide es terminación visual en tres
puntos: el footer del sitio público (hoy cuatro `<p>` planos), el link "Ingresar"
del header (hoy un subrayado), y el dashboard `/admin` (tarjetas peladas sin íconos
y un subtítulo de obra — "Se van a ir habilitando a medida que avancemos" — que ya
no corresponde: las diez secciones están habilitadas).

## Qué NO se toca (frontera dura)

- `/admin/socios` entero (decisión explícita del operador, 27/08/2026).
- Hero y sección Noticias del HOME (salvo el reemplazo de la foto, ver §3).
- Toda la lógica: `src/lib/**` de dominio, server actions, queries, pagos, crons.
- Los arrays `ADMIN_NAV` (`src/lib/admin/nav.ts`) y `DASHBOARD_GROUPS`
  (`src/lib/admin/dashboard-cards.ts`): el rediseño no les agrega ni cambia campos.
- Tests existentes: `dashboard-cards.test.ts`, `admin-nav.test.ts`, `seo.test.ts`
  y toda la suite deben pasar **sin modificar una aserción**.
- Accesibilidad ya verificada del shell y del nav público: targets ≥44px,
  `aria-current`, `outline-hidden` + anillos `focus-visible`, skip links.

## 1. Footer del sitio público — "banda institucional"

**Archivo:** `src/components/public/site-footer.tsx` (reescritura de presentación).

**Restricción de arquitectura (intocable):** el footer lo montan también
`src/app/error.tsx` (client component) y `src/app/not-found.tsx`. Tiene que seguir
siendo **client-safe**: sin `async`, sin Prisma, sin `next/cache`, solo `next/link`,
`next/image` y constantes puras. El teléfono/email de `Configuration` NO entran.

**Diseño:**

- **Firma:** franja superior de 4px en celeste de marca `#2E9BDF`
  (token `--sidebar-primary`) — el gesto hermano del `border-b-4 border-primary`
  del header de `/mi`. El sitio queda enmarcado por la identidad.
- **Banda:** fondo `#003C5F` (token `--sidebar`), texto `--sidebar-foreground`
  (blanco al 85%), links que aclaran a blanco pleno en hover con subrayado.
  Anillos de foco con `--sidebar-ring` (`#9ED3F2`), como en la lateral del panel.
- **Contenedor:** `max-w-5xl` centrado, como el resto del sitio público.
- **Tres columnas** (grid apilado en móvil → 3 columnas desde `sm`/`md`):
  1. **Identidad:** `assets/logo-negativo.png` (import estático, `next/image`) +
     `SITE.name`, `SITE.address`, `SITE.legalStatus`, "Fundada el {SITE.founded}".
  2. **Secciones:** encabezado de columna en mayúsculas chicas
     (`text-[10px] font-bold tracking-widest uppercase`, la voz de los labels de
     grupo del panel) + links Inicio, Noticias, Actividades, Ubicación.
  3. **Contacto y acceso:** Facebook y Canal de WhatsApp (ícono + etiqueta de
     texto), más links Ingresar y Asociate.
- **Cierre:** línea inferior fina (`border-t` con `--sidebar-border`) con
  "Sistema SIGeV" y `SITE.city`.
- **Targets:** todo link del footer con `min-h-11` o padding equivalente
  (es superficie táctil en móvil).

**Redes sociales (datos nuevos, solo constantes):** en `src/lib/site.ts` se agrega

```ts
social: {
  facebook: "https://www.facebook.com/vecinalciudadela",
  whatsapp: "https://whatsapp.com/channel/0029Vb5B4S29sBICFUz8ih1i",
}
```

Los links de redes llevan `target="_blank"` + `rel="noopener noreferrer"`.

**Íconos de redes:** lucide no tiene marcas (WhatsApp no existe). Van como **SVG
inline propios** dentro del componente del footer: dos paths simples (glifo
Facebook y glifo WhatsApp), `aria-hidden`, `fill="currentColor"`, tamaño `size-4`.
Sin dependencias nuevas, compatible con la CSP (`img-src 'self'`; los SVG inline
no la tocan).

## 2. Botón "Ingresar" en el header público

**Archivos:** `src/components/public/site-header.tsx` y
`src/components/public/site-nav.tsx` (solo clases/markup).

- **Desktop** (`site-header.tsx`): el link subrayado pasa a botón primario relleno:
  `bg-primary text-primary-foreground rounded-md px-4 font-medium` con hover más
  oscuro (`hover:bg-primary/90`) y `focus-visible:ring`. Sigue siendo un `<Link>`
  (no se importa `Button` para no arrastrar nada al bundle del header client-safe);
  se estila a mano con las mismas clases-receta del proyecto.
- **Menú móvil** (`site-nav.tsx`): el "Ingresar" del cajón también se vuelve botón,
  ancho completo, `min-h-11` (mantiene el contrato de targets del nav).
- No cambia ninguna ruta ni el orden de los links.

## 3. Foto del hero

- `src/app/(public)/page.tsx`: el import estático pasa de `assets/hero.jpg` a
  `assets/hero-nuevo.jpg` (1980×690, recorte que centra la sede).
- `src/components/mi/member-card.tsx`: mismo cambio de import (la credencial usa
  la misma foto como banda).
- El overlay de gradiente del hero está calibrado en píxeles: tras el cambio se
  **verifica en el browser** que el texto sobre la foto siga legible en desktop y
  móvil. Si el recorte nuevo lo exige, se ajustan solo los stops del gradiente
  (cambio de clase, documentado en el commit).
- `assets/hero.jpg` queda en el repo (lo referencia `scripts/generate-assets.ts`
  para el OG image; regenerar el OG queda fuera de alcance).

## 4. Dashboard `/admin`

**Archivo:** `src/app/admin/page.tsx` (solo JSX/clases; las queries de
`altasCount`/`sociosCount` y el filtrado por superadmin quedan idénticos).

- **Encabezado:** `h1` "Hola, {nombre}" igual que hoy; debajo, en lugar del texto
  de obra, la **fecha del día** en es-AR: "miércoles 27 de agosto de 2026",
  formateada server-side con `Intl.DateTimeFormat("es-AR", { weekday: "long",
  day: "numeric", month: "long", year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires" })`, en
  `text-muted-foreground`. (La página ya es dinámica por `auth()`; no se cachea.)
- **Tarjetas:** cada card abre con su ícono Lucide en un **chip tintado**
  (`size-9 rounded-lg bg-primary/10 text-primary`, ícono `size-5`,
  `aria-hidden`) — el mismo ícono que la sección tiene en la lateral.
- **Resolución del ícono, sin tocar los arrays:** el mapa `AdminNavIcon →
  componente lucide` se extrae de `admin-nav-list.tsx` a un módulo compartido
  (`src/components/admin/nav-icons.ts`), importado por `admin-nav-list.tsx` (que
  queda igual funcionalmente) y por el dashboard. El dashboard resuelve el ícono
  de cada tarjeta por `href` contra `ADMIN_NAV` (el test
  `dashboard-cards.test.ts` ya garantiza la biyección tarjeta↔ítem de nav por
  `href`). Tarjeta sin `href` (roadmap futuro) → sin chip, con el
  `Badge "Próximamente"` como hoy.
- **Interacción:** tarjeta entera clickeable. Patrón accesible: el **título es el
  link** (`<Link>` dentro de `CardTitle`) estirado a toda la card con
  `after:absolute after:inset-0` sobre una `Card` `relative`; un solo link por
  tarjeta, sin interactivos anidados. Hover: `transition-shadow hover:shadow-md`
  (el lenguaje de los QuickLink de `/mi`). Foco:
  `focus-visible:ring-2 focus-visible:ring-ring` en el link.
- **CTA:** deja de ser `<Button>`; pasa a texto celeste con flecha
  ("Ver la bandeja →", `text-sm font-medium text-primary`), parte del contenido
  de la card (no es un segundo link).
- **Contador de Solicitudes:** se mantiene con los mismos datos y redacción
  ("N altas · M de socios pendientes"); puede re-ubicarse dentro de la card
  (misma tipografía `font-mono text-xs tabular-nums`).
- **Grupos:** los `h2` Gestión / Contenido / Sistema y la grilla
  `sm:grid-cols-2 lg:grid-cols-3` se conservan.

## Criterios de aceptación

1. `npm test` pasa entero sin tocar una aserción.
2. `npm run build` pasa.
3. El footer nuevo se ve correcto en `/`, `/noticias`, `/ubicacion`, en el 404 y
   en la pantalla de error (client) — las tres superficies que lo montan.
4. "Ingresar" es botón relleno en desktop y en el menú móvil; targets ≥44px.
5. El hero del HOME y la credencial de `/mi` usan `hero-nuevo.jpg`; el texto del
   hero sigue legible (verificación visual en browser, desktop + móvil).
6. `/admin` muestra saludo + fecha, tarjetas con chip de ícono, hover de
   elevación y tarjeta entera clickeable; el contador de Solicitudes sigue
   mostrando los mismos números.
7. Navegación por teclado: un Tab por tarjeta del dashboard, anillo de foco
   visible; los links del footer con foco visible sobre fondo oscuro.
8. Cero diffs en `src/lib/**` salvo el agregado de `SITE.social` en
   `src/lib/site.ts`; cero diffs en `nav.ts` y `dashboard-cards.ts`.

## Verificación

Dev server + browser: screenshots de HOME (desktop y móvil), footer, menú móvil
abierto, `/admin` (desktop y móvil), y foco por teclado en dashboard y footer.
Suite completa de tests y build antes de dar por cerrado.
