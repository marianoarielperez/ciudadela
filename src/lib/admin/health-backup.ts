// Lectura del sello del backup nocturno (spec 4C §8, panel 2).
//
// `scripts/backup.sh:39-41` escribe `LAST_OK` con un ISO-8601 UTC al terminar
// bien, y lo puso ahí a propósito para esta pantalla. El fallo NO deja rastro en
// disco (el `trap ... ERR` sólo escribe a stderr, que va al log del cron), así
// que lo único que se puede leer es la ANTIGÜEDAD del último éxito.
//
// `node:fs` acá adentro: este módulo no se importa NUNCA desde un componente
// cliente (misma nota que `treasury/receipts-dir.ts`).
import { readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";

export type BackupState = "fresh" | "stale" | "missing" | "unconfigured";
export type BackupHealth = { state: BackupState; lastOkAt: Date | null };

/** El backup corre a las 04:00 (`scripts/backup.sh:3`). 26 h en vez de 24 le dan
 *  margen a una corrida lenta sin acusar un backup roto que no lo está. */
export const BACKUP_FRESH_HOURS = 26;

export async function readBackupHealth(
  now: Date,
  opts?: { dir?: string; readFile?: (path: string) => Promise<string> },
): Promise<BackupHealth> {
  const dir = opts && "dir" in opts ? opts.dir : process.env.BACKUP_DIR;
  // Los TRES estados se distinguen a propósito: "no configurado" (nadie definió
  // BACKUP_DIR), "no está el archivo" (el backup nunca corrió, o la ruta apunta
  // mal) y "viejo" (corría y se cortó). Un `Date | null` pelado los confunde, y
  // significan cosas muy distintas para el que tiene que arreglarlo.
  if (!dir) return { state: "unconfigured", lastOkAt: null };
  const read = opts?.readFile ?? ((p: string) => fsReadFile(p, "utf8"));
  let raw: string;
  try {
    raw = await read(join(dir, "LAST_OK"));
  } catch {
    return { state: "missing", lastOkAt: null };
  }
  const lastOkAt = new Date(raw.trim());
  if (Number.isNaN(lastOkAt.getTime())) return { state: "missing", lastOkAt: null };
  const hours = (now.getTime() - lastOkAt.getTime()) / 3_600_000;
  return { state: hours <= BACKUP_FRESH_HOURS ? "fresh" : "stale", lastOkAt };
}
