// Lista de capturas de los manuales. Cada entrada produce
// docs/manuales/img/<manual>/<file>.png. `prepare` corre con la página ya
// cargada y la sesión del rol iniciada, para abrir pestañas, llenar pasos, etc.
//
// Estados sembrados en la base LOCAL de los que dependen varias entradas (ids y
// procedimiento en `.superpowers/sdd/manuales/siembra.md`):
//
//   - socio ficticio 678 ("Prueba Manuales, Socia", N° 308) con 2 cuotas
//     pendientes y el recibo 2026-00011;
//   - solicitud de alta 32 en cola ("Camino Feliz, Vecina", datos inventados);
//   - reporte 19 (N° 4, reclamo recibido) del socio 678;
//   - fila 62 de la bandeja Sin conciliar ($ 18.000, sembrada con
//     `scripts/dev/seed-unmatched.ts`);
//   - noticia 63 en borrador.
//
// Las listas que muestran apellidos REALES del padrón importado se capturan
// filtradas por "Prueba" (`?q=`), que es el único recorte que deja sólo fichas
// inventadas: `/admin/socios`, Deudores y Recibos. Usuarios va con
// `?q=sigev.local` (las tres cuentas de prueba) y el padrón electoral va sin
// `fullPage` porque su encabezado y la tira de conteos no llevan nombres.
import { join } from "node:path";
import type { Page } from "playwright-core";

export type Role = "public" | "admin" | "member" | "superadmin";
export type Manual = "m1" | "m2" | "m3";
export type Capture = {
  manual: Manual;
  file: string;          // NN-slug, sin extensión
  role: Role;
  url: string;           // relativa a DOCS_CAPTURE_BASE_URL
  fullPage?: boolean;    // default: solo el viewport
  prepare?: (page: Page) => Promise<void>;
  /** Selector que tiene que estar en pantalla antes de disparar la foto. Para
   *  lo que se pinta después del primer render (una tabla que se carga, un
   *  panel de pestaña, un gráfico): sin esto la captura sale a mitad de camino
   *  y nadie se entera hasta que el manual está impreso. */
  ready?: string;
  /** Oculta el widget de Turnstile. En local corre con las claves dummy de
   *  Cloudflare, que pintan una leyenda ROJA "Solo para pruebas. Si se ve,
   *  informe al propietario del sitio": en un manual eso se lee como un error
   *  del sitio. Se prende sólo donde el widget está en cuadro. */
  hideTurnstile?: boolean;
};

// ── Insumos de los `prepare` ────────────────────────────────────────────────

/** Las dos caras del DNI que sube el paso de documentación de ASOCIATE. Es el
 *  logo institucional: un PNG chico que ya está en el repo, y que en la captura
 *  se ve como "archivo cargado" sin publicar el documento de nadie. */
const SAMPLE_IMAGE = join(process.cwd(), "assets", "logo.png");

/** DNI inventado para los pasos del wizard que NO crean la solicitud (el alta
 *  nace recién al enviar "Tus datos"). No existe ni en `members` ni en
 *  `applications`: si existiera, el paso 1 lo bloquearía y la captura saldría
 *  con el panel de veredicto en vez del paso. */
const ASOCIATE_DNI = "99000101";

/** Para los dos pasos que SÍ crean la solicitud (documentación y pago) hace
 *  falta un documento libre en CADA corrida: el anterior quedó tomado por la
 *  solicitud que dejó la captura pasada, y el paso 1 lo rebotaría. */
function freshDni(): string {
  return `99${String(Date.now() % 1_000_000).padStart(6, "0")}`;
}

/** El widget de Turnstile con las claves dummy resuelve solo, pero no al
 *  instante: el `<form>` no se puede enviar hasta que llenó su input oculto. */
async function waitTurnstile(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
    return Boolean(el && el.value);
  }, undefined, { timeout: 30_000 });
}

/** Lleva el wizard ASOCIATE hasta el paso pedido, con datos inventados.
 *
 *  OJO con la numeración: el orden REAL del wizard es 1 Tu DNI · 2 ¿Dónde
 *  vivís? · 3 Categoría · 4 Tus datos · 5 Documentación · 6 Pago
 *  (`STEP_TITLES` en `asociate-wizard.tsx`). Los nombres de archivo de las
 *  capturas 06-10 vienen del brief con otra numeración; lo que manda es el
 *  TEMA del nombre, y acá se pide el paso real.
 *
 *  Del paso 4 en adelante la solicitud ya existe en la base: por eso esos dos
 *  llamados usan `freshDni()` y no la constante. */
