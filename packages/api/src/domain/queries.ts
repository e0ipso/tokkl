/**
 * Read use cases for the HTTP API. Routes receive these bound to one credential-checked snapshot
 * and never see repositories, so workspace scoping, filtering and ordering live here.
 */
import type { ClientFilter, EntryFilter, ProjectFilter, Repositories } from '../storage/contracts.ts';
import type {
  AccountExportProjection,
  AccountToken,
  Client,
  EntryBounds,
  EntryDetails,
  Id,
  InstanceSettings,
  MembershipRole,
  ProjectSummary,
  Tag,
  TaskSummary,
  User,
  Workspace,
  WorkspaceMember,
} from '../storage/domain.ts';
import { memberWorkspace } from './membership.ts';
import { getInstanceSettings } from './instanceSettings.ts';
import { getClient, getProject, getTask } from './catalogs.ts';
import { getTimeEntry } from './timeEntries.ts';

export type ReadRepositories = Omit<Repositories, 'rateLimits'>;

/** A workspace with the caller's membership role in it. */
export interface MemberWorkspace {
  workspace: Workspace;
  role: MembershipRole | undefined;
}
export interface WorkspaceProject {
  project: ProjectSummary;
  /** The workspace's currency, which Toggl repeats on every project. */
  defaultCurrency: string;
}
export interface Organization {
  workspace: Workspace;
  owner: boolean;
  memberCount: number;
}
export interface RelatedData {
  workspaces: MemberWorkspace[];
  clients: Client[];
  projects: WorkspaceProject[];
  tags: Tag[];
  tasks: TaskSummary[];
  timeEntries: EntryDetails[];
}
export type TaskSortField = 'name' | 'created_at';
export type SortOrder = 'ASC' | 'DESC';
export interface TaskSearch {
  projectId?: Id;
  active?: boolean;
  changedSince?: string;
  /** Case-insensitive substring of the name. */
  search?: string;
  sortField: TaskSortField;
  sortOrder: SortOrder;
}

/** Toggl's default window for time entry lists that name no range. */
export const DEFAULT_LIST_DAYS = 9;
export const recentEntriesStart = (now = Date.now()) => new Date(now - DEFAULT_LIST_DAYS * 86400000).toISOString();

const changedAfter = <T extends { updatedAt: string }>(rows: T[], since: string | undefined): T[] =>
  since === undefined ? rows : rows.filter(row => row.updatedAt >= since);

function compareTasks(field: TaskSortField, order: SortOrder) {
  const direction = order === 'ASC' ? 1 : -1;
  return (a: TaskSummary, b: TaskSummary) =>
    direction *
    ((field === 'name'
      ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      : a.createdAt.localeCompare(b.createdAt)) || a.id - b.id);
}

