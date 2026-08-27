import Link from "next/link";
import { getContactInfo } from "@/lib/config";
import { formatDateAR, formatDateTimeAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { presentations } from "@/lib/reregistration/presentation";
import {
  editabilityOf, REREGISTRATION_NEIGHBOURHOOD, type PresentationData,
} from "@/lib/reregistration/presentation-rules";
import { ReempadronateWizard } from "../../reempadronate-wizard";
import { ResendLinkForm } from "../../resend-link-form";
import type { PresentationDraft, PresentationSnapshot } from "../../wizard-shared";

// El token viene en la URL: nada de esto se puede cachear ni prerenderizar.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tu re-empadronamiento — Vecinal Ciudadela",
  // La URL LLEVA el token adentro: indexada, quedaría publicado. Mismo criterio
  // que /verificar, /acceso y /asociate/retomar (y el prefijo está también en
  // robots.ts).
  robots: { index: false, follow: false },
};

// GET SIN EFECTOS: sólo lee. El token NO se consume —es la llave de la
// presentación mientras viva, no un vale de un solo uso—, así que el escáner de
// enlaces de un cliente de correo que abra la URL antes que la persona no rompe
// nada. Y no lleva captcha ni cupo: es una lectura por índice, y limitarla
// castigaría al que refresca (mismo criterio que documenta `publicTokenLimiter`
// para los GET). Los POST que salen de esta pantalla sí lo llevan.
export default async function RetomarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await presentations.findByToken(token);

  // Enlace muerto: el token no matchea nada. Puede ser un enlace incompleto, o
  // uno que quedó reemplazado por otro más nuevo —la llave vive de a una— si el
  // vecino pidió un reenvío o volvió a entrar por el paso 1. El cartel es
  // genérico y ofrece el reenvío, que es la salida real.
  if (!view) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">No encontramos ese re-empadronamiento</h1>
        <p className="mt-3 text-muted-foreground">
          El enlace puede estar incompleto o haber sido reemplazado por uno más nuevo. Revisá el
          último correo que te mandamos, o pedinos que te lo reenviemos.
        </p>
        <div className="mt-6 rounded-xl border border-border p-4">
          <p className="text-sm font-semibold">Reenviame el enlace</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Escribí tu DNI y te lo mandamos al email que dejaste en tu re-empadronamiento.
          </p>
          <ResendLinkForm siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />
        </div>
        <p className="mt-8">
          <Link href="/reempadronate" className="text-sm text-primary underline underline-offset-2">
            Volver al re-empadronamiento
          </Link>
        </p>
      </main>
    );
  }

  // El wizard sólo edita lo que se puede editar. Con la presentación ya enviada
  // —o resuelta por la Comisión, o con el proceso fuera de sus dos instancias—
  // esta pantalla es de SÓLO LECTURA: dice en qué estado quedó y nada más
  // (§5.4). Lo decide `editabilityOf`, la misma función que usan las tres
  // actions de escritura, así que no puede abrirse acá lo que allá se rechaza.
  const editable = editabilityOf({ status: view.status, processStatus: view.processStatus });
  if (!editable.ok) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <StatusScreen view={view} />
      </main>
    );
  }

  // Editable: el wizard rehidratado con los datos propios. Acá SÍ se precargan,
  // y eso no contradice la anti-precarga del paso 1: el enlace llegó al buzón
  // que el propio vecino declaró, así que el buzón ya demostró ser suyo.
  const [contact, streets, street] = await Promise.all([
    getContactInfo(),
    prisma.street.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, loadOrder: true },
    }),
    view.data.streetId
      ? prisma.street.findUnique({ where: { id: view.data.streetId }, select: { name: true } })
      : null,
  ]);

  const snapshot: PresentationSnapshot = {
    status: view.status,
    observation: view.observation,
    submittedAt: view.submittedAt?.toISOString() ?? null,
    validatedAt: view.validatedAt?.toISOString() ?? null,
    open: true,
    uploadedTypes: view.uploadedTypes,
    draft: draftOf(view.data, street?.name ?? ""),
  };

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <ReempadronateWizard
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        contact={contact}
        streets={streets}
        initial={{ token, presentation: snapshot }}
      />
    </main>
  );
}

