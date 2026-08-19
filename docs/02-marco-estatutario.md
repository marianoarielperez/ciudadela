# 02 — Marco estatutario (reglas de negocio)

Fuente: Estatuto reformado aprobado por Asamblea Extraordinaria del 15/08/2026,
**pendiente de oficialización por la IGJ del Chubut**. El sistema se construye ahora
y se lanza cuando la IGJ apruebe (ver disposición transitoria, Art. 40).

Este documento mapea cada artículo relevante a reglas concretas del sistema.
**Es el documento más importante del proyecto.**

## Categorías de socios (Art. 5, 5 bis)

| Categoría | Residencia en el barrio | Cuota | Alta por web | Derechos clave |
|---|---|---|---|---|
| Activo | Sí (obligatoria) | Obligatoria ($6.000) | Sí, con débito automático | Voz y voto, elegible para cargos |
| Adherente | Sí (obligatoria) | Voluntaria ($3.000) | Sí (con o sin débito) | Voz sin voto en asambleas; vota en elecciones |
| Colaborador | No (vinculación con el barrio) | Obligatoria ($3.000) | Sí, con débito automático | Voz sin voto; vota en elecciones; no elegible |
| Cadete | Sí, 14-17 años | — | **No** (por sede, con autorización parental) | Sin voz ni voto |
| Honorario | — | Eximido | **No** (lo designa la Asamblea) | = activo |
| Vitalicio | — | Eximido | **No** (automático a los 25 años como activo) | = activo |

Reglas de sistema:
- REG-01. El alta web solo ofrece Activo, Adherente (residentes en Ciudadela) y
  Colaborador (no residentes). Las demás categorías se cargan desde el panel admin.
- REG-02. Requisitos generales (Art. 5): 18+ años (validar con fecha de nacimiento),
  datos obligatorios de la solicitud: nombre y apellido, DNI, fecha de nacimiento,
  estado civil, nacionalidad, ocupación, domicilio físico y **domicilio electrónico (email)**.
- REG-03. Acreditación de residencia/identidad (Art. 5 inc. 3): el formulario exige
  subir foto de DNI frente y dorso, y admite hasta 2 anexos (factura de servicios,
  certificado). Para Colaborador, los anexos acreditan la vinculación con el barrio
  (titularidad de inmueble, vínculo familiar directo con residente, o actividad
  comercial/profesional en la zona — Art. 5 bis inc. d).
- REG-04. Un expulsado **no puede reingresar jamás** (Art. 5 inc. 2). El sistema
  bloquea por DNI toda nueva solicitud de un socio con baja por expulsión.
- REG-05. Un rechazado puede reintentar recién a los **6 meses** de la resolución
  denegatoria (Art. 5 inc. 7). Bloqueo automático por DNI con fecha de rehabilitación.
- REG-06. Vitalicio automático: al cumplir 25 años ininterrumpidos como activo
  (Art. 5 bis inc. f). Job mensual que detecta y propone el pase (el primero será ~2040;
  implementar igual, es barato). El pase queda registrado con acta.
- REG-07. Cambio de categoría (Art. 5° ter): lo solicita el socio o lo resuelve la CD;
  requiere no tener deuda; **no interrumpe la antigüedad**; prohibido desde la
  convocatoria a elecciones hasta la proclamación (flag `elecciones_en_curso` que
  bloquea cambios de categoría).

## Domicilio electrónico y notificaciones (Art. 5° quater)

- REG-08. Todo email declarado se verifica con doble opt-in (link de confirmación).
  Estado por socio: `sin_email` / `declarado_no_verificado` / `verificado` / `rebotado`.
- REG-09. Toda notificación estatutaria (convocatorias, re-empadronamiento, sanciones,
  resultados de solicitudes) se registra: destinatario, vía, fecha/hora, resultado.
  Los webhooks de Brevo actualizan entregas y rebotes.
