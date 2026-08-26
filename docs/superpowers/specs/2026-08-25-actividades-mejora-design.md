# Mejora de Actividades — diseño

**Fecha:** 25/08/2026 · **Estado:** aprobado por Mariano (entrevista de dos rondas)

## Contexto

La sección Actividades (Módulo 2, 19-20/08/2026) quedó austera: grilla de 7 columnas
sin identidad visual, dos salones, semana de 7 días. Este trabajo la moderniza y
amplía sin tocar su arquitectura (server component + `unstable_cache` por tag +
server actions auditadas).

Disparador adicional: 3 actividades de prueba cargadas en producción desaparecieron.
La auditoría de código concluyó que **no hay bug ni borrado en la aplicación**, y el
diagnóstico corrido en el VPS el 25/08/2026 (Anexo A) lo **confirmó**: fue el rearmado
de la base del 22/08/2026 (`docs/10` §4.2), que hace `DROP DATABASE` y no rescata
`activities` ni `news`, y cuyo checklist post-rearmado tampoco las cuenta.

Evidencia medida, las tres consistentes entre sí:

- `_prisma_migrations`: `20260817200230_init_module_0` tiene `started_at`
  **2026-08-22 21:44:58**, igual que las seis migraciones siguientes dentro del mismo
  segundo — la firma de una base creada de cero y migrada de una sola corrida.
- `audit_log`: el asiento más viejo es **2026-08-22 21:45:27**, treinta segundos
  posterior. La auditoría previa se fue con la base, así que la ausencia de
  `activity_create` de las pruebas no prueba nada por sí sola — y un `activity_delete`
  tampoco habría sobrevivido.
- `activities`: las 4 filas recargadas el 25/08 tienen `id` 1 a 4. La tabla nunca tuvo
  filas en esta encarnación; si las viejas hubieran existido acá y se hubieran borrado,
  el `AUTO_INCREMENT` habría arrancado más arriba.
- `news` también estaba vacía antes del 25/08, que es la corroboración cruzada esperada
  (misma migración, mismo destino).

Decisión: las actividades se recargaron a mano (ya hechas); no se restaura backup.

## Alcance

1. **Semana de lunes a sábado.** El domingo desaparece de todos lados: `WEEKDAYS`
   queda con 6 días, `parseWeekdays` rechaza el día 7 con mensaje es-AR, el checkbox
   Domingo sale del formulario del admin y la grilla pública pasa a 6 columnas.
   Una fila preexistente con día 7 no se dibuja y no rompe nada (los guards de
   `rules.ts` ya descartan días fuera del rango aceptado).
2. **Cuatro espacios.** El enum `Room` suma `kitchen` (Cocina) y `classroom` (Aulas)
   vía migración aditiva (`ALTER TABLE … MODIFY room ENUM(...)`, no toca filas).
   Labels en `SITE.rooms`, única fuente de nombres.
3. **Solape.** Salones y Cocina conservan la regla actual (sin superposición en el
   mismo espacio). **Aulas admite hasta 3 actividades simultáneas** (3 aulas físicas,
   sin identificar): la validación calcula la concurrencia máxima del intervalo
   candidato con un barrido sobre las existentes activas del mismo día/año en Aulas
   y rechaza la cuarta ("Las 3 aulas ya están ocupadas de HH:MM a HH:MM…").
   Las actividades ocultas no ocupan aula (regla existente).
4. **Rediseño de la página pública** (ver sección Diseño visual).
5. **Admin: cambios mínimos.** El `<select>` de espacio ofrece los 4 valores, la
   tabla del listado muestra los labels nuevos y pierde la abreviatura "Dom", y la
   validación de Aulas corre en las server actions. Auditoría, `updateTag`,
   redirects y el resto del comportamiento quedan idénticos.
6. **Runbook `docs/10`:** `activities` y `news` entran al rescate del Paso 2 del
   rearmado y sus conteos al checklist del Paso 8, para que una futura corrida no
   vuelva a perderlas en silencio.

Fuera de alcance: filtro por espacio en la página pública (descartado en la
entrevista; el espacio se comunica por color + ícono + etiqueta), identificación de
aulas individuales, rediseño visual del admin, soft-delete de actividades.

## Diseño visual (página pública)

Marco del sitio intacto: `main.mx-auto.max-w-5xl.px-4.py-10`, tokens de
`globals.css`, header/footer compartidos. Dentro de eso:

- **Desktop (`lg+`):** grilla Lunes–Sábado de 6 columnas. Cada actividad es una
  tarjeta con nombre, horario destacado y su espacio identificado con **ícono +
  acento de color** (borde/fondo sutil). La columna del día de hoy se marca
  sutilmente en su cabecera.
- **Mobile (`< lg`):** chips de día (L a S) con el día de hoy preseleccionado
  (si es domingo, lunes), mostrando la agenda del día elegido. Componente cliente
  con estado local — no navega, no lleva parámetro de URL (criterio `MemberTabs`).
  Targets ≥ 44px.
- **Colores e íconos por espacio** (lucide, automáticos, sin campo nuevo):
  Salón Vidriado → celeste de marca; Salón Histórico → tono cálido; Cocina y
  Aulas → acentos propios. Los cuatro con contraste AA verificado y variante
  para modo oscuro; los valores exactos se fijan en implementación contra los
  tokens existentes.
