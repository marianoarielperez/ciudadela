// Siembra la tabla `holidays` con los feriados nacionales argentinos.
// Run: npx tsx scripts/seed-holidays.ts
//
// Para qué: los plazos del re-empadronamiento (Art. 9° bis) y la notificación
// por cartelera (Art. 5° ter, 20 días hábiles) se cuentan en DÍAS HÁBILES. Sin
// esta tabla el sistema contaría un feriado como día hábil y le acortaría el
// plazo a un vecino, que es lo único que este módulo no se puede permitir.
//
// QUÉ CARGA. Los feriados nacionales de la Ley 27.399, en sus tres formas:
//   · INAMOVIBLES de fecha fija (art. 1 inc. a): la misma fecha todos los años;
//   · el lunes y martes de Carnaval y el Viernes Santo, también inamovibles pero
//     de fecha móvil: no dependen de ningún decreto, se derivan del domingo de
//     Pascua (05/04/2026 y 28/03/2027) — Carnaval son los dos días previos al
//     Miércoles de Ceniza, que cae 46 días antes de Pascua, y el Viernes Santo
//     es el viernes anterior;
//   · TRASLADABLES (art. 1 inc. b), en su fecha EFECTIVA, aplicando la regla de
//     traslado del art. 7 (ver `MOVABLE`).
//
// QUÉ NO CARGA, Y NO ES UN OLVIDO: los DÍAS NO LABORABLES CON FINES
// TURÍSTICOS (los "puentes" del art. 6, hasta tres por año, que el Poder
// Ejecutivo fija por decreto — en 2026 fueron el 23/03, el 10/07 y el 07/12).
// NO son feriados: son días de opción, y el estatuto cuenta días HÁBILES, no
// días de asueto. Meterlos acá ALARGARÍA los plazos sin fundamento legal. Es
// exactamente la clase de fila que alguien "corrige" agregándola de buena fe:
// no se agrega. Por el mismo motivo queda afuera el Jueves Santo, que es día no
// laborable y no feriado.
//
// Idempotente: `date` es unique y la carga usa `skipDuplicates`, así que
// re-correrlo no duplica nada ni pisa lo que el operador haya corregido a mano
// desde el ABM de feriados del panel.
//
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { civilDateUtc } from "../src/lib/dates";

// [año, mes, día, nombre]. El mediodía UTC lo pone `civilDateUtc`: es el
// criterio con el que el proyecto guarda TODA fecha civil (ver `fee_values`),
// para que renderizar en UTC-3 nunca corra el día.
type HolidaySeed = [number, number, number, string];

// Inamovibles de fecha fija — Ley 27.399 art. 1 inc. a. Se repiten idénticos
// todos los años.
const FIXED: ReadonlyArray<[number, number, string]> = [
  [1, 1, "Año Nuevo"],
  [3, 24, "Día Nacional de la Memoria por la Verdad y la Justicia"],
  [4, 2, "Día del Veterano y de los Caídos en la Guerra de Malvinas"],
  [5, 1, "Día del Trabajador"],
  [5, 25, "Día de la Revolución de Mayo"],
  [6, 20, "Paso a la Inmortalidad del Gral. Manuel Belgrano"],
  [7, 9, "Día de la Independencia"],
  [12, 8, "Inmaculada Concepción de María"],
  [12, 25, "Navidad"],
];

// Derivados de Pascua, año por año. Se listan explícitos en vez de calcular el
// computus: son dos años, y una tabla que se lee de un vistazo es más
// verificable que un algoritmo de cinco líneas que nadie va a auditar.
const EASTER_DERIVED: ReadonlyArray<HolidaySeed> = [
  [2026, 2, 16, "Carnaval"],
  [2026, 2, 17, "Carnaval"],
  [2026, 4, 3, "Viernes Santo"],
  [2027, 2, 8, "Carnaval"],
  [2027, 2, 9, "Carnaval"],
  [2027, 3, 26, "Viernes Santo"],
];

