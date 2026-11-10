import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidate } from '../../../api/invalidate.ts';
import { stale } from '../../../api/keys.ts';
import { transferRequests } from '../../../api/transfer.ts';
import type { ImportResult } from '@tokkl/types';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { useAction } from '../../../components/useAction.ts';
import { t } from '../../../i18n/messages.ts';
import { importCounts, toggledUsers } from './transferForm.ts';

function ImportSummary({ result }: { result: ImportResult }) {
  const { otherUsers, failed } = importCounts(result);
  const preview = result.dry_run;
  return (
    <div className="import-summary" aria-live="polite">
      <ul className="import-stats">
        <li>{t('settings.rowsInFile', { count: result.rows })}</li>
        <li>{t(preview ? 'settings.entriesToImport' : 'settings.entriesImported', { count: result.created })}</li>
        <li>{t('settings.alreadyHere', { count: result.skipped_duplicates })}</li>
        {otherUsers > 0 ? <li>{t('settings.otherUsersRows', { count: otherUsers })}</li> : null}
        {failed > 0 ? <li className="is-error">{t('settings.problemRows', { count: failed })}</li> : null}
      </ul>
      {result.created_projects.length > 0 ? (
        <p>
          {t(preview ? 'settings.newProjects' : 'settings.createdProjects', {
            list: result.created_projects.join(', '),
          })}
        </p>
      ) : null}
      {result.created_clients.length > 0 ? (
        <p>
          {t(preview ? 'settings.newClients' : 'settings.createdClients', { list: result.created_clients.join(', ') })}
        </p>
      ) : null}
      {result.errors.length > 0 ? (
        <details className="import-errors" open={result.errors.length <= 5}>
          <summary>
            {result.errors.length < failed
              ? t('settings.firstProblems', { count: result.errors.length })
              : t('settings.problemCount', { count: result.errors.length })}
          </summary>
          <ul>
            {result.errors.map(error => (
              <li key={error.row}>{t('settings.problemRow', { row: error.row, message: error.message })}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** For a team export: whose rows to import. */
function ImportUsers({
  users,
  selected,
  onToggle,
}: {
  users: ImportResult['users'];
  selected: string[];
  onToggle: (key: string, checked: boolean) => void;
}) {
  return (
    <fieldset className="import-users">
      <legend>{t('settings.importUsers', { count: users.length })}</legend>
      {users.map(user => (
        <label key={user.key} className="field checkbox-field">
          <input
            type="checkbox"
            checked={selected.includes(user.key)}
            onChange={event => onToggle(user.key, event.target.checked)}
          />
          <span>
            {user.user || user.email || t('settings.noTogglUser')}
            {user.user && user.email ? <span className="muted"> {user.email}</span> : null}
            <span className="muted"> · {t('settings.rowCount', { count: user.rows })}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Every file and user choice is previewed before the import. */
export function TogglImport({ timeZone }: { timeZone: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // Only the newest request may show its result, so a slow preview can't overwrite a newer one.
  const latest = useRef(0);

  const runImport = useAction<{ text: string; dryRun: boolean; users: string[]; request: number }, ImportResult>({
    mutationFn: ({ text, dryRun, users }) => transferRequests.importTogglCsv(text, dryRun, users),
    movesTimer: true,
    onSuccess: (imported, { dryRun, request }) => {
      if (!dryRun) {
        void invalidate(qc, stale.imported);
        toast.show(t('settings.imported', { count: imported.created }));
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
    const next = toggledUsers(result.users, selected, key, checked);
    setSelected(next);
    send(file.text, true, next);
  };
  const mustChoose = (result?.users.length ?? 0) > 1;

  return (
    <>
      <h3 className="settings-subheading">{t('settings.importTitle')}</h3>
      <p className="hint">{t('settings.importHint', { timeZone })}</p>
      <div className="inline-controls settings-row">
        <label className="button button-ghost file-button">
          <Icon name="upload" size={16} /> {t('settings.chooseCsv')}
          <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={event => void chooseFile(event)} />
        </label>
        {file ? <span className="muted file-name">{file.name}</span> : null}
      </div>

      {runImport.isPending ? (
        <p className="hint">{runImport.variables?.dryRun ? t('settings.checkingFile') : t('settings.importing')}</p>
      ) : null}
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
            <Icon name="upload" size={16} /> {t('settings.importCount', { count: result.created })}
          </button>
          <button type="button" className="button button-ghost" onClick={reset}>
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
    </>
  );
}
