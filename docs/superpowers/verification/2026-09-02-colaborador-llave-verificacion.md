# Verificación y auditoría — llave `colaborador_habilitado`

**Fecha:** 02/09/2026 · **Rama:** `collaborator-switch` · **Base (`main`):** `7d41469` ·
**HEAD verificado:** `2124431` (nueve commits; el commit que incluye este informe y los
dos arreglos de docs de la revisión final es posterior y no toca código).
**Plan:** `docs/superpowers/plans/2026-09-02-colaborador-llave.md`, Tarea 8.

Veredicto: **todo en verde, con tres desvíos documentales justificados** (abajo, §3).
Ningún punto quedó en FALLA.

## 1. Suite, typecheck, lint, build

| Chequeo | Resultado |
|---|---|
| `npm test` | **285 archivos passed, 3 skipped; 4027 tests passed, 7 skipped**; 29,2 s |
| Tests agregados por la rama | **23** `it(` agregados, 0 quitados (`git diff main..HEAD -- tests`). El plan preveía 22; el 23.º es el test que fija que `opacity-60` no vuelva (fix `407c6a1`, enmienda §11 de la spec). `main` no se corrió aparte: de 4027 − 23 se infiere 4004 en `main` (la nota intermedia del libro decía 4003; era una inferencia, no una medición) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errores, 2 warnings **preexistentes** en `tests/invitation-email.test.ts:32` y `tests/verificar-page-dead.test.ts:25` (archivos que la rama no toca) |
| `npm run build` | exit 0; `/asociate` (ISR 1h), `/asociate/retomar/[token]`, `/mi/solicitudes`, `/mi/documentos` y `/admin/configuracion` presentes |

## 2. Auditoría del diff (pedido del operador: tesorería, MP, pagos y suscripciones intactos)

`git diff --stat main..HEAD`: **36 archivos, +627 / −88**. Todos en la lista del plan
(Tarea 8 paso 3) más uno, justificado en §3.

| Chequeo | Resultado |
|---|---|
| `git diff --stat main..HEAD -- src/lib/treasury src/lib/mp prisma src/app/admin/tesoreria src/app/api/webhooks src/app/api/cron src/lib/cron src/app/mi/debito src/app/mi/pagar src/app/api/mi src/app/api/admin/recibos src/lib/members/withdraw-with-debits.ts src/lib/members/debit-adhesion.ts src/lib/members/member-debit.ts` | **VACÍO** |
| Líneas agregadas en `src` y `tests` que nombren `preapproval`, `mercadopago`, `mpPaymentId`, `registerPayment`, `makeMpGateway`, `allocate(` o `receipt` | **VACÍO** (una primera pasada sin acotar rutas matcheó el texto del propio plan, no código) |
| Migraciones, seed, variables de entorno, crontab | ninguna |
| `grep -rn "Norma vigente" src/app/mi` | vacío. En `src/app/admin/documentos/page.tsx:47-48` y `document-form.tsx:112` sigue como nombre de la tarjeta y del control de admin: por alcance de la spec (§1, §5.3), decisión del operador si también cambia |
| `grep -rn "REQUESTABLE_CATEGORIES" src \| grep -v ALL_` | vacío |
| `grep -rn "categoryAllowedForResidence(" src` | seis llamadores intactos, ninguno con tercer argumento (`asociate/actions.ts` mensaje por causa, `admin/solicitudes/actions.ts`, `admin/solicitudes/page.tsx`, `decision-forms.tsx`, `applications/query.ts`, la composición en `wizard.ts`) |

## 3. Desvíos respecto del plan (los tres, justificados)

1. **`grep "Norma vigente" src` no queda vacío** por las tres apariciones de admin. El
   código es el correcto (la spec acota el cambio a `/mi/documentos`); lo que estaba mal
   era la expectativa del plan, corregida en Tarea 8 paso 3 (acotada a `src/app/mi`).
2. **`tests/mi-documentos-screen.test.ts` no estaba en la lista de archivos.** Fijaba
   `aria-label="Norma vigente"` dos veces; sin actualizarlo el commit de la Tarea 7
   dejaba la suite en rojo. Agregado a la lista del plan.
3. **23 tests nuevos, no 22.** El extra es el de contraste (`opacity-60`), enmienda §11.

## 4. Revisiones de código

- **Por tarea (7 tareas + 1 fix):** las siete aprobadas; una sola de nivel Important, en
  la Tarea 4 (la tarjeta deshabilitada atenuaba con `opacity-60` la línea del motivo a
  2,3:1), corregida en `407c6a1` y re-aprobada (texto a 4,57:1 en claro y 7,0:1 en
  oscuro; atenuación por superficie y control, `border-dashed bg-muted/40`). Los Minor
  quedaron anotados en `.superpowers/sdd/progress.md`.
