import type {
  AccountExportProjection,
  AccountToken,
  Client,
  EntryBounds,
  EntryDetails,
  EntryDuplicateKey,
  Id,
  InstanceSettings,
  JsonObject,
  Membership,
  MembershipRole,
  PauseChain,
  PomodoroSession,
  Project,
  ProjectRef,
  ProjectSummary,
  ReportEntryProjection,
  Session,
  SettingChange,
  Tag,
  Task,
  TaskRef,
  TaskSummary,
  TimeEntry,
  TimerRevision,
  TimerSnapshot,
  User,
  UserRole,
  UtcInstant,
  Workspace,
  WorkspaceMember,
} from './model.ts';
import type { RowRange } from '../lib/pagination.ts';

/** The most trashed entries one trash read returns, so the read stays bounded. */
export const TRASH_READ_LIMIT = 1000;

type StorageConflictKind = 'unique' | 'foreign-key' | 'serialization' | 'deadlock' | 'busy';
/**
 * What a repository throws when the database refuses a write for a conflict, which the domain maps
 * to its own errors. No SQL, constraint names or driver cause.
 */
export class StorageConflict extends Error {
  readonly kind: StorageConflictKind;
  constructor(kind: StorageConflictKind) {
    super(`Storage conflict (${kind})`);
    this.name = 'StorageConflict';
    this.kind = kind;
  }
}

// Inputs have passed domain validation. Repositories still enforce scoping and database constraints.
export interface NewAccount {
  email: string;
  fullName: string;
  passwordHash: string;
  apiToken: string;
  timezone: string;
  role: UserRole;
  preferences: JsonObject;
}
export interface AccountChanges {
  email?: string;
  fullName?: string;
  timezone?: string;
  beginningOfWeek?: number;
  defaultWorkspaceId?: Id;
}
/** Revision 0 stands for a user without stored timer state. */
interface UserTimerRevision {
  user: User;
  timerRevision: number;
}
export interface UsersRepository {
  count(): Promise<number>;
  countActiveAdmins(): Promise<number>;
  get(id: Id): Promise<User | undefined>;
  /** One statement: the same user as get, with the user's current timer revision. */
  getWithTimerRevision(id: Id): Promise<UserTimerRevision | undefined>;
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
  getRole(userId: Id, workspaceId: Id): Promise<MembershipRole | undefined>;
  countMembers(workspaceId: Id): Promise<number>;
  listMembers(workspaceId: Id): Promise<WorkspaceMember[]>;
  /**
   * How many writes have changed the workspace's v9 project list: a project or client write, or a
   * new default currency. 0 for a missing workspace.
   */
  catalogRevision(workspaceId: Id): Promise<number>;
  create(name: string): Promise<Workspace>;
  update(
    id: Id,
    changes: Partial<
      Pick<Workspace, 'name' | 'defaultCurrency' | 'defaultHourlyRate' | 'rounding' | 'roundingMinutes'>
    >,
  ): Promise<Workspace>;
  addMember(membership: Membership): Promise<void>;
  deleteSoleMemberWorkspaces(userId: Id): Promise<void>;
}
export interface SettingsRepository {
  /** Missing values remain missing so application settings rules apply deployment defaults. */
  read(): Promise<Partial<InstanceSettings>>;
  write(changes: SettingChange[]): Promise<void>;
}
export interface TokensRepository {
  listPendingInvites(now: UtcInstant): Promise<AccountToken[]>;
  findUsable(tokenHash: string, kind: AccountToken['kind'], now: UtcInstant): Promise<AccountToken | undefined>;
  create(input: Omit<AccountToken, 'id'>): Promise<AccountToken>;
  /** Compare-and-set: false for already used, expired or revoked tokens. */
  consume(id: Id, now: UtcInstant, userId?: Id): Promise<boolean>;
  revokeInvite(id: Id): Promise<boolean>;
  revokeInvitesCreatedBy(userId: Id): Promise<void>;
  revokeUnusedPasswordResets(userId: Id): Promise<void>;
  /**
   * Deletes up to a batch of used or expired links, which nothing reads again, skipping rows other
   * writes hold, and returns how many it deleted.
   */
  deleteSpent(now: UtcInstant): Promise<number>;
}
export interface SessionsRepository {
  find(tokenHash: string): Promise<Session | undefined>;
  create(session: Session): Promise<void>;
  delete(tokenHash: string): Promise<void>;
  deleteForUser(userId: Id, keepTokenHash?: string): Promise<void>;
  /**
   * Deletes up to a batch of sessions that expired before `now`, skipping rows other writes hold,
   * and returns how many it deleted. An expired session that is still stored never signs in.
   */
  deleteExpired(now: UtcInstant): Promise<number>;
}
/** A hashed limiter key and the failures it allows per window. */
export interface RateLimitCounter {
  keyHash: string;
  limit: number;
}
export type RateLimitCounterKey = Pick<RateLimitCounter, 'keyHash'>;
export type RateLimitReservation =
  | { ok: true; reservations: string[] }
  /** Reset times of the counters at their failure limit. */
  | { ok: false; reason: 'blocked'; resetAts: UtcInstant[] }
  /** No counter is at its limit, but live reservations fill at least one. */
  | { ok: false; reason: 'slots' };
