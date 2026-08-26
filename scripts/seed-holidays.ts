// Siembra la tabla `holidays` con los feriados nacionales argentinos.
// Run: npx tsx scripts/seed-holidays.ts
//
// Para qué: los plazos del re-empadronamiento (Art. 9° bis) se cuentan en DÍAS
// HÁBILES. Sin esta tabla el sistema contaría un feriado como día hábil y le
// acortaría el plazo a un vecino, que es lo único que este módulo no se puede
// permitir.
//
// QUÉ CARGA Y QUÉ NO. Sólo lo que es cierto sin consultar el boletín de cada
// año:
//   · los feriados INAMOVIBLES de la Ley 27.399 art. 1 (fecha fija, todos los
//     años la misma);
//   · el lunes y martes de Carnaval y el Viernes Santo, que no dependen de
//     ningún decreto: se derivan del domingo de Pascua (05/04/2026 y
//     28/03/2027) — Carnaval son los dos días previos al Miércoles de Ceniza,
//     que cae 46 días antes de Pascua, y el Viernes Santo es el viernes
//     anterior.
//
// NO carga los feriados TRASLADABLES (17/06 Güemes, 17/08 San Martín, 12/10
// Diversidad Cultural, 20/11 Soberanía Nacional) ni los días no laborables con
// fines turísticos ("puentes"). La Ley 27.399 art. 7 tiene una regla de
// traslado, pero la fecha en que finalmente se celebran la fija el Poder
// Ejecutivo por decreto cada año y puede apartarse de ella; los puentes son
// enteramente discrecionales. Una fecha inventada acá corre un plazo legal, así
// que se cargan a mano desde el ABM de feriados del panel una vez publicado el
// calendario oficial del año (argentina.gob.ar/jefatura/feriados-nacionales-AAAA).
//
// Idempotente: `date` es unique y la carga usa `skipDuplicates`, así que
// re-correrlo no duplica nada ni pisa lo que el operador haya corregido a mano.
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

const YEARS = [2026, 2027];

function seeds(): HolidaySeed[] {
  const fixed = YEARS.flatMap<HolidaySeed>((year) =>
    FIXED.map(([month, day, label]): HolidaySeed => [year, month, day, label]),
  );
  return [...fixed, ...EASTER_DERIVED].sort(
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
    "Faltan los TRASLADABLES (17/06, 17/08, 12/10, 20/11) y los puentes turísticos:" +
      " se cargan desde el panel con el calendario oficial del año a la vista.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
