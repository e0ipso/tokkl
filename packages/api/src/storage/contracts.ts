import type {
  AccountExportProjection, AccountToken, Client, EntryBounds, EntryDetails, EntryDuplicateKey, Id,
  InstanceSettings, JsonObject, Membership, MembershipRole, PauseChain, PomodoroSession, Project,
  ProjectRef, ProjectSummary, ReportEntryProjection, Session, SettingChange, Tag, Task, TaskRef,
  TaskSummary, TimeEntry, TimerRevision, TimerSnapshot, User, UserRole, UtcInstant, Workspace, WorkspaceMember,
} from './domain.ts';

// Inputs have passed domain validation. Repositories still enforce scoping and database constraints.
export interface NewAccount {
  email: string; fullName: string; passwordHash: string; apiToken: string; timezone: string;
  role: UserRole; preferences: JsonObject;
}
export interface AccountChanges {
  email?: string; fullName?: string; timezone?: string; beginningOfWeek?: number; defaultWorkspaceId?: Id;
}
export interface UsersRepository {
  count(): Promise<number>;
  countActiveAdmins(): Promise<number>;
  get(id: Id): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findByApiToken(token: string): Promise<User | undefined>;
  list(): Promise<User[]>;
  /** Creates the account and its owned default workspace and membership together. */
  createAccount(input: NewAccount): Promise<User>;
  updateAccount(id: Id, changes: AccountChanges): Promise<User>;
  setPreferences(id: Id, preferences: JsonObject): Promise<void>;
  /** Conditional update rechecks the hash seen before asynchronous password verification. */
  changeCredentials(id: Id, expectedPasswordHash: string, passwordHash: string, apiToken: string): Promise<boolean>;
  rotateApiToken(id: Id, apiToken: string): Promise<void>;
  setAccess(id: Id, role: UserRole, disabledAt: UtcInstant | null): Promise<User>;
  delete(id: Id): Promise<void>;
}
export interface WorkspacesRepository {
  get(id: Id): Promise<Workspace | undefined>;
  forMember(userId: Id, workspaceId: Id): Promise<Workspace | undefined>;
  listForUser(userId: Id): Promise<Workspace[]>;
  create(name: string): Promise<Workspace>;
  update(id: Id, changes: Partial<Pick<Workspace, 'name' | 'defaultCurrency' | 'defaultHourlyRate' | 'rounding' | 'roundingMinutes'>>): Promise<Workspace>;
  getRole(userId: Id, workspaceId: Id): Promise<MembershipRole | undefined>;
  addMember(membership: Membership): Promise<void>;
  countMembers(workspaceId: Id): Promise<number>;
  listMembers(workspaceId: Id): Promise<WorkspaceMember[]>;
  deleteSoleMemberWorkspaces(userId: Id): Promise<void>;
}
export interface SettingsRepository {
  /** Missing values remain missing so application settings rules apply deployment defaults. */
  read(): Promise<Partial<InstanceSettings>>;
  write(changes: SettingChange[]): Promise<void>;
}
export interface TokensRepository {
  create(input: Omit<AccountToken, 'id'>): Promise<AccountToken>;
  listPendingInvites(now: UtcInstant): Promise<AccountToken[]>;
  findUsable(tokenHash: string, kind: AccountToken['kind'], now: UtcInstant): Promise<AccountToken | undefined>;
  /** Compare-and-set: false for already used, expired or revoked tokens. */
  consume(id: Id, now: UtcInstant): Promise<boolean>;
  revokeInvite(id: Id): Promise<boolean>;
  revokeInvitesCreatedBy(userId: Id): Promise<void>;
  revokeUnusedPasswordResets(userId: Id): Promise<void>;
}
export interface SessionsRepository {
  create(session: Session): Promise<void>;
  find(tokenHash: string): Promise<Session | undefined>;
  delete(tokenHash: string): Promise<void>;
  deleteForUser(userId: Id, keepTokenHash?: string): Promise<void>;
  deleteExpired(now: UtcInstant): Promise<number>;
}
export interface ClientFilter { status?: 'active' | 'archived' | 'both'; name?: string }
export interface ClientsRepository {
  list(workspaceId: Id, filter?: ClientFilter): Promise<Client[]>;
  get(workspaceId: Id, id: Id): Promise<Client | undefined>;
  findByName(workspaceId: Id, name: string): Promise<Client | undefined>;
  create(input: Pick<Client, 'workspaceId' | 'name' | 'notes' | 'archived'>): Promise<Client>;
  update(workspaceId: Id, id: Id, changes: Partial<Pick<Client, 'name' | 'notes'>>): Promise<Client>;
  /** Updates the client and its projects, returning project IDs whose active flag changed. */
  setArchived(workspaceId: Id, id: Id, archived: boolean): Promise<Id[]>;
  /** Atomically detaches projects, resolving resulting name collisions before removing the client. */
  deleteAndDetachProjects(workspaceId: Id, id: Id): Promise<void>;
}
export interface ProjectFilter { active?: boolean | 'both'; name?: string; clientIds?: Id[]; billable?: boolean; changedSince?: UtcInstant }
export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;
export interface ProjectsRepository {
  list(workspaceId: Id, filter?: ProjectFilter): Promise<ProjectSummary[]>;
  get(workspaceId: Id, id: Id): Promise<ProjectSummary | undefined>;
  /** Indexed lookup; never computes history totals. */
  getRef(workspaceId: Id, id: Id): Promise<ProjectRef | undefined>;
  findByName(workspaceId: Id, clientId: Id | null, name: string): Promise<Project | undefined>;
  create(input: ProjectInput): Promise<ProjectSummary>;
  update(workspaceId: Id, id: Id, changes: Partial<Omit<ProjectInput, 'workspaceId'>>): Promise<ProjectSummary>;
  delete(workspaceId: Id, id: Id, entryMode: 'detach' | 'delete'): Promise<void>;
}
export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
export interface TasksRepository {
  list(workspaceId: Id, filter?: { projectId?: Id; active?: boolean }): Promise<TaskSummary[]>;
  get(workspaceId: Id, id: Id, projectId?: Id): Promise<TaskSummary | undefined>;
  getRef(workspaceId: Id, id: Id): Promise<TaskRef | undefined>;
  findByName(workspaceId: Id, projectId: Id, name: string): Promise<Task | undefined>;
  create(input: TaskInput): Promise<TaskSummary>;
  update(workspaceId: Id, projectId: Id, id: Id, changes: Partial<Pick<Task, 'name' | 'active' | 'estimatedSeconds'>>): Promise<TaskSummary>;
  delete(workspaceId: Id, projectId: Id, id: Id): Promise<void>;
}
export interface TagsRepository {
  list(workspaceId: Id): Promise<Tag[]>;
  get(workspaceId: Id, id: Id): Promise<Tag | undefined>;
  findByName(workspaceId: Id, name: string): Promise<Tag | undefined>;
  resolveNames(workspaceId: Id, names: string[]): Promise<Tag[]>;
  create(workspaceId: Id, name: string): Promise<Tag>;
  rename(workspaceId: Id, id: Id, name: string): Promise<Tag>;
  delete(workspaceId: Id, id: Id): Promise<void>;
}
export interface EntryFilter {
  from?: UtcInstant; to?: UtcInstant; changedSince?: UtcInstant; projectIds?: Array<Id | null>; limit?: number;
}
/** Exact normalized values; application rules snap live writes before invoking persistence. */
export type EntryInput = Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'> & { tagIds: Id[] };
export interface EntriesRepository {
  list(userId: Id, filter?: EntryFilter): Promise<EntryDetails[]>;
  get(userId: Id, id: Id, includeDeleted?: boolean): Promise<EntryDetails | undefined>;
  running(userId: Id): Promise<EntryDetails | undefined>;
  bounds(userId: Id): Promise<EntryBounds>;
  create(input: EntryInput): Promise<EntryDetails>;
  update(userId: Id, workspaceId: Id, id: Id, changes: Partial<Omit<EntryInput, 'userId' | 'workspaceId'>>): Promise<EntryDetails>;
  setTags(userId: Id, entryId: Id, tagIds: Id[]): Promise<void>;
  softDelete(userId: Id, workspaceId: Id, id: Id, at: UtcInstant): Promise<void>;
  restore(userId: Id, id: Id): Promise<EntryDetails>;
  listDeleted(userId: Id): Promise<EntryDetails[]>;
  purgeDeleted(userId: Id, id?: Id): Promise<number>;
  /** Used for timezone reanchoring without fetching every entry's related labels. */
  listAllDay(userId: Id): Promise<TimeEntry[]>;
  findDuplicate(key: EntryDuplicateKey): Promise<Id | undefined>;
}
export interface TimersRepository {
  read(userId: Id): Promise<TimerSnapshot>;
  getSession(userId: Id): Promise<PomodoroSession | undefined>;
  saveSession(session: PomodoroSession): Promise<void>;
  deleteSession(userId: Id): Promise<void>;
  getPauseChain(userId: Id): Promise<PauseChain | undefined>;
  savePauseChain(chain: PauseChain): Promise<void>;
  deletePauseChain(userId: Id): Promise<void>;
  removeTagFromPauseChains(tagId: Id): Promise<void>;
  getRevision(userId: Id): Promise<TimerRevision | undefined>;
  saveRevision(revision: TimerRevision): Promise<void>;
  /** IDs in ascending order for predictable lock acquisition before catalog changes. */
  affectedUsers(workspaceId: Id): Promise<Id[]>;
}
export interface ReportSelection {
  /** UTC half-open start range, derived by application calendar rules. */
  from: UtcInstant; to: UtcInstant;
  projectIds?: Array<Id | null>; clientIds?: Array<Id | null>; taskIds?: Array<Id | null>;
  tagIds?: Array<Id | null>; userIds?: Array<Id | null>;
  excludeProjectIds?: Array<Id | null>; excludeClientIds?: Array<Id | null>; excludeTagIds?: Array<Id | null>;
  timeEntryIds?: Id[]; billable?: boolean; description?: string;
  minDurationSeconds?: number; maxDurationSeconds?: number;
}
export interface ReportsRepository {
  /** Stopped, live entries ordered by start/id, with ordered tags in bounded relational queries. */
  collect(userId: Id, workspaceId: Id, selection: ReportSelection): Promise<ReportEntryProjection[]>;
}
export interface TransfersRepository {
  /** All related projections are collected in one consistent read snapshot. */
  exportAccount(userId: Id): Promise<AccountExportProjection>;
  /** Imports use catalog name lookups and EntriesRepository.findDuplicate within savepoints. */
  hasRunningEntry(userId: Id): Promise<boolean>;
}
export interface Repositories {
  users: UsersRepository; workspaces: WorkspacesRepository; settings: SettingsRepository;
  tokens: TokensRepository; sessions: SessionsRepository; clients: ClientsRepository;
  projects: ProjectsRepository; tasks: TasksRepository; tags: TagsRepository;
  entries: EntriesRepository; timers: TimersRepository; reports: ReportsRepository; transfers: TransfersRepository;
}
/** Declaration only. A concrete context binds every repository to the same operation connection. */
export interface TransactionContext extends Repositories {
  transaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
  savepoint<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
  beforeCommit(key: string, callback: () => Promise<void>): void;
  afterCommit(callback: () => Promise<void>): void;
  lockUserTimer(userId: Id): Promise<void>;
  lockInstanceAdministration(): Promise<void>;
  lockUsers(userIds: Id[]): Promise<void>;
  lockWorkspaces(workspaceIds: Id[]): Promise<void>;
}
export interface Storage extends Repositories {
  transaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
  readSnapshot<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
  health(): Promise<void>;
  close(): Promise<void>;
}
/** Startup owns migration invocation; report readers must never invoke it. */
export interface MigrationLifecycle { migrate(): Promise<void>; verifyCurrent(): Promise<void> }
