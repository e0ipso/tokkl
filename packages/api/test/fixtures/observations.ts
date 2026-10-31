import { storageFor, type FixtureDatabase } from './database.ts';
import type { TestContext } from '../helpers.ts';

export async function entryRecord(ctx: TestContext, id: number) {
  const row = (await storageFor(ctx.db).entries.get(ctx.user.id, id, true))!;
  return { start: row.start, stop: row.stop, deleted_at: row.deletedAt, all_day: Number(row.allDay), updated_at: row.updatedAt };
}
export async function entryCount(ctx: TestContext): Promise<number> {
  const storage = storageFor(ctx.db);
  return (await storage.entries.list(ctx.user.id)).length + (await storage.entries.listDeleted(ctx.user.id)).length;
}
/** Count every fixture account/workspace so refusal and dry-run assertions also catch cross-account writes. */
export async function catalogCounts(ctx: TestContext): Promise<Record<string, number>> {
  const storage = storageFor(ctx.db);
  return storage.readSnapshot(async repositories => {
    const counts = { clients: 0, projects: 0, tasks: 0, tags: 0, time_entries: 0 };
    const workspaces = new Set<number>();
    for (const user of await repositories.users.list()) {
      for (const workspace of await repositories.workspaces.listForUser(user.id)) workspaces.add(workspace.id);
      counts.time_entries += (await repositories.entries.list(user.id)).length + (await repositories.entries.listDeleted(user.id)).length;
    }
    for (const wid of workspaces) {
      counts.clients += (await repositories.clients.list(wid, { status: 'both' })).length;
      counts.projects += await repositories.projects.count(wid);
      counts.tasks += (await repositories.tasks.list(wid)).length;
      counts.tags += (await repositories.tags.list(wid)).length;
    }
    return counts;
  });
}
export async function memberships(db: FixtureDatabase) {
  const storage = storageFor(db);
  const rows = [];
  for (const user of await storage.users.list()) for (const workspace of await storage.workspaces.listForUser(user.id)) {
    rows.push({ workspace_id:workspace.id, user_id:user.id, role:await storage.workspaces.getRole(user.id,workspace.id) });
  }
  return rows.sort((a,b)=>a.workspace_id-b.workspace_id || a.user_id-b.user_id);
}
