import { createHash } from 'node:crypto';
import type { TestContext } from '../../../packages/api/test/helpers.ts';
import { storageFor } from '../../../packages/api/test/fixtures/database.ts';
import type { TimeEntry, Workspace } from '../../../packages/api/src/storage/domain.ts';

export type Row = Record<string, unknown>;
const byId = <T extends { id: number }>(a: T, b: T) => a.id - b.id;
const fields = (value: object): Row => Object.fromEntries(Object.entries(value).map(([key, val]) => [key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`), val]));

/** A consistent domain snapshot of the fixture instance, including entries in the trash. */
export function snapshot(context: TestContext) {
  return storageFor(context.db).readSnapshot(async repositories => {
    const users = (await repositories.users.list()).sort(byId);
    const workspaces = new Map<number, Workspace>();
    const entries: Row[] = [];
    for (const user of users) {
      for (const workspace of await repositories.workspaces.listForUser(user.id)) workspaces.set(workspace.id, workspace);
      const all = [...await repositories.entries.list(user.id), ...await repositories.entries.listDeleted(user.id)];
      for (const entry of all.sort(byId)) {
        const { tags, project: _project, client: _client, task: _task, ...base } = entry;
        entries.push({ ...fields(base satisfies TimeEntry), tags: tags.map(tag => tag.name).sort() });
      }
    }
    const memberships: Row[] = [];
    const projects: Row[] = [];
    const tasks: Row[] = [];
    for (const id of [...workspaces.keys()].sort((a, b) => a - b)) {
      for (const { workspaceId, userId, role } of (await repositories.workspaces.listMembers(id)).sort((a, b) => a.userId - b.userId)) {
        memberships.push(fields({ workspaceId, userId, role }));
      }
      // Totals change with entries, while these assertions concern catalog metadata only.
      for (const project of (await repositories.projects.list(id, { active: 'both' })).sort(byId)) {
        projects.push(fields((await repositories.projects.getMetadata(id, project.id))!));
      }
      for (const task of (await repositories.tasks.list(id)).sort(byId)) {
        tasks.push(fields((await repositories.tasks.getMetadata(id, task.id))!));
      }
    }
    return {
      users: users.map(({ passwordHash, apiToken, ...user }) => fields({ ...user,
        passwordHash: createHash('sha256').update(passwordHash).digest('hex'),
        apiToken: createHash('sha256').update(apiToken).digest('hex'),
      })),
      workspaces: [...workspaces.values()].sort(byId).map(fields),
      memberships, projects, tasks,
      entries: entries.sort((a, b) => Number(a.id) - Number(b.id)),
    };
  });
}