- Se conservan: selector de año (chips), redirect canónico de `?anio=`,
  empty state, metadata/canonical, sitemap y la caché por tag.

## Componentes y datos

- `src/lib/activities/rules.ts`: `WEEKDAYS` a 6 días; `findOverlap` se generaliza
  (o se acompaña de una función hermana) para expresar "capacidad por espacio":
  capacidad 1 para salones y Cocina, 3 para Aulas. Sigue siendo lógica pura,
  testeada sin base.
- `src/lib/activities/query.ts`: sin cambios de forma; el DTO ya es plano.
- `src/app/(public)/actividades/page.tsx`: server component; extrae la vista de
  tarjetas a componentes de presentación; suma el componente cliente del selector
  de día para mobile.
- `src/app/admin/actividades/*`: select de 4 espacios, labels, validación nueva.
- `prisma/schema.prisma` + migración: enum `Room` de 4 valores.

## Manejo de errores

- Mensajes de validación nuevos en castellano (día 7 rechazado, cuarta actividad
  en Aulas), consistentes con los existentes de `actions.ts`.
- Datos corruptos (weekdays no-array, día fuera de 1..6) siguen degradando en
  silencio en la vista pública, como hoy.

## Tests

- Se actualizan los 5 archivos existentes (semana de 6 días, enum de 4 espacios).
- Casos nuevos: tercera actividad simultánea en Aulas pasa y la cuarta se rechaza;
  borde exacto de horario en Aulas; una actividad oculta no ocupa aula; día 7
  rechazado en `parseWeekdays` y en las actions; labels de Cocina y Aulas.
- Sigue sin haber test de render de la página pública (deuda preexistente, fuera
  de alcance).

## Anexo A — Diagnóstico SQL de la desaparición (solo lectura, correr en el VPS)

Por SSH (`mysql sigev`). Cómo leer: la consulta 1 con **todas** las migraciones
`started_at >= 2026-08-22` + la 3 con `AUTO_INCREMENT = 1` + la 8 con `noticias = 0`
confirman el rearmado (nadie borró nada). Si la 2 devuelve filas y la 4 las muestra
con `active = 0`, se arregla desde el panel. Si la 6 devuelve `activity_delete`,
hubo borrado desde el panel, con actor.

```sql
-- 1. ¿La base se rearmó (DROP DATABASE) el 22/08?
SELECT migration_name, started_at, finished_at, applied_steps_count, rolled_back_at
FROM _prisma_migrations ORDER BY started_at;

-- 2. ¿Existen filas hoy?
SELECT COUNT(*) AS total_actividades FROM activities;
SELECT id, name, room, weekdays, start_time, end_time, year, active, created_at, updated_at
FROM activities ORDER BY id;

-- 3. ¿La tabla tuvo filas alguna vez en esta encarnación? (AUTO_INCREMENT = 1 => nunca)
SELECT TABLE_NAME, TABLE_ROWS, AUTO_INCREMENT, CREATE_TIME, UPDATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'sigev' AND TABLE_NAME IN ('activities','news');

-- 4. Filas que existen pero quedan ocultas al público (filtra year + active = 1).
SELECT year, active, COUNT(*) AS filas
FROM activities GROUP BY year, active ORDER BY year DESC, active DESC;

-- 5. Activas que igual no se dibujan (weekdays vacío/corrupto).
SELECT id, name, year, active, weekdays, JSON_VALID(weekdays) AS json_valido,
       JSON_TYPE(weekdays) AS json_tipo, JSON_LENGTH(weekdays) AS cantidad_dias
FROM activities WHERE active = 1;

-- 6. Auditoría de actividades (activity_create / activity_update / activity_delete).
SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.detail, a.ip, u.email AS actor
FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
WHERE a.entity = 'activity' OR a.action LIKE 'activity\_%' ORDER BY a.id;

-- 7. ¿Se perdió el propio audit_log? (fila más vieja del 22/08 o posterior => sí)
SELECT COUNT(*) AS asientos, MIN(id) AS primer_id,
       MIN(created_at) AS mas_viejo, MAX(created_at) AS mas_nuevo
FROM audit_log;

-- 8. Corroboración cruzada con noticias (misma migración, mismo destino).
SELECT COUNT(*) AS noticias, SUM(status = 'published') AS publicadas,
       MIN(created_at) AS mas_vieja
FROM news;

-- 9. Rastro del rearmado/restore, por si quedó asiento.
SELECT id, created_at, action, entity, entity_id, detail
FROM audit_log
WHERE action IN ('padron_prune','padron_import') OR action LIKE '%prune%'
ORDER BY id DESC LIMIT 20;
```

Fuera de MySQL, para fechar el rearmado contra los backups:

```bash
ls -lh --time-style=long-iso /root/backup-pre-rearmado-*.sql.gz.gpg \
                             /root/backup-pre-deploy-*.sql.gz.gpg 2>/dev/null
ls -lh --time-style=long-iso /var/sigev/backups/sigev-*.sql.gz.gpg | head -40
```
