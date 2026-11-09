/**
 * Read use cases for the HTTP API. Routes receive these bound to one credential-checked snapshot
 * and never see repositories, so workspace scoping, filtering and ordering live here.
 */
import type {
  ClientFilter,
  ClientsRepository,
  EntriesRepository,
  EntryFilter,
  ProjectFilter,
  ProjectsRepository,
  SettingsRepository,
  TagsRepository,
  TaskSortKey,
  TasksRepository,
  TokensRepository,
  TransfersRepository,
  UsersRepository,
  WorkspacesRepository,
} from './ports.ts';
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
} from './model.ts';
import { memberWorkspace, ownedWorkspace } from './membership.ts';
import { getInstanceSettings } from './instanceSettings.ts';
import { getClient, getProject, getTask } from './catalogs.ts';
import { getTimeEntry } from './entryAccess.ts';
import { offsetRange, pageRange, slicePage, type PageWindow, type RowRange } from '../lib/pagination.ts';

/** Reads about accounts, the instance and workspace membership. No repository here can write. */
export interface AccountReadRepositories {
  users: Pick<UsersRepository, 'list'>;
  workspaces: Pick<WorkspacesRepository, 'forMember' | 'listForUser' | 'getRole' | 'countMembers' | 'listMembers'>;
  settings: SettingsRepository;
  tokens: Pick<TokensRepository, 'listPendingInvites'>;
  transfers: TransfersRepository;
}
/** Reads of the clients, projects, tasks and tags in the workspaces a user belongs to. */
export interface CatalogReadRepositories {
  workspaces: Pick<WorkspacesRepository, 'listForUser' | 'catalogRevision'>;
  clients: Pick<ClientsRepository, 'list' | 'get'>;
  projects: Pick<ProjectsRepository, 'list' | 'get'>;
  tasks: Pick<TasksRepository, 'list' | 'get' | 'listSortKeys' | 'count' | 'listByCreation' | 'listForMember'>;
  tags: Pick<TagsRepository, 'list'>;
}
/** Reads of one user's time entries. */
export interface EntryReadRepositories {
  entries: Pick<EntriesRepository, 'list' | 'get' | 'running' | 'bounds' | 'listDeleted' | 'countDeleted'>;
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
/** One page of a task search and how many tasks match it in all. */
export interface TaskSearchPage {
  tasks: TaskSummary[];
  totalCount: number;
}

export interface MemberTaskFilter {
  includeInactive: boolean;
  changedSince?: string;
}
const memberTaskFilter = (filter: MemberTaskFilter) => ({
  active: filter.includeInactive ? undefined : true,
  changedSince: filter.changedSince,
});

/** Toggl's default window for time entry lists that name no range. */
const DEFAULT_LIST_DAYS = 9;
export const recentEntriesStart = (now = Date.now()) => new Date(now - DEFAULT_LIST_DAYS * 86400000).toISOString();

const changedAfter = <T extends { updatedAt: string }>(rows: T[], since: string | undefined): T[] =>
  since === undefined ? rows : rows.filter(row => row.updatedAt >= since);

function compareTasks(field: TaskSortField, order: SortOrder) {
  const direction = order === 'ASC' ? 1 : -1;
  return (a: TaskSortKey, b: TaskSortKey) =>
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
    /** 403 unless the user owns the workspace. */
    ownedWorkspace: (userId: Id, workspaceId: Id): Promise<Workspace> => ownedWorkspace(r, userId, workspaceId),
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
    workspaceMembers: async (userId: Id, workspaceId: Id): Promise<WorkspaceMember[]> =>
      r.workspaces.listMembers((await memberWorkspace(r, userId, workspaceId)).id),
    accounts: (): Promise<User[]> => r.users.list(),
    pendingInvites: (): Promise<AccountToken[]> => r.tokens.listPendingInvites(new Date().toISOString()),
  };
}

