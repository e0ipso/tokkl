import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { classifyConflict } from '../errors.ts';

const asciiNameKey = (value: string): string => value.replace(/[A-Z]/g, char => char.toLowerCase());
export function nameKey(backend: Backend, name: string): RawBuilder<string> {
  const value = asciiNameKey(name);
  return backend === 'mysql' || backend === 'mariadb' ? sql<string>`cast(${value} as binary)` : sql<string>`${value}`;
}
export function containsName(backend: Backend, column: string, search: string): RawBuilder<boolean> {
  return backend === 'postgres'
    ? sql<boolean>`strpos(${sql.ref(column)}, ${nameKey(backend, search)}) > 0`
    : sql<boolean>`instr(${sql.ref(column)}, ${nameKey(backend, search)}) > 0`;
}
/** SQLite's historic INTEGER affinity can hold finite real estimates. Project them
 * as REAL so the bridge's strict integer/ID normalization does not reject amounts. */
export function taskEstimate(backend: Backend, column: string): RawBuilder<number | null> {
  return backend === 'sqlite'
    ? sql<number | null>`cast(${sql.ref(column)} as real)`
    : sql<number | null>`${sql.ref(column)}`;
}
function epoch(backend: Backend, value: RawBuilder<unknown>): RawBuilder<number> {
  if (backend === 'sqlite') return sql<number>`unixepoch(${value})`;
  if (backend === 'postgres') return sql<number>`floor(extract(epoch from cast(${value} as timestamptz)))`;
  return sql<number>`floor(timestampdiff(microsecond, '1970-01-01 00:00:00', str_to_date(${value}, '%Y-%m-%dT%H:%i:%s.%fZ')) / 1000000)`;
}
export function catalogTotal(backend: Backend, kind: 'project' | 'task', now: string): RawBuilder<number> {
  const ref = kind === 'project' ? sql.ref('p.id') : sql.ref('t.id');
  return sql<number>`coalesce((select sum(${epoch(backend, sql`coalesce(te.stop, ${now})`)} - ${epoch(backend, sql`te.start`)})
    from time_entries te where ${sql.ref(`te.${kind}_id`)} = ${ref} and te.deleted_at is null), 0)`;
}
/**
 * Adds one to the workspace's catalog revision. Every project and client write calls it in its own
 * transaction, which already holds the workspace's row lock, so the bump waits on nothing new.
 */
export async function bumpCatalogRevision(db: Kysely<PhysicalDatabase>, workspaceId: number): Promise<void> {
  await db
    .updateTable('workspaces')
    .set({ catalog_revision: sql<number>`${sql.ref('catalog_revision')} + 1` })
    .where('id', '=', workspaceId)
    .execute();
}
export async function catalogWrite<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw classifyConflict(error) ?? error;
  }
}
