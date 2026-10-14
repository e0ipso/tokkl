import { useState } from 'react';
import { download } from '../../api/client.ts';
import type { DurationFormat, Grouping } from '../../api/types.ts';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import { rangeDays, type DateRange } from './range.ts';
import type { ReportFilterBody } from './query.ts';
import type { SubGrouping } from './urlState.ts';

/** Toggl's Reports API v3, which these exports follow, rejects ranges longer than a year. */
const EXPORT_MAX_DAYS = 366;

type Kind = 'detailed' | 'summary';

export function ExportButtons({ workspaceId, range, filters, grouping, subGrouping, durationFormat }: {
  workspaceId: number;
  range: DateRange;
  filters: ReportFilterBody;
  grouping: Grouping;
  subGrouping: SubGrouping;
  durationFormat: DurationFormat;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<Kind | null>(null);
  const tooLong = rangeDays(range) > EXPORT_MAX_DAYS;

  const run = async (kind: Kind) => {
    if (tooLong || !workspaceId) return;
    setBusy(kind);
    const base = `/reports/api/v3/workspace/${workspaceId}`;
    const body = {
      ...filters,
      duration_format: durationFormat,
      ...(kind === 'summary' ? { grouping, sub_grouping: subGrouping === 'none' ? 'users' : subGrouping } : {}),
    };
    try {
      await download(
        kind === 'detailed' ? `${base}/search/time_entries.csv` : `${base}/summary/time_entries.csv`,
        `timetrack-${kind}-${range.from}-to-${range.to}.csv`,
        'POST',
        body,
      );
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="export-buttons" role="group" aria-label="Export">
      {(['detailed', 'summary'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          className="button button-ghost"
          disabled={busy !== null || tooLong || !workspaceId}
          onClick={() => void run(kind)}
        >
          <Icon name="download" size={16} />
          {kind === 'detailed' ? 'CSV (detailed)' : 'CSV (summary)'}
        </button>
      ))}
      {tooLong ? <span className="hint">CSV export covers at most {EXPORT_MAX_DAYS} days.</span> : null}
    </div>
  );
}
