// Crea (o reutiliza) el socio FICTICIO con el que se sacan las capturas del
// panel de socio para docs/manuales, y le vincula la cuenta de prueba
// `socio.prueba@sigev.local`.
//
// Por qué existe: la cuenta de prueba venía vinculada a una ficha REAL del
// padrón, así que cada captura de /mi publicaba el nombre, el número de socio,
// la fecha de ingreso y el estado de cuenta de una persona de carne y hueso en
// un manual que se imprime y se reparte. Los manuales no son un motivo para
// tratar un dato personal (Ley 25.326), y acá no hace falta: alcanza con una
// ficha inventada.
//
// Es idempotente por DNI: correrlo dos veces no crea un segundo socio, sólo
// vuelve a asegurar el vínculo con la cuenta.
// Solo corre contra una base en localhost. Uso: npx tsx scripts/docs/seed-docs-member.ts
//
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import { prisma } from "../../src/lib/prisma";
import { memberWriter } from "../../src/lib/members/write";

/** Datos de la ficha inventada. El DNI 99000001 no puede pertenecer a nadie
 *  (los DNI argentinos en circulación no llegan ahí) y es la llave de
 *  idempotencia del script. El nombre va en el formato del libro,
 *  "Apellido, Nombre", que es como lo muestra la credencial de /mi. */
const DNI = "99000001";
const FULL_NAME = "Prueba Manuales, Socia";
const ACCOUNT_EMAIL = "socio.prueba@sigev.local";
const STREET_NAME = "El Tobiano";
const STREET_NUMBER = "742";
// Día civil argentino guardado al MEDIODÍA UTC, que es la convención del resto
// del sistema para las fechas sin hora (ver `civilDayOf` en periods.ts y las
// fichas importadas del padrón).
const JOINED_AT = new Date(Date.UTC(2024, 2, 1, 12, 0, 0));
const ADMISSION_DETAIL = "Alta de prueba para las capturas de los manuales (no es un socio real).";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    throw new Error("Este script solo corre contra una base en localhost (DATABASE_URL).");
  }

  const user = await prisma.user.findUnique({ where: { email: ACCOUNT_EMAIL }, select: { id: true } });
  if (!user) throw new Error(`No existe la cuenta ${ACCOUNT_EMAIL} (¿corriste el seed de usuarios de prueba?).`);

  // El DNI tiene que estar libre en las DOS tablas: una solicitud pendiente con
  // el mismo documento bloquearía el alta por la web y ensuciaría la bandeja.
  const clashingApplications = await prisma.application.count({ where: { dni: DNI } });
  if (clashingApplications > 0) {
    throw new Error(`El DNI ${DNI} ya figura en ${clashingApplications} solicitud(es): no se toca nada.`);
  }

  let member = await prisma.member.findUnique({ where: { dni: DNI }, select: { id: true, fullName: true } });
  if (member) {
    console.log(`socio ficticio: ya existía (id ${member.id}, ${member.fullName})`);
  } else {
    const book = await prisma.book.findFirst({ where: { status: "open" }, select: { id: true, number: true } });
    if (!book) throw new Error("No hay ningún libro abierto: el socio nuevo no tendría dónde anotarse.");
    const street = await prisma.street.findFirst({ where: { name: STREET_NAME }, select: { id: true } });
    if (!street) throw new Error(`No está la calle "${STREET_NAME}" en el catálogo (tabla streets).`);

    // Las tres escrituras en una transacción, por el mismo motivo que el import
    // del padrón: una ficha sin asiento de admisión o sin número de libro es una
    // ficha rota que la re-corrida no repara (la idempotencia es por DNI).
    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.membership.aggregate({ where: { bookId: book.id }, _max: { memberNumber: true } });
      const memberNumber = (last._max.memberNumber ?? 0) + 1;
      const m = await tx.member.create({
        data: {
          fullName: FULL_NAME,
          dni: DNI,
          email: ACCOUNT_EMAIL,
          emailStatus: "declared",
          category: "active",
          status: "active",
          joinedAt: JOINED_AT,
          streetId: street.id,
          streetText: STREET_NAME,
          streetNumber: STREET_NUMBER,
          neighborhood: "Ciudadela",
        },
      });
      await tx.membership.create({ data: { memberId: m.id, bookId: book.id, memberNumber } });
      await tx.movement.create({
        data: { memberId: m.id, type: "admission", date: JOINED_AT, newCategory: "active", detail: ADMISSION_DETAIL },
      });
      return { id: m.id, fullName: m.fullName, memberNumber, bookNumber: book.number };
    });
    member = { id: created.id, fullName: created.fullName };
    console.log(`socio ficticio: creado (id ${created.id}, N° ${created.memberNumber} del Libro ${created.bookNumber})`);
  }

  // `Member.userId` es único: la cuenta no puede quedar vinculada a dos fichas,
  // así que primero se suelta la que tenga. Se pasa por `memberWriter` y no por
  // `prisma.member.update` a secas para no saltearse las invariantes de la
  // escritura de fichas (revocación de enlaces vivos y sincronización del email
  // de la cuenta); acá ninguna se dispara —el email no cambia— pero el camino
  // correcto es el del dueño del dato.
  const previous = await prisma.member.findFirst({
    where: { userId: user.id, id: { not: member.id } },
    select: { id: true, fullName: true },
  });
  if (previous) {
    await memberWriter.updateMember(previous.id, { userId: null });
    console.log(`cuenta ${ACCOUNT_EMAIL}: desvinculada de la ficha id ${previous.id} (${previous.fullName})`);
  }
  await memberWriter.updateMember(member.id, { userId: user.id });
  console.log(`cuenta ${ACCOUNT_EMAIL}: vinculada al socio id ${member.id} (${member.fullName})`);
}

main().then(() => prisma.$disconnect()).catch((err) => { console.error(err); process.exit(1); });
