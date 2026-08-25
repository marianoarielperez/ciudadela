# Activities Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six-day week (Mon–Sat), four spaces (add Cocina and Aulas with capacity 3), redesigned public `/actividades` page with per-space icons/colors and a mobile day selector, plus the docs/10 runbook fix so a future DB rebuild can't silently lose activities again.

**Architecture:** Pure rules in `src/lib/activities/rules.ts` stay the single source for weekdays, labels, and the scheduling conflict rule (now capacity-aware). The public page stays a cached server component; the only new client component is the mobile day selector (local state, no URL param — the `MemberTabs` criterion). Admin actions keep their exact auth/audit/cache-invalidation shape.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma (MariaDB), Tailwind v4 + shadcn tokens, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-actividades-mejora-design.md`

## Global Constraints

- UI copy in Spanish es-AR ("vos"); code, identifiers, and commit messages in English.
- Schema changes only via `prisma migrate` (never `db push`). Local dev DB is the Docker MariaDB (`DATABASE_URL` in `.env`).
- Touch targets ≥ 44px (`min-h-11`) on every public control.
- Do not use raw Tailwind green/amber for **messages** (tokens `--success`/`--warning` exist); decorative per-space accents on the public page may use explicit Tailwind palette classes with `dark:` variants.
- Validation messages in es-AR — a server action is a public endpoint (see header comment of `src/app/admin/actividades/actions.ts`).
- Run activity tests with: `npx vitest run tests/activities-rules.test.ts tests/activities-query.test.ts tests/activities-actions.test.ts tests/activities-actions-auth.test.ts tests/activities-year-param.test.ts`
- Before finishing any task: `npx tsc --noEmit` must pass (route-type globals like `PageProps` may need `npx next typegen` first if it fails cold — do not chase unrelated errors).

---

### Task 1: Six-day week (Mon–Sat)

**Files:**
- Modify: `src/lib/activities/rules.ts:6-9` (WEEKDAYS), `:24-31` (parseWeekdays), `:85` (grid guard)
- Test: `tests/activities-rules.test.ts`

**Interfaces:**
- Produces: `WEEKDAYS` now has 6 entries `[1,"Lunes"]…[6,"Sábado"]`; `parseWeekdays` rejects `"7"`. Everything that iterates `WEEKDAYS` (admin form checkboxes, admin `DAY_SHORT`, `buildWeeklyGrid`, `buildDailyAgenda`) picks the change up automatically — Task 4 relies on the agenda having exactly 6 days.

- [ ] **Step 1: Update the tests to the six-day week**

In `tests/activities-rules.test.ts`:

1. `parseWeekdays` describe — extend the rejection test:

```ts
  it("rechaza vacío y valores fuera de 1-6 con mensaje es-AR", () => {
    expect(parseWeekdays([]).ok).toBe(false);
    expect(parseWeekdays(["0"]).ok).toBe(false);
    // La vecinal no abre los domingos: el día 7 dejó de ser cargable.
    expect(parseWeekdays(["7"]).ok).toBe(false);
    expect(parseWeekdays(["8"]).ok).toBe(false);
    expect(parseWeekdays(["x"]).ok).toBe(false);
  });
