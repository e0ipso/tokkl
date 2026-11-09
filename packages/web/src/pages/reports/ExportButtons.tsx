import { useState } from 'react';
import { downloadReportCsv, type ReportFilterBody } from '../../api/reports.ts';
import type { DurationFormat, Grouping } from '@tokkl/types';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import { reportUnlessCancelled, useCancellable } from '../../components/useUnmountSignal.ts';
import type { DateRange } from './range.ts';
import type { SortDir, SortKey, SubGrouping } from './urlState.ts';
import { t } from '../../i18n/messages.ts';

type Kind = 'detailed' | 'summary';

/**
 * CSV downloads of the report on screen: same range, filters, rounding, grouping and sort order.
 * While one runs, Cancel stops it, and so does leaving the page, without an error.
 */
export function ExportButtons({
  range,
  filters,
  grouping,
  subGrouping,
  sort,
  dir,
  durationFormat,
}: {
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
  const downloads = useCancellable(busy !== null);

  const run = async (kind: Kind, origin: HTMLElement) => {
    setBusy(kind);
    const body = {
      ...filters,
      duration_format: durationFormat,
      ...(kind === 'summary'
        ? { grouping, sub_grouping: subGrouping === 'none' ? grouping : subGrouping }
        : { sort, dir }),
    };
    await reportUnlessCancelled(
      downloads.start(origin),
      signal => downloadReportCsv(kind, body, `tokkl-${kind}-${range.from}-to-${range.to}.csv`, signal),
      toast.error,
    );
    setBusy(null);
  };

  return (
    <div className="export-buttons" role="group" aria-label={t('reports.export')}>
      {(['detailed', 'summary'] as const).map(kind => (
        <button
          key={kind}
          type="button"
          className="button button-ghost"
          disabled={busy !== null}
          onClick={event => void run(kind, event.currentTarget)}
        >
          <Icon name="download" size={16} />
          {kind === 'detailed' ? t('reports.csvDetailed') : t('reports.csvSummary')}
        </button>
      ))}
      {busy !== null ? (
        <button
          type="button"
          className="button button-ghost"
          aria-label={t('common.cancelDownload')}
          onClick={downloads.cancel}
        >
          <Icon name="x" size={16} />
          {t('common.cancel')}
        </button>
      ) : null}
    </div>
  );
}
