import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidate } from '../../../api/invalidate.ts';
import { stale } from '../../../api/keys.ts';
import { transferRequests } from '../../../api/transfer.ts';
import type { JsonRestoreResult } from '../../../api/types.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { useAction } from '../../../components/useAction.ts';
import { plural } from '../ui.tsx';

/** Restores a Tokkl JSON export: preview first, then import. */
export function RestoreJson() {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<JsonRestoreResult | null>(null);
  const run = useAction<{ text: string; dryRun: boolean }, JsonRestoreResult>({
    mutationFn: ({ text, dryRun }) => transferRequests.restoreJson(text, dryRun),
    onSuccess: (restored, { dryRun }) => {
      setResult(restored);
      if (!dryRun) {
        void invalidate(qc, stale.imported);
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
          <input ref={input} type="file" accept=".json,application/json" onChange={event => void choose(event)} />
        </label>
        {file ? <span className="muted file-name">{file.name}</span> : null}
      </div>
      {run.isPending ? <p className="hint">{result ? 'Restoring…' : 'Checking the file…'}</p> : null}
      {result ? (
        <div className="import-summary" aria-live="polite">
          <ul className="import-stats">
            <li>
              {plural(result.time_entries, 'entry', 'entries')} {verb}
            </li>
            <li>{result.skipped_duplicates} already here, skipped</li>
            <li>
              {plural(result.projects, 'project')}, {plural(result.clients, 'client')}, {plural(result.tasks, 'task')},{' '}
              {plural(result.tags, 'tag')} {verb}
            </li>
            {result.errors.length ? <li className="is-error">{plural(result.errors.length, 'problem')}</li> : null}
          </ul>
          {result.errors.length ? (
            <details className="import-errors">
              <summary>Problems</summary>
              <ul>
                {result.errors.map((error, i) => (
                  <li key={i}>
                    {error.entity} {String(error.id)}: {error.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {file && result?.dry_run ? (
        <div className="inline-controls settings-row">
          <button
            type="button"
            className="button button-primary"
            disabled={run.isPending}
            onClick={() => run.mutate({ text: file.text, dryRun: false })}
          >
            <Icon name="upload" size={16} /> Restore
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              setFile(null);
              setResult(null);
              if (input.current) input.current.value = '';
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </>
  );
}
