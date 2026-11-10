import { useState } from 'react';
import { transferRequests } from '../../../api/transfer.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { reportUnlessCancelled, useCancellable } from '../../../components/useUnmountSignal.ts';
import { exportFilename } from './transferForm.ts';
import { t } from '../../../i18n/messages.ts';

/** One export at a time; Cancel and leaving the page both stop it without an error. */
export function ExportData() {
  const toast = useToast();
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const exports = useCancellable(exporting !== null);

  const exportFile = async (kind: 'json' | 'csv', origin: HTMLElement) => {
    setExporting(kind);
    await reportUnlessCancelled(
      exports.start(origin),
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
          onClick={event => void exportFile('json', event.currentTarget)}
        >
          <Icon name="download" size={16} /> {t('settings.exportJson')}
        </button>
        <button
          type="button"
          className="button button-ghost"
          disabled={exporting !== null}
          onClick={event => void exportFile('csv', event.currentTarget)}
        >
          <Icon name="download" size={16} /> {t('settings.exportCsv')}
        </button>
        {exporting !== null ? (
          <button
            type="button"
            className="button button-ghost"
            aria-label={t('common.cancelDownload')}
            onClick={exports.cancel}
          >
            <Icon name="x" size={16} /> {t('common.cancel')}
          </button>
        ) : null}
      </div>
    </>
  );
}
