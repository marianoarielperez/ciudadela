"use client";

import { Button } from "@/components/ui/button";

// `window.print()` necesita el cliente, y es lo ÚNICO que necesita: el resto de
// la pantalla es un server component. Se aísla acá para no arrastrar el resumen
// entero —que consulta la base— al bundle del navegador.
//
// `print:hidden` como en el resto de los controles: el botón no sale en la hoja.
export function PrintButton() {
  return (
    <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}>
      Imprimir
    </Button>
  );
}