- REG-10. Si el email rebota o el socio no tiene email, aplica la vía subsidiaria:
  **publicación en cartelera de la sede por 20 días hábiles** con idéntico efecto.
  El sistema registra la notificación con vía = `cartelera`, fecha de fijación y
  fecha de cumplimiento del plazo (calcular días hábiles argentinos: lun-vie,
  excluyendo feriados nacionales; mantener tabla de feriados editable por admin).

## Admisión (Art. 5 inc. 7, Art. 23 incs. b y e)

- REG-11. La admisión la resuelve la CD y consta en actas. El sistema implementa esto
  con la entidad **Acta** (ver modelo de datos): toda alta tiene acta asociada y la
  **fecha de ingreso del socio = fecha del acta** que lo admite. Las altas pueden ser
  masivas (varias solicitudes → una misma acta).
- REG-12. **Acta marco de admisión digital**: la CD dictará una resolución
  (invocando Art. 23 inc. b, ad referéndum de la primera asamblea) que establece:
  (a) quien se asocia por la web y adhiere al débito automático queda **aceptado
  automáticamente**, sujeto a asiento formal en la siguiente acta de CD;
  (b) la **cuota de ingreso no es reembolsable** cualquiera sea el resultado;
  (c) la CD conserva la facultad de recategorizar o dar de baja si la documentación
  no acredita los requisitos.
  El sistema refleja esto con el estado `aprobada_pendiente_acta` (ver flujos).
- REG-13. El rechazo no requiere expresión de causa, pero sí constancia en actas
  (Art. 5 inc. 7): el rechazo desde el panel exige seleccionar/crear el acta.
- REG-14. Cuota de ingreso: equivale a un mes de cuota de la categoría. En el flujo
  con débito, el **primer débito es la cuota de ingreso** (se informa explícitamente
  antes de pagar). No reembolsable (REG-12.b).

## Mora y cesantía (Art. 9 inc. c)

- REG-15. Activos y colaboradores: el atraso de **4 cuotas** (consecutivas o no)
  habilita a la CD a declarar la cesantía sin notificación previa. El sistema:
  cuenta cuotas impagas por socio, muestra alertas desde la 2ª, y a partir de la 4ª
  ofrece al admin la acción "declarar cesantía" (requiere acta). La declaración es
  decisión humana, nunca automática.
- REG-16. Reingreso de cesante por mora: debe saldar la totalidad de la deuda
  **a valores vigentes al momento del reingreso** (deuda en cantidad de cuotas ×
  valor actual de la cuota) y cumplir los requisitos de la categoría. El sistema
  calcula ese monto automáticamente.
- REG-17. Cesantía por mudanza fuera del barrio (activos/adherentes): baja manual
  desde el panel, con acta y motivo `mudanza`, "previa comprobación efectiva".

## Bajas (Art. 9) y régimen disciplinario (Arts. 10-11)

- REG-18. Motivos de baja normalizados (catálogo): `fallecimiento`, `renuncia`,
  `cesantia_mora`, `cesantia_mudanza`, `cesantia_no_reempadronado`, `expulsion`,
  `anulacion_duplicado`, `otro`. Toda baja tiene fecha, acta y motivo.
- REG-19. Renuncia: se presenta por escrito y la acepta la CD. El panel de socio
  tiene "Solicitar baja" → genera la solicitud escrita (queda el texto y timestamp)
  → la CD la acepta con acta → baja efectiva.
- REG-20. El régimen disciplinario completo (descargos, apelaciones, plazos de los
  Arts. 10-11) queda FUERA del alcance v1. El sistema solo registra el resultado
  (suspensión con fechas desde/hasta, o expulsión) con su acta. Un socio suspendido
  no puede operar desde su panel mientras dure la suspensión.

## Re-empadronamiento de adherentes (Art. 9° bis y Art. 40)

Proceso completo en `05-flujos-funcionales.md`. Reglas duras:

- REG-21. Aplica **solo a socios adherentes** vigentes del libro activo.
- REG-22. Plazos: 1ª instancia **30 días** desde la convocatoria; 2ª instancia
  **+10 días** para quienes no respondieron, bajo apercibimiento de baja.
  El sistema calcula y muestra las fechas límite, y dispara las notificaciones
  de 2ª instancia automáticamente al vencer la 1ª (con confirmación del admin).
