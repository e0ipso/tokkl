import type { ReportQuery } from '../../api/types.ts';
import type { ReportState } from './urlState.ts';

/** Filter fields shared by the app report endpoint and the Toggl-compatible CSV exports. */
export type ReportFilterBody = Pick<
  ReportQuery, 'start_date' | 'end_date' | 'project_ids' | 'client_ids' | 'tag_ids' | 'billable' | 'description'
  | 'exclude_project_ids' | 'exclude_client_ids' | 'exclude_tag_ids'
>;

function idFilter(ids: ReportState['projects'], negated: boolean, include: string, exclude: string) {
  if (!ids.length) return {};
  return { [negated ? exclude : include]: [...ids] };
}

export function filterBody(state: ReportState): ReportFilterBody {
  return {
    start_date: state.range.from,
    end_date: state.range.to,
    ...idFilter(state.projects, state.projectsNot, 'project_ids', 'exclude_project_ids'),
    ...idFilter(state.clients, state.clientsNot, 'client_ids', 'exclude_client_ids'),
    ...idFilter(state.tags, state.tagsNot, 'tag_ids', 'exclude_tag_ids'),
    ...(state.billable !== 'all' ? { billable: state.billable === 'billable' } : {}),
    ...(state.description.trim() ? { description: state.description.trim() } : {}),
  };
}

/**
 * The query for POST /api/app/report. Entries are always included so switching tabs needs no
 * refetch. The server reads a sub-grouping equal to the grouping as "no sub-grouping".
 */
export function reportQuery(state: ReportState): ReportQuery {
  return {
    ...filterBody(state),
    grouping: state.grouping,
    sub_grouping: state.subGrouping === 'none' ? state.grouping : state.subGrouping,
    include_entries: true,
  };
}