/**
 * Callers supply `now`. A counter whose window has ended has no failures, and an expired
 * reservation holds no slot, so stale rows never change an answer. `deleteExpired` removes them.
 */
export interface RateLimitsRepository {
  /**
   * All or none: one reservation per counter, or none when any counter is blocked or full. A refusal
   * keeps no counter row it would have created.
   */
  reserve(
    counters: readonly RateLimitCounter[],
    now: UtcInstant,
    windowMs: number,
    leaseMs: number,
  ): Promise<RateLimitReservation>;
  /** Deletes the reservations. A failed check adds one failure to every counter. */
  release(
    reservations: readonly string[],
    counters: readonly RateLimitCounterKey[],
    failed: boolean,
    now: UtcInstant,
    windowMs: number,
  ): Promise<void>;
  /** Clears failures. Live reservations keep their slots. */
  reset(keyHashes: readonly string[], now: UtcInstant): Promise<void>;
  /**
   * Deletes up to a batch of expired reservations, and of expired counters that no live reservation
   * holds, skipping rows other writes hold. Returns how many rows it deleted.
   */
  deleteExpired(now: UtcInstant): Promise<number>;
}
/** What a password check uses; cleanup is the maintenance job's. */
export type RateLimitChecks = Pick<RateLimitsRepository, 'reserve' | 'release' | 'reset'>;
export interface ClientFilter {
  status?: 'active' | 'archived' | 'both';
  name?: string;
}
export interface ClientsRepository {
  list(workspaceId: Id, filter?: ClientFilter): Promise<Client[]>;
  get(workspaceId: Id, id: Id): Promise<Client | undefined>;
  findByName(workspaceId: Id, name: string): Promise<Client | undefined>;
  create(input: Pick<Client, 'workspaceId' | 'name' | 'notes' | 'archived'>): Promise<Client>;
  update(workspaceId: Id, id: Id, changes: Partial<Pick<Client, 'name' | 'notes' | 'archived'>>): Promise<Client>;
  /** Caller validates project ownership before invoking this selective restore. */
  restore(workspaceId: Id, id: Id, projectIds: Id[], all: boolean): Promise<Client>;
  /** Updates the client and its projects, returning project IDs whose active flag changed. */
  setArchived(workspaceId: Id, id: Id, archived: boolean): Promise<Id[]>;
  /** Atomically detaches projects, resolving resulting name collisions before removing the client. */
  deleteAndDetachProjects(workspaceId: Id, id: Id): Promise<void>;
}
export interface ProjectFilter {
  active?: boolean | 'both';
  name?: string;
  clientIds?: Id[];
  billable?: boolean;
  changedSince?: UtcInstant;
}
export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;
export interface ProjectsRepository {
  count(workspaceId: Id): Promise<number>;
  getMetadata(workspaceId: Id, id: Id): Promise<Project | undefined>;
  listForClient(workspaceId: Id, clientId: Id): Promise<Array<Pick<Project, 'id' | 'name'>>>;
  /** Ordered by folded name, then id. A `range` keeps only those rows of that order. */
  list(workspaceId: Id, filter?: ProjectFilter, range?: RowRange): Promise<ProjectSummary[]>;
  get(workspaceId: Id, id: Id): Promise<ProjectSummary | undefined>;
  /** Indexed lookup; never computes history totals. */
  getRef(workspaceId: Id, id: Id): Promise<ProjectRef | undefined>;
  findByName(workspaceId: Id, clientId: Id | null, name: string): Promise<Project | undefined>;
  create(input: ProjectInput): Promise<ProjectSummary>;
  update(workspaceId: Id, id: Id, changes: Partial<Omit<ProjectInput, 'workspaceId'>>): Promise<ProjectSummary>;
  delete(workspaceId: Id, id: Id, entryMode: 'detach' | 'delete'): Promise<void>;
}
export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
/** What the workspace task search sorts and pages by in memory: id, name and creation instant. */
export type TaskSortKey = Pick<Task, 'id' | 'name' | 'createdAt'>;
/** The workspace task search's filters that SQL applies exactly. */
export interface TaskSearchFilter {
  projectId?: Id;
  active?: boolean;
  /** Keeps tasks updated at or after this instant. */
  changedSince?: UtcInstant;
}
export interface TasksRepository {
  getMetadata(workspaceId: Id, id: Id): Promise<Task | undefined>;
  /** Ordered by folded name, then id. `ids` keeps only those tasks. */
  list(
    workspaceId: Id,
    filter?: { projectId?: Id; active?: boolean; name?: string; ids?: readonly Id[] },
  ): Promise<TaskSummary[]>;
  /**
   * The sort keys of the tasks `filter` keeps, in id order. With `nameCandidates`, a lower-cased
   * search, it also drops every task whose JavaScript-lower-cased name cannot contain it: an ASCII
   * name is kept only when it does, and a name with other characters is always kept, for the caller
   * to test.
   */
  listSortKeys(workspaceId: Id, filter: TaskSearchFilter & { nameCandidates?: string }): Promise<TaskSortKey[]>;
  /** How many tasks `filter` keeps. */
  count(workspaceId: Id, filter: TaskSearchFilter): Promise<number>;
  /**
   * The `range` rows of the tasks `filter` keeps, ordered by creation instant, then id, both
   * ascending or both descending.
   */
  listByCreation(
    workspaceId: Id,
    filter: TaskSearchFilter,
    order: 'ASC' | 'DESC',
    range: RowRange,
  ): Promise<TaskSummary[]>;
  /**
   * The tasks of every workspace the user belongs to, ordered by workspace id, folded name, then
   * id. A `range` keeps only those rows of that order.
   */
  listForMember(
    userId: Id,
    filter: { active?: boolean; changedSince?: UtcInstant },
    range?: RowRange,
  ): Promise<TaskSummary[]>;
  get(workspaceId: Id, id: Id, projectId?: Id): Promise<TaskSummary | undefined>;
  getRef(workspaceId: Id, id: Id): Promise<TaskRef | undefined>;
  findByName(workspaceId: Id, projectId: Id, name: string): Promise<Task | undefined>;
  create(input: TaskInput): Promise<TaskSummary>;
  update(
    workspaceId: Id,
    projectId: Id,
    id: Id,
    changes: Partial<Pick<Task, 'name' | 'active' | 'estimatedSeconds'>>,
  ): Promise<TaskSummary>;
  delete(workspaceId: Id, projectId: Id, id: Id): Promise<void>;
}
export interface TagsRepository {
  /** Ordered by folded name, then id. A `range` keeps only those rows of that order. */
  list(workspaceId: Id, search?: string, range?: RowRange): Promise<Tag[]>;
  findByIds(workspaceId: Id, ids: readonly Id[]): Promise<Tag[]>;
  get(workspaceId: Id, id: Id): Promise<Tag | undefined>;
  findByName(workspaceId: Id, name: string): Promise<Tag | undefined>;
  resolveNames(workspaceId: Id, names: string[]): Promise<Tag[]>;
  create(workspaceId: Id, name: string): Promise<Tag>;
  rename(workspaceId: Id, id: Id, name: string): Promise<Tag>;
  delete(workspaceId: Id, id: Id): Promise<void>;
}
export interface EntryFilter {
  from?: UtcInstant;
  to?: UtcInstant;
  changedSince?: UtcInstant;
  projectIds?: Array<Id | null>;
  limit?: number;
}
/** Exact normalized values; application rules snap live writes before invoking persistence. */
export type EntryInput = Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'> & { tagIds: Id[] };
export interface EntriesRepository {
  list(userId: Id, filter?: EntryFilter): Promise<EntryDetails[]>;
  get(userId: Id, id: Id, includeDeleted?: boolean): Promise<EntryDetails | undefined>;
  running(userId: Id): Promise<EntryDetails | undefined>;
  bounds(userId: Id): Promise<EntryBounds>;
  /** The user's newest `TRASH_READ_LIMIT` trashed entries, newest deletion first. */
  listDeleted(userId: Id): Promise<EntryDetails[]>;
  /** How many trashed entries the user has, those `listDeleted` leaves out included. */
  countDeleted(userId: Id): Promise<number>;
  /** Used for timezone reanchoring without fetching every entry's related labels. */
  listAllDay(userId: Id): Promise<TimeEntry[]>;
  findDuplicate(key: EntryDuplicateKey): Promise<Id | undefined>;
  create(input: EntryInput): Promise<EntryDetails>;
  /** Same integrity checks as create, without reloading labels discarded by import callers. */
  insert(input: EntryInput): Promise<Id>;
  update(
    userId: Id,
    workspaceId: Id,
    id: Id,
    changes: Partial<Omit<EntryInput, 'userId' | 'workspaceId'>>,
  ): Promise<EntryDetails>;
  softDelete(userId: Id, workspaceId: Id, id: Id, at: UtcInstant): Promise<void>;
  restore(userId: Id, id: Id): Promise<EntryDetails>;
  /** Every workspace holding at least one of the user's trashed entries, however many there are. */
  trashedWorkspaceIds(userId: Id): Promise<Id[]>;
  /** Deletes the user's trashed entries in `workspaceIds`, or only `id` among them. */
  purgeDeleted(userId: Id, scope: { workspaceIds: Id[]; id?: Id }): Promise<number>;
}
/** A create a client named with an idempotency key. */
interface IdempotencyRecord {
  /** Hash of the user and the client's key. */
  keyHash: string;
  userId: Id;
  /** Digest of the request the key first came with. */
  fingerprint: string;
  /** The id of the record the create made. */
  resultId: Id;
  createdAt: UtcInstant;
}
export interface IdempotencyKeysRepository {
  find(keyHash: string): Promise<IdempotencyRecord | undefined>;
  /**
   * Records a create. When another transaction recorded the same key first, it fails as a
   * serialization conflict, so the runner runs the whole operation again and it finds that record.
   */
  insert(record: IdempotencyRecord): Promise<void>;
  delete(keyHash: string): Promise<void>;
  /**
   * Deletes up to a batch of records created before `before`, skipping rows other writes hold, and
   * returns how many it deleted.
   */
  deleteExpired(before: UtcInstant): Promise<number>;
}
export interface TimersRepository {
  read(userId: Id): Promise<TimerSnapshot>;
  getSession(userId: Id): Promise<PomodoroSession | undefined>;
  getPauseChain(userId: Id): Promise<PauseChain | undefined>;
  getRevision(userId: Id): Promise<TimerRevision | undefined>;
  /** IDs in ascending order for predictable lock acquisition before catalog changes. */
  affectedUsers(workspaceId: Id): Promise<Id[]>;
  saveSession(session: PomodoroSession): Promise<void>;
  deleteSession(userId: Id): Promise<void>;
  savePauseChain(chain: PauseChain): Promise<void>;
  deletePauseChain(userId: Id): Promise<void>;
  removeTagFromPauseChains(tagId: Id): Promise<void>;
  saveRevision(revision: TimerRevision): Promise<void>;
}
export interface ReportSelection {
  /** UTC half-open start range, derived by application calendar rules. */
  from: UtcInstant;
  to: UtcInstant;
  projectIds?: Array<Id | null>;
  clientIds?: Array<Id | null>;
  taskIds?: Array<Id | null>;
  tagIds?: Array<Id | null>;
  userIds?: Array<Id | null>;
  excludeProjectIds?: Array<Id | null>;
  excludeClientIds?: Array<Id | null>;
  excludeTagIds?: Array<Id | null>;
  timeEntryIds?: Id[];
  billable?: boolean;
  description?: string;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
}
/**
 * An order the database applies to selected report entries. Ties go to the entry id, in the same
 * direction. `duration` sorts on the whole elapsed seconds after `rounding`, as reports show them.
 */