async function asociateHasta(page: Page, step: 2 | 3 | 4 | 5 | 6): Promise<void> {
  const dni = step >= 5 ? freshDni() : ASOCIATE_DNI;
  // La casilla también tiene su techo (`asociateEmailLimiter`, por dirección),
  // así que las dos capturas que crean solicitud no pueden compartir email: con
  // uno fijo, la segunda se frenaba por cupo y la captura salía del paso 4.
  const email = `vecina.prueba+${dni}@example.test`;

  // Paso 1 — Tu DNI.
  await page.fill("#dni", dni);
  await waitTurnstile(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "¿Dónde vivís?" }).waitFor({ timeout: 60_000 });
  if (step === 2) return;

  // Paso 2 — ¿Dónde vivís? Calle del catálogo del barrio + altura.
  await page.getByText("En el Barrio Ciudadela", { exact: true }).click();
  await page.fill("#street-search", "Tobiano");
  await page.locator('[role="option"]').first().click();
  await page.fill("#streetNumber", "742");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "¿En qué categoría querés asociarte?" }).waitFor({ timeout: 60_000 });
  if (step === 3) return;

  // Paso 3 — Categoría. "Socio activo" a propósito: el adherente abre además la
  // pregunta del débito, que no es lo que ilustra la captura.
  await page.getByText("Socio activo", { exact: true }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "Tus datos" }).waitFor({ timeout: 60_000 });
  if (step === 4) return;

  // Paso 4 — Tus datos. Acá nace la solicitud.
  await page.fill("#fullName", "Vecina de Prueba");
  await page.fill("#birthDate", "1985-04-17");
  await page.selectOption("#civilStatus", "Soltero/a");
  await page.fill("#nationality", "Argentina");
  await page.fill("#occupation", "Docente");
  await page.fill("#phone", "297 400 0000");
  await page.fill("#email", email);
  await page.fill("#emailConfirm", email);
  await page.check('input[name="acceptTerms"]');
  await waitTurnstile(page);
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await page.getByRole("heading", { name: "Documentación" }).waitFor({ timeout: 60_000 });
  if (step === 5) return;

  // Paso 5 — Documentación. Las dos caras del DNI, una ranura por vez: cada una
  // corre su propia action (ver el comentario de `step-documents.tsx`).
  for (const docType of ["dni_front", "dni_back"]) {
    const slot = page.locator(`form:has(input[name="docType"][value="${docType}"])`);
    await slot.locator('input[type="file"]').setInputFiles(SAMPLE_IMAGE);
    await slot.getByRole("button", { name: "Subir" }).click();
    // Una ranura que terminó bien se PLIEGA (`setOpen(false)`), así que su
    // `<form>` deja de existir: esperar eso es esperar la subida, sin sondear
    // un rótulo.
    await slot.waitFor({ state: "detached", timeout: 60_000 });
  }
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "Pago y envío de tu solicitud" }).waitFor({ timeout: 60_000 });
}

/** Pliega el panel "Convocados sin aviso por correo" del tablero de
 *  reempadronamiento: es lo ÚNICO de esa pantalla que imprime nombre y número
 *  de vecinos reales del padrón importado. El resto —la línea del proceso, las
 *  pastillas de estado y la cartelera— son conteos. */
async function hideSinAviso(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById("sin-aviso");
    if (el instanceof HTMLElement) el.style.display = "none";
  });
  await page.waitForTimeout(200);
}

/** Paso 1 del wizard público de REPORTES: tipo de reporte + cómo figura. Deja
 *  la pantalla en el paso 2 (la identidad del vecino). */
async function reportesHastaIdentidad(page: Page): Promise<void> {
  await page.getByText("Un reclamo", { exact: true }).click();
  await page.getByText("Con mi nombre", { exact: true }).click();
  await waitTurnstile(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "Tus datos" }).first().waitFor({ timeout: 60_000 });
}

