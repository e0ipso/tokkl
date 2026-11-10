export type IdFilter = Array<number | null>;

export interface ReportFilter {
  /** Inclusive, in the user's timezone. */
  startDate: string;
  /** Inclusive, in the user's timezone. */
  endDate: string;
  projectIds?: IdFilter;
  clientIds?: IdFilter;
  tagIds?: IdFilter;
  taskIds?: IdFilter;
  userIds?: IdFilter;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  /** Drops entries matching any. `null` means "without". */
  excludeProjectIds?: IdFilter;
  excludeClientIds?: IdFilter;
  excludeTagIds?: IdFilter;
  timeEntryIds?: number[];
  billable?: boolean;
  description?: string;
  /** -1 down, 0 nearest, 1 up. Applied per entry when `roundingMinutes` > 0. */
  rounding?: number;
  roundingMinutes?: number;
}

/** `none` keeps them in one group. */
export type Dimension = 'project' | 'client' | 'tag' | 'description' | 'task' | 'none';

export type OrderBy = 'date' | 'user' | 'duration' | 'description' | 'last_update';
export type DetailedOrderBy = Extract<OrderBy, 'date' | 'duration' | 'description'>;
export type SortDirection = 'ASC' | 'DESC';
