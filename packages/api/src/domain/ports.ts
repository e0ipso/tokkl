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

export const TRASH_READ_LIMIT = 1000;

type StorageConflictKind = 'unique' | 'foreign-key' | 'serialization' | 'deadlock' | 'busy';
/** Thrown for a write conflict, which the domain maps. Carries no SQL, constraint names or driver cause. */
export class StorageConflict extends Error {
  readonly kind: StorageConflictKind;
  constructor(kind: StorageConflictKind) {
    super(`Storage conflict (${kind})`);
    this.name = 'StorageConflict';
    this.kind = kind;
  }
}

// Inputs have passed domain validation; repositories still enforce scoping and constraints.
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
/** Revision 0: the user has no stored timer state. */
interface UserTimerRevision {
  user: User;
  timerRevision: number;
}
export interface UsersRepository {
  count(): Promise<number>;
  countActiveAdmins(): Promise<number>;
  get(id: Id): Promise<User | undefined>;
  /** One statement. */
  getWithTimerRevision(id: Id): Promise<UserTimerRevision | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findByApiToken(token: string): Promise<User | undefined>;
  list(): Promise<User[]>;
  /** Together with its owned default workspace and membership. */
  createAccount(input: NewAccount): Promise<User>;
  updateAccount(id: Id, changes: AccountChanges): Promise<User>;
  setPreferences(id: Id, preferences: JsonObject): Promise<void>;
  /** Compare-and-set on `expectedPasswordHash`, read before the async password verification. */
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
  /** Counts project, client and default-currency writes; 0 for a missing workspace. */
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
  /** Missing values stay missing so deployment defaults apply. */
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
  /** The key uses normalizeEmail; used links and non-invite tokens are kept. */
  revokeUnusedSignupInvites(emailKey: string): Promise<void>;
  revokeInvitesCreatedBy(userId: Id): Promise<void>;
  revokeUnusedPasswordResets(userId: Id): Promise<void>;
  /** Deletes up to a batch of used or expired links, skipping rows other writes hold; returns the count. */
  deleteSpent(now: UtcInstant): Promise<number>;
}
export interface SessionsRepository {
  find(tokenHash: string): Promise<Session | undefined>;
  create(session: Session): Promise<void>;
  delete(tokenHash: string): Promise<void>;
  deleteForUser(userId: Id, keepTokenHash?: string): Promise<void>;
  /** Deletes up to a batch of expired sessions, skipping rows other writes hold; returns the count. */
  deleteExpired(now: UtcInstant): Promise<number>;
}
export interface RateLimitCounter {
  keyHash: string;
  limit: number;
}
export type RateLimitCounterKey = Pick<RateLimitCounter, 'keyHash'>;
export type RateLimitReservation =
  | { ok: true; reservations: string[] }
  | { ok: false; reason: 'blocked'; resetAts: UtcInstant[] }
  /** No counter is at its limit, but live reservations fill one. */
  | { ok: false; reason: 'slots' };
