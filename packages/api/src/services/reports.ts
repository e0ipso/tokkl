import { noWorkspaceAccess } from '../domain/membership.ts';
import { forbidden } from '../lib/errors.ts';
import { addDays, dateKey, startOfDay } from '@tokkl/common/time';
import type { User, Workspace, ReportEntryProjection } from '../storage/domain.ts';
import type { ReadOnlyRepositories } from '../storage/contracts.ts';
import { authenticatedUser, type Authentication } from '../domain/credentials.ts';
import type { ReportFilter } from '../domain/reportCommands.ts';

export interface ReportEntry {
  id: number;
  description: string;
  start: string;
  stop: string;
  at: string;
  date: string;
  seconds: number;
  billable: boolean;
  projectId: number | null;
  projectName: string | null;
  projectColor: string | null;
  clientId: number | null;
  clientName: string | null;
  taskId: number | null;
  taskName: string | null;
  tags: Array<{ id: number; name: string }>;
  hourlyRateCents: number | null;
  currency: string;
  amountCents: number | null;
  allDay: boolean;
}

function roundSeconds(seconds: number, mode: number, minutes: number): number {
  if (minutes <= 0) return seconds;
  const step = minutes * 60;
  if (mode > 0) return Math.ceil(seconds / step) * step;
  if (mode < 0) return Math.floor(seconds / step) * step;
  return Math.round(seconds / step) * step;
}

export type ReportRepositories = Pick<ReadOnlyRepositories, 'users' | 'workspaces' | 'sessions' | 'reports'>;
export interface ReportSource {
  readSnapshot<T>(work: (repositories: ReportRepositories) => Promise<T>): Promise<T>;
}
export type ReportUser = Pick<User, 'id' | 'fullName' | 'email' | 'timezone' | 'beginningOfWeek'>;
export type ReportWorkspace = Pick<Workspace, 'id' | 'defaultCurrency' | 'defaultHourlyRate'>;
export interface ReportData {
  user: ReportUser;
  workspace: ReportWorkspace;
  entries: ReportEntryProjection[];
}

/** Read all related values on one checkout; release it before grouping or constructing CSV. */
export function collectReport(
  source: ReportSource,
  userId: number,
  workspaceId: number,
  filter: ReportFilter,
  authentication?: Authentication,
): Promise<ReportData> {
  return source.readSnapshot(async repositories => {
    const user = authentication
      ? authentication.user.id === userId
        ? await authenticatedUser(repositories, authentication)
        : undefined
      : await repositories.users.get(userId);
    if (!user) throw forbidden();
    const workspace = await repositories.workspaces.forMember(userId, workspaceId);
    if (!workspace) throw noWorkspaceAccess();
    const from = startOfDay(filter.startDate, user.timezone).toISOString();
    const to = startOfDay(addDays(filter.endDate, 1), user.timezone).toISOString();
    const entries = await repositories.reports.collect(userId, workspaceId, { ...filter, from, to });
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        timezone: user.timezone,
        beginningOfWeek: user.beginningOfWeek,
      },
      workspace: {
        id: workspace.id,
        defaultCurrency: workspace.defaultCurrency,
        defaultHourlyRate: workspace.defaultHourlyRate,
      },
      entries,
    };
  });
}

export function formatReportEntries(
  rows: ReportEntryProjection[],
  user: ReportUser,
  workspace: ReportWorkspace,
  filter: ReportFilter,
): ReportEntry[] {
  return rows.map(row => {
    const raw = Math.floor((Date.parse(row.stop) - Date.parse(row.start)) / 1000);
    const seconds = roundSeconds(raw, filter.rounding ?? 0, filter.roundingMinutes ?? 0);
    const rate = row.projectRate ?? workspace.defaultHourlyRate;
    const currency =
      row.projectRate !== null ? (row.projectCurrency ?? workspace.defaultCurrency) : workspace.defaultCurrency;
    const hourlyRateCents = row.billable && rate !== null ? Math.round(rate * 100) : null;
    return {
      id: row.id,
      description: row.description,
      start: row.start,
      stop: row.stop,
      at: row.updatedAt,
      date: dateKey(new Date(row.start), user.timezone),
      seconds,
      billable: row.billable,
      projectId: row.projectId,
      projectName: row.projectName,
      projectColor: row.projectColor,
      clientId: row.clientId,
      clientName: row.clientName,
      taskId: row.taskId,
      taskName: row.taskName,
      tags: row.tags,
      hourlyRateCents,
      currency,
      amountCents: hourlyRateCents === null ? null : Math.round((seconds / 3600) * hourlyRateCents),
      allDay: row.allDay,
    };
  });
}
