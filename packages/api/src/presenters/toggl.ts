/** Toggl v9 shapes over the `@tokkl/types` DTOs; every route, the timer state and the JSON export use them. */
import type {
  AdminAccount,
  Client as ClientDto,
  InstanceSettings as InstanceSettingsDto,
  Invite,
  Project as ProjectDto,
  Tag as TagDto,
  Task as TaskDto,
  TimeEntry as TimeEntryDto,
  Workspace as WorkspaceDto,
} from '@tokkl/types';
import type {
  AccountToken,
  Client,
  EntryDetails,
  InstanceSettings,
  MembershipRole,
  ProjectSummary,
  Tag,
  TaskSummary,
  User,
  Workspace,
  WorkspaceMember,
} from '../domain/model.ts';
import { togglTime } from '../lib/values.ts';

/** Keeps the result typed as a string. */
const stamp = (iso: string): string => togglTime(iso)!;
const wholeSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function serializeAccount(user: User): AdminAccount {
  return {
    id: user.id,
    email: user.email,
    fullname: user.fullName,
    role: user.role,
    created_at: stamp(user.createdAt),
    disabled_at: togglTime(user.disabledAt),
  };
}

export function serializeUser(user: User, options: { includeToken: boolean }) {
  return {
    id: user.id,
    api_token: options.includeToken ? user.apiToken : undefined,
    email: user.email,
    fullname: user.fullName,
    timezone: user.timezone,
    toggl_accounts_id: String(user.id),
    default_workspace_id: user.defaultWorkspaceId,
    beginning_of_week: user.beginningOfWeek,
    image_url: '',
    created_at: stamp(user.createdAt),
    updated_at: stamp(user.updatedAt),
    openid_email: null,
    openid_enabled: false,
    country_id: null,
    has_password: true,
    at: stamp(user.updatedAt),
    intercom_hash: undefined,
    oauth_providers: [],
    '2fa_enabled': false,
    authorization_updated_at: stamp(user.updatedAt),
  };
}

interface TogglWorkspace extends WorkspaceDto {
  organization_id: number;
  admin: boolean;
  role: 'admin' | 'user';
  [field: string]: unknown;
}

/** `membership` is the caller's role; an owner is Toggl's workspace admin. */
export function serializeWorkspace(ws: Workspace, membership: MembershipRole | undefined): TogglWorkspace {
  const admin = membership === 'owner';
  return {
    id: ws.id,
    organization_id: ws.id,
    name: ws.name,
    premium: true,
    business_ws: true,
    admin,
    role: admin ? 'admin' : 'user',
    suspended_at: null,
    server_deleted_at: null,
    default_hourly_rate: ws.defaultHourlyRate,
    rate_last_updated: null,
    default_currency: ws.defaultCurrency,
    only_admins_may_create_projects: false,
    only_admins_may_create_tags: false,
    only_admins_see_team_dashboard: false,
    projects_billable_by_default: false,
    projects_private_by_default: true,
    projects_enforce_billable: false,
    limit_public_project_data: false,
    last_modified: stamp(ws.updatedAt),
    reports_collapse: true,
    rounding: ws.rounding,
    rounding_minutes: ws.roundingMinutes,
    api_token: undefined,
    at: stamp(ws.updatedAt),
    logo_url: '',
    ical_url: '',
    ical_enabled: false,
    csv_upload: null,
    subscription: null,
    hide_start_end_times: false,
    disable_timesheet_view: false,
    disable_approvals: true,
    disable_expenses: true,
    working_hours_in_minutes: null,
    permissions: null,
    max_data_retention_days: null,
    te_constraints: null,
  };
}

/** Tokkl has one organization per workspace. */
export function serializeOrganization(ws: Workspace, owner: boolean, memberCount: number) {
  return {
    id: ws.id,
    name: ws.name,
    pricing_plan_id: 0,
    pricing_plan_name: 'Self-hosted',
    created_at: stamp(ws.createdAt),
    at: stamp(ws.updatedAt),
    server_deleted_at: null,
    is_multi_workspace_enabled: false,
    suspended_at: null,
    user_count: memberCount,
    trial_info: null,
    is_chargify: false,
    is_unified: false,
    max_workspaces: 1,
    admin: owner,
    owner,
    permissions: null,
  };
}

export function serializeWorkspaceMember(member: WorkspaceMember) {
  return {
    id: member.userId,
    email: member.email,
    fullname: member.fullName,
    timezone: member.timezone,
    admin: member.role === 'owner',
    inactive: false,
  };
}

export function serializeInvite(invite: AccountToken): Invite {
  return {
    id: invite.id,
    // Only invites are listed here, and every invite row carries a role.
    role: invite.role!,
    note: invite.note,
    created_by: invite.createdBy,
    created_at: stamp(invite.createdAt),
    expires_at: stamp(invite.expiresAt),
  };
}

export function serializeSettings(settings: InstanceSettings): InstanceSettingsDto {
  return {
    session_days: settings.sessionDays,
    invite_days: settings.inviteDays,
    time_resolution_minutes: settings.timeResolutionMinutes,
  };
}

interface TogglClient extends ClientDto {
  at: string;
  creator_id: null;
  integration_provider: null;
  permissions: null;
}

