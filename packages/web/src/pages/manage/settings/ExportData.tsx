import { useState } from 'react';
import { transferRequests } from '../../../api/transfer.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { reportUnlessCancelled, useUnmountSignal } from '../../../components/useUnmountSignal.ts';
import { exportFilename } from './transferForm.ts';
import { t } from '../../../i18n/messages.ts';

/**
 * Saves the account's data as JSON or as CSV. One export runs at a time, and leaving the page
 * cancels it without an error.
 */
export function ExportData() {
  const toast = useToast();
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const unmountSignal = useUnmountSignal();

  const exportFile = async (kind: 'json' | 'csv') => {
    setExporting(kind);
    await reportUnlessCancelled(
      unmountSignal(),
      signal => transferRequests.export(kind, exportFilename(kind, new Date()), signal),
      toast.error,
    );
    setExporting(null);
  };

  return (
    <>
      <h3 className="settings-subheading">{t('settings.export')}</h3>
      <p className="hint">{t('settings.exportHint')}</p>
      <div className="inline-controls settings-row">
        <button
          type="button"
          className="button button-ghost"
          disabled={exporting !== null}
          onClick={() => void exportFile('json')}
        >
          <Icon name="download" size={16} /> {t('settings.exportJson')}
        </button>
        <button
          type="button"
          className="button button-ghost"
          disabled={exporting !== null}
          onClick={() => void exportFile('csv')}
        >
          <Icon name="download" size={16} /> {t('settings.exportCsv')}
        </button>
      </div>
    </>
  );
}
