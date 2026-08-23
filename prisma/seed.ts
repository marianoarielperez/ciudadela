import bcrypt from "bcryptjs"

import type { Prisma } from "../src/generated/prisma/client"
import { BCRYPT_COST } from "../src/lib/auth/password"
import { prisma } from "../src/lib/prisma"
import { resolveTestUsers, TEST_USERS_OPT_IN } from "./seed-guard"

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
  if (!existing) {
    for (const role of roles) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } })
    }
    console.log(`new  usuario ${email} [${roles.map((r) => r.name).join(", ")}]`)
    return user
  }

  // La cuenta YA existía: los roles NO se vuelven a otorgar. El seed corre en
  // cada despliegue (deploy.sh), así que re-upsertear los roles haría que una
  // revocación deliberada —degradar al superadmin, por ejemplo— volviera sola
  // en el próximo deploy, en silencio. Un deploy no es el lugar donde se
  // decide quién es admin.
  //
  // Lo que sí se hace es AVISAR: si falta un rol (revocación deliberada, o un
  // rol nuevo que estrena un módulo) queda escrito en el log del deploy. Para
  // otorgarlo hay que hacerlo a mano desde /admin/usuarios.
  const current = await prisma.userRole.findMany({
    where: { userId: user.id, roleId: { in: roles.map((r) => r.id) } },
    select: { roleId: true },
  })
  const held = new Set(current.map((r) => r.roleId))
  const missing = roles.filter((r) => !held.has(r.id)).map((r) => r.name)
  console.log(
    `ok   usuario ${email} [${roles
      .filter((r) => held.has(r.id))
      .map((r) => r.name)
      .join(", ")}]` +
      (missing.length > 0 ? ` — AVISO: sin ${missing.join(", ")} (el seed no los re-otorga)` : ""),
  )
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

  // Las cuentas de prueba tienen contraseña conocida y una de ellas es admin:
  // sobre la base real serían un backdoor. La decisión —opt-in explícito, falla
  // cerrado— vive en `seed-guard.ts`, con el porqué completo.
  const testUsers = resolveTestUsers()
  if (testUsers.create) {
    const testPass = process.env.SEED_TEST_PASSWORD
    if (!testPass) throw new Error(`${TEST_USERS_OPT_IN}="true" pero falta SEED_TEST_PASSWORD`)
    await upsertUser("admin.prueba@sigev.local", "Admin de Prueba", testPass, ["admin"])
    await upsertUser("socio.prueba@sigev.local", "Socio de Prueba", testPass, ["socio"])
    // 4B: una suscripción vinculada y una fila de bandeja, para ver las
    // pantallas sin Mercado Pago. Sólo con cuentas de prueba: en producción la
    // bandeja y las suscripciones son datos reales.
    //
    // El id es HEXADECIMAL de 32 como los de verdad, y no algo legible tipo
    // "5eed0000000000000000000000000001", porque MP valida la FORMA antes de buscar:
    // `/authorized_payments/search?preapproval_id=seed-...` responde
    // `Invalid value 'seed', Field 'id' must match this pattern: '[a-f0-9-]+'`.
    // Con un id legible, el cron de conciliación devolvía 207 con dos errores
    // en TODA corrida local — y un cron que siempre falla un poco es un cron
    // cuyos errores nadie mira. Verificado en la batería de la T14.
    const seedMember = await prisma.member.findFirst({ where: { status: "active" }, select: { id: true } })
    if (seedMember) {
      await prisma.mpSubscription.upsert({
        where: { preapprovalId: "5eed0000000000000000000000000001" },
        update: {},
        create: {
          preapprovalId: "5eed0000000000000000000000000001", memberId: seedMember.id, status: "authorized",
          payerEmail: "socio.prueba@sigev.local", linkedManually: true, amount: "6000.00",
          externalReference: null, planId: null, lastSyncAt: new Date(),
        },
      })
      await prisma.mpUnmatchedPayment.upsert({
        where: { mpPaymentId: "seed-payment-0001" },
        update: {},
        create: {
          mpPaymentId: "seed-payment-0001", amount: "3000.00", paidAt: new Date(),
          payerEmail: "vecino@example.com", externalReference: null, description: "Cuota Vecinal",
          reason: "no_reference",
        },
      })
      console.log("new  4B: suscripción y fila de bandeja de prueba")
    }
  } else {
    // Log explícito: el silencio no distingue "no se crearon" de "no se miró".
    console.log(`skip cuentas de prueba: ${testUsers.reason}`)
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

  // Valor de cuota inicial (M4, REG-34): $6.000 activo / $3.000 adherente y
  // colaborador, fijados por la asamblea de agosto de 2026. Rige desde el
  // 01/08/2026 y no desde el primer devengo (septiembre): la deuda importada
  // llega hasta agosto y se salda a valor vigente (REG-16), así que una
  // vigencia posterior a hoy dejaría al sistema sin monto con qué cobrar.
  // Solo si la tabla está vacía: los valores posteriores se registran desde
  // /admin/configuracion con su acta.
  const anyFeeValue = await prisma.feeValue.findFirst({ select: { id: true } })
  if (!anyFeeValue) {
    await prisma.feeValue.create({
      data: { activeAmount: "6000.00", sharedAmount: "3000.00", validFrom: new Date(Date.UTC(2026, 7, 1, 12)) },
    })
    console.log("new  valor de cuota inicial: activo 6000 / compartido 3000 (vigente 01/08/2026)")
  } else {
    console.log("ok   valor de cuota (sin tocar)")
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
