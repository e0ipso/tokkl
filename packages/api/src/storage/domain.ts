import type { PomodoroSessionConfig, SessionPhaseKind } from '@tokkl/common/pomodoroSession';

/** Positive safe integer, checked at the repository boundary. */
export type Id = number;
/** Canonical UTC ISO 8601 with millisecond precision. Never a driver-local timestamp. */
export type UtcInstant = string;
/** Valid YYYY-MM-DD calendar key, separate from an instant. */
export type DateOnly = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export type UserRole = 'admin' | 'user';
export type MembershipRole = 'owner' | 'member';
export interface AuditTimes { createdAt: UtcInstant; updatedAt: UtcInstant }
export interface User extends AuditTimes {
  id: Id;
  email: string;
  fullName: string;
  passwordHash: string;
  apiToken: string;
  timezone: string;
  beginningOfWeek: number;
  defaultWorkspaceId: Id;
  preferences: JsonObject;
  role: UserRole;
  disabledAt: UtcInstant | null;
}
export interface Workspace extends AuditTimes {
  id: Id;
  name: string;
  defaultCurrency: string;
  defaultHourlyRate: number | null;
  rounding: number;
  roundingMinutes: number;
}
export interface Membership { workspaceId: Id; userId: Id; role: MembershipRole }
export interface WorkspaceMember extends Membership { email: string; fullName: string; timezone: string }
export interface InstanceSettings { sessionDays: number; inviteDays: number; timeResolutionMinutes: number }
export interface SettingChange { key: keyof InstanceSettings; value: number; updatedAt: UtcInstant; updatedBy: Id | null }
export interface AccountToken {
  id: Id;
  tokenHash: string;
  kind: 'invite' | 'password_reset';
  role: UserRole | null;
  note: string | null;
  userId: Id | null;
  createdBy: Id | null;
  createdAt: UtcInstant;
  expiresAt: UtcInstant;
  usedAt: UtcInstant | null;
}
export interface Session { tokenHash: string; userId: Id; createdAt: UtcInstant; expiresAt: UtcInstant; userAgent: string }
export interface Client extends AuditTimes { id: Id; workspaceId: Id; name: string; notes: string | null; archived: boolean }
export interface Project extends AuditTimes {
  id: Id;
  workspaceId: Id;
  clientId: Id | null;
  name: string;
  color: string;
  active: boolean;
  isPrivate: boolean;
  billable: boolean;
  estimatedHours: number | null;
  rate: number | null;
  currency: string | null;
  fixedFee: number | null;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  template: boolean;
}
export interface ProjectSummary extends Project { clientName: string | null; actualSeconds: number }
export type ProjectRef = Pick<Project, 'id' | 'workspaceId' | 'active' | 'billable'>;
export interface Task extends AuditTimes { id: Id; workspaceId: Id; projectId: Id; name: string; active: boolean; estimatedSeconds: number | null }
export interface TaskSummary extends Task {
  projectName: string;
  projectColor: string;
  projectBillable: boolean;
  projectIsPrivate: boolean;
  clientId: Id | null;
  clientName: string | null;
  /** Public tracked_seconds serializes milliseconds, despite its public name. */
  trackedMilliseconds: number;
}
export type TaskRef = Pick<Task, 'id' | 'workspaceId' | 'projectId' | 'active'>;
export interface Tag extends AuditTimes { id: Id; workspaceId: Id; name: string }
export interface TagLabel { id: Id; name: string }
export interface TimeEntry extends AuditTimes {
  id: Id;
  workspaceId: Id;
  userId: Id;
  projectId: Id | null;
  taskId: Id | null;
  description: string;
  start: UtcInstant;
  stop: UtcInstant | null;
  billable: boolean;
  durationOnly: boolean;
  allDay: boolean;
  createdWith: string;
  deletedAt: UtcInstant | null;
}
export interface EntryDetails extends TimeEntry {
  /** Public labels use ASCII case-insensitive name order, with id as a stable tie breaker. */
  tags: TagLabel[];
  project: { name: string; color: string; active: boolean; billable: boolean } | null;
  client: { id: Id; name: string } | null;
  task: { name: string; active: boolean } | null;
}
export interface PauseChain {
  userId: Id;
  workspaceId: Id;
  projectId: Id | null;
  taskId: Id | null;
  description: string;
  /** Canonical fingerprint order is ascending id. */
  tagIds: Id[];
  billable: boolean;
  seconds: number;
  cloneEntryId: Id | null;
}
export interface PomodoroPhase { kind: SessionPhaseKind; startedAt: UtcInstant; completed: number }
export interface PomodoroSession { userId: Id; entryId: Id; config: PomodoroSessionConfig; phase: PomodoroPhase }
export interface DiscardedPomodoro { entryId: Id; start: UtcInstant; stop: UtcInstant }
export interface TimerRevision { userId: Id; revision: number; fingerprint: string; discardedPomodoro: DiscardedPomodoro | null }
export interface TimerSnapshot { running: EntryDetails | null; pauseChain: PauseChain | null; session: PomodoroSession | null; revision: TimerRevision | null }

/** Unrounded stopped-entry data; application report logic owns rounding, dates and money. */
export interface ReportEntryProjection {
  id: Id;
  userId: Id;
  workspaceId: Id;
  description: string;
  start: UtcInstant;
  stop: UtcInstant;
  updatedAt: UtcInstant;
  billable: boolean;
  allDay: boolean;
  projectId: Id | null;
  projectName: string | null;
  projectColor: string | null;
  projectRate: number | null;
  projectCurrency: string | null;
  clientId: Id | null;
  clientName: string | null;
  taskId: Id | null;
  taskName: string | null;
  tags: TagLabel[];
}
/** Export values omit credentials and span only the account's memberships and own entries. */
export interface AccountExportProjection {
  user: Omit<User, 'passwordHash' | 'apiToken'>;
  memberships: Membership[];
  workspaces: Workspace[];
  clients: Client[];
  projects: ProjectSummary[];
  tasks: TaskSummary[];
  tags: Tag[];
  entries: EntryDetails[];
}
export interface EntryDuplicateKey { userId: Id; start: UtcInstant; stop: UtcInstant | null; description: string; projectId: Id | null }
export interface EntryBounds { firstStart: UtcInstant | null; lastStart: UtcInstant | null }