- REG-23. Sin respuesta al vencer la 2ª instancia: la CD declara la baja por
  **resolución fundada** (acta) y se notifica al domicilio electrónico. El sistema
  genera el borrador del anexo del acta (lista de socios, notificaciones cursadas
  con fechas y vías, y vencimientos).
- REG-24. La baja es **recurrible ante la primera asamblea ordinaria dentro de los
  30 días** de notificada: el registro de la baja guarda la fecha de notificación
  y el sistema marca la ventana de recurso.
- REG-25. Readmisión: el ex adherente puede solicitar reincorporación en cualquier
  momento por el proceso de admisión común.
- REG-26. Restricción temporal: no puede convocarse con menos de **180 días** de
  anticipación a un acto eleccionario. Al activar el proceso, el sistema pide la
  fecha estimada de elecciones (si existe) y advierte si viola el plazo.
- REG-27. Art. 40 (transitoria): la primera depuración debe completarse dentro de
  los **90 días** de oficializada la reforma por IGJ. Al activar, se carga la fecha
  de oficialización y el sistema muestra la cuenta regresiva.
- REG-28. Cierre del proceso = **cierre del libro** vigente y apertura del siguiente:
  migran automáticamente todos los socios vigentes NO adherentes + los adherentes
  con re-empadronamiento validado. Se asigna **nueva numeración por orden de
  antigüedad** (fecha de ingreso original ascendente; empate → número de libro
  anterior ascendente). El proceso es repetible cada ≥2 años (cada cierre abre
  un libro nuevo).
- REG-29. La antigüedad NUNCA se reinicia con el cambio de libro: la persona es la
  misma entidad con números distintos por libro (Art. 5° ter).

## Elecciones y padrón electoral (Arts. 6, 18)

- REG-30. Derecho a participar en asambleas y elecciones: antigüedad mínima
  **90 días corridos** desde la fecha de ingreso (no aplica a honorarios ni vitalicios).
- REG-31. Exportación "Padrón electoral" (Excel/PDF) para la Junta Electoral:
  socios activos, honorarios, colaboradores, vitalicios y adherentes con ≥90 días
  de antigüedad a la fecha de la elección (parámetro), donde activos y colaboradores
  además no registren deuda. Columnas: nombre, número de socio, categoría (Art. 18 incs. h, i).
  El sistema NO gestiona la elección; solo entrega este padrón.

## Órganos y roles internos (Arts. 13-15, 23, 27)

- REG-32. El sistema no valida requisitos de elegibilidad de cargos (edad 21+,
  2 años de residencia, etc.) en v1; solo registra quiénes componen CD y Revisora
  como dato informativo, y sus usuarios admin.
- REG-33. Tesorería (Art. 27): registro de asociados y cobro de cuotas → módulo
  de tesorería con recibos numerados; los balances contables quedan fuera de alcance.
- REG-34. La CD puede actualizar la cuota hasta 4 veces/año (Art. 23 inc. o).
  Los montos viven en los Planes de MP; el sistema guarda un **historial de valores
  de cuota** (monto, vigencia desde, acta) para calcular deudas históricas y
  reingresos a valor vigente (REG-16).

## Numeración y libros

- REG-35. Libro N° 1 = padrón histórico importado de `datos/padron_socios.xlsx`
  (numeración 1-305 con **22 huecos**: 12 anulados por duplicidad
  [21, 71, 72, 73, 93, 94, 95, 97, 125, 147, 238, 254], 8 fichas extraviadas que
  se desestiman [199, 208, 214, 221, 222, 223, 224, 245] y 2 duplicados eliminados
  en la carga definitiva del 18/08/2026 [132, 263] — estos números simplemente no
  existen en el libro). Total: **283 registros** (160 vigentes: 55 activos +
  105 adherentes; 123 bajas).
- REG-36. Cada libro registra: número de libro, acta/fecha de apertura, acta/fecha
  de cierre. El libro cerrado queda en modo solo-lectura y consultable.