export function createReadQueries(r: ReadRepositories, deploymentSessionDays: number) {
  const memberWorkspaces = (userId: Id) => r.workspaces.listForUser(userId);
  /** Rows from every workspace the user belongs to, in workspace order. */
  async function acrossWorkspaces<T>(userId: Id, read: (ws: Workspace) => Promise<T[]>): Promise<T[]> {
    return (await Promise.all((await memberWorkspaces(userId)).map(read))).flat();
  }
  const withRole = async (userId: Id, workspace: Workspace): Promise<MemberWorkspace> => ({
    workspace,
    role: await r.workspaces.getRole(userId, workspace.id),
  });
  const projectsOf = async (ws: Workspace, filter?: ProjectFilter): Promise<WorkspaceProject[]> =>
    (await r.projects.list(ws.id, filter)).map(project => ({ project, defaultCurrency: ws.defaultCurrency }));

  return {
    instanceSettings: (): Promise<InstanceSettings> => getInstanceSettings(r, deploymentSessionDays),
    /** 403 unless the user is a member; a missing workspace looks the same. */
    workspace: (userId: Id, workspaceId: Id): Promise<Workspace> => memberWorkspace(r, userId, workspaceId),
    async memberWorkspace(userId: Id, workspaceId: Id): Promise<MemberWorkspace> {
      return withRole(userId, await memberWorkspace(r, userId, workspaceId));
    },
    async memberWorkspaces(userId: Id, changedSince?: string): Promise<MemberWorkspace[]> {
      const workspaces = changedAfter(await memberWorkspaces(userId), changedSince);
      return Promise.all(workspaces.map(ws => withRole(userId, ws)));
    },
    async organizations(userId: Id): Promise<Organization[]> {
      return Promise.all(
        (await memberWorkspaces(userId)).map(async workspace => ({
          workspace,
          owner: (await r.workspaces.getRole(userId, workspace.id)) === 'owner',
          memberCount: await r.workspaces.countMembers(workspace.id),
        })),
      );
    },
    workspaceRole: (userId: Id, workspaceId: Id): Promise<MembershipRole | undefined> =>
      r.workspaces.getRole(userId, workspaceId),
    workspaceMembers: async (userId: Id, workspaceId: Id): Promise<WorkspaceMember[]> =>
      r.workspaces.listMembers((await memberWorkspace(r, userId, workspaceId)).id),
    async relatedData(user: User): Promise<RelatedData> {
      const workspaces = await memberWorkspaces(user.id);
      const each = async <T>(read: (ws: Workspace) => Promise<T[]>) => (await Promise.all(workspaces.map(read))).flat();
      return {
        workspaces: await Promise.all(workspaces.map(ws => withRole(user.id, ws))),
        clients: await each(ws => r.clients.list(ws.id)),
        projects: await each(ws => projectsOf(ws)),
        tags: await each(ws => r.tags.list(ws.id)),
        tasks: await each(ws => r.tasks.list(ws.id)),
        timeEntries: await r.entries.list(user.id, { from: recentEntriesStart() }),
      };
    },
    memberProjects: (userId: Id, filter: { includeArchived: boolean; changedSince?: string }) =>
      acrossWorkspaces(userId, ws =>
        projectsOf(ws, { active: filter.includeArchived ? 'both' : true, changedSince: filter.changedSince }),
      ),
    memberClients: (userId: Id, changedSince?: string) =>
      acrossWorkspaces(userId, async ws => changedAfter(await r.clients.list(ws.id), changedSince)),
    memberTags: (userId: Id, changedSince?: string) =>
      acrossWorkspaces(userId, async ws => changedAfter(await r.tags.list(ws.id), changedSince)),
    memberTasks: (userId: Id, filter: { includeInactive: boolean; changedSince?: string }) =>
      acrossWorkspaces(userId, async ws =>
        changedAfter(
          await r.tasks.list(ws.id, { active: filter.includeInactive ? undefined : true }),
          filter.changedSince,
        ),
      ),
    workspaceProjects: (ws: Workspace, filter: ProjectFilter) => projectsOf(ws, filter),
    workspaceProject: (ws: Workspace, id: Id): Promise<ProjectSummary> => getProject(r, ws.id, id),
    async searchTasks(ws: Workspace, search: TaskSearch): Promise<TaskSummary[]> {
      let tasks = changedAfter(
        await r.tasks.list(ws.id, { projectId: search.projectId, active: search.active }),
        search.changedSince,
      );
      const needle = search.search?.toLowerCase();
      if (needle) tasks = tasks.filter(task => task.name.toLowerCase().includes(needle));
      return tasks.sort(compareTasks(search.sortField, search.sortOrder));
    },
    async projectTasks(ws: Workspace, projectId: Id, onlyActive: boolean): Promise<TaskSummary[]> {
      await getProject(r, ws.id, projectId);
      return r.tasks.list(ws.id, { projectId, active: onlyActive ? true : undefined });
    },
    projectTask: (ws: Workspace, projectId: Id, id: Id): Promise<TaskSummary> => getTask(r, ws.id, id, projectId),
    workspaceClients: (ws: Workspace, filter: ClientFilter): Promise<Client[]> => r.clients.list(ws.id, filter),
    workspaceClient: (ws: Workspace, id: Id): Promise<Client> => getClient(r, ws.id, id),
    workspaceTags: (ws: Workspace, search?: string): Promise<Tag[]> => r.tags.list(ws.id, search),
    timeEntries: (userId: Id, filter: EntryFilter): Promise<EntryDetails[]> => r.entries.list(userId, filter),
    runningEntry: (userId: Id): Promise<EntryDetails | undefined> => r.entries.running(userId),
    timeEntry: (userId: Id, id: Id): Promise<EntryDetails> => getTimeEntry(r, userId, id),
    entryBounds: (userId: Id): Promise<EntryBounds> => r.entries.bounds(userId),
    trash: (userId: Id): Promise<EntryDetails[]> => r.entries.listDeleted(userId),
    accountExport: (userId: Id): Promise<AccountExportProjection> => r.transfers.exportAccount(userId),
    accounts: (): Promise<User[]> => r.users.list(),
    pendingInvites: (): Promise<AccountToken[]> => r.tokens.listPendingInvites(new Date().toISOString()),
  };
}
export type ReadQueries = ReturnType<typeof createReadQueries>;
