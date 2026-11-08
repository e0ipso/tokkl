/**
 * Read use cases for the HTTP API. Routes receive these bound to one credential-checked snapshot
 * and never see repositories, so workspace scoping, filtering and ordering live here.
 */
import type {
  ClientFilter,
  ClientsReader,
  EntriesReader,
  EntryFilter,
  ProjectFilter,
  ProjectsReader,
  SettingsReader,
  TagsReader,
  TasksReader,
  TokensReader,
  TransfersRepository,
  UsersReader,
  WorkspacesReader,
} from '../storage/contracts.ts';
import type {
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
import { getTimeEntry } from './entryAccess.ts';

/** Reads about accounts, the instance and workspace membership. No repository here can write. */
export interface AccountReadRepositories {
  users: Pick<UsersReader, 'list'>;
  workspaces: Pick<WorkspacesReader, 'forMember' | 'listForUser' | 'getRole' | 'countMembers' | 'listMembers'>;
  settings: SettingsReader;
  tokens: Pick<TokensReader, 'listPendingInvites'>;
  transfers: TransfersRepository;
}
/** Reads of the clients, projects, tasks and tags in the workspaces a user belongs to. */
export interface CatalogReadRepositories {
  workspaces: Pick<WorkspacesReader, 'listForUser'>;
  clients: Pick<ClientsReader, 'list' | 'get'>;
  projects: Pick<ProjectsReader, 'list' | 'get'>;
  tasks: Pick<TasksReader, 'list' | 'get'>;
  tags: Pick<TagsReader, 'list'>;
}
/** Reads of one user's time entries. */
export interface EntryReadRepositories {
  entries: Pick<EntriesReader, 'list' | 'get' | 'running' | 'bounds' | 'listDeleted'>;
}
export type ReadQueryRepositories = AccountReadRepositories & CatalogReadRepositories & EntryReadRepositories;

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
const DEFAULT_LIST_DAYS = 9;
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

/** Rows from every workspace the user belongs to, in workspace order. */
async function acrossWorkspaces<T>(
  r: Pick<CatalogReadRepositories, 'workspaces'>,
  userId: Id,
  read: (ws: Workspace) => Promise<T[]>,
): Promise<T[]> {
  return (await Promise.all((await r.workspaces.listForUser(userId)).map(read))).flat();
}

export function createAccountQueries(r: AccountReadRepositories, deploymentSessionDays: number) {
  const withRole = async (userId: Id, workspace: Workspace): Promise<MemberWorkspace> => ({
    workspace,
    role: await r.workspaces.getRole(userId, workspace.id),
  });
  return {
    instanceSettings: (): Promise<InstanceSettings> => getInstanceSettings(r, deploymentSessionDays),
    /** 403 unless the user is a member; a missing workspace looks the same. */
    workspace: (userId: Id, workspaceId: Id): Promise<Workspace> => memberWorkspace(r, userId, workspaceId),
    async memberWorkspace(userId: Id, workspaceId: Id): Promise<MemberWorkspace> {
      return withRole(userId, await memberWorkspace(r, userId, workspaceId));
    },
    async memberWorkspaces(userId: Id, changedSince?: string): Promise<MemberWorkspace[]> {
      const workspaces = changedAfter(await r.workspaces.listForUser(userId), changedSince);
      return Promise.all(workspaces.map(ws => withRole(userId, ws)));
    },
    async organizations(userId: Id): Promise<Organization[]> {
      return Promise.all(
        (await r.workspaces.listForUser(userId)).map(async workspace => ({
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
    accounts: (): Promise<User[]> => r.users.list(),
    pendingInvites: (): Promise<AccountToken[]> => r.tokens.listPendingInvites(new Date().toISOString()),
  };
}

export function createCatalogQueries(r: CatalogReadRepositories) {
  const projectsOf = async (ws: Workspace, filter?: ProjectFilter): Promise<WorkspaceProject[]> =>
    (await r.projects.list(ws.id, filter)).map(project => ({ project, defaultCurrency: ws.defaultCurrency }));
  return {
    memberProjects: (userId: Id, filter: { includeArchived: boolean; changedSince?: string }) =>
      acrossWorkspaces(r, userId, ws =>
        projectsOf(ws, { active: filter.includeArchived ? 'both' : true, changedSince: filter.changedSince }),
      ),
    memberClients: (userId: Id, changedSince?: string) =>
      acrossWorkspaces(r, userId, async ws => changedAfter(await r.clients.list(ws.id), changedSince)),
    memberTags: (userId: Id, changedSince?: string) =>
      acrossWorkspaces(r, userId, async ws => changedAfter(await r.tags.list(ws.id), changedSince)),
    memberTasks: (userId: Id, filter: { includeInactive: boolean; changedSince?: string }) =>
      acrossWorkspaces(r, userId, async ws =>
        changedAfter(
          await r.tasks.list(ws.id, { active: filter.includeInactive ? undefined : true }),
          filter.changedSince,
        ),
      ),
    workspaceProjects: (ws: Workspace, filter?: ProjectFilter) => projectsOf(ws, filter),
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
    workspaceClients: (ws: Workspace, filter?: ClientFilter): Promise<Client[]> => r.clients.list(ws.id, filter),
    workspaceClient: (ws: Workspace, id: Id): Promise<Client> => getClient(r, ws.id, id),
    workspaceTags: (ws: Workspace, search?: string): Promise<Tag[]> => r.tags.list(ws.id, search),
    /** Every task in the workspace, active or not. */
    workspaceTasks: (ws: Workspace): Promise<TaskSummary[]> => r.tasks.list(ws.id),
  };
}

export function createEntryQueries(r: EntryReadRepositories) {
  return {
    timeEntries: (userId: Id, filter: EntryFilter): Promise<EntryDetails[]> => r.entries.list(userId, filter),
    runningEntry: (userId: Id): Promise<EntryDetails | undefined> => r.entries.running(userId),
    timeEntry: (userId: Id, id: Id): Promise<EntryDetails> => getTimeEntry(r, userId, id),
    entryBounds: (userId: Id): Promise<EntryBounds> => r.entries.bounds(userId),
    trash: (userId: Id): Promise<EntryDetails[]> => r.entries.listDeleted(userId),
  };
}

/** The account, catalog and entry queries over one snapshot, plus `relatedData`, which spans all three. */
export function createReadQueries(r: ReadQueryRepositories, deploymentSessionDays: number) {
  const accounts = createAccountQueries(r, deploymentSessionDays),
    catalogs = createCatalogQueries(r),
    entries = createEntryQueries(r);
  return {
    ...accounts,
    ...catalogs,
    ...entries,
    async relatedData(user: User): Promise<RelatedData> {
      const memberships = await accounts.memberWorkspaces(user.id);
      const workspaces = memberships.map(({ workspace }) => workspace);
      const each = async <T>(read: (ws: Workspace) => Promise<T[]>) => (await Promise.all(workspaces.map(read))).flat();
      return {
        workspaces: memberships,
        clients: await each(ws => catalogs.workspaceClients(ws)),
        projects: await each(ws => catalogs.workspaceProjects(ws)),
        tags: await each(ws => catalogs.workspaceTags(ws)),
        tasks: await each(ws => catalogs.workspaceTasks(ws)),
        timeEntries: await entries.timeEntries(user.id, { from: recentEntriesStart() }),
      };
    },
  };
}
export type ReadQueries = ReturnType<typeof createReadQueries>;
