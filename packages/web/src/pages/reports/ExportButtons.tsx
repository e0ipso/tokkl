import { useState } from 'react';
import { download } from '../../api/client.ts';
import type { DurationFormat, Grouping } from '../../api/types.ts';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import type { DateRange } from './range.ts';
import type { ReportFilterBody } from './query.ts';
import type { SortDir, SortKey, SubGrouping } from './urlState.ts';

type Kind = 'detailed' | 'summary';

/** CSV downloads of the report on screen: same range, filters, rounding, grouping and sort order. */
export function ExportButtons({ range, filters, grouping, subGrouping, sort, dir, durationFormat }: {
  range: DateRange;
  filters: ReportFilterBody;
  grouping: Grouping;
  subGrouping: SubGrouping;
  sort: SortKey;
  dir: SortDir;
  durationFormat: DurationFormat;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<Kind | null>(null);

  const run = async (kind: Kind) => {
    setBusy(kind);
    const body = {
      ...filters,
      duration_format: durationFormat,
      ...(kind === 'summary'
        ? { grouping, sub_grouping: subGrouping === 'none' ? grouping : subGrouping }
        : { sort, dir }),
    };
    try {
      await download(`/api/app/report/${kind}.csv`, `timetrack-${kind}-${range.from}-to-${range.to}.csv`, 'POST', body);
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
          disabled={busy !== null}
          onClick={() => void run(kind)}
        >
          <Icon name="download" size={16} />
          {kind === 'detailed' ? 'CSV (detailed)' : 'CSV (summary)'}
        </button>
      ))}
    </div>
  );
}