```

2. Every assertion that expects seven day keys becomes six. Replace all occurrences of `[1, 2, 3, 4, 5, 6, 7]` with `[1, 2, 3, 4, 5, 6]` (they appear in "repite la actividad en cada uno de sus días y deja los siete días armados" — rename to "…los seis días armados" —, "ignora días fuera de 1-7…" — rename to "ignora días fuera de 1-6…" and change its input to `weekdays: [1, 7]` so it proves day 7 specifically gets dropped —, the prototype-key `it.each`, "no explota con claves de prototipo y devuelve los siete días vacíos" — rename to "…los seis días vacíos" —, and "devuelve los siete días en orden" — rename to "devuelve los seis días en orden").

3. The final labels test:

```ts
  it("WEEKDAYS va de lunes a sábado con nombres es-AR", () => {
    expect(WEEKDAYS).toEqual([
      [1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"],
      [5, "Viernes"], [6, "Sábado"],
    ]);
  });
```

4. In "repite la actividad en cada uno de sus días y excluye las inactivas" (buildDailyAgenda), the hidden activity uses `weekdays: [5]` and asserts `agenda[4].entries` — still valid with 6 days, leave as is.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/activities-rules.test.ts`
Expected: FAIL — `parseWeekdays(["7"])` returns ok, grids still have key 7, WEEKDAYS has 7 entries.

- [ ] **Step 3: Implement in `src/lib/activities/rules.ts`**

Header comment (lines 1-3) — replace with:

```ts
// Reglas del calendario de espacios de la sede. La semana va de lunes a
// sábado (la vecinal no abre los domingos) y cada espacio físico tiene una
// capacidad: dos actividades activas del mismo espacio y año no pueden
// pisarse en día y horario más allá de esa capacidad.
```

WEEKDAYS:

```ts
export const WEEKDAYS: Array<[number, string]> = [
  [1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"],
  [5, "Viernes"], [6, "Sábado"],
];
```

`parseWeekdays` — the range check becomes `d < 1 || d > 6` (message unchanged: `"Día de la semana inválido."`).

`buildWeeklyGrid` guard (line 85) — becomes `if (!Number.isInteger(d) || d < 1 || d > 6) continue;` and add one line to the comment above it: `// El 7 (domingo) quedó fuera de la semana: una fila vieja con domingo se descarta acá, no rompe.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/activities-rules.test.ts tests/activities-actions.test.ts tests/activities-actions-auth.test.ts tests/activities-query.test.ts`
Expected: PASS. If an actions test fixture used weekday 7, change that fixture to a 1–6 day — the assertion intent doesn't change.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/activities/rules.ts tests/activities-rules.test.ts tests/activities-actions.test.ts
git commit -m "feat(activities): six-day week, Monday through Saturday"
```

---

### Task 2: Four spaces — kitchen and classroom

**Files:**
- Modify: `prisma/schema.prisma:457-461` (enum Room), `src/lib/site.ts:15` (rooms), `src/lib/activities/rules.ts` (RoomKey/ROOM_KEYS/grid), `src/lib/activities/query.ts:22` (cast), `src/app/admin/actividades/actions.ts:48` (zod enum), `src/app/admin/actividades/activity-form.tsx:66-73` (select), `src/app/admin/actividades/page.tsx:80` (column header)
- Create: `prisma/migrations/<timestamp>_add_kitchen_and_classroom_rooms/migration.sql` (generated)
- Test: `tests/activities-rules.test.ts`, `tests/activities-actions.test.ts`

**Interfaces:**
- Produces: `type RoomKey = "historic" | "glass" | "kitchen" | "classroom"` and `ROOM_KEYS: RoomKey[]` exported from `@/lib/activities/rules`; `ActivitySlot.room` and `AgendaEntry.room` are `RoomKey`; `buildWeeklyGrid` returns `Record<RoomKey, Record<number, …>>`. Task 3 and Task 4 depend on `RoomKey`/`ROOM_KEYS`.

- [ ] **Step 1: Write failing tests**

In `tests/activities-rules.test.ts`, extend the labels describe and the grid test:

```ts
  it("ROOM_LABELS cubre los cuatro espacios desde SITE.rooms", () => {
    expect(ROOM_LABELS).toEqual(SITE.rooms);
    expect(ROOM_LABELS.kitchen).toBe("Cocina");
    expect(ROOM_LABELS.classroom).toBe("Aulas");
  });
```

And inside `describe("buildWeeklyGrid")`:

```ts
  it("arma la grilla para los cuatro espacios, con arrays independientes", () => {
    const grid = buildWeeklyGrid([
      slot({ id: 5, name: "Cocina para todos", room: "kitchen", weekdays: [2] }),
      slot({ id: 6, name: "Apoyo escolar", room: "classroom", weekdays: [2] }),
    ]);
    expect(grid.kitchen[2].map((a) => a.name)).toEqual(["Cocina para todos"]);
    expect(grid.classroom[2].map((a) => a.name)).toEqual(["Apoyo escolar"]);
    expect(grid.historic[2]).toEqual([]);
    expect(grid.glass[2]).toEqual([]);
  });
```

And inside `describe("buildDailyAgenda")`:

```ts
  it("mezcla los cuatro espacios en el mismo día", () => {
    const agenda = buildDailyAgenda([
      slot({ id: 7, name: "Cocina para todos", room: "kitchen", weekdays: [1], startTime: "10:00", endTime: "11:00" }),
      slot({ id: 8, name: "Apoyo escolar", room: "classroom", weekdays: [1], startTime: "08:00", endTime: "09:00" }),
    ]);
    expect(agenda[0].entries.map((e) => [e.name, e.room])).toEqual([
      ["Apoyo escolar", "classroom"],
      ["Cocina para todos", "kitchen"],
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/activities-rules.test.ts`
Expected: FAIL — TypeScript rejects `room: "kitchen"`, `ROOM_LABELS.kitchen` undefined.

- [ ] **Step 3: Schema + migration**

`prisma/schema.prisma` — the enum becomes:

```prisma
// Los espacios de la sede son fijos: enum, no tabla (YAGNI, spec §2).
enum Room {
  historic // Salón Histórico
  glass // Salón Vidriado
  kitchen // Cocina
  classroom // Aulas (tres aulas físicas, sin identificar)
}
```

Run: `npx prisma migrate dev --name add_kitchen_and_classroom_rooms`
Expected: a new migration whose SQL is a single additive `ALTER TABLE \`activities\` MODIFY \`room\` ENUM('historic','glass','kitchen','classroom') NOT NULL;` (open the generated file and confirm — no DROP, no data change). The command also regenerates the Prisma client.

- [ ] **Step 4: Labels and types**

`src/lib/site.ts:15`:

```ts
  rooms: {
    historic: "Salón Histórico",
    glass: "Salón Vidriado",
    kitchen: "Cocina",
    classroom: "Aulas",
  },
```

`src/lib/activities/rules.ts`:

```ts
export type RoomKey = keyof typeof SITE.rooms;

// El orden acá es el orden estable de desempate visual (grilla y agenda).
export const ROOM_KEYS = Object.keys(SITE.rooms) as RoomKey[];

export const ROOM_LABELS: Record<RoomKey, string> = SITE.rooms;
```

`ActivitySlot.room` and `AgendaEntry.room` become `RoomKey`. In `buildWeeklyGrid`, replace the hardcoded rooms:

```ts
  const grid = Object.fromEntries(ROOM_KEYS.map((k) => [k, empty()])) as Record<
    RoomKey,
    ReturnType<typeof empty>
  >;
```

and the sorting loop iterates `for (const room of ROOM_KEYS)`. In `buildDailyAgenda`, the flatMap iterates `ROOM_KEYS` instead of `(["historic", "glass"] as const)`.

`src/lib/activities/query.ts` — import `type RoomKey` from `@/lib/activities/rules` and cast `room: a.room as RoomKey` in `toSlot` (line 22).

- [ ] **Step 5: Admin surfaces**

`src/app/admin/actividades/actions.ts:48`:

```ts
  room: z.enum(["historic", "glass", "kitchen", "classroom"], { error: "Elegí el espacio." }),
```

`src/app/admin/actividades/activity-form.tsx` — import `ROOM_KEYS` and replace the SelectField:

```tsx
      <SelectField
        label="Espacio"
        field={field("room")}
        options={ROOM_KEYS.map((k) => [k, ROOM_LABELS[k]] as [string, string])}
      />
```

`src/app/admin/actividades/page.tsx:80` — `<TableHead>Salón</TableHead>` becomes `<TableHead>Espacio</TableHead>`; and the `PageHeader` title (line 34) becomes `title="Actividades de la sede"` with the empty-state description unchanged.

- [ ] **Step 6: Run tests, fix message assertions**

Run: `npx vitest run tests/activities-rules.test.ts tests/activities-actions.test.ts tests/activities-actions-auth.test.ts tests/activities-query.test.ts`
Expected: rules/query PASS. If an actions test asserts the old `"Elegí el salón."` message, update it to `"Elegí el espacio."`.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add prisma/schema.prisma prisma/migrations src/lib/site.ts src/lib/activities src/app/admin/actividades tests
git commit -m "feat(activities): add kitchen and classroom spaces to the Room enum"
```

---

### Task 3: Capacity-aware conflict rule (Aulas = 3)

**Files:**
- Modify: `src/lib/activities/rules.ts` (replace `findOverlap` with `findScheduleConflict`), `src/app/admin/actividades/actions.ts:108-117` (conflict message), `src/app/admin/actividades/activity-form.tsx:120-123` (hint copy)
- Test: `tests/activities-rules.test.ts`, `tests/activities-actions.test.ts`

**Interfaces:**
- Consumes: `RoomKey`, `ROOM_KEYS`, `ActivitySlot`, `timeToMinutes` from Task 2.
- Produces:

```ts
export const ROOM_CAPACITY: Record<RoomKey, number>;
export function minutesToTime(min: number): string;
export type ScheduleConflict =
  | { kind: "overlap"; other: ActivitySlot }
  | { kind: "full"; capacity: number; startTime: string; endTime: string };
export function findScheduleConflict(
  candidate: Omit<ActivitySlot, "id"> & { id?: number },
  existing: ActivitySlot[],
): ScheduleConflict | null;
```

`findOverlap` is **removed** (its only caller is `actions.ts`; grep to confirm before deleting).

- [ ] **Step 1: Rewrite the rule tests**

In `tests/activities-rules.test.ts`, replace both `findOverlap` describes ("findOverlap" and "findOverlap (bordes)") with `findScheduleConflict` equivalents — every previous case survives with the new return shape — and add the capacity cases. Update the import (drop `findOverlap`, add `findScheduleConflict`).

```ts
describe("findScheduleConflict (capacidad 1: salones y cocina)", () => {
  it("detecta solape parcial en mismo espacio, año y día", () => {
    const hit = findScheduleConflict(slot({ id: undefined, startTime: "19:00", endTime: "20:00" }), [slot()]);
    expect(hit).toMatchObject({ kind: "overlap", other: { name: "Gimnasia mujeres" } });
  });
  it("borde exacto NO es solape (19:30 empieza cuando 19:30 termina)", () => {
    expect(findScheduleConflict(slot({ id: undefined, startTime: "19:30", endTime: "20:30" }), [slot()])).toBeNull();
  });
  it("otro espacio, otro año, día sin intersección o inactiva: no chocan", () => {
    expect(findScheduleConflict(slot({ id: undefined, room: "glass" }), [slot()])).toBeNull();
    expect(findScheduleConflict(slot({ id: undefined, year: 2027 }), [slot()])).toBeNull();
    expect(findScheduleConflict(slot({ id: undefined, weekdays: [2, 4] }), [slot()])).toBeNull();
    expect(findScheduleConflict(slot({ id: undefined }), [slot({ active: false })])).toBeNull();
  });
  it("la cocina también es un espacio único", () => {
    const hit = findScheduleConflict(
      slot({ id: undefined, room: "kitchen", startTime: "19:00", endTime: "20:00" }),
      [slot({ room: "kitchen" })],
    );
    expect(hit?.kind).toBe("overlap");
  });
  it("en edición se ignora a sí misma pero sigue viendo a las demás", () => {
    expect(findScheduleConflict(slot({ id: 1 }), [slot()])).toBeNull();
    const otra = slot({ id: 2, name: "Zumba", startTime: "19:00", endTime: "20:00" });
    const hit = findScheduleConflict(slot({ id: 1, startTime: "19:15", endTime: "20:15" }), [slot(), otra]);
    expect(hit).toMatchObject({ kind: "overlap", other: { name: "Zumba" } });
  });
  it("el candidato inactivo no choca con nada", () => {
    expect(findScheduleConflict(slot({ id: undefined, active: false }), [slot()])).toBeNull();
  });
  it("una actividad contenida dentro de otra sí choca", () => {
    const hit = findScheduleConflict(slot({ id: undefined, startTime: "18:30", endTime: "19:00" }), [slot()]);
    expect(hit?.kind).toBe("overlap");
  });
  it("horario inválido no se reporta como conflicto (lo rechaza la validación, no esta regla)", () => {
    expect(findScheduleConflict(slot({ id: undefined, startTime: "25:00" }), [slot()])).toBeNull();
  });
});

describe("findScheduleConflict (capacidad 3: aulas)", () => {
  const aula = (over: Record<string, unknown> = {}) =>
    slot({ room: "classroom", weekdays: [1], startTime: "18:00", endTime: "19:30", ...over });

  it("la segunda y la tercera actividad superpuestas entran", () => {
    expect(findScheduleConflict(aula({ id: undefined }), [aula({ id: 1 })])).toBeNull();
    expect(findScheduleConflict(aula({ id: undefined }), [aula({ id: 1 }), aula({ id: 2 })])).toBeNull();
  });

  it("la cuarta se rechaza informando la ventana ocupada", () => {
    const hit = findScheduleConflict(aula({ id: undefined, startTime: "18:30", endTime: "20:00" }), [
      aula({ id: 1 }), aula({ id: 2 }), aula({ id: 3 }),
    ]);
    expect(hit).toEqual({ kind: "full", capacity: 3, startTime: "18:30", endTime: "19:30" });
  });

  it("tres existentes que NO coinciden entre sí a ninguna hora no llenan el aula", () => {
    // Escalera: cada una pisa a la siguiente pero nunca hay 3 en simultáneo.
    const hit = findScheduleConflict(aula({ id: undefined, startTime: "08:00", endTime: "12:00" }), [
      aula({ id: 1, startTime: "08:00", endTime: "09:00" }),
      aula({ id: 2, startTime: "09:00", endTime: "10:00" }),
      aula({ id: 3, startTime: "10:00", endTime: "11:00" }),
    ]);
    expect(hit).toBeNull();
  });

  it("el borde exacto no cuenta como simultaneidad", () => {
    const hit = findScheduleConflict(aula({ id: undefined }), [
      aula({ id: 1 }), aula({ id: 2, startTime: "16:30", endTime: "18:00" }), aula({ id: 3, startTime: "16:00", endTime: "18:00" }),
    ]);
    expect(hit).toBeNull();
  });

  it("una oculta no ocupa aula", () => {
    const hit = findScheduleConflict(aula({ id: undefined }), [
      aula({ id: 1 }), aula({ id: 2 }), aula({ id: 3, active: false }),
    ]);
    expect(hit).toBeNull();
  });

  it("la simultaneidad se mide por día: 3 en lunes no bloquean el martes", () => {
    const hit = findScheduleConflict(aula({ id: undefined, weekdays: [2] }), [
      aula({ id: 1 }), aula({ id: 2 }), aula({ id: 3 }),
    ]);
    expect(hit).toBeNull();
  });

  it("en edición no se cuenta a sí misma para el cupo", () => {
    const hit = findScheduleConflict(aula({ id: 3 }), [aula({ id: 1 }), aula({ id: 2 }), aula({ id: 3 })]);
    expect(hit).toBeNull();
  });
});

describe("minutesToTime", () => {
  it("es la inversa de timeToMinutes", () => {
    expect(minutesToTime(1110)).toBe("18:30");
    expect(minutesToTime(0)).toBe("00:00");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/activities-rules.test.ts`
Expected: FAIL — `findScheduleConflict` / `minutesToTime` / `ROOM_CAPACITY` not exported.

- [ ] **Step 3: Implement in `rules.ts`**

Delete `findOverlap` and add:

```ts
// Capacidad física de cada espacio: los salones y la cocina son un ambiente
// único; "Aulas" son tres aulas sin identificar, así que hasta tres
// actividades activas pueden convivir en el mismo horario.
export const ROOM_CAPACITY: Record<RoomKey, number> = {
  historic: 1,
  glass: 1,
  kitchen: 1,
  classroom: 3,
};

export function minutesToTime(min: number): string {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export type ScheduleConflict =
  | { kind: "overlap"; other: ActivitySlot }
  | { kind: "full"; capacity: number; startTime: string; endTime: string };

// Reemplaza a findOverlap: misma regla estricta de solape (compartir el borde
// exacto es válido) generalizada por capacidad. Con capacidad 1 el resultado
// es el de siempre — la primera actividad pisada—; con capacidad N el
// candidato entra salvo que en algún instante de su rango ya haya N activas
// en simultáneo EN EL MISMO DÍA, y en ese caso se informa la ventana ocupada
// para que el operador sepa qué franja tiene que esquivar.
export function findScheduleConflict(
  candidate: Omit<ActivitySlot, "id"> & { id?: number },
  existing: ActivitySlot[],
): ScheduleConflict | null {
  const start = timeToMinutes(candidate.startTime);
  const end = timeToMinutes(candidate.endTime);
  if (start === null || end === null || !candidate.active) return null;
  const overlapping = existing.filter((other) => {
    if (other.id === candidate.id || !other.active) return false;
    if (other.room !== candidate.room || other.year !== candidate.year) return false;
    if (!other.weekdays.some((d) => candidate.weekdays.includes(d))) return false;
    const oStart = timeToMinutes(other.startTime);
    const oEnd = timeToMinutes(other.endTime);
    return oStart !== null && oEnd !== null && start < oEnd && oStart < end;
  });
  const capacity = ROOM_CAPACITY[candidate.room];
  if (capacity === 1) {
    return overlapping.length > 0 ? { kind: "overlap", other: overlapping[0] } : null;
  }
  // Barrido por día: la concurrencia solo puede subir donde EMPIEZA una
  // actividad, así que alcanza con medirla en cada inicio (acotado al rango
  // del candidato). Los horarios de `overlapping` ya validaron en el filtro.
  for (const day of candidate.weekdays) {
    const sameDay = overlapping.filter((o) => o.weekdays.includes(day));
    if (sameDay.length < capacity) continue;
    const points = [...new Set(sameDay.map((o) => Math.max(timeToMinutes(o.startTime)!, start)))].sort(
      (a, b) => a - b,
    );
    for (const p of points) {
      const concurrent = sameDay.filter(
        (o) => timeToMinutes(o.startTime)! <= p && p < timeToMinutes(o.endTime)!,
      );
      if (concurrent.length >= capacity) {
        const busyEnd = Math.min(end, ...concurrent.map((o) => timeToMinutes(o.endTime)!));
        return { kind: "full", capacity, startTime: minutesToTime(p), endTime: minutesToTime(busyEnd) };
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Wire the actions**

`src/app/admin/actividades/actions.ts` — update the import (drop `findOverlap`, add `findScheduleConflict`) and replace the clash block inside `validateActivity` (lines 108-117):

```ts
  if (data.active) {
    const existing = await activitiesQueries.allForAdmin(data.year);
    const conflict = findScheduleConflict({ ...data, id: selfId }, existing);
    if (conflict) {
      return {
        ok: false as const,
        error:
          conflict.kind === "overlap"
            ? `Se superpone con "${conflict.other.name}" (${conflict.other.startTime}–${conflict.other.endTime}) en el mismo espacio. Ajustá el horario o los días.`
            : `Las ${conflict.capacity} aulas ya están ocupadas de ${conflict.startTime} a ${conflict.endTime}. Ajustá el horario o los días.`,
      };
    }
  }
```

Also update the file's header comment second paragraph: "Los dos salones son un espacio físico" → "Cada espacio físico tiene una capacidad (los salones y la cocina, una actividad; las aulas, tres)".

`src/app/admin/actividades/activity-form.tsx` — the visibility hint becomes:

```tsx
        <p className="text-xs text-muted-foreground">
          Una actividad oculta se guarda igual y no ocupa el espacio: no se controla el solapamiento
          hasta que la hagas visible.
        </p>
```

- [ ] **Step 5: Update the actions tests**

In `tests/activities-actions.test.ts`, update every assertion of the old overlap message to the new wording (`"en el mismo espacio"` instead of `"en el mismo salón"`), and add one action-level capacity case (using that file's existing fake-db helpers — mirror the shape of the current overlap test):

- seed the fake with 3 active classroom activities, same year, `weekdays: [1]`, `18:00–19:30`;
- submit a create for a 4th classroom activity `18:30–20:00`, weekdays `[1]`;
- assert the returned `error` is `'Las 3 aulas ya están ocupadas de 18:30 a 19:30. Ajustá el horario o los días.'` and that nothing was written/audited;
- submit the same activity with room `glass` and assert it clashes as `overlap` against nothing (no glass rows seeded → succeeds).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/activities-rules.test.ts tests/activities-actions.test.ts tests/activities-actions-auth.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/activities/rules.ts src/app/admin/actividades tests
git commit -m "feat(activities): capacity-aware schedule conflicts, classrooms hold three"
```

---

### Task 4: Public page redesign

**Files:**
- Create: `src/lib/activities/room-meta.ts`, `src/app/(public)/actividades/activity-card.tsx`, `src/app/(public)/actividades/day-tabs.tsx`
- Modify: `src/lib/dates.ts` (add `currentWeekdayAR`), `src/app/(public)/actividades/page.tsx` (rewrite render)
- Test: `tests/dates-weekday.test.ts` (new)

**Interfaces:**
- Consumes: `RoomKey`, `ROOM_KEYS`, `ROOM_LABELS`, `AgendaEntry`, `buildDailyAgenda` (Tasks 1-2).
- Produces: `currentWeekdayAR(now?: Date): number` (1=Monday … 7=Sunday, Argentine wall clock) in `@/lib/dates`; `ROOM_META: Record<RoomKey, { icon: LucideIcon; accentBorder: string; accentText: string }>` in `@/lib/activities/room-meta`; `ActivityCard({ entry: AgendaEntry })` and `DayTabs({ agenda, initialDay })` components.

- [ ] **Step 1: Failing test for `currentWeekdayAR`**

Create `tests/dates-weekday.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { currentWeekdayAR } from "@/lib/dates";

describe("currentWeekdayAR", () => {
  it("devuelve el día de la semana argentino, no el del reloj UTC", () => {
    // 2026-08-24 fue lunes en AR; a las 23:30 AR el reloj UTC ya está en el martes 25.
    expect(currentWeekdayAR(new Date("2026-08-25T02:30:00Z"))).toBe(1);
  });
  it("lunes=1 … domingo=7", () => {
    expect(currentWeekdayAR(new Date("2026-08-29T15:00:00Z"))).toBe(6); // sábado
    expect(currentWeekdayAR(new Date("2026-08-30T15:00:00Z"))).toBe(7); // domingo
  });
});
```

Run: `npx vitest run tests/dates-weekday.test.ts` — Expected: FAIL (not exported).

- [ ] **Step 2: Implement `currentWeekdayAR` in `src/lib/dates.ts`**

Append after `currentYearAR`:

```ts
// El día de la semana ARGENTINO (lunes=1 … domingo=7), por el mismo motivo que
// currentYearAR: cerca de la medianoche el reloj UTC del server ya está en el
// día siguiente. Mismo esquema de numeración que Activity.weekdays.
export function currentWeekdayAR(now: Date = new Date()): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[short] ?? 1;
}
```

Run: `npx vitest run tests/dates-weekday.test.ts` — Expected: PASS.

- [ ] **Step 3: Room metadata module**

Create `src/lib/activities/room-meta.ts`:

```ts
// Identidad visual de cada espacio en el sitio público: ícono + acento.
// El Salón Vidriado lleva el celeste institucional (tokens --primary); los
// demás usan paleta explícita de Tailwind con su variante dark. Contraste
// verificado: los *-800 sobre blanco y los *-300 sobre fondo oscuro dan AA
// para texto chico. Es decoración de tarjetas, no mensajes de estado: los
// tokens --success/--warning quedan para FormMessage.
import { Building2, GraduationCap, Landmark, Utensils, type LucideIcon } from "lucide-react";
import type { RoomKey } from "@/lib/activities/rules";

export const ROOM_META: Record<
  RoomKey,
  { icon: LucideIcon; accentBorder: string; accentText: string }
> = {
  historic: {
    icon: Landmark,
    accentBorder: "border-amber-600 dark:border-amber-400",
    accentText: "text-amber-800 dark:text-amber-300",
  },
  glass: {
    icon: Building2,
    accentBorder: "border-primary",
    accentText: "text-primary",
  },
  kitchen: {
    icon: Utensils,
    accentBorder: "border-rose-600 dark:border-rose-400",
    accentText: "text-rose-800 dark:text-rose-300",
  },
  classroom: {
    icon: GraduationCap,
    accentBorder: "border-emerald-600 dark:border-emerald-400",
    accentText: "text-emerald-800 dark:text-emerald-300",
  },
};
```

- [ ] **Step 4: Activity card (shared by grid and day tabs)**

Create `src/app/(public)/actividades/activity-card.tsx` (no `"use client"` — it renders on the server in the grid and gets bundled into the client day tabs):

```tsx
import { ROOM_LABELS, type AgendaEntry } from "@/lib/activities/rules";
import { ROOM_META } from "@/lib/activities/room-meta";

// Tarjeta de una actividad: nombre, horario destacado y el espacio con su
// ícono y color. El nombre lo escribe la Comisión y puede ser largo:
// [overflow-wrap:anywhere] evita que empuje el ancho de la columna.
export function ActivityCard({ entry }: { entry: AgendaEntry }) {
  const meta = ROOM_META[entry.room];
  const Icon = meta.icon;
  return (
    <li className={`rounded-md border-l-2 bg-muted/40 py-2 pl-2.5 pr-2 ${meta.accentBorder}`}>
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{entry.name}</p>
      <p className="mt-0.5 text-xs font-medium tabular-nums">
        {entry.startTime} a {entry.endTime}
      </p>
      <p className={`mt-1 flex items-center gap-1 text-xs ${meta.accentText}`}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="[overflow-wrap:anywhere]">{ROOM_LABELS[entry.room]}</span>
      </p>
    </li>
  );
}
```

- [ ] **Step 5: Mobile day selector**

Create `src/app/(public)/actividades/day-tabs.tsx`:

```tsx
"use client";
// Selector de día para el celular: estado local, sin parámetro de URL (mismo
// criterio que MemberTabs — no navega, es una vista de la misma página). El
// día inicial llega del servidor calculado con hora argentina.
import { useState } from "react";
import type { AgendaEntry } from "@/lib/activities/rules";
import { ActivityCard } from "./activity-card";

type AgendaDay = { day: number; label: string; entries: AgendaEntry[] };

export function DayTabs({ agenda, initialDay }: { agenda: AgendaDay[]; initialDay: number }) {
  const [selected, setSelected] = useState(initialDay);
  const current = agenda.find((d) => d.day === selected) ?? agenda[0];
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Elegir día">
        {agenda.map((d) => (
          <button
            key={d.day}
            type="button"
            aria-pressed={d.day === selected}
            onClick={() => setSelected(d.day)}
            className={`min-h-11 shrink-0 rounded-md border px-3 text-sm font-medium ${
              d.day === selected
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {current.entries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Sin actividades el {current.label.toLocaleLowerCase("es-AR")}.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {current.entries.map((e) => (
            <ActivityCard key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rewrite the page render**

`src/app/(public)/actividades/page.tsx` — keep `generateMetadata`, the year resolution, the canonical redirect, and the year chips exactly as they are. Changes:

1. Imports: drop `ROOM_LABELS` (now used by the card), add `currentWeekdayAR` (from `@/lib/dates`), `ActivityCard`, `DayTabs`.
2. `DESCRIPTION` becomes: `` const DESCRIPTION = "Calendario semanal de actividades de la sede: salones, cocina y aulas."; ``
3. The intro paragraph becomes:

```tsx
          <p className="mt-2 text-sm text-muted-foreground">
            Grilla semanal de lunes a sábado en la sede de{" "}
            <Link href="/ubicacion" className="text-primary underline">
              {SITE.address}
            </Link>
            .
          </p>
```

4. Delete `joinEs` and the `freeDays` computation and its `<p>` (the day selector replaces the "Sin actividades: …" summary). Keep `busyDays` for the empty state, unchanged.
5. Replace the whole grid block (the `<div className="mt-6 grid …">` and everything inside, plus the freeDays paragraph) with:

```tsx
          {(() => {
            const todayAR = currentWeekdayAR();
            const initialDay = todayAR > 6 ? 1 : todayAR;
            const isCurrentYear = year === currentYearAR();
            return (
              <>
                {/* Desktop: la semana entera de un vistazo, seis columnas. */}
                <div className="mt-6 hidden gap-2 lg:grid lg:grid-cols-6">
                  {agenda.map(({ day, label, entries }) => (
                    <section
                      key={day}
                      className={`rounded-lg border p-3 ${entries.length === 0 ? "border-dashed" : ""}`}
                    >
                      <h2
                        className={`flex items-center justify-between gap-1 text-sm font-semibold ${
                          entries.length === 0 ? "text-muted-foreground" : ""
                        }`}
                      >
                        {label}
                        {isCurrentYear && day === todayAR && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            Hoy
                          </span>
                        )}
                      </h2>
                      {entries.length === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">Sin actividades</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {entries.map((e) => (
                            <ActivityCard key={e.id} entry={e} />
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
                {/* Celular: un día por vez, con el de hoy preseleccionado. */}
                <div className="mt-6 lg:hidden">
                  <DayTabs agenda={agenda} initialDay={initialDay} />
                </div>
              </>
            );
          })()}
```

(If the IIFE reads awkward against the file's style, hoist `todayAR`/`initialDay`/`isCurrentYear` next to `busyDays` instead — same values, author's choice.)

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all green (the removed `joinEs` had no tests; no render tests exist).

- [ ] **Step 8: Visual verification in the browser**

Start the dev server with the Browser pane (`preview_start` with the project's `.claude/launch.json` entry; if none exists, create one running `npm run dev` on port 3000). Then, with a couple of seeded activities across the four spaces (create them via `/admin/actividades` in dev, including three overlapping classroom ones):

1. Desktop 1280px: 6 columns, "Hoy" chip on today's column, per-space colors/icons visible, no horizontal scroll.
2. Mobile 375px: day chips scroll horizontally if needed, today preselected, tapping chips switches the day, empty day shows its dashed message.
3. Empty year: the empty state renders (no `thead`, no grid).
4. Screenshot desktop + mobile for the final report.

- [ ] **Step 9: Commit**

```bash
git add src/lib/dates.ts src/lib/activities/room-meta.ts "src/app/(public)/actividades" tests/dates-weekday.test.ts
git commit -m "feat(activities): redesigned public page with space accents and a mobile day selector"
```

---

### Task 5: Runbook fix — activities and news survive a rebuild

**Files:**
- Modify: `docs/10-runbook-dominio-produccion.md` (§4.2: intro line 382, Paso 2 block ~line 419, Paso 5 block ~line 464, Paso 8 block ~line 509)

**Interfaces:** documentation only.

- [ ] **Step 1: Edit §4.2**

1. Line 382-383: "Lo único que sobrevive son **cuatro tablas**: `configuration`, `users`, `roles` y `user_roles`." becomes "Lo único que sobrevive son **seis tablas**: `configuration`, `users`, `roles`, `user_roles`, `activities` y `news`. Las dos últimas son contenido cargado a mano desde el panel — no hay archivo en `datos/` que las reponga, y así se perdieron las actividades de prueba en el rearmado del 22/08/2026."
2. Paso 2 SQL — add to the `CREATE TABLE … LIKE` block:

```sql
CREATE TABLE sigev_rescate.activities    LIKE sigev.activities;
CREATE TABLE sigev_rescate.news          LIKE sigev.news;
```

and to the `INSERT` block:

```sql
INSERT INTO sigev_rescate.activities    SELECT * FROM sigev.activities;
INSERT INTO sigev_rescate.news          SELECT * FROM sigev.news;
```

and to the count `SELECT` two more columns: `(SELECT COUNT(*) FROM sigev_rescate.activities) AS actividades, (SELECT COUNT(*) FROM sigev_rescate.news) AS noticias`. Update "Anotá esos cuatro números" → "Anotá esos seis números".

3. Paso 5 — add `INSERT INTO sigev.activities SELECT * FROM sigev_rescate.activities;` and `INSERT INTO sigev.news SELECT * FROM sigev_rescate.news;` (after the existing four; neither has FKs), the two count columns, and "Los cuatro números" → "Los seis números". Note: `news` has an FK to `users` (author) — insert it **after** `users`, which the placement already guarantees.
4. Paso 8 — append to the `mysql` block: `SELECT COUNT(*) AS actividades FROM activities; SELECT COUNT(*) AS noticias FROM news;` and to the expected-numbers paragraph: "`actividades` y `noticias` tampoco tienen un número fijo: tienen que dar los que anotaste en el paso 2."

- [ ] **Step 2: Verify FK claim before writing it**

Run: `Grep "model News" prisma/schema.prisma` with context — confirm whether `News` references `User`. Adjust the Paso 5 note to the truth (if there is no FK, drop the note sentence).

- [ ] **Step 3: Commit**

```bash
git add docs/10-runbook-dominio-produccion.md
git commit -m "docs(runbook): rescue and verify activities and news across DB rebuilds"
```

---

## Out of scope (explicit)

- No render/E2E tests for the public page (pre-existing debt, spec).
- No changes to `year-param.ts`, sitemap, caching, auth, or audit shapes.
- The production diagnosis SQL lives in the spec (Anexo A) and is run by Mariano over SSH — nothing in this plan touches production.
