import { transferRequests } from '../../../api/transfer.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { useDownload } from '../../../components/useDownload.ts';
import { exportFilename } from './transferForm.ts';
import { t } from '../../../i18n/messages.ts';

/** One export at a time; Cancel and leaving the page both stop it without an error. */
export function ExportData() {
  const toast = useToast();
  const exports = useDownload(toast.error);

  const exportFile = (kind: 'json' | 'csv', origin: HTMLElement) =>
    exports.run(origin, signal => transferRequests.export(kind, exportFilename(kind, new Date()), signal));

  return (
    <>
      <h3 className="settings-subheading">{t('settings.export')}</h3>
      <p className="hint">{t('settings.exportHint')}</p>
      <div className="inline-controls settings-row">
        <button
          type="button"
          className="button button-ghost"
          disabled={exports.isPending}
          onClick={event => void exportFile('json', event.currentTarget)}
        >
          <Icon name="download" size={16} /> {t('settings.exportJson')}
        </button>
        <button
          type="button"
          className="button button-ghost"
          disabled={exports.isPending}
          onClick={event => void exportFile('csv', event.currentTarget)}
        >
          <Icon name="download" size={16} /> {t('settings.exportCsv')}
        </button>
        {exports.isPending ? (
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
