// Los períodos que un pago de este socio iría CREANDO. Vivía copiado en dos
// pantallas —el link del admin y /mi/cuenta— con su comentario incluido, justo
// en la zona por la que pasa el devengo de la 4C: tocar una sola de las dos
// copias rompía la promesa en la otra, en silencio.
//
// Módulo puro: no importa `@/lib/prisma`. Lo único que trae de Mercado Pago es
// `MAX_LINK_FEES`, una constante de `references.ts` —módulo sin gateway, sin
// SDK y sin red—: es el tope de cuotas que una pantalla puede ofrecer de una
// vez, no una dependencia del dominio con el proveedor.
import { MAX_LINK_FEES } from "@/lib/mp/references";
import type { Period } from "./periods";
import { allocate, coverageFloor } from "./rules";

/** Los períodos que un pago de este socio iría CREANDO, en orden, desde su piso
 *  de cobertura. La pantalla los usa para nombrar a qué mes va el pago; el
 *  servicio llama a `allocate` con el MISMO piso al imputarlo, así que lo que se
 *  anuncia es lo que va a decir el recibo.
 *
 *  El reingreso entra por parámetro: `joinedAt` no se toca al reingresar
 *  (REG-11), así que la fecha sale del `Movement` de tipo `readmission` más
 *  nuevo. Sin ese término, a un ex socio que vuelve en noviembre la pantalla le
 *  ofrecería cubrir septiembre y octubre, meses en los que no fue socio. */
export function upcomingPeriods(existing: Period[], joinedAt: Date, readmittedAt: Date | null): Period[] {
  return allocate({
    pending: [],
    existing,
    n: MAX_LINK_FEES,
    startAt: coverageFloor({ joinedAt, readmittedAt }),
  }).toCreate;
}