export interface ReportOrder {
  by: 'start' | 'updated' | 'duration';
  direction: 'ASC' | 'DESC';
  /** -1 down, 0 nearest, 1 up, to a step of `minutes`; no rounding when `minutes` is 0 or less. */
  rounding: { mode: number; minutes: number };
}
/** Rows skipped from the front of an ordered selection, and how many follow. */
export interface ReportWindow {
  offset: number;
  limit: number;
}
/** Where a start/id batch read resumes: just after this entry. */
export interface ReportCursor {
  start: UtcInstant;
  id: Id;
}
interface ReportCounts {
  entries: number;
  billable: number;
  /** Billable entries whose project has its own hourly rate. */
  billableWithProjectRate: number;
}
/**
 * Stopped, live entries of one user in one workspace that match a selection. Every read is bounded
 * by its ids, window or batch size, so no call loads the whole selection's projections.
 */
interface ReportsRepository {
  count(userId: Id, workspaceId: Id, selection: ReportSelection): Promise<ReportCounts>;
  /** The selected ids in `order`; all of them without a window. */
  ids(
    userId: Id,
    workspaceId: Id,
    selection: ReportSelection,
    order: ReportOrder,
    window?: ReportWindow,
  ): Promise<Id[]>;
  /** Every selected id with its description, unordered, for orders the database cannot collate. */
  descriptions(
    userId: Id,
    workspaceId: Id,
    selection: ReportSelection,
  ): Promise<Array<{ id: Id; description: string }>>;
  /** The selected entries among `ids` with their ordered tags, in the order of `ids`. */
  entries(
    userId: Id,
    workspaceId: Id,
    selection: ReportSelection,
    ids: readonly Id[],
  ): Promise<ReportEntryProjection[]>;
  /** Up to `limit` selected entries after `after` in start/id order, with their ordered tags. */
  batch(
    userId: Id,
    workspaceId: Id,
    selection: ReportSelection,
    after: ReportCursor | undefined,
    limit: number,
  ): Promise<ReportEntryProjection[]>;
}
/** An account export's entry order: newest first (start, then id, descending) or oldest first. */
type ExportEntryOrder = 'newest' | 'oldest';
export interface TransfersRepository {
  /** All related projections are collected in one consistent read snapshot. */
  exportAccount(userId: Id): Promise<AccountExportProjection>;
  /** The export without its entries, as `exportAccount` reads it. */
  exportHead(userId: Id): Promise<Omit<AccountExportProjection, 'entries'>>;
  /**
   * Up to `limit` of the entries `exportAccount` lists, the next ones after `after` in `order`. The
   * pages of one snapshot concatenate into its list, or into the list reversed for `oldest`.
   */
  exportEntries(
    userId: Id,
    order: ExportEntryOrder,
    after: ReportCursor | undefined,
    limit: number,
  ): Promise<EntryDetails[]>;
}
export interface Repositories {
  users: UsersRepository;
  workspaces: WorkspacesRepository;
  settings: SettingsRepository;
  tokens: TokensRepository;
  sessions: SessionsRepository;
  rateLimits: RateLimitsRepository;
  clients: ClientsRepository;
  projects: ProjectsRepository;
  tasks: TasksRepository;
  tags: TagsRepository;
  entries: EntriesRepository;
  idempotencyKeys: IdempotencyKeysRepository;
  timers: TimersRepository;
  reports: ReportsRepository;
  transfers: TransfersRepository;
}
/**
 * SQL-free operations of one open write transaction. A scope cannot open another transaction: code
 * that receives an `OperationContext` runs inside its caller's, and only a runner (`Storage` and the
 * domain's `*Runner` interfaces) opens one.
 */