export const CAPTURES: Capture[] = [
  // ── M1 · Manual del operador ──────────────────────────────────────────────
  { manual: "m1", file: "01-ingresar", role: "public", url: "/ingresar", hideTurnstile: true },
  { manual: "m1", file: "02-inicio-tablero", role: "admin", url: "/admin", fullPage: true },
  // Sin `fullPage`: la cola lleva una barra de asiento STICKY, y en una captura
  // de página entera esa barra queda clavada a media altura tapando una ficha.
  // En el viewport se ve donde el operador la ve, al pie.
  { manual: "m1", file: "03-solicitudes-altas", role: "admin", url: "/admin/solicitudes" },
  { manual: "m1", file: "04-solicitud-alta-ficha", role: "admin", url: "/admin/solicitudes/32", fullPage: true },
  { manual: "m1", file: "05-solicitudes-resumen-acta", role: "admin", url: "/admin/solicitudes/resumen", fullPage: true },
  { manual: "m1", file: "06-solicitudes-de-socios", role: "admin", url: "/admin/solicitudes/socios", fullPage: true },
  { manual: "m1", file: "07-reportes-bandeja", role: "admin", url: "/admin/solicitudes/reportes", fullPage: true },
  { manual: "m1", file: "08-reporte-ficha", role: "admin", url: "/admin/solicitudes/reportes/19", fullPage: true },
  // El panel "Convocados sin aviso por correo" lista con nombre y número a los
  // vecinos reales del padrón importado: se pliega antes de la foto en las dos
  // capturas del tablero. Es la única parte de la pantalla con datos personales.
  { manual: "m1", file: "09-reempadronamiento-tablero", role: "admin", url: "/admin/reempadronamiento", fullPage: true, prepare: hideSinAviso },
  { manual: "m1", file: "10-reempadronamiento-presentaciones", role: "admin", url: "/admin/reempadronamiento/presentaciones", fullPage: true },
  // `/admin/reempadronamiento/avisos` NO es una ruta (esa carpeta sólo tiene la
  // action y la tarjeta): la cartelera es la sección `#cartelera` del tablero.
  {
    manual: "m1",
    file: "11-reempadronamiento-avisos",
    role: "admin",
    url: "/admin/reempadronamiento#cartelera",
    prepare: async (page) => {
      await hideSinAviso(page);
      await page.locator("#cartelera").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    },
  },
  { manual: "m1", file: "12-socios-padron", role: "admin", url: "/admin/socios?q=Prueba", fullPage: true },
  { manual: "m1", file: "13-socio-ficha", role: "admin", url: "/admin/socios/678", fullPage: true },
  { manual: "m1", file: "14-socio-ficha-cuenta", role: "admin", url: "/admin/socios/678?tab=cuenta", fullPage: true },
  { manual: "m1", file: "15-socio-link-de-pago", role: "admin", url: "/admin/socios/678/link", fullPage: true },
  { manual: "m1", file: "16-socios-libros", role: "admin", url: "/admin/socios/libros", fullPage: true },
  { manual: "m1", file: "17-tesoreria-deudores", role: "admin", url: "/admin/tesoreria/deudores?q=Prueba", fullPage: true },
  { manual: "m1", file: "18-tesoreria-efectivo", role: "admin", url: "/admin/tesoreria/efectivo?socio=678", fullPage: true },
  { manual: "m1", file: "19-tesoreria-recibos", role: "admin", url: "/admin/tesoreria/recibos?q=Prueba", fullPage: true },
  { manual: "m1", file: "20-tesoreria-sin-conciliar", role: "admin", url: "/admin/tesoreria/sin-conciliar", fullPage: true },
  { manual: "m1", file: "21-tesoreria-reparto", role: "admin", url: "/admin/tesoreria/sin-conciliar/62", fullPage: true },
  { manual: "m1", file: "22-tesoreria-suscripciones", role: "admin", url: "/admin/tesoreria/suscripciones", fullPage: true },
  { manual: "m1", file: "23-tesoreria-otros-ingresos", role: "admin", url: "/admin/tesoreria/otros-ingresos", fullPage: false }, // viewport: la columna "Registró" con el nombre del operador queda fuera,
  { manual: "m1", file: "24-tesoreria-exenciones", role: "admin", url: "/admin/tesoreria/exenciones", fullPage: true },
  { manual: "m1", file: "25-actas", role: "admin", url: "/admin/actas", fullPage: true },
  { manual: "m1", file: "26-noticias", role: "admin", url: "/admin/noticias", fullPage: true },
  { manual: "m1", file: "27-noticia-editor", role: "admin", url: "/admin/noticias/63", fullPage: true },
  { manual: "m1", file: "28-actividades", role: "admin", url: "/admin/actividades", fullPage: true },
  { manual: "m1", file: "29-documentos", role: "admin", url: "/admin/documentos", fullPage: true },
  { manual: "m1", file: "30-usuarios", role: "superadmin", url: "/admin/usuarios?q=sigev.local", fullPage: true },
  { manual: "m1", file: "31-configuracion", role: "superadmin", url: "/admin/configuracion", fullPage: true },
  { manual: "m1", file: "32-tesoreria-valores", role: "superadmin", url: "/admin/tesoreria/valores", fullPage: true },
  { manual: "m1", file: "33-salud", role: "superadmin", url: "/admin/salud", fullPage: true },
  // Sin `fullPage`: de la mitad de la página para abajo el padrón electoral es
  // la lista de vecinos con nombre y número. El encabezado, el formulario de
  // fecha y la tira de conteos entran enteros en el viewport, y el `prepare`
  // pliega las tres listas para que no asome ninguna fila por el borde.
  {
    manual: "m1",
    file: "34-padron-electoral",
    role: "superadmin",
    url: "/admin/padron-electoral",
    prepare: async (page) => {
      await page.evaluate(() => {
        for (const id of ["habilitados", "a-purgar", "no-habilitados"]) {
          const el = document.getElementById(id);
          if (el instanceof HTMLElement) el.style.display = "none";
        }
      });
      await page.waitForTimeout(200);
    },
  },
  // Sin `fullPage`: la pantalla de cierre es el checklist MÁS la nómina entera
  // de los que se darían de baja (125 vecinos reales, 15.800 px de alto). El
  // viewport muestra el checklist, que es lo que el manual explica.
  { manual: "m1", file: "35-reempadronamiento-cierre", role: "superadmin", url: "/admin/reempadronamiento/cierre" },

  // ── M2 · Manual del socio ─────────────────────────────────────────────────
  { manual: "m2", file: "01-mi-inicio", role: "member", url: "/mi", fullPage: true },
  { manual: "m2", file: "02-mi-cuenta", role: "member", url: "/mi/cuenta", fullPage: true },
  {
    manual: "m2",
    file: "03-mi-cuenta-pagar",
    role: "member",
    url: "/mi/cuenta#pagar",
    // La tarjeta "Pagar ahora" vive al pie de la cuenta: sin traerla al
    // viewport la captura sale del encabezado, que ya es la 02.
    prepare: async (page) => {
      await page.locator("#pagar").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    },
  },
  { manual: "m2", file: "04-mi-debito", role: "member", url: "/mi/debito", fullPage: true },
  { manual: "m2", file: "05-mi-datos", role: "member", url: "/mi/datos", fullPage: true },
  { manual: "m2", file: "06-mi-solicitudes", role: "member", url: "/mi/solicitudes", fullPage: true },
  { manual: "m2", file: "07-mi-solicitudes-reportes", role: "member", url: "/mi/solicitudes/reportes", fullPage: true },
  { manual: "m2", file: "08-mi-documentos", role: "member", url: "/mi/documentos", fullPage: true },
  { manual: "m2", file: "09-recuperar-contrasena", role: "public", url: "/ingresar/recuperar", hideTurnstile: true },

  // ── M3 · Manual del vecino ────────────────────────────────────────────────
  { manual: "m3", file: "01-portada", role: "public", url: "/", fullPage: true },
  { manual: "m3", file: "02-noticias", role: "public", url: "/noticias", fullPage: true },
  { manual: "m3", file: "03-actividades", role: "public", url: "/actividades", fullPage: true },
  { manual: "m3", file: "04-ubicacion", role: "public", url: "/ubicacion", fullPage: true },
  { manual: "m3", file: "05-asociate-paso-1-dni", role: "public", url: "/asociate", fullPage: true, hideTurnstile: true },
  // El nombre viene del brief; la pantalla es la que dice el TEMA del nombre.
  // Paso REAL del wizard entre paréntesis.
  { manual: "m3", file: "06-asociate-paso-2-datos", role: "public", url: "/asociate", fullPage: true, hideTurnstile: true, prepare: (p) => asociateHasta(p, 4) },
  { manual: "m3", file: "07-asociate-paso-3-residencia", role: "public", url: "/asociate", fullPage: true, prepare: (p) => asociateHasta(p, 2) },
  { manual: "m3", file: "08-asociate-paso-4-categoria", role: "public", url: "/asociate", fullPage: true, prepare: (p) => asociateHasta(p, 3) },
  { manual: "m3", file: "09-asociate-paso-5-documentos", role: "public", url: "/asociate", fullPage: true, prepare: (p) => asociateHasta(p, 5) },
  { manual: "m3", file: "10-asociate-paso-6-pago", role: "public", url: "/asociate", fullPage: true, prepare: (p) => asociateHasta(p, 6) },
  { manual: "m3", file: "11-reempadronate-paso-1", role: "public", url: "/reempadronate", fullPage: true, hideTurnstile: true },
  // `/reportes` es la LANDING (las dos puertas, reclamo e iniciativa); el
  // wizard vive en `/reportes/nuevo?tipo=…`, que es lo que estas dos entradas
  // tienen que mostrar para que el nombre del archivo diga la verdad.
  { manual: "m3", file: "12-reportes-paso-1", role: "public", url: "/reportes/nuevo?tipo=reclamo", fullPage: true, hideTurnstile: true },
  { manual: "m3", file: "13-reportes-paso-2", role: "public", url: "/reportes/nuevo?tipo=reclamo", fullPage: true, prepare: reportesHastaIdentidad },
  { manual: "m3", file: "14-ingresar", role: "public", url: "/ingresar", hideTurnstile: true },
];
