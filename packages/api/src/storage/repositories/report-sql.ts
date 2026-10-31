import { sql, type RawBuilder } from 'kysely';
import type { Backend } from '../config.ts';

function epoch(backend: Backend, column: string): RawBuilder<number> {
  const value = sql.ref(column);
  if (backend === 'sqlite') return sql<number>`unixepoch(${value})`;
  if (backend === 'postgres') return sql<number>`floor(extract(epoch from cast(${value} as timestamptz)))`;
  return sql<number>`floor(timestampdiff(microsecond, '1970-01-01 00:00:00', str_to_date(${value}, '%Y-%m-%dT%H:%i:%s.%fZ')) / 1000000)`;
}
/** Duration bounds use whole-second endpoints, unlike report formatting's elapsed milliseconds. */
export function reportDuration(backend: Backend): RawBuilder<number> {
  return sql<number>`${epoch(backend, 'e.stop')} - ${epoch(backend, 'e.start')}`;
}
/** SQLite lower() folds ASCII only. Bind literal text, including %, _ and backslash. */
export function reportContains(backend: Backend, search: string): RawBuilder<boolean> {
  let value: RawBuilder<unknown> = backend === 'mysql' || backend === 'mariadb' ? sql`cast(e.description as binary)` : sql`e.description`;
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') value = sql`replace(${value}, ${letter}, ${letter.toLowerCase()})`;
  const needle = search.replace(/[A-Z]/g, c => c.toLowerCase());
  return backend === 'postgres' ? sql<boolean>`strpos(${value}, ${needle}) > 0` : sql<boolean>`instr(${value}, ${needle}) > 0`;
}
export function reportIds(column: string, ids?: Array<number | null>): RawBuilder<boolean> | undefined {
  if (!ids?.length) return;
  const numeric = ids.filter((id): id is number => id !== null);
  const clauses = [...(numeric.length ? [sql`${sql.ref(column)} in (${sql.join(numeric)})`] : []),
    ...(ids.includes(null) ? [sql`${sql.ref(column)} is null`] : [])];
  return sql<boolean>`(${sql.join(clauses, sql` or `)})`;
}
export function reportTags(ids?: Array<number | null>): RawBuilder<boolean> | undefined {
  if (!ids?.length) return;
  const numeric = ids.filter((id): id is number => id !== null);
  const clauses = [...(numeric.length ? [sql`exists (select 1 from time_entry_tags x where x.time_entry_id = e.id and x.tag_id in (${sql.join(numeric)}))`] : []),
    ...(ids.includes(null) ? [sql`not exists (select 1 from time_entry_tags x where x.time_entry_id = e.id)`] : [])];
  return sql<boolean>`(${sql.join(clauses, sql` or `)})`;
}