export interface TransactionScope<R extends object> {
  savepoint<T>(work: (context: OperationContext<R>) => Promise<T>): Promise<T>;
  beforeCommit(key: string, callback: () => Promise<void>): void;
  /**
   * Runs `read` once every before-commit hook has run, just before COMMIT, so an operation can build
   * its answer from the state the transaction commits. `read` may only read: a hook it registers
   * fails the transaction.
   */
  readAtCommit(read: () => Promise<void>): void;
  afterCommit(callback: () => Promise<void>): void;
  lockUserTimer(userId: Id): Promise<void>;
  lockInstanceAdministration(): Promise<void>;
  /** Acquire instance, then ascending workspaces, then ascending users, across all calls. */
  lockUsers(userIds: Id[]): Promise<void>;
  lockWorkspaces(workspaceIds: Id[]): Promise<void>;
}
export type OperationContext<R extends object> = R & TransactionScope<R>;
export type TransactionContext = OperationContext<Repositories>;
/**
 * The application's database. Every repository call runs inside an explicit unit of work: a write
 * transaction, which takes the guards in the documented order, or a read-only snapshot.
 */
export interface Storage {
  transaction<T>(work: (context: TransactionContext) => Promise<T>, options?: { dryRun?: boolean }): Promise<T>;
  readSnapshot<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
  health(): Promise<void>;
  close(): Promise<void>;
}

/** A hint that a user's committed timer revision changed. It never carries state. */
export type TimerSignal = { userId: number; revision: number };
/** Carries timer signals between API processes. A receiver rebuilds state from its own database read. */
export interface TimerBus {
  send(signal: TimerSignal): void;
  /** Registers the single receiver. */
  receive(handler: (signal: TimerSignal) => void): void;
  close(): Promise<void>;
}

/**
 * The current time, for operations that act "now". The composition root passes `systemClock`
 * (`lib/clock.ts`); a fixed clock makes those operations repeatable.
 */
export interface Clock {
  now(): Date;
}
