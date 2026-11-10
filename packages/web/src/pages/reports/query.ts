import type { ReportFilterBody } from '../../api/reports.ts';
import type { ReportQuery } from '@tokkl/types';
import type { ReportState } from './urlState.ts';

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
 * A sub-grouping equal to the grouping means none. Detailed and weekly tabs need only totals, so they ask
 * for the smallest grouping.
 */
export function reportQuery(state: ReportState): ReportQuery {
  if (state.tab !== 'summary') return { ...filterBody(state), grouping: 'projects', sub_grouping: 'projects' };
  return {
    ...filterBody(state),
    grouping: state.grouping,
    sub_grouping: state.subGrouping === 'none' ? state.grouping : state.subGrouping,
  };
}