// TRASLADABLES — Ley 27.399 art. 1 inc. b: Güemes (17/06), San Martín (17/08),
// Diversidad Cultural (12/10) y Soberanía Nacional (20/11).
//
// Acá va la fecha EFECTIVA, no la del almanaque: la que corre el plazo es la
// fecha en que el feriado se celebra. La regla de traslado NO es un decreto
// anual, está en el art. 7 de la ley y es autoejecutable:
//
//     martes o miércoles  → lunes ANTERIOR
//     jueves o viernes    → lunes SIGUIENTE
//     sábado, domingo o lunes → queda donde está (el art. 7 no los alcanza)
//
// 2026 — FUENTE CITABLE: FEHGRA, calendario oficial de feriados 2026,
// https://fehgra.org.ar/archivos/41093 (consultado el 26/08/2026). Las cuatro
// fechas de abajo son las que publica esa fuente; la columna del medio es la
// verificación de que salen de aplicar el art. 7, no de copiar a ojo:
//     17/06/2026 cae MIÉRCOLES → lunes anterior  → 15/06/2026 (lunes)
//     17/08/2026 cae LUNES     → queda            → 17/08/2026 (lunes)
//     12/10/2026 cae LUNES     → queda            → 12/10/2026 (lunes)
//     20/11/2026 cae VIERNES   → lunes siguiente  → 23/11/2026 (lunes)
//
// 2027 — DERIVADAS, no copiadas: al 26/08/2026 no hay calendario oficial 2027
// publicado. Se aplican el mismo art. 7 y la misma aritmética, que en 2026
// reprodujo las CUATRO fechas de la fuente citable sin una sola diferencia —
// esa coincidencia 4/4 es la evidencia de que la regla está bien aplicada:
//     17/06/2027 cae JUEVES  → lunes siguiente → 21/06/2027 (lunes)
//     17/08/2027 cae MARTES  → lunes anterior  → 16/08/2027 (lunes)
//     12/10/2027 cae MARTES  → lunes anterior  → 11/10/2027 (lunes)
//     20/11/2027 cae SÁBADO  → queda           → 20/11/2027 (sábado)
//
// Se cargan derivadas en vez de dejarlas vacías porque los dos errores no
// pesan igual: una fecha FALTANTE le acorta el plazo al vecino en silencio, y
// una fecha de más se lo alarga (o, como el 20/11/2027 sábado, no cambia nada
// porque el sábado no es hábil de todos modos). Cuando salga el calendario
// oficial de 2027 hay que CONTRASTARLO: si el Congreso cambiara la ley, se
// corrige desde el ABM de feriados del panel, que es una fila.
const MOVABLE: ReadonlyArray<HolidaySeed> = [
  [2026, 6, 15, "Paso a la Inmortalidad del Gral. Martín Miguel de Güemes"],
  [2026, 8, 17, "Paso a la Inmortalidad del Gral. José de San Martín"],
  [2026, 10, 12, "Día del Respeto a la Diversidad Cultural"],
  [2026, 11, 23, "Día de la Soberanía Nacional"],
  [2027, 6, 21, "Paso a la Inmortalidad del Gral. Martín Miguel de Güemes"],
  [2027, 8, 16, "Paso a la Inmortalidad del Gral. José de San Martín"],
  [2027, 10, 11, "Día del Respeto a la Diversidad Cultural"],
  [2027, 11, 20, "Día de la Soberanía Nacional"],
];

const YEARS = [2026, 2027];

function seeds(): HolidaySeed[] {
  const fixed = YEARS.flatMap<HolidaySeed>((year) =>
    FIXED.map(([month, day, label]): HolidaySeed => [year, month, day, label]),
  );
  return [...fixed, ...EASTER_DERIVED, ...MOVABLE].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2],
  );
}

async function main() {
  const rows = seeds().map(([year, month, day, label]) => ({
    date: civilDateUtc(year, month, day),
    label,
  }));

  const before = await prisma.holiday.count();
  const { count } = await prisma.holiday.createMany({ data: rows, skipDuplicates: true });
  const after = await prisma.holiday.count();

  console.log(`Feriados propuestos: ${rows.length}`);
  console.log(`Insertados: ${count} (la tabla pasó de ${before} a ${after} filas)`);
  if (count < rows.length) {
    console.log(`Ya estaban cargados: ${rows.length - count}`);
  }
  console.log(
    "Cargados 2026 y 2027 completos, trasladables incluidos en su fecha efectiva." +
      " NO se cargan los días no laborables con fines turísticos (los puentes):" +
      " no son feriados y alargarían los plazos sin fundamento legal.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
