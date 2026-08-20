"use client";
import { useEffect, type RefObject } from "react";

// React 19 resetea el <form action> cuando la server action termina. Con inputs
// de texto controlados eso no se nota: React los vuelve a poner en el valor del
// estado. Con <select>, <input type="radio"> e <input type="checkbox"> SÍ se
// nota, y feo:
//
//   `form.reset()` los devuelve a su selección por defecto — la primera opción
//   del select, ningún radio marcado, el checkbox destildado — y React no los
//   corrige, porque desde su punto de vista ninguna prop cambió y no hay nada
//   que actualizar en el DOM.
//
// En estas pantallas el rechazo es el caso frecuente (elecciones en curso,
// socio ya dado de baja, número de acta repetido), así que el efecto real era:
// el admin elige "Colaborador", la acción la rechaza el estatuto, y el
// formulario vuelve a mostrar "Activo" sin decir nada. Si reintenta sin mirar,
// cambia al socio a una categoría que nunca eligió. Es el peor error posible en
// un asiento societario: silencioso y con la firma del admin.
//
// Con el checkbox pasa lo mismo y el daño es del mismo tipo: en noticias, el
// operador tilda "Quitar la portada actual", la acción rechaza por slug
// repetido, el reset destilda el checkbox sin avisar y al reintentar la
// portada sigue ahí. Nadie le dice que su decisión se perdió. Con el GRUPO de
// checkboxes de los días del calendario de salones es peor todavía: el rechazo
// por solapamiento es el caso frecuente, y volver a tildar cinco días a mano
// después de cada intento es la clase de fricción que termina en un horario
// cargado mal.
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
    if (ref.current) syncFormResetToState(ref.current, values);
  });
}

// El cuerpo del efecto, aparte para poder probarlo sin montar React.
export function syncFormResetToState(root: HTMLElement, values: Record<string, string>): void {
  for (const el of root.querySelectorAll("select")) {
    const wanted = values[el.name];
    if (wanted !== undefined && el.value !== wanted) el.value = wanted;
  }
  // Radios: marcado si y solo si el estado dice exactamente el `value` de ese
  // control (de un grupo de radios sale un valor solo).
  for (const el of root.querySelectorAll<HTMLInputElement>("input[type=radio]")) {
    const wanted = values[el.name];
    if (wanted !== undefined && el.checked !== (el.value === wanted)) {
      el.checked = el.value === wanted;
    }
  }
  // Checkboxes: pertenencia a una lista separada por comas. Generaliza la regla
  // de los radios sin salirse del Record<string, string>, y por eso cubre los
  // dos casos con un solo camino:
  //
  //   - Checkbox suelto: "on" lo tilda y "" lo destilda, que es exactamente lo
  //     que manda el navegador y lo que ya esperaba `removeCover` en noticias.
  //   - GRUPO con el mismo `name` —los días de la semana del calendario de
  //     salones— entra como "2,4" y cada input se re-tilda si su value está en
  //     la lista. Sin esto, el reset le borraba al operador los días tildados
  //     cada vez que la action rechazaba por solapamiento.
  //
  // Límite conocido: un `value` con una coma adentro no se puede representar.
  // Hoy todos son "on" o un dígito del 1 al 7.
  for (const el of root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
    const wanted = values[el.name];
    if (wanted === undefined) continue;
    const shouldCheck = wanted.split(",").includes(el.value);
    if (el.checked !== shouldCheck) el.checked = shouldCheck;
  }
}
