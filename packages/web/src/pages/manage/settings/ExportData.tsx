import { useState } from 'react';
import { transferRequests } from '../../../api/transfer.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { exportFilename } from './transferForm.ts';

/** Saves the account's data as JSON or as CSV. One export runs at a time. */
export function ExportData() {
  const toast = useToast();
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);

  const exportFile = async (kind: 'json' | 'csv') => {
    setExporting(kind);
    try {
      await transferRequests.export(kind, exportFilename(kind, new Date()));
    } catch (error) {
      toast.error(error);
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <h3 className="settings-subheading">Export</h3>
      <p className="hint">
        JSON has your clients, projects, tasks, tags, time entries and settings. CSV has one row per time entry, with
        the same columns as the Toggl Track detailed report.
      </p>
      <div className="inline-controls settings-row">
        <button
          type="button"
          className="button button-ghost"
          disabled={exporting !== null}
          onClick={() => void exportFile('json')}
        >
          <Icon name="download" size={16} /> Export JSON
        </button>
        <button
          type="button"
          className="button button-ghost"
          disabled={exporting !== null}
          onClick={() => void exportFile('csv')}
        >
          <Icon name="download" size={16} /> Export CSV
        </button>
      </div>
    </>
  );
}
