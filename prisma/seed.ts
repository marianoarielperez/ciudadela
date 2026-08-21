import bcrypt from "bcryptjs"

import type { Prisma } from "../src/generated/prisma/client"
import { BCRYPT_COST } from "../src/lib/auth/password"
import { prisma } from "../src/lib/prisma"

// `password` sólo se usa para CREAR la cuenta; si ya existe no se mira siquiera.
// Por eso es opcional: el seed corre en cada despliegue (deploy.sh) y exigir la
// variable incluso cuando la cuenta ya está creada convertiría un `.env` sin
// `SEED_SUPERADMIN_PASSWORD` en un deploy roto, sin ninguna contrapartida.
async function upsertUser(
  email: string,
  name: string,
  password: string | undefined,
  roleNames: string[],
) {
  const roles = await prisma.role.findMany({ where: { name: { in: roleNames } } })
  const existing = await prisma.user.findUnique({ where: { email } })
  // Nunca pisar la contraseña de un usuario existente
  let user = existing
  if (!user) {
    if (!password) throw new Error(`Falta la contraseña para crear ${email}`)
    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        // Mismo criterio que los otros dos caminos que escriben una
        // contraseña: la columna significa "cuándo se escribió ésta". Acá no
        // hay ninguna sesión que invalidar (la cuenta acaba de nacer), pero
        // dejarla nula haría que una cuenta creada hoy fuera indistinguible de
        // las previas a la migración. Ver `@/lib/auth/session-freshness`.
        passwordChangedAt: new Date(),
      },
    })
  }
  for (const role of roles) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    })
  }
  console.log(`${existing ? "ok  " : "new "} usuario ${email} [${roleNames.join(", ")}]`)
  return user
}

// Borradores de los textos legales del wizard ASOCIATE (M3). Se siembran una
// sola vez: el `upsert` de abajo lleva `update: {}` justamente para que volver a
// correr el seed —cosa que pasa en cada despliegue— no pise lo que el superadmin
// haya editado desde /admin/configuracion.
//
// Texto PLANO a propósito (se renderiza con `whitespace-pre-line`, nunca como
// HTML) y marcado como BORRADOR: la redacción definitiva la aprueba la Comisión
// Directiva.
const TERMS_DRAFT = `Términos y condiciones de la solicitud de asociación

1. La solicitud de asociación se rige por el Estatuto de la Asociación Vecinal del Barrio Ciudadela y su admisión es resuelta por la Comisión Directiva (Art. 5 y Art. 23).
2. En las categorías con débito automático, el primer débito corresponde a la cuota de ingreso, equivalente a un mes de cuota. La cuota de ingreso NO es reembolsable, cualquiera sea el resultado de la solicitud.
3. La Comisión Directiva conserva la facultad de recategorizar o rechazar la solicitud si la documentación no acredita los requisitos de la categoría.
4. El solicitante declara que los datos consignados son veraces y que la documentación adjunta es auténtica.
5. La solicitud rechazada puede reintentarse a los 6 (seis) meses de la resolución denegatoria (Art. 5 inc. 7).

[BORRADOR — sujeto a aprobación de la Comisión Directiva]`

const PRIVACY_DRAFT = `Consentimiento para el tratamiento de datos personales (Ley 25.326)

Los datos personales y la documentación cargados en este formulario serán utilizados por la Asociación Vecinal del Barrio Ciudadela exclusivamente para la gestión de su solicitud de asociación y, de resultar admitido/a, para la administración de su condición de socio/a (registro de asociados, tesorería y notificaciones estatutarias).
Los datos no serán cedidos a terceros. El titular podrá ejercer los derechos de acceso, rectificación y supresión previstos por la Ley 25.326 ante la Comisión Directiva, en la sede de la asociación.
La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, tiene la atribución de atender denuncias y reclamos sobre incumplimiento de las normas de protección de datos personales.

[BORRADOR — sujeto a aprobación de la Comisión Directiva]`

async function main() {
  for (const name of ["superadmin", "admin", "socio"]) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } })
  }

  const superEmail = "marianoaperez@yahoo.com.ar"
  const superPass = process.env.SEED_SUPERADMIN_PASSWORD
  if (!superPass && !(await prisma.user.findUnique({ where: { email: superEmail } }))) {
    throw new Error("SEED_SUPERADMIN_PASSWORD no está definida")
  }
  await upsertUser(superEmail, "Mariano Perez", superPass, ["superadmin", "admin"])

  if (process.env.SEED_TEST_USERS === "true") {
    // Las cuentas de prueba tienen contraseña conocida: en producción serían
    // una puerta abierta. Preferimos romper el deploy antes que crearlas.
    if (process.env.NODE_ENV === "production") {
      throw new Error("SEED_TEST_USERS=true está prohibido en producción")
    }
    const testPass = process.env.SEED_TEST_PASSWORD
    if (!testPass) throw new Error("SEED_TEST_USERS=true pero falta SEED_TEST_PASSWORD")
    await upsertUser("admin.prueba@sigev.local", "Admin de Prueba", testPass, ["admin"])
    await upsertUser("socio.prueba@sigev.local", "Socio de Prueba", testPass, ["socio"])
  }

  // `update: {}` en todas: son valores INICIALES, no valores impuestos. El seed
  // se vuelve a correr en cada despliegue (`npx prisma db seed`, paso explícito
  // de deploy.sh) y pisar acá borraría el teléfono de contacto o el texto legal
  // que el superadmin cargó desde el panel.
  const defaults: Record<string, Prisma.InputJsonValue> = {
    asociate_activo: false,
    elecciones_en_curso: false,
    terms_text: TERMS_DRAFT,
    privacy_consent_text: PRIVACY_DRAFT,
  }
  const created: string[] = []
  const kept: string[] = []
  for (const [key, value] of Object.entries(defaults)) {
    const existing = await prisma.configuration.findUnique({ where: { key } })
    await prisma.configuration.upsert({ where: { key }, update: {}, create: { key, value } })
    ;(existing ? kept : created).push(key)
  }
  if (created.length > 0) console.log(`new  configuración: ${created.join(", ")}`)
  if (kept.length > 0) console.log(`ok   configuración (sin tocar): ${kept.join(", ")}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
