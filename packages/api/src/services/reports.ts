import { noWorkspaceAccess } from '../domain/membership.ts';
import { forbidden } from '../lib/errors.ts';
import { addDays, dateKey, startOfDay } from '@tokkl/common/time';
import type { User, Workspace, ReportEntryProjection } from '../storage/domain.ts';
import type {
  ReadOnlyRepositories,
  ReportCursor,
  ReportOrder,
  ReportSelection,
  ReportWindow,
} from '../storage/contracts.ts';
import { authenticatedUser, type Authentication } from '../domain/credentials.ts';
import type { OrderBy, ReportFilter, SortDirection } from '../domain/reportCommands.ts';

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

/** Entries a report formats at a time, and the most ids one entry read names. */
export const REPORT_BATCH_SIZE = 500;
/** A detailed report's order. Ties go to the entry id, in the same direction. */
export interface DetailedOrder {
  orderBy: OrderBy;
  direction: SortDirection;
}
/**
 * One report's entries inside its read snapshot, formatted with the caller's filter. Every read is
 * bounded: a page reads its window, and a full pass hands over one batch at a time.
 */
export interface ReportReader {
  readonly user: ReportUser;
  readonly filter: ReportFilter;
  /** How many entries match, and whether any of them has an amount. */
  counts(): Promise<{ total: number; hasAmounts: boolean }>;
  /** Up to `limit` entries from position `offset` (0-based) in `order`. */
  page(order: DetailedOrder, offset: number, limit: number): Promise<ReportEntry[]>;
  /** Every entry in `order`, one batch at a time. */
  ordered(order: DetailedOrder, visit: (batch: ReportEntry[]) => void): Promise<void>;
  /** Every entry by start, then id, one batch at a time. */
  each(visit: (batch: ReportEntry[]) => void): Promise<void>;
}
export interface ReportReadOptions {
  authentication?: Authentication;
  /** Called once, when the report's first rows arrive. */
  onRows?: () => void;
}

/** The orders the database applies. Descriptions sort by the runtime's collation instead. */
const SQL_ORDERS: Readonly<Record<Exclude<OrderBy, 'description'>, ReportOrder['by']>> = {
  date: 'start',
  user: 'start',
  duration: 'duration',
  last_update: 'updated',
};
/** `String.prototype.localeCompare` without locales or options compares as this collator does. */
const collator = new Intl.Collator();

/**
 * Checks the caller and the workspace, then runs `work` over the filter's entries, all in one read
 * snapshot. `work` formats as it reads, so the snapshot stays open until `work` settles.
 */
export function readReport<T>(
  source: ReportSource,
  userId: number,
  workspaceId: number,
  filter: ReportFilter,
  options: ReportReadOptions,
  work: (report: ReportReader) => Promise<T>,
): Promise<T> {
  const { authentication, onRows } = options;
  return source.readSnapshot(async repositories => {
    const found = authentication
      ? authentication.user.id === userId
        ? await authenticatedUser(repositories, authentication)
        : undefined
      : await repositories.users.get(userId);
    if (!found) throw forbidden();
    const member = await repositories.workspaces.forMember(userId, workspaceId);
    if (!member) throw noWorkspaceAccess();
    const user: ReportUser = {
      id: found.id,
      fullName: found.fullName,
      email: found.email,
      timezone: found.timezone,
      beginningOfWeek: found.beginningOfWeek,
    };
    const workspace: ReportWorkspace = {
      id: member.id,
      defaultCurrency: member.defaultCurrency,
      defaultHourlyRate: member.defaultHourlyRate,
    };
    const selection: ReportSelection = {
      ...filter,
      from: startOfDay(filter.startDate, user.timezone).toISOString(),
      to: startOfDay(addDays(filter.endDate, 1), user.timezone).toISOString(),
    };
    const reports = repositories.reports;
    let arrived = false;
    const format = (rows: ReportEntryProjection[]): ReportEntry[] => {
      if (!arrived) {
        arrived = true;
        onRows?.();
      }
      return formatReportEntries(rows, user, workspace, filter);
    };
    /** The entries of `ids`, read a batch at a time, in the order of `ids`. */
    async function* entriesOf(ids: readonly number[]): AsyncGenerator<ReportEntry[]> {
      for (let i = 0; i < ids.length; i += REPORT_BATCH_SIZE)
        yield format(await reports.entries(userId, workspaceId, selection, ids.slice(i, i + REPORT_BATCH_SIZE)));
    }
    /** The ids in `order`, only those inside `window` when there is one. */
    async function orderedIds(order: DetailedOrder, window?: ReportWindow): Promise<number[]> {
      if (order.orderBy !== 'description') {
        const sqlOrder: ReportOrder = {
          by: SQL_ORDERS[order.orderBy],
          direction: order.direction,
          rounding: { mode: filter.rounding ?? 0, minutes: filter.roundingMinutes ?? 0 },
        };
        return reports.ids(userId, workspaceId, selection, sqlOrder, window);
      }
      const keyed = await reports.descriptions(userId, workspaceId, selection);
      const dir = order.direction === 'ASC' ? 1 : -1;
      keyed.sort((a, b) => dir * (collator.compare(a.description, b.description) || a.id - b.id));
      const ids = keyed.map(k => k.id);
      return window ? ids.slice(window.offset, window.offset + window.limit) : ids;
    }
    return work({
      user,
      filter,
      async counts() {
        const counts = await reports.count(userId, workspaceId, selection);
        // An entry has an amount when it is billable and its project or the workspace has a rate.
        const priced = workspace.defaultHourlyRate !== null ? counts.billable : counts.billableWithProjectRate;
        return { total: counts.entries, hasAmounts: priced > 0 };
      },
      async page(order, offset, limit) {
        const page: ReportEntry[] = [];
        for await (const batch of entriesOf(await orderedIds(order, { offset, limit }))) page.push(...batch);
        return page;
      },
      async ordered(order, visit) {
        for await (const batch of entriesOf(await orderedIds(order))) visit(batch);
      },
      async each(visit) {
        let after: ReportCursor | undefined;
        for (;;) {
          const rows = await reports.batch(userId, workspaceId, selection, after, REPORT_BATCH_SIZE);
          if (rows.length) visit(format(rows));
          if (rows.length < REPORT_BATCH_SIZE) return;
          const last = rows.at(-1)!;
          after = { start: last.start, id: last.id };
        }
      },
    });
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