- **Revisión final de rama (Opus):** sin Critical; sin Important de código; **un Important
  documental** —el informe tenía que registrar los tres desvíos de §3 y el spec §4.1
  tenía que marcar la viñeta de admin como reemplazada por §11— aplicado en este mismo
  commit. Veredicto: "listo para mergear con arreglos", arreglos = docs. El revisor
  confirmó de forma independiente: la división display/guarda (dos lectores cacheados en
  páginas, tres lecturas directas en guardas), la regla estatutaria intacta, el mensaje
  por causa, el orden de guardas de la action pública, el contraste, y que no existe
  camino anónimo, de socio ni cacheado que cree un colaborador con la llave apagada.
- Nota operativa del revisor (no bloquea): la llave gobierna la *creación*. Si algún día
  la IGJ rechazara la reforma después de haberla prendido, apagarla no barre las
  solicitudes de colaborador en curso: haría falta un repaso manual de
  `Application where requestedCategory = 'collaborator'`.

## 5. Verificación en el navegador

Panel del navegador (Claude Browser, `sigev-dev` en :3000) con sesión de **socio 274
(activo)**; Chrome de Mariano con sesión de **superadmin**. Las capturas de pantalla
devolvieron timeouts intermitentes en los dos navegadores (renderer ocupado): la
evidencia es por lectura del DOM y por `fetch` de la página, anotada paso a paso en
`.superpowers/sdd/progress.md`.

Base local antes de empezar: `asociate_activo=true`, **sin fila** `colaborador_habilitado`
(estado de lanzamiento).

| # | Pantalla | Estado de la llave | Resultado |
|---|---|---|---|
| 1 | `/asociate` paso 2 | ausente | **OK.** "En otro barrio" con radio `disabled`, borde punteado, fondo atenuado y la línea "Por ahora, la asociación en línea es sólo para quienes viven en el Barrio Ciudadela." legible. Clic sobre la tarjeta: sigue `checked=false`, no aparecen calle/barrio/altura. "En el Barrio Ciudadela" se selecciona y muestra la altura. Consola sin errores |
| 2 | `/admin/configuracion` → Sitio público | — | **OK.** Segundo switch "Categoría socio colaborador habilitada (Art. 5 bis)" bajo el de ASOCIATE, con su ayuda. Guardar apagado → "Configuración guardada." y tira "Socio colaborador · Deshabilitado" **sin `text-warning`** |
| 3 | `/mi/solicitudes` | apagada | **OK.** Único radio de cambio de categoría: `adherent` (el socio es activo); sin Colaborador |
| 4 | `/mi/documentos` | — | **OK.** La base local no tenía documentos; se importó el estatuto con `scripts/import-estatuto.ts` (doc 19, sólo local). Eyebrow "ESTATUTO", `section[aria-label="Estatuto"]`, `innerText` sin "Norma vigente" |
| 5 | `/asociate` tras prender por la pantalla | prendida | **OK, sin reinicio.** `fetch('/asociate')` pasa de serializar `collaboratorEnabled:false` a `true` al guardar (invalidación por `updateTag(config)`); paso 2 con los dos radios habilitados y el texto original; al elegir "En otro barrio" aparecen calle, barrio y altura; paso 3 muestra "Socio colaborador · $ 3.100,00 por mes · obligatoria" y el aviso de vinculación. No se creó ninguna solicitud (no se pasó del paso 3) |
| 6 | `/mi/solicitudes` | prendida | **OK.** Radios `adherent` y `collaborator` |
| 7 | Tira de estado | prendida | **OK.** "Habilitado" sin advertencia |
| 1' | `/asociate` tras apagar por la pantalla | apagada | **OK.** `fetch('/asociate')` vuelve a serializar `false`: invalidación verificada **en las dos direcciones** |

Estado final de la base local: `colaborador_habilitado = false` (apagada), como pide el
plan. La fila existe (en producción no existirá hasta que la Comisión guarde por primera
vez; ausente cuenta como apagada, verificado en el punto 1).

## 6. Pendientes que NO bloquean el cierre (anotados para el operador)

- Cotejar contra el estatuto anterior el copy que cita artículos de la reforma (spec §9).
- Decidir si `/admin/documentos` también deja de decir "Norma vigente" (una línea +
  `tests/documentos-screen.test.ts`).
- Actualizar la descripción del PDF del estatuto desde `/admin/documentos` (texto
  reformado, pendiente de IGJ).
- Minors de las revisiones (libro de avance): `docs/05:515` "norma vigente destacada";
  eyebrow "Estatuto" fijo sobre un slot genérico; mensaje del guard de `/mi` nombra
  colaborador aunque el predicado es genérico; cabecera de `configuracion/actions.ts`.
