"use server";
// La action pública del paso 1 de REEMPADRONATE: el vecino escribe su DNI y el
// sistema le contesta si le corresponde re-empadronarse.
//
// No hay sesión y no puede haberla: el Art. 9° bis convoca a socios que en su
// enorme mayoría nunca tuvieron cuenta en el sitio. Lo único que protege este
// endpoint es el mismo orden de guardas del wizard de alta —interruptor, cupo,
// captcha, formato, cobro del intento, recién entonces el padrón—, y eso está
// calcado a propósito de `createApplicationAction`; el comentario de más abajo
// dice por qué cada pieza está donde está.
//
// Lo que esta pantalla NO puede hacer, y es la decisión de producto que la
// gobierna: revelar por diferencia. El DNI no es autenticación —cualquiera
// puede tipear el de otro—, así que todos los caminos negativos contestan lo
// MISMO y el positivo devuelve el nombre ENMASCARADO para que el propio vecino
// se reconozca sin que un desconocido se entere de quién es. La identidad real
// la acredita después el operador, mirando las fotos del DNI (Task 11).
//
// Y no hay ningún paso de pago en todo el wizard (decisión del operador,
// 25/08/2026): re-empadronarse no ofrece pagar, ni adherir débito, ni cambiar
// montos. Nada de este archivo toca el circuito de plata.
import { headers } from "next/headers";
import { z } from "zod";
import { reregistrationLookupLimiter } from "@/lib/auth/rate-limiter";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { openWizardProcess } from "@/lib/reregistration/current";
import { lookupVerdict } from "@/lib/reregistration/rules";
import { verifyTurnstile } from "@/lib/turnstile";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint). El wizard cliente declara su
// propio tipo estructural equivalente en `wizard-shared.ts`.
type LookupState =
  | { kind: "idle" }
  | { kind: "eligible"; maskedName: string; presentationToken: string }
  | { kind: "already_submitted"; canResend: boolean }
  | { kind: "not_found" }
  | { kind: "error"; error: string };

const TOO_MANY = "Demasiados intentos desde esta conexión. Probá de nuevo en un rato.";
const NO_CAPTCHA = "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo.";
const PROCESS_CLOSED =
  "En este momento no hay un proceso de re-empadronamiento en curso. Si creés que sí, acercate a la sede vecinal.";

// El mismo schema que ASOCIATE usa para el DNI: sólo dígitos, 7 a 9. No se
// comparte el símbolo porque allá es una constante de módulo dentro de un
// archivo "use server", que no puede exportar nada que no sea una función.
const schema = z.object({
  dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números, sin puntos)"),
});

// Sólo X-Real-IP, como el login, el recupero y ASOCIATE: el resto de las
// cabeceras de IP las puede fijar el cliente si le pega directo al origen, y
// rotándolas se regalaría un presupuesto nuevo del limitador en cada intento.
async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

export async function lookupAction(_prev: LookupState, formData: FormData): Promise<LookupState> {
  const ip = await clientIp();

  // Guarda 1: el proceso tiene que estar ABIERTO.
  //
  // `page.tsx` ya lo chequea al renderizar, y eso no alcanza: la pestaña que
  // quedó abierta cuando venció la segunda instancia, y un POST armado a mano,
  // no vuelven a pasar por el render. Esta action es un endpoint público y
  // tiene que decidir por sí misma — exactamente el mismo argumento por el que
  // `createApplicationAction` revalida el interruptor de ASOCIATE.
  //
  // Importa de verdad: lo que cierra este wizard es el vencimiento de un plazo
  // estatutario, y una presentación aceptada un día tarde es una presentación
  // que la Comisión no puede considerar.
  //
  // Va primero por claridad, no por ahorro: `allows` es una consulta en memoria
  // que NO cobra el intento, así que ponerla antes o después no le gasta cupo a
  // nadie. Se lee mejor con la pregunta institucional arriba de todo.
  const activeProcess = await openWizardProcess(prisma);
  if (activeProcess === null) return { kind: "error", error: PROCESS_CLOSED };

  // El orden es `allows` → captcha → formato → `record` → padrón, calcado de
  // `createApplicationAction` (que lo documenta en largo). En corto:
  //
  //   - se CONSULTA el cupo primero, sin gastarlo, para no cobrarle un intento
  //     a quien ya está bloqueado;
  //   - se REGISTRA recién después del captcha, porque la ficha de Turnstile
  //     dura ~5 minutos y una vencida no puede quemarle un intento al vecino
  //     que fue a buscar el documento;
  //   - y después del formato, porque un DNI mal tipeado tampoco puede.
  //
  // Nada de esto afloja la anti-enumeración: la validez de FORMATO es zod sobre
  // el POST (ninguna consulta), cada intento sigue costando un captcha resuelto
  // —el token de Turnstile es de un solo uso— y todo lo que toca el padrón
  // queda detrás del captcha Y del cupo ya cobrado.
  if (!reregistrationLookupLimiter.allows(ip)) return { kind: "error", error: TOO_MANY };
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { kind: "error", error: NO_CAPTCHA };

  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { kind: "error", error: parsed.error };
  const dni = parsed.data.dni; // normalizado: parseForm recorta y el regex deja sólo dígitos

  // Desde acá se toca el padrón, así que el intento se cobra: el cupo es lo
  // único, junto con el captcha, que impide usar este formulario para barrerlo.
  reregistrationLookupLimiter.record(ip);

  // Una sola consulta: la ficha y —si existe— SU fila de cohorte en ESTE
  // proceso. El `where` por `processId` es lo que hace que un socio convocado en
  // un proceso anterior no cuente como convocado en éste.
  const member = await prisma.member.findUnique({
    where: { dni },
    select: {
      id: true,
      fullName: true,
      category: true,
      status: true,
      presentations: {
        where: { processId: activeProcess.id },
        select: { status: true, email: true },
        // La unique (`processId`, `memberId`) ya garantiza que hay a lo sumo
        // una; el take es para que el tipo sea el que es.
        take: 1,
      },
    },
  });

  // NO SE AUDITA. Es una búsqueda anónima de un formulario público: un asiento
  // por intento llenaría `audit_log` de ruido y, peor, dejaría registrado qué
  // DNI consultó cada dirección IP — un dato personal que nadie va a mirar
  // nunca y que hoy no existe (docs/08, Ley 25.326). El precedente es el GET
  // público de la solicitud, que tampoco audita. Lo que sí se audita es lo que
  // hace el operador en el panel.
  const verdict = lookupVerdict({
    member,
    presentation: member?.presentations[0] ?? null,
  });

  switch (verdict.kind) {
    case "eligible":
      return {
        kind: "eligible",
        maskedName: verdict.maskedName,
        // Vacío a propósito: el token de la presentación lo acuña la Task 11
        // junto con el paso 2 (patrón `mintResumeToken → enviar → commit` de
        // `applications/service.ts`). Acá todavía no hay nada que retomar, y
        // acuñarlo antes dejaría un token vivo colgado de una presentación que
        // nadie empezó.
        presentationToken: "",
      };
    case "already_submitted":
      return {
        kind: "already_submitted",
        // Si la presentación no dejó email no hay a dónde reenviar el enlace, y
        // la pantalla tiene que decirlo en vez de ofrecer un botón que no puede
        // funcionar. La action de reenvío la suma la Task 11
        // (`reregistrationResendLimiter` ya está reservado).
        canResend: Boolean(member?.presentations[0]?.email),
      };
    case "not_found":
      return { kind: "not_found" };
  }
}
