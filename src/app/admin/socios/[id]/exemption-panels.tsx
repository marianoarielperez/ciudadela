// La EXENCIÓN (Art. 7 inc. a.4) en la ficha del socio: badge, aviso y botón.
//
// Fuera de `page.tsx` a propósito. La ficha es un componente async que consulta
// Prisma, así que no se puede montar en un test; estos tres reciben datos
// serializables y no tocan la base, y el test de pantalla los renderiza con
// `renderToStaticMarkup` (precedente `admin-health-screen`, molde
// `cierre/confirmar/confirm-panels.tsx`).
//
// Cada uno decide su propia visibilidad y devuelve `null` cuando no corresponde:
// así la regla —"se exime al socio VIGENTE, sin exención, y lo asienta el
// superadmin"— vive en un solo lugar que el test ejercita, en vez de repartida
// en tres condicionales de la página. Lo de acá es DISPLAY: la autorización real
// la vuelven a hacer la ruta de Exenciones y sus dos actions.
import Link from "next/link";

import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { minuteName } from "@/lib/members/labels";
import type { ActiveExemption } from "@/lib/treasury/exemptions";
import { periodLabel } from "@/lib/treasury/periods";
import type { MemberStatus } from "@/generated/prisma/client";

/** Lo que la ficha necesita de la exención vigente. Sale de `activeExemption`
 *  —LA función compartida— y no de un `where` propio de esta pantalla: lo que la
 *  ficha muestra como vigente es exactamente lo que los cinco caminos de pago
 *  bloquean. El tipo se importa con `import type` porque el módulo del dominio
 *  arma su singleton con Prisma al evaluarse. */
export type FichaExemption = Pick<ActiveExemption, "fromPeriod" | "toPeriod" | "minuteId" | "minute">;

/** El badge de la fila del encabezado. "Eximido" solo no dice hasta cuándo, y el
 *  rango no entra en una pastilla: va en un `sr-only`, que es además lo único
 *  que oye quien navega por lectura de pantalla. */
export function ExemptionBadge({ exemption }: { exemption: FichaExemption | null }) {
  if (!exemption) return null;
  return (
    <Badge variant="success">
      Eximido
      <span className="sr-only">
        {` de la cuota: ${periodLabel(exemption.fromPeriod)} a ${periodLabel(exemption.toPeriod)}`}
      </span>
    </Badge>
  );
}

/** El aviso, junto a los otros tres de la ficha. NEUTRO y no ámbar: no es un
 *  problema ni una tarea pendiente, es un hecho que el operador tiene que saber
 *  antes de intentar cobrarle en el mostrador.
 *
 *  Nombra el acta por TIPO y NÚMERO —`minuteName`—, que es como se la busca en
 *  el libro; el `id` es sólo a dónde lleva el enlace. Decir "acta N° {id}" era
 *  señalar un documento que no existe: la verificación en vivo leyó "acta N° 16"
 *  sobre una exención asentada por la Comisión Directiva N° 124.
 *
 *  Lleva además el camino a Exenciones: mientras la exención rige, el botón
 *  "Eximir de cuota" no se ofrece, y sin este enlace la ficha no diría desde
 *  dónde se la anula. */
export function ExemptionNotice({ exemption }: { exemption: FichaExemption | null }) {
  if (!exemption) return null;
  return (
    <FormMessage kind="neutral" box>
      {`Exención de cuota vigente hasta ${periodLabel(exemption.toPeriod)} — acta `}
      <Link className={INLINE_LINK} href={`/admin/actas/${exemption.minuteId}`}>
        {minuteName(exemption.minute)}
      </Link>
      {". Mientras dure no se le puede cobrar ni una cuota ni un aporte. "}
      <Link className={INLINE_LINK} href="/admin/tesoreria/exenciones">
        Verla en Exenciones
      </Link>
      .
    </FormMessage>
  );
}

/** El botón del encabezado. Lleva a Exenciones con el socio ya elegido
 *  (`?socio=`), que es donde se asienta: la ficha no exime a nadie.
 *
 *  Las tres condiciones son las mismas que la pantalla de destino pre-valida y
 *  que `grant` revalida adentro de su transacción. Acá se esconde el botón para
 *  no mandar al operador a una puerta cerrada, no para defender nada.
 *
 *  Sin `min-h-11`: comparte fila con los otros botones del encabezado de la
 *  ficha, que van con el alto por defecto, y uno más alto que los demás se lee
 *  como otra cosa. */
export function ExemptAction({ memberId, status, exempted, superadmin }: {
  memberId: number;
  status: MemberStatus;
  exempted: boolean;
  superadmin: boolean;
}) {
  if (!superadmin || exempted || status !== "active") return null;
  return (
    <Button asChild variant="outline">
      <Link href={`/admin/tesoreria/exenciones?socio=${memberId}`}>Eximir de cuota</Link>
    </Button>
  );
}