export function serializeClient(row: Client): TogglClient {
  return {
    id: row.id,
    wid: row.workspaceId,
    archived: row.archived,
    name: row.name,
    at: stamp(row.updatedAt),
    notes: row.notes,
    creator_id: null,
    integration_provider: null,
    permissions: null,
  };
}

function projectStatus(row: ProjectSummary, today: string): string {
  if (!row.active) return 'archived';
  if (row.startDate && row.startDate > today) return 'upcoming';
  if (row.endDate && row.endDate < today) return 'ended';
  return 'active';
}

interface TogglProject extends ProjectDto {
  [field: string]: unknown;
}

export function serializeProject(row: ProjectSummary, defaultCurrency: string): TogglProject {
  const actualSeconds = Number(row.actualSeconds);
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    client_id: row.clientId,
    name: row.name,
    is_private: row.isPrivate,
    active: row.active,
    at: stamp(row.updatedAt),
    created_at: stamp(row.createdAt),
    server_deleted_at: null,
    color: row.color,
    billable: row.billable,
    template: row.template,
    auto_estimates: false,
    estimated_hours: row.estimatedHours,
    estimated_seconds: row.estimatedHours === null ? null : Math.round(row.estimatedHours * 3600),
    rate: row.rate,
    rate_last_updated: null,
    currency: row.currency,
    recurring: false,
    template_id: null,
    recurring_parameters: null,
    fixed_fee: row.fixedFee,
    actual_hours: Math.floor(actualSeconds / 3600),
    actual_seconds: actualSeconds,
    start_date: row.startDate ?? row.createdAt.slice(0, 10),
    end_date: row.endDate,
    status: projectStatus(row, new Date().toISOString().slice(0, 10)),
    wid: row.workspaceId,
    cid: row.clientId,
    client_name: row.clientName,
    can_track_time: true,
    pinned: false,
    permissions: null,
    workspace_default_currency: defaultCurrency,
    integration_provider: null,
    external_reference: null,
  };
}

interface TogglTask extends TaskDto {
  [field: string]: unknown;
}

export function serializeTask(row: TaskSummary): TogglTask {
  return {
    id: row.id,
    name: row.name,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    user_id: null,
    active: row.active,
    at: stamp(row.updatedAt),
    estimated_seconds: row.estimatedSeconds,
    // Toggl documents this field as milliseconds despite the name.
    tracked_seconds: row.trackedMilliseconds,
    server_deleted_at: null,
    project_name: row.projectName,
    project_color: row.projectColor,
    project_billable: row.projectBillable,
    project_is_private: row.projectIsPrivate,
    client_id: row.clientId,
    client_name: row.clientName,
    rate: null,
    recurring: false,
    permissions: null,
    integration_provider: null,
  };
}

interface TogglTag extends TagDto {
  at: string;
  deleted_at: null;
  creator_id: null;
  integration_provider: null;
  permissions: null;
}

export function serializeTag(row: Tag): TogglTag {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    at: stamp(row.updatedAt),
    deleted_at: null,
    creator_id: null,
    integration_provider: null,
    permissions: null,
  };
}

interface TogglTimeEntry extends TimeEntryDto {
  duronly: true;
  user_id: number;
  uid: number;
  wid: number;
  pid: number | null;
  tid: number | null;
  permissions: null;
  expense_ids: never[];
  project_active?: boolean | null;
  project_billable?: boolean | null;
  client_id?: number | null;
  task_active?: boolean | null;
  user_name?: string | null;
  user_avatar_url?: string;
}

export interface TimeEntryPresentation {
  /** As Toggl's `meta=true` does. */
  meta?: boolean;
  user?: User;
}

/** A running entry's duration is minus its start in Unix seconds, as in Toggl. */
export function serializeTimeEntry(row: EntryDetails, options: TimeEntryPresentation = {}): TogglTimeEntry {
  const duration = row.stop ? wholeSeconds(row.stop) - wholeSeconds(row.start) : -wholeSeconds(row.start);
  const entry: TogglTimeEntry = {
    id: row.id,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    task_id: row.taskId,
    billable: row.billable,
    start: stamp(row.start),
    stop: togglTime(row.stop),
    duration,
    description: row.description,
    tags: row.tags.map(tag => tag.name),
    tag_ids: row.tags.map(tag => tag.id),
    duronly: true,
    all_day: row.allDay,
    at: stamp(row.updatedAt),
    server_deleted_at: togglTime(row.deletedAt),
    user_id: row.userId,
    uid: row.userId,
    wid: row.workspaceId,
    pid: row.projectId,
    tid: row.taskId,
    permissions: null,
    expense_ids: [],
  };
  if (!options.meta) return entry;
  return {
    ...entry,
    project_name: row.project?.name ?? null,
    project_color: row.project?.color ?? null,
    project_active: row.project?.active ?? null,
    project_billable: row.project?.billable ?? null,
    client_id: row.client?.id ?? null,
    client_name: row.client?.name ?? null,
    task_name: row.task?.name ?? null,
    task_active: row.task?.active ?? null,
    user_name: options.user?.fullName ?? null,
    user_avatar_url: '',
  };
}
