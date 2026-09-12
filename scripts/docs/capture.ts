// Capturas de pantalla para docs/manuales con playwright-core sobre el Chrome
// instalado. Uso:
//   npm run docs:capture             (todas)
//   npm run docs:capture m1          (solo un manual)
//   npm run docs:capture m1 -- --only 07   (solo la que empieza por 07)
// Requiere el dev server en DOCS_CAPTURE_BASE_URL (default http://localhost:3000)
// y SEED_TEST_PASSWORD en el .env (la contraseña de los usuarios de prueba).
import "dotenv/config";

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { CAPTURES, type Capture, type Manual, type Role } from "./capture-plan";

const BASE = process.env.DOCS_CAPTURE_BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "docs", "manuales", "img");
const USAGE = "uso: npm run docs:capture [m1|m2|m3] [-- --only NN]";
const ACCOUNTS: Record<Exclude<Role, "public">, string> = {
  admin: "admin.prueba@sigev.local",
  member: "socio.prueba@sigev.local",
  superadmin: "verificacion.m2@sigev.local",
};

// El mensaje de error del login (`login-form.tsx`): un <p> propio, no un
// `FormMessage`. La clase entra en el selector a propósito: el widget de
// Turnstile también rinde `role="alert"` para sus avisos TRANSITORIOS (reintento,
// token vencido), y cortar la corrida por uno de esos sería un falso negativo.
const LOGIN_ERROR = 'p[role="alert"].text-red-600';

// ── Retoques que se inyectan justo antes de la foto ────────────────────────
// El badge de las dev tools de Next (la "N" flotante abajo a la izquierda) es un
// artefacto del dev server, no de la aplicación: en el panel tapa "Cerrar
// sesión" y en un manual no se puede explicar.
const HIDE_DEV_BADGE = "nextjs-portal{display:none!important}";
// El widget de Turnstile con las claves dummy pinta la leyenda roja "Solo para
// pruebas. Si se ve, informe al propietario del sitio". Medido en local: con
// esas claves NO hay iframe de challenges.cloudflare.com ni clase
// `.cf-turnstile` — el widget se dibuja en un shadow root y el único ancla
// estable es el input oculto que inyecta dentro del <form>, así que se apunta a
// su contenedor. `visibility` y no `display`: el hueco se mantiene y el
// formulario no se recompagina.
const HIDE_TURNSTILE = 'div:has(> input[name="cf-turnstile-response"]){visibility:hidden!important}';

/** La contraseña de los usuarios de prueba, o un error que dice qué falta. */
function testPassword(): string {
  const password = process.env.SEED_TEST_PASSWORD;
  if (!password) throw new Error("Falta SEED_TEST_PASSWORD en el .env");
  return password;
}

// El widget de Turnstile deja una petición de challenges.cloudflare.com abierta
// para siempre, así que en las pantallas que lo llevan `networkidle` NO llega
// nunca. Medido contra el dev server local: `/` alcanza el reposo de red en
// 943 ms y `/ingresar` no lo alcanza (corte propio a los 25 s). Se navega con
// "load" y el reposo queda como espera ACOTADA y best-effort: si no llega,
// seguimos.
async function gotoStable(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
}

async function login(page: Page, role: Exclude<Role, "public">): Promise<void> {
  const email = ACCOUNTS[role];
  await gotoStable(page, `${BASE}/ingresar`);
  await page.fill("#email", email);
  await page.fill("#password", testPassword());
  // Turnstile con claves dummy: el widget resuelve solo y llena el hidden input.
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
    return Boolean(el && el.value);
  }, undefined, { timeout: 30_000 });
  await page.click('button[type="submit"]');

  // Se corre la redirección contra el mensaje de error del formulario. Sin esto,
  // una contraseña desactualizada se manifestaba como un timeout de 60 s sin
  // ninguna pista, cuando la pantalla tenía el motivo escrito.
  const navigated = page.waitForURL(/\/(admin|mi)(\/|$)/, { timeout: 60_000 }).then(() => "ok" as const);
  const rejected = page
    .waitForSelector(LOGIN_ERROR, { state: "visible", timeout: 60_000 })
    .then(async (el) => (await el.textContent())?.trim() || "el formulario mostró un error sin texto");
  // El perdedor de la carrera queda pendiente y termina rechazando (por timeout
  // o porque se cierra la página): sin este `catch` sería una unhandled
  // rejection, que en Node 24 tumba el proceso DESPUÉS de una captura buena.
  navigated.catch(() => {});
  rejected.catch(() => {});

  let outcome: string;
  try {
    outcome = await Promise.race([navigated, rejected]);
  } catch {
    outcome = "no hubo ni redirección ni mensaje de error a los 60 s";
  }
  if (outcome !== "ok") {
    throw new Error(`login falló para ${email} (¿corriste reset-test-passwords?): ${outcome}`);
  }
}

async function contextFor(browser: Browser, role: Role): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: "es-AR", colorScheme: "light" });
  ctx.setDefaultNavigationTimeout(120_000); // el dev server compila la primera vez
  if (role !== "public") { const page = await ctx.newPage(); await login(page, role); await page.close(); }
  return ctx;
}

async function capture(ctx: BrowserContext, c: Capture): Promise<void> {
  const page = await ctx.newPage();
  try {
    await gotoStable(page, `${BASE}${c.url}`);
    if (c.prepare) await c.prepare(page);
    if (c.ready) await page.waitForSelector(c.ready, { state: "visible", timeout: 60_000 });
    await page.addStyleTag({ content: c.hideTurnstile ? `${HIDE_DEV_BADGE}\n${HIDE_TURNSTILE}` : HIDE_DEV_BADGE });
    // Las tipografías cargan después del primer render: sin esperarlas, la
    // captura sale con la fuente de respaldo y la métrica corrida. El `.then`
    // está porque `document.fonts.ready` resuelve en un FontFaceSet, que no es
    // serializable y haría fallar el `evaluate`.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(400); // transiciones
    const dir = join(OUT, c.manual);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${c.file}.png`), fullPage: c.fullPage ?? false });
    console.log(`ok  ${c.manual}/${c.file}.png`);
  } finally {
    await page.close();
  }
}

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

/** Argumentos conocidos y nada más: un `--onyl 07` o un `m4` mal tipeado
 *  capturaba TODAS en silencio y pisaba capturas buenas con la pantalla
 *  equivocada. */
function parseArgs(argv: string[]): { manual?: Manual; only?: string } {
  let manual: Manual | undefined;
  let only: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (/^m[123]$/.test(arg)) { manual = arg as Manual; continue; }
    if (arg === "--only") {
      only = argv[++i];
      if (!only) fail("--only necesita un valor (el prefijo del archivo, por ejemplo 07).");
      continue;
    }
    fail(`argumento desconocido: ${arg}`);
  }
  return { manual, only };
}

async function main() {
  const { manual, only } = parseArgs(process.argv.slice(2));
  const selected = CAPTURES.filter((c) => (!manual || c.manual === manual) && (!only || c.file.startsWith(only)));
  if (!selected.length) { console.error("ninguna captura coincide"); process.exit(1); }
  // Se falla ANTES de abrir el navegador si falta la contraseña y hay alguna
  // captura con sesión: el error tarda medio minuto en aparecer si espera al
  // primer login.
  if (selected.some((c) => c.role !== "public")) testPassword();

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const roles = [...new Set(selected.map((c) => c.role))];
    for (const role of roles) {
      const ctx = await contextFor(browser, role);
      try { for (const c of selected.filter((x) => x.role === role)) await capture(ctx, c); }
      finally { await ctx.close(); }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
