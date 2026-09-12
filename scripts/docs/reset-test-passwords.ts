// Reaplica SEED_TEST_PASSWORD a los tres usuarios de prueba que usan las
// capturas de docs/manuales y activa verificacion.m2 (superadmin de prueba).
// Solo corre contra una base en localhost. Uso: npx tsx scripts/docs/reset-test-passwords.ts
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "../../src/lib/auth/password";
import { prisma } from "../../src/lib/prisma";

const TEST_USERS = ["admin.prueba@sigev.local", "socio.prueba@sigev.local", "verificacion.m2@sigev.local"];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    throw new Error("Este script solo corre contra una base en localhost (DATABASE_URL).");
  }
  const password = process.env.SEED_TEST_PASSWORD;
  if (!password) throw new Error("Falta SEED_TEST_PASSWORD en el .env local.");
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  for (const email of TEST_USERS) {
    const r = await prisma.user.updateMany({ where: { email }, data: { passwordHash, passwordChangedAt: new Date(), active: true } });
    console.log(`${email}: ${r.count ? "contraseña reaplicada" : "NO EXISTE"}`);
  }
}

main().then(() => prisma.$disconnect()).catch((err) => { console.error(err); process.exit(1); });
