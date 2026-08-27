// Cuál es el proceso de re-empadronamiento que el SITIO PÚBLICO tiene que
// atender, en una sola función.
//
// Fuente: la clave de configuración `reempadronamiento_proceso_id`, no una
// consulta por estado. Es a propósito y lo dice el tablero del panel: de esa
// clave dependen la suspensión de ASOCIATE y el botón REEMPADRONATE, y si el
// proceso vivo y la clave divergen, el panel AVISA de la divergencia en vez de
// que cada pantalla adivine. El público sigue la clave; el panel sigue el
// estado. Si acá se consultara por estado, el aviso del tablero pasaría a ser
// mentira: diría "el vecino no ve el wizard" mientras el vecino sí lo ve.
//
// Por qué una función compartida y no dos lecturas parecidas: la usan la
// PÁGINA (para decidir si se dibuja el wizard) y la ACTION (como guarda del
// POST), que son dos puertas al mismo trámite. El proyecto ya pagó la lección
// de la regla copiada en dos lados —`coverageFloor` en el Módulo 4— y la misma
// forma se repite en este módulo con `isCohortMember`: la consulta que congela
// la cohorte y el veredicto del wizard comparten las constantes justamente para
// que no puedan divergir. Acá la divergencia se vería como una página que abre
// el formulario y una action que lo rechaza, o peor, al revés.
//
// El cliente de Prisma se INYECTA y este módulo NO importa `@/lib/config`: ese
// evalúa el singleton de Prisma (y `unstable_cache`) al cargarse, así que
// importarlo ataría al runtime de Next a cualquiera que sólo quiera esta
// consulta. Es la misma trampa que documenta `config-keys.ts`.
import type { PrismaClient, ReregistrationStatus } from "@/generated/prisma/client";
import { CONFIG_KEYS } from "@/lib/config-keys";
import { wizardOpen } from "./rules";

type Db = Pick<PrismaClient, "configuration" | "reregistrationProcess">;

/** Lo mínimo que el wizard necesita saber del proceso. El id es lo que ata la
 *  presentación; el estado es lo que decide si sigue abierto; los dos plazos
 *  son lo que le decimos al vecino cuando le pedimos que corrija algo — cuál de
 *  los dos corre lo resuelve `currentDeadline` y no cada llamador. NO viaja
 *  nada del padrón: esto termina en una pantalla anónima, y las fechas del
 *  proceso son públicas (van también a la cartelera). */
export type WizardProcess = {
  id: number;
  status: ReregistrationStatus;
  firstEndsAt: Date;
  secondEndsAt: Date | null;
};

/** El proceso que el wizard público tiene que atender, o `null` si no hay
 *  ninguno abierto (sin clave, con una clave que no apunta a nada, o con el
 *  proceso en `preparing` / `closing` / `closed`).
 *
 *  Lectura DIRECTA contra la base, sin `unstable_cache`: es una GUARDA. Las
 *  lecturas cacheadas de `@/lib/config` existen para las páginas públicas y se
 *  invalidan por tag, pero un valor viejo acá dejaría entrar presentaciones
 *  después de cerrar el plazo del Art. 9° bis — el mismo criterio con el que
 *  `createApplicationAction` lee el interruptor de ASOCIATE con `configReader`
 *  y no con `getAsociateActive`. */
export async function openWizardProcess(db: Db): Promise<WizardProcess | null> {
  const row = await db.configuration.findUnique({
    where: { key: CONFIG_KEYS.reregistrationProcessId },
  });
  // El valor es un Json y la convocatoria lo escribe como `String(process.id)`,
  // o sea un string. Cualquier otra cosa (null, un número, basura escrita por
  // SQL) es una clave rota y vale lo mismo que no tenerla.
  const id = typeof row?.value === "string" ? Number(row.value.trim()) : NaN;
  // `Number("")` es 0 y `Number("abc")` es NaN: las dos formas de una clave
  // rota terminan acá y no en un `findUnique` con un id inventado.
  if (!Number.isInteger(id) || id <= 0) return null;

  const process = await db.reregistrationProcess.findUnique({
    where: { id },
    select: { id: true, status: true, firstEndsAt: true, secondEndsAt: true },
  });
  // `wizardOpen` es el ÚNICO lugar donde se decide qué estados admiten
  // presentaciones (vive en `rules.ts`, con los plazos). Acá no se vuelve a
  // escribir esa lista: si algún día un estado nuevo abre el wizard, entra por
  // ahí y esta función lo hereda.
  if (process === null || !wizardOpen(process)) return null;
  return process;
}
