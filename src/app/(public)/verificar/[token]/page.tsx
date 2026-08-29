import { ConfirmForm } from "./confirm-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACCESS_ERRORS, canRedeem, deadVerificationCopy, REDEEM_CARD_SELECT, REDEEM_PAGE_COPY,
} from "@/lib/members/access";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";

// El token viene en la URL: nada de esto se puede cachear ni prerenderizar.
export const dynamic = "force-dynamic";

// Los dos textos que NO se pueden reusar del circuito de fichas, porque para una
// solicitud son falsos. Viven acá y no en `REDEEM_PAGE_COPY` por lo mismo que el
// mensaje de éxito vive en `confirm-form`: son de esta rama y de ninguna otra.
const APPLICATION_COPY = {
  // El pie de la ficha dice "sin tu confirmación no queda registrada ninguna
  // dirección", y para una ficha es cierto. Para una SOLICITUD no: la dirección
  // quedó registrada en el `create` del wizard y se copia a la ficha al asentar.
  // Lo que la confirmación habilita no es el registro sino el uso.
  notYou:
    "Si no esperabas este correo, cerrá esta página: sin tu confirmación no vamos a usar esta casilla para notificarte.",
  // Y el enlace muerto no puede mandar a pedir un reenvío que no existe: el
  // token de verificación de una solicitud se emite UNA sola vez, al crearla
  // (el reenvío público del wizard rota el token de RETOME, que es otro).
  dead:
    "Este enlace de verificación ya fue usado o venció, y es de un solo uso. Si tu solicitud sigue en trámite, comunicate con la Asociación Vecinal.",
} as const;

export const metadata = {
  title: "Verificá tu email — Vecinal Ciudadela",
  // El enlace lleva un token de un solo uso: que no lo indexe nadie.
  robots: { index: false, follow: false },
};

export default async function VerificarPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  // `peek` y NO `consume`: este es un GET y los escáneres de enlaces de los
  // clientes de correo abren la URL antes que la persona. Un GET que consumiera
  // dejaría al socio con un enlace muerto sin haber hecho nada.
  const t = await tokens.peek(token, "email_verification");
  // Sólo la dirección y el estado: esta página es anónima y el correo que trajo
  // el enlace pudo haber ido a la casilla equivocada. El nombre del socio no se
  // lee ni se muestra — ver `REDEEM_CARD_SELECT`.
  const member = t?.memberId
    ? await prisma.member.findUnique({ where: { id: t.memberId }, select: REDEEM_CARD_SELECT })
    : null;

  // El mismo enlace puede pertenecer a una SOLICITUD del wizard (M3), que
  // todavía no tiene ficha ni cuenta. Se le muestra este mismo formulario: el
  // texto es genérico y no nombra a nadie. De la solicitud se lee sólo la
  // dirección, con el mismo criterio de `REDEEM_CARD_SELECT` — nunca el nombre.
  const application = t?.applicationId
    ? await prisma.application.findUnique({ where: { id: t.applicationId }, select: { email: true } })
    : null;

  // Un enlace que ya no sirve no dice de quién era, y el texto genérico manda a
  // pedir un reenvío que para una solicitud no existe. `ownerOf` lee el dueño
  // del token aunque esté usado o vencido —no valida ni autoriza nada— sólo para
  // elegir cuál de los dos textos corresponde. Si el token no está ni siquiera
  // como rastro, queda el genérico, que es correcto para el circuito de fichas.
  const deadOwner = t ? null : await tokens.ownerOf(token, "email_verification");
  // §7.2: si el dueño es una FICHA verificada y sin cuenta, el enlace murió pero
  // el trámite avanzó — el texto lo dice (deadVerificationCopy, compartida con
  // la action). El select es mínimo y sin nombre, mismo criterio que
  // REDEEM_CARD_SELECT: esta página sigue siendo anónima.
  const deadMember = deadOwner?.memberId
    ? await prisma.member.findUnique({
        where: { id: deadOwner.memberId },
        select: { status: true, emailStatus: true, userId: true },
      })
    : null;
  const deadCopy = deadOwner?.applicationId ? APPLICATION_COPY.dead : deadVerificationCopy(deadMember);

  // La misma revalidación en vivo que hace el canje: si el socio quedó dado de
  // baja después del envío, la página no le ofrece el botón. Lo que cierra el
  // agujero es la guarda del canje —esto es sólo no mentirle a la persona—.
  // La solicitud no tiene un estado equivalente que cierre el canje: verificar
  // el email es idempotente y no le da acceso a nada por sí solo (lo que la
  // action SÍ mira antes de propagar a la ficha es el estado de la solicitud).
  const blocked = member ? canRedeem(member)
    : application ? { ok: true as const }
    : { ok: false as const, error: deadCopy };
  const email = member?.email ?? application?.email ?? null;
  const usable = blocked.ok && email;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Verificación de email</CardTitle>
          <CardDescription>
            {usable
              ? "Confirmá tu domicilio electrónico ante la Vecinal Ciudadela."
              : "No pudimos usar este enlace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usable ? (
            <ConfirmForm
              token={token}
              footer={
                <p className="text-sm text-muted-foreground">
                  {member ? REDEEM_PAGE_COPY.verifyNotYou : APPLICATION_COPY.notYou}
                </p>
              }
            >
              <p className="text-sm">{REDEEM_PAGE_COPY.verifyLead}</p>
              <p className="rounded bg-secondary px-3 py-2 text-sm font-medium break-all">
                {email}
              </p>
              <p className="text-sm text-muted-foreground">{REDEEM_PAGE_COPY.verifyWhy}</p>
            </ConfirmForm>
          ) : (
            <p className="text-sm text-red-600" role="alert">
              {blocked.ok ? ACCESS_ERRORS.noEmail : blocked.error}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
