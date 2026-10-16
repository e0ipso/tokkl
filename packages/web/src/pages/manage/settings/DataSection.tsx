import { useRef, useState, type ChangeEvent } from 'react';
import { api, download } from '../../../api/client.ts';
import { keys } from '../../../api/hooks.ts';
import type { ImportResult } from '../../../api/types.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { plural } from '../ui.tsx';
import { useAction, useInvalidate } from '../queries.ts';
import { SettingsCard } from './SettingsCard.tsx';

const IMPORT_PATH = '/api/app/import/toggl-csv';
const IMPORT_KEYS = [keys.entries, keys.current, keys.projects, keys.clients, keys.tags, keys.tasks, keys.report] as const;

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The query string for a CSV import request: preview or not, and the chosen Toggl users. */
function importQuery(dryRun: boolean, users: string[]): string {
  const params = new URLSearchParams();
  if (dryRun) params.set('dry_run', 'true');
  for (const key of users) params.append('user', key);
  const text = params.toString();
  return text ? `?${text}` : '';
}

function ImportSummary({ result }: { result: ImportResult }) {
  const otherUsers = result.skipped.reduce((sum, item) => sum + item.rows, 0);
  const failed = Math.max(0, result.rows - result.created - result.skipped_duplicates - otherUsers);
  const preview = result.dry_run;
  return (
    <div className="import-summary" aria-live="polite">
      <ul className="import-stats">
        <li>{plural(result.rows, 'row')} in the file</li>
        <li>{plural(result.created, 'entry', 'entries')} {preview ? 'to import' : 'imported'}</li>
        <li>{result.skipped_duplicates} already here, skipped</li>
        {otherUsers > 0 ? <li>{plural(otherUsers, 'row')} from other Toggl users, skipped</li> : null}
        {failed > 0 ? <li className="is-error">{plural(failed, 'row')} with problems</li> : null}
      </ul>
      {result.created_projects.length > 0 ? (
        <p>
          {preview ? 'New projects: ' : 'Created projects: '}
          {result.created_projects.join(', ')}
        </p>
      ) : null}
      {result.created_clients.length > 0 ? (
        <p>
          {preview ? 'New clients: ' : 'Created clients: '}
          {result.created_clients.join(', ')}
        </p>
      ) : null}
      {result.errors.length > 0 ? (
        <details className="import-errors" open={result.errors.length <= 5}>
          <summary>
            {result.errors.length < failed ? `First ${result.errors.length} problems` : plural(result.errors.length, 'problem')}
          </summary>
          <ul>
            {result.errors.map((error) => <li key={error.row}>Row {error.row}: {error.message}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

interface RestoreResult {
  dry_run: boolean;
  clients: number;
  projects: number;
  tasks: number;
  tags: number;
  time_entries: number;
  skipped_duplicates: number;
  errors: Array<{ entity: string; id: unknown; message: string }>;
}

/** Checkboxes for a team export: whose rows to import. */
function ImportUsers({ users, selected, onToggle }: {
  users: ImportResult['users'];
  selected: string[];
  onToggle: (key: string, checked: boolean) => void;
}) {
  return (
    <fieldset className="import-users">
      <legend>This file has entries from {users.length} Toggl users. Choose whose entries to import.</legend>
      {users.map((user) => (
        <label key={user.key} className="field checkbox-field">
          <input type="checkbox" checked={selected.includes(user.key)} onChange={(event) => onToggle(user.key, event.target.checked)} />
          <span>
            {user.user || user.email || 'No Toggl user'}
            {user.user && user.email ? <span className="muted"> {user.email}</span> : null}
            <span className="muted"> · {plural(user.rows, 'row')}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Restores a Tokkl JSON export: preview first, then import. */
function RestoreJson() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const run = useAction<{ text: string; dryRun: boolean }, RestoreResult>({
    mutationFn: ({ text, dryRun }) => api.post<RestoreResult>(`/api/app/import/json${dryRun ? '?dry_run=true' : ''}`, text),
    onSuccess: (restored, { dryRun }) => {
      setResult(restored);
      if (!dryRun) {
        void invalidate(...IMPORT_KEYS);
        toast.show(`Restored ${plural(restored.time_entries, 'entry', 'entries')}`);
        setFile(null);
        if (input.current) input.current.value = '';
      }
    },
  });
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    setResult(null);
    if (!selected) return setFile(null);
    const text = await selected.text();
    setFile({ name: selected.name, text });
    run.mutate({ text, dryRun: true });
  };
  const verb = result?.dry_run ? 'to add' : 'added';
  return (
    <>
      <h3 className="settings-subheading">Restore a Tokkl export</h3>
      <p className="hint">
        Upload a JSON file from Export JSON, from this or another Tokkl server. Clients, projects, tasks and tags are
        matched by name and created when missing. Entries that are already here get skipped.
      </p>
      <div className="inline-controls settings-row">
        <label className="button button-ghost file-button">
          <Icon name="upload" size={16} /> Choose JSON file
          <input ref={input} type="file" accept=".json,application/json" onChange={(event) => void choose(event)} />
        </label>
        {file ? <span className="muted file-name">{file.name}</span> : null}
      </div>
      {run.isPending ? <p className="hint">{result ? 'Restoring…' : 'Checking the file…'}</p> : null}
      {result ? (
        <div className="import-summary" aria-live="polite">
          <ul className="import-stats">
            <li>{plural(result.time_entries, 'entry', 'entries')} {verb}</li>
            <li>{result.skipped_duplicates} already here, skipped</li>
            <li>{plural(result.projects, 'project')}, {plural(result.clients, 'client')}, {plural(result.tasks, 'task')}, {plural(result.tags, 'tag')} {verb}</li>
            {result.errors.length ? <li className="is-error">{plural(result.errors.length, 'problem')}</li> : null}
          </ul>
          {result.errors.length ? (
            <details className="import-errors">
              <summary>Problems</summary>
              <ul>{result.errors.map((error, i) => <li key={i}>{error.entity} {String(error.id)}: {error.message}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {file && result?.dry_run ? (
        <div className="inline-controls settings-row">
          <button type="button" className="button button-primary" disabled={run.isPending} onClick={() => run.mutate({ text: file.text, dryRun: false })}>
            <Icon name="upload" size={16} /> Restore
          </button>
          <button type="button" className="button button-ghost" onClick={() => { setFile(null); setResult(null); if (input.current) input.current.value = ''; }}>
            Cancel
          </button>
        </div>
      ) : null}
    </>
  );
}

export function DataSection({ timeZone }: { timeZone: string }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  // Only the newest request may show its result, so a slow preview can't overwrite a newer one.
  const latest = useRef(0);

  const runImport = useAction<{ text: string; dryRun: boolean; users: string[]; request: number }, ImportResult>({
    mutationFn: ({ text, dryRun, users }) => api.post<ImportResult>(`${IMPORT_PATH}${importQuery(dryRun, users)}`, text),
    onSuccess: (imported, { dryRun, request }) => {
      if (!dryRun) {
        void invalidate(...IMPORT_KEYS);
        toast.show(`Imported ${plural(imported.created, 'entry', 'entries')}`);
      }
      if (request !== latest.current) return;
      setResult(imported);
      if (!dryRun) {
        // Clear the file so a second click can't import the same rows again.
        setFile(null);
        setSelected([]);
        if (fileInput.current) fileInput.current.value = '';
      }
    },
  });
  const send = (text: string, dryRun: boolean, users: string[]) => {
    latest.current++;
    runImport.mutate({ text, dryRun, users, request: latest.current });
  };

  const exportFile = async (kind: 'json' | 'csv') => {
    setExporting(kind);
    try {
      await download(`/api/app/export.${kind}`, kind === 'json' ? `tokkl-${stamp()}.json` : `tokkl-entries-${stamp()}.csv`);
    } catch (error) {
      toast.error(error);
    } finally {
      setExporting(null);
    }
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    setResult(null);
    setSelected([]);
    if (!chosen) return setFile(null);
    try {
      const text = await chosen.text();
      setFile({ name: chosen.name, text });
      send(text, true, []);
    } catch (error) {
      toast.error(error);
    }
  };

  const reset = () => {
    latest.current++;
    setFile(null);
    setResult(null);
    setSelected([]);
    if (fileInput.current) fileInput.current.value = '';
  };

  // Each change previews again, so the counts describe the chosen users' rows only.
  const toggleUser = (key: string, checked: boolean) => {
    if (!file || !result) return;
    const next = result.users.map((user) => user.key)
      .filter((candidate) => (candidate === key ? checked : selected.includes(candidate)));
    setSelected(next);
    send(file.text, true, next);
  };
  const mustChoose = (result?.users.length ?? 0) > 1;

  return (
    <SettingsCard id="data" title="Data">
      <h3 className="settings-subheading">Export</h3>
      <p className="hint">
        JSON has your clients, projects, tasks, tags, time entries and settings. CSV has one row per time entry, with the
        same columns as the Toggl Track detailed report.
      </p>
      <div className="inline-controls settings-row">
        <button type="button" className="button button-ghost" disabled={exporting !== null} onClick={() => void exportFile('json')}>
          <Icon name="download" size={16} /> Export JSON
        </button>
        <button type="button" className="button button-ghost" disabled={exporting !== null} onClick={() => void exportFile('csv')}>
          <Icon name="download" size={16} /> Export CSV
        </button>
      </div>

      <h3 className="settings-subheading">Import from Toggl Track</h3>
      <p className="hint">
        In Toggl Track, go to Reports → Detailed, pick the date range, then Export → CSV. Upload that file here.
        Times in the file are read in the account timezone, {timeZone}. Entries that are already here get skipped,
        so importing the same file twice is safe.
      </p>
      <div className="inline-controls settings-row">
        <label className="button button-ghost file-button">
          <Icon name="upload" size={16} /> Choose CSV file
          <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event)} />
        </label>
        {file ? <span className="muted file-name">{file.name}</span> : null}
      </div>

      {runImport.isPending ? <p className="hint">{runImport.variables?.dryRun ? 'Checking the file…' : 'Importing…'}</p> : null}
      {file && result?.dry_run && mustChoose ? (
        <ImportUsers users={result.users} selected={selected} onToggle={toggleUser} />
      ) : null}
      {result ? <ImportSummary result={result} /> : null}

      {file && result?.dry_run ? (
        <div className="inline-controls settings-row">
          <button
            type="button"
            className="button button-primary"
            disabled={runImport.isPending || result.created === 0 || (mustChoose && selected.length === 0)}
            onClick={() => send(file.text, false, selected)}
          >
            <Icon name="upload" size={16} /> Import {plural(result.created, 'entry', 'entries')}
          </button>
          <button type="button" className="button button-ghost" onClick={reset}>Cancel</button>
        </div>
      ) : null}

      <RestoreJson />
    </SettingsCard>
  );
}