/** Callers supply `now`. Ended windows and expired reservations never change an answer. */
export interface RateLimitsRepository {
  /** All or none: a refusal reserves nothing and keeps no counter row it would have created. */
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
  /** Deletes up to a batch of expired reservations and unheld expired counters, skipping locked rows. */
  deleteExpired(now: UtcInstant): Promise<number>;
}
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
  /** The caller checks project ownership. */
  restore(workspaceId: Id, id: Id, projectIds: Id[], all: boolean): Promise<Client>;
  /** Returns the project ids whose active flag changed. */
  setArchived(workspaceId: Id, id: Id, archived: boolean): Promise<Id[]>;
  /** Detaches the projects, resolving name collisions, and removes the client, atomically. */
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
  /** Never computes history totals. */
  getRef(workspaceId: Id, id: Id): Promise<ProjectRef | undefined>;
  findByName(workspaceId: Id, clientId: Id | null, name: string): Promise<Project | undefined>;
  create(input: ProjectInput): Promise<ProjectSummary>;
  update(workspaceId: Id, id: Id, changes: Partial<Omit<ProjectInput, 'workspaceId'>>): Promise<ProjectSummary>;
  delete(workspaceId: Id, id: Id, entryMode: 'detach' | 'delete'): Promise<void>;
}
export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
export type TaskSortKey = Pick<Task, 'id' | 'name' | 'createdAt'>;
/** The workspace task search's filters that SQL applies exactly. */
export interface TaskSearchFilter {
  projectId?: Id;
  active?: boolean;
  changedSince?: UtcInstant;
}
export interface TasksRepository {
  getMetadata(workspaceId: Id, id: Id): Promise<Task | undefined>;
  /** Ordered by folded name, then id. `ids` keeps only those tasks. */
  list(
    workspaceId: Id,
    filter?: { projectId?: Id; active?: boolean; name?: string; ids?: readonly Id[] },
  ): Promise<TaskSummary[]>;
  /** In id order. `nameCandidates` drops ASCII names that cannot contain it; others are kept for the caller. */
  listSortKeys(workspaceId: Id, filter: TaskSearchFilter & { nameCandidates?: string }): Promise<TaskSortKey[]>;
  count(workspaceId: Id, filter: TaskSearchFilter): Promise<number>;
  /** Ordered by creation instant, then id, both in the same direction. */
  listByCreation(
    workspaceId: Id,
    filter: TaskSearchFilter,
    order: 'ASC' | 'DESC',
    range: RowRange,
  ): Promise<TaskSummary[]>;
  /** Ordered by workspace id, folded name, then id. */
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
/** Already normalized and snapped by the application. */
export type EntryInput = Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'> & { tagIds: Id[] };
export interface EntriesRepository {
  list(userId: Id, filter?: EntryFilter): Promise<EntryDetails[]>;
  get(userId: Id, id: Id, includeDeleted?: boolean): Promise<EntryDetails | undefined>;
  running(userId: Id): Promise<EntryDetails | undefined>;
  bounds(userId: Id): Promise<EntryBounds>;
  /** Newest deletion first, at most `TRASH_READ_LIMIT`. */
  listDeleted(userId: Id): Promise<EntryDetails[]>;
  /** Includes those `listDeleted` leaves out. */
  countDeleted(userId: Id): Promise<number>;
  /** For timezone reanchoring; skips the related labels. */
  listAllDay(userId: Id): Promise<TimeEntry[]>;
  findDuplicate(key: EntryDuplicateKey): Promise<Id | undefined>;
  create(input: EntryInput): Promise<EntryDetails>;
  /** Same integrity checks as create, without reloading labels. */
  insert(input: EntryInput): Promise<Id>;
  update(
    userId: Id,
    workspaceId: Id,
    id: Id,
    changes: Partial<Omit<EntryInput, 'userId' | 'workspaceId'>>,
  ): Promise<EntryDetails>;
  softDelete(userId: Id, workspaceId: Id, id: Id, at: UtcInstant): Promise<void>;
  restore(userId: Id, id: Id): Promise<EntryDetails>;
  trashedWorkspaceIds(userId: Id): Promise<Id[]>;
  purgeDeleted(userId: Id, scope: { workspaceIds: Id[]; id?: Id }): Promise<number>;
}
interface IdempotencyRecord {
  /** Hash of the user and the client's key. */
  keyHash: string;
  userId: Id;
  /** Digest of the first request with this key. */
  fingerprint: string;
  resultId: Id;
  createdAt: UtcInstant;
}
export interface IdempotencyKeysRepository {
  find(keyHash: string): Promise<IdempotencyRecord | undefined>;
  /** A concurrent insert of the same key fails as a serialization conflict, so the runner retries and finds it. */
  insert(record: IdempotencyRecord): Promise<void>;
  delete(keyHash: string): Promise<void>;
  /** Deletes up to a batch of records created before `before`, skipping locked rows; returns the count. */
  deleteExpired(before: UtcInstant): Promise<number>;
}
export interface TimersRepository {
  read(userId: Id): Promise<TimerSnapshot>;
  getSession(userId: Id): Promise<PomodoroSession | undefined>;
  getPauseChain(userId: Id): Promise<PauseChain | undefined>;
  getRevision(userId: Id): Promise<TimerRevision | undefined>;
  /** Ascending, for a predictable lock order. */
  affectedUsers(workspaceId: Id): Promise<Id[]>;
  saveSession(session: PomodoroSession): Promise<void>;
  deleteSession(userId: Id): Promise<void>;
  savePauseChain(chain: PauseChain): Promise<void>;
  deletePauseChain(userId: Id): Promise<void>;
  removeTagFromPauseChains(tagId: Id): Promise<void>;
  saveRevision(revision: TimerRevision): Promise<void>;
}
export interface ReportSelection {
  /** UTC, half-open. */
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
/** Ties go to the entry id, same direction. `duration` sorts on rounded whole seconds, as reports show them. */
export interface ReportOrder {
  by: 'start' | 'updated' | 'duration';
  direction: 'ASC' | 'DESC';
  /** -1 down, 0 nearest, 1 up, to a step of `minutes`; no rounding when `minutes` is 0 or less. */
  rounding: { mode: number; minutes: number };
}
export interface ReportWindow {
  offset: number;
  limit: number;
}
/** Resume just after this entry. */
export interface ReportCursor {
  start: UtcInstant;
  id: Id;
}
interface ReportCounts {
  entries: number;
  billable: number;
  billableWithProjectRate: number;
}
/** Stopped live entries of one user and workspace. Every read is bounded by ids, window or batch size. */
interface ReportsRepository {
  count(userId: Id, workspaceId: Id, selection: ReportSelection): Promise<ReportCounts>;
  /** All of them without a window. */
  ids(
    userId: Id,
    workspaceId: Id,
    selection: ReportSelection,
    order: ReportOrder,
    window?: ReportWindow,
  ): Promise<Id[]>;
  /** Unordered, for orders the database cannot collate. */
  descriptions(
    userId: Id,
    workspaceId: Id,
    selection: ReportSelection,
  ): Promise<Array<{ id: Id; description: string }>>;
  /** In the order of `ids`, with ordered tags. */
  entries(
    userId: Id,
    workspaceId: Id,
    selection: ReportSelection,
    ids: readonly Id[],
  ): Promise<ReportEntryProjection[]>;
  /** In start/id order, with ordered tags. */
  batch(
    userId: Id,
    workspaceId: Id,
    selection: ReportSelection,
    after: ReportCursor | undefined,
    limit: number,
  ): Promise<ReportEntryProjection[]>;
}
/** `newest`: start, then id, descending. */
type ExportEntryOrder = 'newest' | 'oldest';
export interface TransfersRepository {
  /** One consistent read snapshot. */
  exportAccount(userId: Id): Promise<AccountExportProjection>;
  exportHead(userId: Id): Promise<Omit<AccountExportProjection, 'entries'>>;
  /** Pages of one snapshot concatenate into `exportAccount`'s list, reversed for `oldest`. */
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
/** One open write transaction. Only a runner opens one; code given an `OperationContext` runs in its caller's. */
export interface TransactionScope<R extends object> {
  savepoint<T>(work: (context: OperationContext<R>) => Promise<T>): Promise<T>;
  beforeCommit(key: string, callback: () => Promise<void>): void;
  /** Runs `read` after every before-commit hook, just before COMMIT. `read` may only read: registering a hook fails. */
  readAtCommit(read: () => Promise<void>): void;
  afterCommit(callback: () => Promise<void>): void;
  lockUserTimer(userId: Id): Promise<void>;
  lockInstanceAdministration(): Promise<void>;
  /** Lock order across all calls: instance, then ascending workspaces, then ascending users. */
  lockUsers(userIds: Id[]): Promise<void>;
  lockWorkspaces(workspaceIds: Id[]): Promise<void>;
}
export type OperationContext<R extends object> = R & TransactionScope<R>;
export type TransactionContext = OperationContext<Repositories>;
/** Every repository call runs inside a write transaction, which takes the guards in order, or a read-only snapshot. */
export interface Storage {
  transaction<T>(work: (context: TransactionContext) => Promise<T>, options?: { dryRun?: boolean }): Promise<T>;
  readSnapshot<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
  health(): Promise<void>;
  close(): Promise<void>;
}

/** A hint only; it never carries state. */
export type TimerSignal = { userId: number; revision: number };
/** Between API processes. A receiver rebuilds state from its own database read. */
export interface TimerBus {
  send(signal: TimerSignal): void;
  /** Registers the single receiver. */
  receive(handler: (signal: TimerSignal) => void): void;
  close(): Promise<void>;
}

export interface Clock {
  now(): Date;
}
