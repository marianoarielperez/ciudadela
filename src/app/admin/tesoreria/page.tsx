import { redirect } from "next/navigation";

import { TREASURY_HOME } from "@/lib/admin/treasury-tabs";

// La sección no tiene pantalla propia: la primera pestaña es la pantalla. El
// ítem de la lateral apunta acá para que "/admin/tesoreria" siga siendo una URL
// válida (y para que la pestaña activa se marque igual al entrar).
//
// Única página del panel sin `requireAdmin()`: no lee nada ni muestra nada, sólo
// reescribe la URL a una pestaña que SÍ se autoriza a sí misma. Agregar la
// guarda acá no protegería ningún dato y duplicaría la consulta de la cuenta
// viva en cada entrada a la sección.
export default function TesoreriaPage() {
  redirect(TREASURY_HOME);
}
