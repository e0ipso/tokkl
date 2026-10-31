import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { FixtureDatabase } from './database.ts';

// Deliberate corruption and physical metadata unavailable through public storage contracts.
// Never accepts a URL or an unregistered connection. These writes intentionally do not publish.
const connections = new WeakMap<FixtureDatabase, Kysely<any>>();
export function registerPhysicalFixture(handle: FixtureDatabase, connection: Kysely<any>): void { connections.set(handle, connection); }
function physical(handle: FixtureDatabase): Kysely<any> { const db = connections.get(handle); if (!db) throw Error('Unknown fixture'); return db; }
export async function removeWorkspaceMember(handle: FixtureDatabase, workspaceId: number, userId: number): Promise<number> {
  const result = await physical(handle).deleteFrom('workspace_users').where('workspace_id', '=', workspaceId).where('user_id', '=', userId).executeTakeFirst();
  return Number(result.numDeletedRows);
}
/** SQLite file-copy semantics are tested separately from portable report behavior. */
export async function copySQLiteFile(handle: FixtureDatabase, filename: string): Promise<void> {
  if (handle.backend !== 'sqlite') throw Error('SQLite fixture required');
  await sql`VACUUM INTO ${filename}`.execute(physical(handle));
}

/** Token hashes, used-token history, session counts and setting attribution have no public read port. */
export async function tokenRows(handle: FixtureDatabase): Promise<Array<Record<string, any>>> {
  return normalizeRows(await physical(handle).selectFrom('account_tokens').selectAll().orderBy('id').execute());
}
export async function sessionCount(handle: FixtureDatabase, userId?: number): Promise<number> {
  let q = physical(handle).selectFrom('sessions').select(({ fn }) => fn.countAll().as('n'));
  if (userId !== undefined) q = q.where('user_id', '=', userId);
  return Number((await q.executeTakeFirstOrThrow()).n);
}
export async function settingRows(handle: FixtureDatabase): Promise<Array<Record<string, any>>> {
  return normalizeRows(await physical(handle).selectFrom('instance_settings').select(['key','value','updated_by']).orderBy('key').execute());
}
function normalizeRows(rows: Array<Record<string, any>>): Array<Record<string, any>> {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    value !== null && (key === 'id' || key.endsWith('_id') || ['created_by','updated_by'].includes(key)) ? Number(value) : value])));
}
/** Backdate or corrupt a known fixture record without application validation or publication. */
export async function corruptRecord(handle: FixtureDatabase, table: 'time_entries'|'users'|'sessions'|'account_tokens'|'clients'|'projects'|'tasks'|'tags'|'workspaces', changes: Record<string, unknown>, where: Record<string, unknown> = {}): Promise<void> {
  let q = physical(handle).updateTable(table).set(changes);
  for (const [key, value] of Object.entries(where)) q = q.where(key, '=', value);
  await q.execute();
}
export async function corruptSetting(handle: FixtureDatabase, value: string): Promise<void> {
  const db = physical(handle);
  await db.deleteFrom('instance_settings').where('key','=','time_resolution_minutes').execute();
  await db.insertInto('instance_settings').values({key:'time_resolution_minutes', value, updated_at:'2026-01-01T00:00:00.000Z', updated_by:null}).execute();
}
/** Force a real statement failure at the membership write, then restore only this fixture's trigger. */
export async function failMembershipInsert(handle: FixtureDatabase): Promise<() => Promise<void>> {
  const db = physical(handle);
  if (handle.backend === 'sqlite') await sql.raw("CREATE TRIGGER fail_membership BEFORE INSERT ON workspace_users BEGIN SELECT RAISE(ABORT, 'forced failure'); END").execute(db);
  else if (handle.backend === 'postgres') {
    await sql.raw("CREATE FUNCTION fail_membership_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$").execute(db);
    await sql.raw('CREATE TRIGGER fail_membership BEFORE INSERT ON workspace_users FOR EACH ROW EXECUTE FUNCTION fail_membership_fn()').execute(db);
  } else await sql.raw("CREATE TRIGGER fail_membership BEFORE INSERT ON workspace_users FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced failure'").execute(db);
  return async () => {
    await sql.raw(`DROP TRIGGER fail_membership${handle.backend === 'postgres' ? ' ON workspace_users' : ''}`).execute(db);
    if (handle.backend === 'postgres') await sql.raw('DROP FUNCTION fail_membership_fn()').execute(db);
  };
}
export async function completedMigrations(handle: FixtureDatabase): Promise<number> {
  return Number((await physical(handle).selectFrom('storage_migrations').select(({fn})=>fn.countAll().as('n')).where('state','=','complete').executeTakeFirstOrThrow()).n);
}
export async function sqliteIndexes(handle: FixtureDatabase): Promise<string[]> {
  if (handle.backend !== 'sqlite') throw Error('SQLite fixture required');
  return (await physical(handle).selectFrom('sqlite_schema').select('name').where('type','=','index').execute()).map(row=>String(row.name));
}
