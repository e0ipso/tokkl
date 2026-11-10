import { sql, type RawBuilder } from 'kysely';
import type { Backend } from '../config.ts';

function epoch(backend: Backend, column: string): RawBuilder<number> {
  const value = sql.ref(column);
  if (backend === 'sqlite') return sql<number>`unixepoch(${value})`;
  if (backend === 'postgres') return sql<number>`floor(extract(epoch from cast(${value} as timestamptz)))`;
  return sql<number>`floor(timestampdiff(microsecond, '1970-01-01 00:00:00', str_to_date(${value}, '%Y-%m-%dT%H:%i:%s.%fZ')) / 1000000)`;
}
/** Whole-second endpoints, unlike report formatting's elapsed milliseconds. */
export function reportDuration(backend: Backend): RawBuilder<number> {
  return sql<number>`${epoch(backend, 'e.stop')} - ${epoch(backend, 'e.start')}`;
}
/** Read from the stored text without the milliseconds. */
function wholeSeconds(backend: Backend, column: string): RawBuilder<number> {
  const value = sql`substr(${sql.ref(column)}, 1, 19)`;
  if (backend === 'sqlite') return sql<number>`unixepoch(${value})`;
  if (backend === 'postgres') return sql<number>`cast(extract(epoch from cast(${value} as timestamp)) as bigint)`;
  return sql<number>`timestampdiff(second, '1970-01-01 00:00:00', str_to_date(${value}, '%Y-%m-%dT%H:%i:%s'))`;
}
/** Of `YYYY-MM-DDTHH:MM:SS.sssZ`. */
function millisecondPart(backend: Backend, column: string): RawBuilder<number> {
  const digits = sql`substr(${sql.ref(column)}, 21, 3)`;
  return backend === 'mysql' || backend === 'mariadb'
    ? sql<number>`cast(${digits} as signed)`
    : sql<number>`cast(${digits} as integer)`;
}
/** For a positive integer divisor. */
function floorDivide(backend: Backend, dividend: RawBuilder<number>, divisor: number): RawBuilder<number> {
  if (!Number.isSafeInteger(divisor) || divisor < 1) throw new Error('Invalid report divisor');
  const d = sql.lit(divisor);
  // Both % operators truncate toward zero; adding the divisor once makes the remainder non-negative.
  const exact = sql`(${dividend} - ((${dividend} % ${d}) + ${d}) % ${d})`;
  return backend === 'mysql' || backend === 'mariadb'
    ? sql<number>`(${exact} div ${d})`
    : sql<number>`(${exact} / ${d})`;
}
/** Whole elapsed seconds, rounded per entry as report formatting does (`Math.ceil`, `floor` or `round`). */
export function reportRoundedSeconds(
  backend: Backend,
  rounding: { mode: number; minutes: number },
): RawBuilder<number> {
  const elapsedMs = sql<number>`((${wholeSeconds(backend, 'e.stop')} - ${wholeSeconds(backend, 'e.start')}) * 1000 + ${millisecondPart(backend, 'e.stop')} - ${millisecondPart(backend, 'e.start')})`;
  const seconds = floorDivide(backend, elapsedMs, 1000);
  if (rounding.minutes <= 0) return seconds;
  const step = rounding.minutes * 60;
  const steps =
    rounding.mode > 0
      ? floorDivide(backend, sql<number>`(${seconds} + ${sql.lit(step - 1)})`, step)
      : rounding.mode < 0
        ? floorDivide(backend, seconds, step)
        : // Math.round(s / step) is floor(s / step + 1/2), which is floor((2s + step) / 2step).
          floorDivide(backend, sql<number>`(2 * ${seconds} + ${sql.lit(step)})`, 2 * step);
  return sql<number>`(${steps} * ${sql.lit(step)})`;
}
/** SQLite lower() folds ASCII only. Bind literal text, including %, _ and backslash. */
export function reportContains(backend: Backend, search: string): RawBuilder<boolean> {
  let value: RawBuilder<unknown> =
    backend === 'mysql' || backend === 'mariadb' ? sql`cast(e.description as binary)` : sql`e.description`;
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') value = sql`replace(${value}, ${letter}, ${letter.toLowerCase()})`;
  const needle = search.replace(/[A-Z]/g, c => c.toLowerCase());
  return backend === 'postgres'
    ? sql<boolean>`strpos(${value}, ${needle}) > 0`
    : sql<boolean>`instr(${value}, ${needle}) > 0`;
}
export function reportIds(column: string, ids?: Array<number | null>): RawBuilder<boolean> | undefined {
  if (!ids?.length) return;
  const numeric = ids.filter((id): id is number => id !== null);
  const clauses = [
    ...(numeric.length ? [sql`${sql.ref(column)} in (${sql.join(numeric)})`] : []),
    ...(ids.includes(null) ? [sql`${sql.ref(column)} is null`] : []),
  ];
  return sql<boolean>`(${sql.join(clauses, sql` or `)})`;
}
export function reportTags(ids?: Array<number | null>): RawBuilder<boolean> | undefined {
  if (!ids?.length) return;
  const numeric = ids.filter((id): id is number => id !== null);
  const clauses = [
    ...(numeric.length
      ? [
          sql`exists (select 1 from time_entry_tags x where x.time_entry_id = e.id and x.tag_id in (${sql.join(numeric)}))`,
        ]
      : []),
    ...(ids.includes(null) ? [sql`not exists (select 1 from time_entry_tags x where x.time_entry_id = e.id)`] : []),
  ];
  return sql<boolean>`(${sql.join(clauses, sql` or `)})`;
}