/** La pantalla de estado. Un estado por vez y en castellano llano: quien abre
 *  este enlace quiere saber una sola cosa, si tiene que hacer algo o no. */
function StatusScreen({
  view,
}: {
  view: NonNullable<Awaited<ReturnType<typeof presentations.findByToken>>>;
}) {
  if (view.status === "validated") {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">Tu re-empadronamiento está aprobado</h1>
        <p className="mt-3 text-muted-foreground">
          {view.validatedAt
            ? `La Comisión Directiva lo validó el ${formatDateAR(view.validatedAt)}. No tenés que hacer nada más.`
            : "La Comisión Directiva ya lo validó. No tenés que hacer nada más."}
        </p>
        <BackHome />
      </>
    );
  }

  if (view.status === "submitted") {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">Tu re-empadronamiento está en revisión</h1>
        <p className="mt-3 text-muted-foreground">
          {view.submittedAt
            ? `Lo recibimos el ${formatDateTimeAR(view.submittedAt)}. Esa fecha es la constancia de que te presentaste dentro del plazo.`
            : "Ya lo recibimos."}
        </p>
        <p className="mt-3 text-muted-foreground">
          La Comisión Directiva lo va a revisar. Si falta o hay que corregir algo, te escribimos por
          email.
        </p>
        <BackHome />
      </>
    );
  }

  // Los estados que quedan (`rejected`, `withdrawn`, y cualquier editable con
  // el proceso ya cerrado) NO se explican por pantalla: el motivo lo tiene el
  // operador y decirlo acá, en una página que se abre con un enlace reenviable,
  // sería resolver por escrito y sin contexto algo que la Comisión resuelve
  // mirando a la persona. La salida es la sede, que es donde está el legajo.
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Tu re-empadronamiento no está abierto</h1>
      <p className="mt-3 text-muted-foreground">
        Por la web ya no se puede modificar. Acercate a la sede vecinal con tu documento y lo
        revisamos con vos.
      </p>
      <BackHome />
    </>
  );
}

function BackHome() {
  return (
    <p className="mt-8">
      <Link href="/" className="text-sm text-primary underline underline-offset-2">
        Volver al inicio
      </Link>
    </p>
  );
}

/** La ficha guardada → el borrador que tipea el wizard. Todo string porque es
 *  lo que viaja en el `<form>`; la fecha se corta a "AAAA-MM-DD" desde el
 *  mediodía UTC del día civil, que es como el proyecto guarda las fechas
 *  civiles. */
function draftOf(data: PresentationData, streetName: string): PresentationDraft {
  const email = data.email ?? "";
  return {
    // El `<input type="date">` habla "AAAA-MM-DD". El valor guardado es el
    // mediodía UTC del día civil argentino —como toda fecha civil del
    // proyecto—, así que cortar el ISO da el día correcto sin que la hora lo
    // corra.
    birthDate: data.birthDate ? data.birthDate.toISOString().slice(0, 10) : "",
    civilStatus: data.civilStatus ?? "",
    nationality: data.nationality ?? "Argentina",
    occupation: data.occupation ?? "",
    streetId: data.streetId,
    streetName,
    streetNumber: data.streetNumber ?? "",
    // Lo guardado NO se relee: el barrio del wizard es fijo y la única salida
    // del paso 2 es guardar, que lo reescribe con la constante. Mostrar acá
    // otro valor —el que un operador pudo cargar desde el mostrador— sería
    // prometerle al vecino un domicilio que su propio envío va a cambiar.
    neighborhood: REREGISTRATION_NEIGHBOURHOOD,
    phone: data.phone ?? "",
    email,
    // Precargado igual que el email: hacerle repetir la dirección a quien ya la
    // declaró y sólo viene a corregir una foto sería fricción sin ganancia.
    emailConfirm: email,
  };
}

