"use client";
import { useEffect, type RefObject } from "react";

// React 19 resetea el <form action> cuando la server action termina. Con inputs
// de texto controlados eso no se nota: React los vuelve a poner en el valor del
// estado. Con <select> y <input type="radio"> SÍ se nota, y feo:
//
//   `form.reset()` los devuelve a su selección por defecto — la primera opción
//   del select, ningún radio marcado — y React no los corrige, porque desde su
//   punto de vista ninguna prop cambió y no hay nada que actualizar en el DOM.
//
// En estas pantallas el rechazo es el caso frecuente (elecciones en curso,
// socio ya dado de baja, número de acta repetido), así que el efecto real era:
// el admin elige "Colaborador", la acción la rechaza el estatuto, y el
// formulario vuelve a mostrar "Activo" sin decir nada. Si reintenta sin mirar,
// cambia al socio a una categoría que nunca eligió. Es el peor error posible en
// un asiento societario: silencioso y con la firma del admin.
//
// El hook re-afirma en el DOM lo que dice el estado después de cada render, que
// es cuando el reset ya ocurrió.
export function useFormResetSync(
  ref: RefObject<HTMLElement | null>,
  values: Record<string, string>,
): void {
  // A propósito sin array de dependencias: el reset de React no cambia ningún
  // valor de React, así que no hay dependencia que mirar — hay que revisar el
  // DOM en cada render.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const el of root.querySelectorAll("select")) {
      const wanted = values[el.name];
      if (wanted !== undefined && el.value !== wanted) el.value = wanted;
    }
    for (const el of root.querySelectorAll<HTMLInputElement>("input[type=radio]")) {
      const wanted = values[el.name];
      if (wanted !== undefined && el.checked !== (el.value === wanted)) {
        el.checked = el.value === wanted;
      }
    }
  });
}