export function createCatalogQueries(r: CatalogReadRepositories) {
  const projectsOf = async (ws: Workspace, filter?: ProjectFilter, range?: RowRange): Promise<WorkspaceProject[]> =>
    (await r.projects.list(ws.id, filter, range)).map(project => ({ project, defaultCurrency: ws.defaultCurrency }));
  return {
    memberProjects: (userId: Id, filter: { includeArchived: boolean; changedSince?: string }) =>
      acrossWorkspaces(r, userId, ws =>
        projectsOf(ws, { active: filter.includeArchived ? 'both' : true, changedSince: filter.changedSince }),
      ),
    memberClients: (userId: Id, changedSince?: string) =>
      acrossWorkspaces(r, userId, async ws => changedAfter(await r.clients.list(ws.id), changedSince)),
    memberTags: (userId: Id, changedSince?: string) =>
      acrossWorkspaces(r, userId, async ws => changedAfter(await r.tags.list(ws.id), changedSince)),
    memberTasks: (userId: Id, filter: MemberTaskFilter): Promise<TaskSummary[]> =>
      r.tasks.listForMember(userId, memberTaskFilter(filter)),
    /** `limit` of `memberTasks` from the 0-based `offset`, or all from it, read as those rows only. */
    async memberTasksFrom(userId: Id, filter: MemberTaskFilter, offset: number, limit?: number) {
      const range = offsetRange(offset, limit);
      return range ? r.tasks.listForMember(userId, memberTaskFilter(filter), range) : [];
    },
    workspaceProjects: (ws: Workspace, filter?: ProjectFilter) => projectsOf(ws, filter),
    /** Changes whenever the workspace's v9 project list may answer differently, totals and `status` aside. */
    catalogRevision: (ws: Workspace): Promise<number> => r.workspaces.catalogRevision(ws.id),
    /** One page of `workspaceProjects`, read from the database as that page only. */
    async workspaceProjectsPage(ws: Workspace, filter: ProjectFilter, window: PageWindow): Promise<WorkspaceProject[]> {
      const range = pageRange(window);
      return range ? projectsOf(ws, filter, range) : [];
    },
    workspaceProject: (ws: Workspace, id: Id): Promise<ProjectSummary> => getProject(r, ws.id, id),
    /**
     * One page of the workspace's tasks. SQL applies the project, state and `since` filters. With
     * no search, a creation-time order is SQL's too, with its count and page. The name order folds
     * case and compares as `localeCompare` does, which no engine repeats, and the search folds case
     * as JavaScript does, so both run in memory: on the ids, names and creation instants of the
     * matching tasks only, and only the page's tasks are read in full.
     */
    async searchTasks(ws: Workspace, search: TaskSearch, window: PageWindow): Promise<TaskSearchPage> {
      const filter = { projectId: search.projectId, active: search.active, changedSince: search.changedSince };
      const needle = search.search?.toLowerCase();
      if (!needle && search.sortField === 'created_at') {
        const range = pageRange(window);
        return {
          tasks: range ? await r.tasks.listByCreation(ws.id, filter, search.sortOrder, range) : [],
          totalCount: await r.tasks.count(ws.id, filter),
        };
      }
      let keys = await r.tasks.listSortKeys(ws.id, needle ? { ...filter, nameCandidates: needle } : filter);
      if (needle) keys = keys.filter(task => task.name.toLowerCase().includes(needle));
      const page = slicePage(keys.sort(compareTasks(search.sortField, search.sortOrder)), window);
      const read = page.length ? await r.tasks.list(ws.id, { ids: page.map(task => task.id) }) : [];
      const byId = new Map(read.map(task => [task.id, task]));
      return { tasks: page.flatMap(({ id }) => byId.get(id) ?? []), totalCount: keys.length };
    },
    async projectTasks(ws: Workspace, projectId: Id, onlyActive: boolean): Promise<TaskSummary[]> {
      await getProject(r, ws.id, projectId);
      return r.tasks.list(ws.id, { projectId, active: onlyActive ? true : undefined });
    },
    projectTask: (ws: Workspace, projectId: Id, id: Id): Promise<TaskSummary> => getTask(r, ws.id, id, projectId),
    workspaceClients: (ws: Workspace, filter?: ClientFilter): Promise<Client[]> => r.clients.list(ws.id, filter),
    workspaceClient: (ws: Workspace, id: Id): Promise<Client> => getClient(r, ws.id, id),
    workspaceTags: (ws: Workspace, search?: string): Promise<Tag[]> => r.tags.list(ws.id, search),
    /** One page of `workspaceTags`, read from the database as that page only. */
    async workspaceTagsPage(ws: Workspace, search: string | undefined, window: PageWindow): Promise<Tag[]> {
      const range = pageRange(window);
      return range ? r.tags.list(ws.id, search, range) : [];
    },
    /** Every task in the workspace, active or not. */
    workspaceTasks: (ws: Workspace): Promise<TaskSummary[]> => r.tasks.list(ws.id),
  };
}

export function createEntryQueries(r: EntryReadRepositories) {
  return {
    timeEntries: (userId: Id, filter: EntryFilter): Promise<EntryDetails[]> => r.entries.list(userId, filter),
    runningEntry: (userId: Id): Promise<EntryDetails | undefined> => r.entries.running(userId),
    /**
     * The user's newest live entry by start, running or stopped, in any workspace: the first entry
     * `/me/time_entries` lists. Read with LIMIT 1 on the user and start index.
     */
    latestEntry: async (userId: Id): Promise<EntryDetails | undefined> =>
      (await r.entries.list(userId, { limit: 1 }))[0],
    timeEntry: (userId: Id, id: Id): Promise<EntryDetails> => getTimeEntry(r, userId, id),
    entryBounds: (userId: Id): Promise<EntryBounds> => r.entries.bounds(userId),
    trash: (userId: Id): Promise<EntryDetails[]> => r.entries.listDeleted(userId),
    trashTotal: (userId: Id): Promise<number> => r.entries.countDeleted(userId),
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
